import logging
import time
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from server.db import init_db, get_cached_batch, set_cached_batch, get_stats, get_languages
from server.translator import translate_batch
from server.config import LLM_BACKEND

log = logging.getLogger(__name__)

app = FastAPI(title="any-i18n Translation Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class TranslateRequest(BaseModel):
    keys: dict[str, str]  # { translation_key: source_text }
    language: str
    domain: str = ""


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    ms = (time.time() - start) * 1000
    log.info("%s %s %d (%.0fms)", request.method, request.url.path, response.status_code, ms)
    return response


@app.on_event("startup")
def startup():
    init_db()
    log.info("Translation server started (backend=%s)", LLM_BACKEND)


@app.post("/api/translate")
def translate(req: TranslateRequest):
    log.info("Translate request: domain=%s lang=%s keys=%d", req.domain, req.language, len(req.keys))

    key_to_text = req.keys
    all_hashes = list(key_to_text.keys())

    # Check cache
    cached = get_cached_batch(all_hashes, req.language)
    log.info("Cache: %d hits / %d total", len(cached), len(all_hashes))

    # Determine uncached keys
    uncached_keys = {k: v for k, v in key_to_text.items() if k not in cached}

    translated = {}
    if uncached_keys:
        # Cache each batch incrementally so partial progress is saved on failure
        def on_batch_done(source_chunk, result_chunk):
            entries = []
            for key, source_text in source_chunk.items():
                if key in result_chunk:
                    entries.append((source_text, key, result_chunk[key]))
            set_cached_batch(entries, req.language)
            log.info("Cached batch: %d translations", len(entries))

        try:
            translated = translate_batch(uncached_keys, req.language, on_batch_done=on_batch_done)
        except Exception as e:
            log.error("Translation failed: %s", e)
            # Return whatever we have so far (cached + any batches that succeeded)
            partial = {**cached, **translated}
            return {"translations": partial, "cached": len(cached), "translated": len(translated), "error": str(e)}

    # Merge cached + newly translated
    result = {}
    for key in all_hashes:
        if key in cached:
            result[key] = cached[key]
        elif key in translated:
            result[key] = translated[key]

    return {
        "translations": result,
        "cached": len(cached),
        "translated": len(translated),
    }


@app.get("/api/languages")
def languages():
    return {"languages": get_languages()}


@app.get("/api/stats")
def stats():
    return get_stats()


@app.get("/api/health")
def health():
    return {"status": "ok", "backend": LLM_BACKEND}
