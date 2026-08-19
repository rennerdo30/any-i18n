import json
import logging
import queue
import re
import shutil
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from server.config import (
    LLM_BACKEND, OPENAI_API_KEY, ANTHROPIC_API_KEY,
    OPENAI_MODEL, ANTHROPIC_MODEL, BATCH_SIZE, MAX_PARALLEL
)

log = logging.getLogger(__name__)

TRANSLATION_PROMPT = (
    "Translate the following JSON to {language}. "
    "Each entry has \"t\" (text to translate) and \"max\" (target character length). "
    "Return ONLY a valid JSON object mapping the same keys to translated strings (not objects). "
    "Keep each translation as close to \"max\" characters as possible. "
    "Use concise phrasing, shorter synonyms, or abbreviations when needed to stay compact. "
    "Prioritize natural, readable translations that fit the UI context. "
    "Preserve any HTML tags, placeholders, or special formatting in the values. "
    "Do not add any explanation, markdown formatting, or code fences."
)


def _has_cjk(text):
    """Check if text contains CJK characters (Chinese, Japanese, Korean)."""
    for ch in text:
        cp = ord(ch)
        if (0x4E00 <= cp <= 0x9FFF    # CJK Unified Ideographs
                or 0x3400 <= cp <= 0x4DBF  # CJK Extension A
                or 0x3040 <= cp <= 0x309F  # Hiragana
                or 0x30A0 <= cp <= 0x30FF  # Katakana
                or 0xAC00 <= cp <= 0xD7AF  # Hangul Syllables
                or 0x3000 <= cp <= 0x303F):  # CJK Punctuation
            return True
    return False


def _max_length(text):
    """Calculate max allowed translation length for a source text.
    CJK text is extremely dense (~1 char = 1-2 English words), so it needs
    much more expansion room. Latin scripts allow ~30% growth."""
    n = len(text)
    if _has_cjk(text):
        return max(n * 6, 20)
    return max(n + 8, int(n * 1.3))


def _build_prompt(texts, language):
    instruction = TRANSLATION_PROMPT.format(language=language)
    annotated = {}
    for key, text in texts.items():
        annotated[key] = {"t": text, "max": _max_length(text)}
    payload = json.dumps(annotated, ensure_ascii=False)
    return f"{instruction}\n\n{payload}"


def _parse_json_response(raw):
    """Extract JSON from a response that might contain markdown fences."""
    text = raw.strip()
    # Strip markdown code fences: ```json ... ``` or ``` ... ```
    match = re.search(r"```(?:json)?\s*\n(.*?)```", text, re.DOTALL)
    if match:
        text = match.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        log.error("Failed to parse LLM response as JSON: %s\nRaw response:\n%s", e, raw[:500])
        raise ValueError(f"LLM returned invalid JSON: {e}") from e


def _translate_cli(command, texts, language):
    """Translate via a CLI tool (claude, gemini, codex) that accepts -p flag."""
    if not shutil.which(command):
        raise RuntimeError(f"CLI tool '{command}' not found in PATH")

    prompt = _build_prompt(texts, language)
    log.info("Calling %s CLI for %d texts -> %s", command, len(texts), language)
    try:
        result = subprocess.run(
            [command, "-p", prompt],
            capture_output=True, text=True, timeout=120
        )
    except subprocess.TimeoutExpired:
        log.error("%s CLI timed out after 120s", command)
        raise RuntimeError(f"{command} CLI timed out after 120 seconds")

    if result.returncode != 0:
        log.error("%s CLI exited %d: %s", command, result.returncode, result.stderr[:300])
        raise RuntimeError(f"{command} CLI failed (exit {result.returncode}): {result.stderr[:200]}")

    log.debug("%s CLI response length: %d chars", command, len(result.stdout))
    return _parse_json_response(result.stdout)


def _translate_openai_api(texts, language):
    import openai
    client = openai.OpenAI(api_key=OPENAI_API_KEY)
    prompt = _build_prompt(texts, language)
    log.info("Calling OpenAI API (%s) for %d texts -> %s", OPENAI_MODEL, len(texts), language)
    response = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1
    )
    return _parse_json_response(response.choices[0].message.content)


def _translate_anthropic_api(texts, language):
    import anthropic
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    prompt = _build_prompt(texts, language)
    log.info("Calling Anthropic API (%s) for %d texts -> %s", ANTHROPIC_MODEL, len(texts), language)
    response = client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}]
    )
    return _parse_json_response(response.content[0].text)


