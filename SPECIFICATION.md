# any-i18n Specification

This document is the implementation reference for the repository. Task-oriented documentation lives
in the [documentation site](https://rennerdo30.github.io/any-i18n/) (source in `docs/`).

## Overview

any-i18n adds multilanguage i18n support to any website at runtime. A Manifest V3 browser extension
scans pages for translatable text and attributes, generates deterministic keys, obtains translations
(directly from an OpenAI-compatible model, from the optional FastAPI server, from the CLI, or by
import), and replaces the content in place with full revert support.

## Components

### Browser extension (`extension/`)

- WebExtensions API + Manifest V3, targeting Chrome and Edge 116+ and Firefox 128+ (no built-in OCR)
- No bundler: content scripts are plain JS files loaded in order by `manifest.json` and share one
  global scope, so top-level declarations use `var`
- Browser shim: `if (typeof browser === 'undefined') var browser = chrome;`
- Content scripts scan the DOM via `TreeWalker`, replace text and attributes, and observe mutations
- The background service worker translates keys (directly against an OpenAI-compatible provider, or
  through the server's SSE stream), imports translation files, indexes bundled translations into
  `browser.storage.local`, owns the context menu and runs image translation
- `shared/providers.js` holds the pure provider helpers (endpoint URLs, prompts, reply parsing,
  batching, settings resolution); it is loaded by the service worker, the options page and the tests
- The popup provides language selection, scan/translate/apply/revert, auto-translate, import/export,
  a key viewer and the active provider
- The options page edits `providerSettings` (provider, endpoints, models, keys, batching, OCR,
  on-page behaviour)
- A floating in-page toolbar (closed shadow root) offers the same core actions without the popup;
  `content/page-ui.js` renders the original-text tooltip, image overlays and notices in a second
  closed shadow root
- An offscreen document (`offscreen/`) hosts the vendored Tesseract.js for the built-in OCR
- UI strings come from `_locales/{en,de}/messages.json`; language names come from
  `Intl.DisplayNames` via `shared/languages.js`
- Command `toggle-translation` (default <kbd>Alt+Shift+T</kbd>) toggles the active tab between
  translated and original; the action badge shows the active language or `…` while translating
- `CANCEL_TRANSLATION` marks running requests for a domain and language cancelled: workers finish
  their current batch (which is still stored) and start no new one; the server stream is cancelled;
  the final result carries `cancelled: true`
- Partial and final results carry `total` (unique strings requested) and `done`
- On first install the options page opens with `?welcome=1` and probes LM Studio and Ollama on their
  default ports (`DETECT_PROVIDERS`)

Permissions: `storage`, `activeTab`, `scripting`, `contextMenus`, `offscreen`; `host_permissions`
for `http://localhost/*`, `http://127.0.0.1/*` and `https://*/*`; optional `http://*/*` for plain-HTTP
providers on other hosts. Content scripts match `http://*/*` and `https://*/*` at `document_idle`.

Content script load order (from `manifest.json`):

```
shared/constants.js, shared/utils.js, shared/storage.js, shared/languages.js,
content/key-generator.js, content/dom-scanner.js, content/text-replacer.js,
content/mutation-handler.js, content/page-ui.js, content/content-script.js, content/toolbar.js
```

### Direct provider translation

- Keys already stored for the domain and language are reported as `cached` and not sent
- The remaining keys are de-duplicated by text and split by count (`batchSize`, per provider) and by
  size (`MAX_BATCH_CHARS`, 6,000 characters)
- Each batch is one chat-completions request: the system prompt names the target language (codes are
  converted with `Intl.DisplayNames`) and demands a JSON array of exactly N strings; the user message
  is the JSON array of source strings
- `parseBatchReply` strips `<think>` blocks and code fences, extracts the outermost array and rejects
  it unless it has exactly N string (or number) items
- A rejected reply is retried once; then each string is translated with a single-string prompt;
  strings that still fail are counted as `failed`
- Up to `parallel` batches run concurrently; every finished batch is merged into storage and
  published as a partial `_translateResult`
- Keys currently in flight for a domain and language are removed from later requests

### Image translation

Context menu → service worker fetches the image (15 s timeout), downscales it to at most 1,600 px,
extracts text with the offscreen Tesseract worker (`ocrLanguages`) or a vision model, translates the
text with the active provider and sends the result to the content script, which shows it below the
image. Results are cached in `imageCache` (newest 200), keyed by provider, model, extractor,
language and image URL.

### Translation server (`server/`)

- FastAPI application, uvicorn entry point in `run.py`, port `39418` by default
- SQLite cache keyed by `(source_hash, target_language)`; all statements parameterized
- Batching: chunks of `BATCH_SIZE` translated by up to `MAX_PARALLEL` threads
- Backends selected by `LLM_BACKEND`: `claude-cli`, `gemini-cli`, `codex-cli` (subprocess,
  `<command> -p <prompt>`, 120 s timeout) or `openai-api`, `anthropic-api` (provider SDKs)
- The streaming endpoint emits SSE events per completed batch, caching each batch before emitting it
- Run from the repository root (`python -m server.run`) — modules import as `server.*`

### CLI (`cli/`)

- Node 18+ ESM package built on `commander`, exposing the `any-i18n` binary
- `translate` invokes the local `claude` command with a single prompt
- `validate` checks structure, empty values, and (optionally) parity with a key export
- `bundle` copies translation JSON files and writes a `_manifest.json` index

### Build system (`scripts/build.js`)

Clears `dist/`, copies `extension/` to `dist/<browser>/` for `chrome`, `firefox`, and `edge`, and
patches the Firefox manifest: `browser_specific_settings.gecko` (`id: any-i18n@extension`,
`strict_min_version: 128.0`), `background.scripts` instead of a service worker, no `offscreen`
permission, and no `offscreen/` or `vendor/` directories.

`scripts/check.js` verifies that every script parses, every manifest path exists and every message
key used in code exists in both locales. `tests/` holds `node --test` unit tests for
`shared/providers.js`.

## Project structure

```
any-i18n/
├── SPECIFICATION.md
├── TODO.md
├── README.md
├── package.json
├── extension/
│   ├── manifest.json
│   ├── _locales/{en,de}/messages.json
│   ├── icons/
│   ├── background/service-worker.js
│   ├── content/
│   │   ├── dom-scanner.js
│   │   ├── key-generator.js
│   │   ├── text-replacer.js
│   │   ├── mutation-handler.js
│   │   ├── page-ui.js
│   │   ├── content-script.js
│   │   └── toolbar.js
│   ├── offscreen/offscreen.{html,js}
│   ├── options/options.{html,js,css}
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   ├── shared/
│   │   ├── constants.js
│   │   ├── utils.js
│   │   ├── storage.js
│   │   ├── providers.js
│   │   └── i18n.js
│   ├── vendor/tesseract/
│   └── translations/manifest.json
├── server/
│   ├── main.py
│   ├── translator.py
│   ├── db.py
│   ├── config.py
│   ├── run.py
│   ├── start.sh
│   └── requirements.txt
├── cli/
│   ├── package.json
│   ├── bin/any-i18n.js
│   └── src/commands/
│       ├── translate.js
│       ├── validate.js
│       └── bundle.js
├── scripts/build.js, scripts/check.js
├── tests/providers.test.mjs
└── docs/                (Astro Starlight documentation site)
```

## Key generation

- `normalizeText`: trim, collapse internal whitespace runs to single spaces
- `isTranslatableText`: reject text shorter than `MIN_TEXT_LENGTH` (2) and text matching
  `^[\d\s\p{P}\p{S}]+$`
- Prefix: first three words, lowercased, non-alphanumerics stripped, joined with `_`; `txt` if none
  remain
- Hash: FNV-1a 32-bit (offset basis `0x811c9dc5`, prime `0x01000193`, `Math.imul`) over the full
  normalized text, hex encoded
- Result: `prefix_hexhash` — deterministic across pages and runs

Example: `"Welcome to our website"` → `welcome_to_our_<hash>`

## DOM scanning

Two `TreeWalker` passes over `document.body`.

**Pass 1 — text nodes** (`NodeFilter.SHOW_TEXT`). Rejected when any ancestor is in `SKIP_TAGS`
(`SCRIPT`, `STYLE`, `NOSCRIPT`, `IFRAME`, `SVG`, `META`, `LINK`, `HEAD`, `TITLE`, `TEXTAREA`),
carries `translate="no"` or is editable, or when the normalized text is not translatable. A node the
extension translated is keyed by its original text (`TextReplacer.originalTextFor`), so rescans of a
translated page produce the same keys.

**Pass 2 — attributes** (`NodeFilter.SHOW_ELEMENT`):

| Attribute | Elements |
| --- | --- |
| `title`, `aria-label` | any element |
| `placeholder` | `INPUT`, `TEXTAREA` |
| `alt` | `IMG` |
| `value` | `INPUT` whose type is in `TRANSLATABLE_INPUT_TYPES` (`submit`, `button`, `reset`) |

`contenteditable` elements are skipped in pass 2.

Each collected entry is `{ node, originalText, key }`, plus `attr` for attribute entries.

## Translation application

- Text nodes are written with `textContent`; attributes with `setAttribute`. `innerHTML` and `eval`
  are never used.
- Originals are stored in a `Map` (text) and a `Map` of `Map` (attributes); two `WeakMap`s track what
  is currently applied so repeated passes skip unchanged nodes.
- Translated elements get a `data-anyi18n` attribute, and a single stylesheet
  (`#anyi18n-translate-styles`) applies `overflow-wrap`, `word-break`, `white-space: normal`, and
  `min-width: 0` to those elements to limit layout damage.
- `revert()` restores every original and removes the markers. `reset()` clears bookkeeping without
  touching the DOM (used after SPA navigation, when nodes are detached).

## SPA support

- `MutationObserver` on `document.body` for `childList`, `subtree`, and `characterData`, debounced
  50 ms; records produced by the extension's own replacements are dropped with `takeRecords()`
- While a language is active, keys found by the observer that have no translation are requested
  after `DYNAMIC_TRANSLATE_DELAY_MS` (800 ms), each key once per page and language
- `history.pushState` and `history.replaceState` are wrapped; `popstate` and `hashchange` are
  observed
- On URL change: reset state, wait 200 ms for the new view, then re-apply the previous language for
  the same host or evaluate the auto-translate configuration

## Long-running translation results

An LLM batch can outlive the extension message port. The service worker answers `{ started: true }`
immediately and publishes progress by writing `_translateResult` to `browser.storage.local`; popup,
toolbar and content script listen on `browser.storage.onChanged` and act on their own `source`
(`popup`, `toolbar`, or `auto`/`page` for the content script) and, where set, on matching `domain`.
Partial results carry `partial: true` and are applied progressively; the final write clears the
flag. Translations are always merged into storage, never replaced.

## Storage layout

| Key | Shape |
| --- | --- |
| `settings` | `{ enabled, autoScan }` |
| `providerSettings` | `{ provider, urls, models, apiKeys, batchSize, parallel, ocrMode, ocrLanguages, visionUrl, visionModel, visionApiKey, showOriginalOnHover, highlightTranslated, showToolbar }` |
| `lastLanguage` | language string |
| `recentLanguages` | up to five language strings, newest first |
| `imageCache` | `{ key: { extractedText, translation, ts } }` |
| `translations` | `{ domain: { language: { key: text } } }` |
| `domainKeys` | `{ domain: { key: sourceText } }` |
| `autoTranslate` | `{ domain: { language, enabled } }` |
| `_translateResult` | `{ success, translations, cached, translated, failed?, partial, source, domain, language, error? }` |

## File formats

### Key export (`_keys.json`)

```json
{
  "_meta": {
    "domain": "example.com",
    "exportedAt": "2026-01-15T10:30:00.000Z",
    "keyCount": 2
  },
  "keys": {
    "welcome_to_our_a1b2c3d4": "Welcome to our website",
    "click_here_to_e5f6a7b8": "Click here to learn more"
  }
}
```

### Translation file (`{lang}.json`)

```json
{
  "_meta": {
    "domain": "example.com",
    "language": "de",
    "translatedAt": "2026-01-15T11:00:00.000Z",
    "sourceVersion": "1.0.0"
  },
  "translations": {
    "welcome_to_our_a1b2c3d4": "Willkommen auf unserer Website",
    "click_here_to_e5f6a7b8": "Klicken Sie hier, um mehr zu erfahren"
  }
}
```

Import requires `_meta.domain`, `_meta.language`, and `translations`. `any-i18n validate` also
requires `_meta.translatedAt`.

### Bundled translation manifest (`extension/translations/manifest.json`)

```json
{
  "_meta": { "version": "1.0.0", "description": "Translation manifest for any-i18n" },
  "domains": {
    "example.com": {
      "languages": ["de", "fr"],
      "lastUpdated": "2026-01-15T11:00:00.000Z"
    }
  }
}
```

Files are loaded from `translations/<domain>/<lang>.json`. Fetch failures are silent, so a package
without translations installs cleanly.

## Server API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/translate` | Translate `{ keys, language, domain? }`; returns `{ translations, cached, translated }` (plus `error` on partial failure) |
| `POST` | `/api/translate/stream` | Same input; SSE stream with `cached`, `batch`, `error`, `done` events |
| `GET` | `/api/languages` | `{ languages: [...] }` from the cache |
| `GET` | `/api/stats` | `{ total, by_language }` |
| `GET` | `/api/health` | `{ status, backend }` |

### Prompt contract

Each batch is sent as JSON where every entry is `{ "t": <source>, "max": <target length> }`. The
response must be a JSON object mapping the same keys to translated strings, with HTML tags and
placeholders preserved and no markdown fences. Responses are fence-stripped before `json.loads`.

Length budgets: `max(len + 8, len * 1.3)` for Latin scripts; `max(len * 6, 20)` when the source
contains CJK characters (Han, Hiragana, Katakana, Hangul, CJK punctuation).

### Cache schema

```sql
CREATE TABLE IF NOT EXISTS translations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_text TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    target_language TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_hash, target_language)
);
CREATE INDEX IF NOT EXISTS idx_hash_lang ON translations(source_hash, target_language);
```

## Configuration

Server environment variables (`server/config.py`): `LLM_BACKEND`, `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `DB_PATH`, `BATCH_SIZE`, `MAX_PARALLEL`,
`SERVER_PORT`. Keys are read from the environment only; nothing is persisted.

Extension constants (`extension/shared/constants.js`): `TOOLBAR_ENABLED`, `MIN_TEXT_LENGTH`,
`SKIP_TAGS`, `TRANSLATABLE_INPUT_TYPES`, `DEFAULT_SETTINGS`, `STORAGE_KEYS`, `MESSAGES`,
`PROVIDER_SETTINGS_KEY`, `DYNAMIC_TRANSLATE_DELAY_MS`, `HOVER_DELAY_MS`. Provider defaults and limits
live in `shared/providers.js`; user choices are stored in `providerSettings`.

## Security considerations

- Content scripts run in the page context: no `eval`, no `innerHTML`; DOM writes use `textContent`
  and `setAttribute` only
- Translation files are JSON only and are validated before import
- All SQL uses parameterized statements
- The extension's network destinations are the configured provider (or translation server), the
  pages' own images (image translation) and the tessdata CDN (OCR language data, built-in OCR only)
- API keys are stored in `browser.storage.local`, never in `storage.sync`, and are sent only to the
  endpoint they belong to
- The server enables permissive CORS and binds `0.0.0.0` with no authentication — it is designed for
  localhost use and must not be exposed to untrusted networks as-is
- Page text is sent to whichever provider the server is configured to use; do not point it at
  confidential pages without understanding that provider's data handling
