# any-i18n Specification

This document is the implementation reference for the repository. Task-oriented documentation lives
in the [documentation site](https://rennerdo30.github.io/any-i18n/) (source in `docs/`).

## Overview

any-i18n adds multilanguage i18n support to any website at runtime. A Manifest V3 browser extension
scans pages for translatable text and attributes, generates deterministic keys, obtains translations
(from a local FastAPI server, from the CLI, or by import), and replaces the content in place with
full revert support.

## Components

### Browser extension (`extension/`)

- WebExtensions API + Manifest V3, targeting Chrome, Edge, and Firefox 109+
- No bundler: content scripts are plain JS files loaded in order by `manifest.json` and share one
  global scope, so top-level declarations use `var`
- Browser shim: `if (typeof browser === 'undefined') var browser = chrome;`
- Content scripts scan the DOM via `TreeWalker`, replace text and attributes, and observe mutations
- The background service worker calls the translation server, imports translation files, and indexes
  bundled translations into `browser.storage.local`
- The popup provides language selection, scan/translate/apply/revert, auto-translate, import/export,
  and a key viewer
- A floating in-page toolbar (closed shadow root) offers the same core actions without the popup

Permissions: `storage`, `activeTab`, `scripting`, and `host_permissions` for
`http://localhost:39418/*`. Content scripts match `<all_urls>` at `document_idle`.

Content script load order (from `manifest.json`):

```
shared/constants.js, shared/utils.js, shared/storage.js,
content/key-generator.js, content/dom-scanner.js, content/text-replacer.js,
content/mutation-handler.js, content/content-script.js, content/toolbar.js
```

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
patches the Firefox manifest with `browser_specific_settings.gecko`
(`id: any-i18n@extension`, `strict_min_version: 109.0`).

## Project structure

```
any-i18n/
├── SPECIFICATION.md
├── TODO.md
├── README.md
├── package.json
├── extension/
│   ├── manifest.json
│   ├── icons/
│   ├── background/service-worker.js
│   ├── content/
│   │   ├── dom-scanner.js
│   │   ├── key-generator.js
│   │   ├── text-replacer.js
│   │   ├── mutation-handler.js
│   │   ├── content-script.js
│   │   └── toolbar.js
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js
│   │   ├── popup.css
│   │   └── browser-shim.js
│   ├── shared/
│   │   ├── constants.js
│   │   ├── utils.js
│   │   └── storage.js
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
├── scripts/build.js
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
(`SCRIPT`, `STYLE`, `NOSCRIPT`, `IFRAME`, `SVG`, `META`, `LINK`, `HEAD`, `TITLE`) or carries
`translate="no"`, or when the normalized text is not translatable.

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
  50 ms, with a `_processing` guard so self-inflicted mutations are ignored
- `history.pushState` and `history.replaceState` are wrapped; `popstate` and `hashchange` are
  observed
- On URL change: reset state, wait 200 ms for the new view, then re-apply the previous language for
  the same host or evaluate the auto-translate configuration

## Long-running translation results

An LLM batch can outlive the extension message port. The service worker answers `{ started: true }`
immediately and publishes progress by writing `_translateResult` to `browser.storage.local`; popup
and content script listen on `browser.storage.onChanged`. Streaming batches carry `partial: true` and
are applied progressively; the final write clears the flag.

## Storage layout

| Key | Shape |
| --- | --- |
| `settings` | `{ enabled, autoScan, highlightTranslated }` |
| `translations` | `{ domain: { language: { key: text } } }` |
| `domainKeys` | `{ domain: { key: sourceText } }` |
| `autoTranslate` | `{ domain: { language, enabled } }` |
| `_translateResult` | `{ success, translations, cached, translated, partial, source, error? }` |

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

Extension constants (`extension/shared/constants.js`): `TRANSLATION_SERVER_URL`, `TOOLBAR_ENABLED`,
`MIN_TEXT_LENGTH`, `SKIP_TAGS`, `TRANSLATABLE_INPUT_TYPES`, `DEFAULT_SETTINGS`, `STORAGE_KEYS`,
`MESSAGES`. `TRANSLATION_SERVER_URL` is duplicated in `background/service-worker.js` (separate
scope), and the host also appears in `manifest.json` `host_permissions`.

## Security considerations

- Content scripts run in the page context: no `eval`, no `innerHTML`; DOM writes use `textContent`
  and `setAttribute` only
- Translation files are JSON only and are validated before import
- All SQL uses parameterized statements
- The extension's only network destination is the configured translation server
- The server enables permissive CORS and binds `0.0.0.0` with no authentication — it is designed for
  localhost use and must not be exposed to untrusted networks as-is
- Page text is sent to whichever provider the server is configured to use; do not point it at
  confidential pages without understanding that provider's data handling