# Map backend names to their translate functions
_CLI_BACKENDS = {
    "claude-cli": "claude",
    "gemini-cli": "gemini",
    "codex-cli": "codex",
}


def _translate_single_batch(texts, language):
    """Translate a single batch via the configured backend."""
    if LLM_BACKEND in _CLI_BACKENDS:
        return _translate_cli(_CLI_BACKENDS[LLM_BACKEND], texts, language)
    elif LLM_BACKEND == "openai-api":
        return _translate_openai_api(texts, language)
    elif LLM_BACKEND == "anthropic-api":
        return _translate_anthropic_api(texts, language)
    else:
        raise ValueError(f"Unknown LLM_BACKEND: {LLM_BACKEND}")


def translate_batch(texts, language, on_batch_done=None):
    """Translate a dict of {key: source_text} to the target language.
    Splits into chunks of BATCH_SIZE and runs up to MAX_PARALLEL at once.
    Calls on_batch_done(source_chunk, result_chunk) after each successful chunk
    so results can be cached incrementally.
    Returns merged dict of {key: translated_text}."""
    if not texts:
        return {}

    items = list(texts.items())
    total = len(items)
    chunks = [dict(items[i:i + BATCH_SIZE]) for i in range(0, total, BATCH_SIZE)]
    batch_count = len(chunks)
    workers = min(MAX_PARALLEL, batch_count)

    log.info("translate_batch: %d texts -> %s via %s (batch_size=%d, batches=%d, parallel=%d)",
             total, language, LLM_BACKEND, BATCH_SIZE, batch_count, workers)

    all_translated = {}
    errors = []

    def run_chunk(batch_num, chunk):
        log.info("Batch %d/%d: %d texts", batch_num, batch_count, len(chunk))
        result = _translate_single_batch(chunk, language)
        log.info("Batch %d/%d done: got %d translations", batch_num, batch_count, len(result))
        return batch_num, chunk, result

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(run_chunk, i + 1, chunk): i
            for i, chunk in enumerate(chunks)
        }
        for future in as_completed(futures):
            try:
                batch_num, chunk, result = future.result()
                all_translated.update(result)
                if on_batch_done:
                    on_batch_done(chunk, result)
            except Exception as e:
                idx = futures[future]
                log.error("Batch %d/%d failed: %s", idx + 1, batch_count, e)
                errors.append(str(e))

    if errors and not all_translated:
        raise RuntimeError(f"All batches failed. First error: {errors[0]}")

    if errors:
        log.warning("%d/%d batches failed, %d translations succeeded", len(errors), batch_count, len(all_translated))

    return all_translated


def translate_batch_generator(texts, language):
    """Generator variant of translate_batch that yields results as batches complete.
    Yields (batch_num, batch_total, source_chunk, result_chunk) tuples.
    Uses a queue to bridge between ThreadPoolExecutor callbacks and the generator."""
    if not texts:
        return

    items = list(texts.items())
    total = len(items)
    chunks = [dict(items[i:i + BATCH_SIZE]) for i in range(0, total, BATCH_SIZE)]
    batch_count = len(chunks)
    workers = min(MAX_PARALLEL, batch_count)

    log.info("translate_batch_generator: %d texts -> %s via %s (batch_size=%d, batches=%d, parallel=%d)",
             total, language, LLM_BACKEND, BATCH_SIZE, batch_count, workers)

    q = queue.Queue()

    def run_chunk(batch_num, chunk):
        log.info("Batch %d/%d: %d texts", batch_num, batch_count, len(chunk))
        result = _translate_single_batch(chunk, language)
        log.info("Batch %d/%d done: got %d translations", batch_num, batch_count, len(result))
        return batch_num, chunk, result

    def run_all():
        completed = 0
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(run_chunk, i + 1, chunk): i
                for i, chunk in enumerate(chunks)
            }
            for future in as_completed(futures):
                try:
                    batch_num, chunk, result = future.result()
                    q.put((batch_num, batch_count, chunk, result))
                except Exception as e:
                    idx = futures[future]
                    log.error("Batch %d/%d failed: %s", idx + 1, batch_count, e)
                    q.put(('error', idx + 1, batch_count, str(e)))
                completed += 1
        q.put(None)  # Sentinel to signal completion

    thread = threading.Thread(target=run_all, daemon=True)
    thread.start()

    while True:
        try:
            item = q.get(timeout=0.5)
        except queue.Empty:
            continue
        if item is None:
            break
        yield item
