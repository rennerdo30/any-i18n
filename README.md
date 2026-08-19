# any-i18n

**Add multilanguage support to any website — at runtime, without touching its source.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-GitHub%20Pages-f97316.svg)](https://rennerdo30.github.io/any-i18n/)

A Manifest V3 browser extension walks the live DOM with a `TreeWalker`, collects every visible text
node and translatable attribute, turns each string into a deterministic key, and swaps translations
in place — keeping the originals so the page can be restored exactly. A local FastAPI server
translates and caches batches of keys, and a Node CLI does the same job offline on exported JSON.

📖 **[Documentation](https://rennerdo30.github.io/any-i18n/)**

## Why

Plenty of pages you have to read, demo, or hand to someone else are simply not localized: internal
tools, legacy admin panels, vendor dashboards, single-language docs. Built-in page translation gives
you a black box — nothing is stored, nothing is fixable, and a string has no stable identity.

any-i18n gives every string a reproducible key (`prefix_fnv1ahash`). Fix a translation once and it
keeps applying on every later visit; the whole translation set is a plain JSON file you own, can diff,
and can ship inside the extension.

## Features

- **TreeWalker DOM scan** — text nodes plus `title`, `aria-label`, `placeholder`, `alt`, and
  button-like `value` attributes; skips `SCRIPT`, `STYLE`, `SVG`, `HEAD`, `TITLE`, `IFRAME`,
  `NOSCRIPT`, `META`, `LINK` and anything marked `translate="no"`
- **Deterministic keys** — FNV-1a 32-bit hash of the normalized text, prefixed with its first three
  words, so the same sentence always resolves to the same key
- **Reversible** — originals are kept in memory and restored on revert, attributes included
- **SPA aware** — a debounced `MutationObserver` plus `pushState` / `replaceState` / `popstate` /
  `hashchange` interception keeps translations applied through client-side navigation
- **Floating in-page toolbar** — draggable, isolated in a closed shadow root, pre-filled from
  `navigator.language`
- **Auto-translate per site** — remember a hostname and language and translate on load
- **Streaming translation server** — FastAPI + SQLite cache, batched and parallel, results streamed
  over SSE and applied as they arrive
- **Pluggable backends** — three local CLI tools or two HTTP APIs, selected by one env var
- **Node CLI** — `translate`, `validate`, `bundle`
- **Multi-browser** — Chrome, Edge, and Firefox 109+ (Manifest V3), no bundler, no build step for
  development

## Install

```bash
git clone https://github.com/rennerdo30/any-i18n.git
cd any-i18n
```

**Chrome / Edge** — open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**,
select the `extension/` directory.

**Firefox** — open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, select
`extension/manifest.json`.

The extension has no dependencies: the content scripts are plain JavaScript loaded in order by the
manifest.

## Usage

### With the translation server

```bash
./server/start.sh          # creates server/.venv, installs deps, starts on :39418
```

1. Open any page, click the floating globe button (or the extension popup).
2. Enter a language code (`de`, `fr`, `es`, …) and press **Translate**.
3. Text is replaced batch by batch as results stream in; **Revert** restores the page.

Turn on **Auto-translate this site** in the popup to do all of that automatically on later visits.

### Without a server

1. Press **Scan Page**, then **Export Keys** to download `_keys.json`.
2. Translate the file — with the CLI, or by hand.
3. Press **Import**, pick the language, press **Apply**.

## Configuration

Server settings are read from the environment (`server/config.py`):

| Variable | Default | Description |
| --- | --- | --- |
| `LLM_BACKEND` | `claude-cli` | One of `claude-cli`, `gemini-cli`, `codex-cli`, `openai-api`, `anthropic-api` |
| `OPENAI_API_KEY` | *(empty)* | Credential for the `openai-api` backend |
| `ANTHROPIC_API_KEY` | *(empty)* | Credential for the `anthropic-api` backend |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model id for the `openai-api` backend |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-20250514` | Model id for the `anthropic-api` backend |
| `DB_PATH` | `server/translations.db` | SQLite translation cache |
| `BATCH_SIZE` | `50` | Max strings per provider call |
| `MAX_PARALLEL` | `5` | Max concurrent provider calls |
| `SERVER_PORT` | `39418` | Port uvicorn binds |

The `*-cli` backends shell out to a command of that name on your `PATH` and need no key; the `*-api`
backends call the provider SDK and need the matching key. Nothing is written to disk but the cache —
export keys in your shell and keep them out of version control.

Extension behaviour is controlled by constants in `extension/shared/constants.js`
(`TRANSLATION_SERVER_URL`, `TOOLBAR_ENABLED`, `MIN_TEXT_LENGTH`, `SKIP_TAGS`, …). Note that the
server URL also appears in `extension/background/service-worker.js` and in `host_permissions` in
`extension/manifest.json` — change all three together.

Full reference: **[Configuration](https://rennerdo30.github.io/any-i18n/getting-started/configuration/)**.

## Server API

| Endpoint | Purpose |
| --- | --- |
| `POST /api/translate` | Translate a key map, returning cached and freshly translated strings |
| `POST /api/translate/stream` | Same, as an SSE stream (`cached`, `batch`, `error`, `done` events) |
| `GET /api/languages` | Languages present in the cache |
| `GET /api/stats` | Cache totals per language |
| `GET /api/health` | Liveness plus the configured backend |

```bash
curl http://localhost:39418/api/health
# {"status":"ok","backend":"claude-cli"}
```

## CLI

```bash
cd cli && npm install

npx any-i18n translate --input _keys.json --language de   # -> de.json
npx any-i18n validate --input de.json --keys _keys.json   # exits non-zero on problems
npx any-i18n bundle --input ./translations --output ../extension/translations
```

`translate` sends one prompt to the local `claude` command; the server is the better choice for large
pages because it batches, parallelizes, and caches. `validate` is CI-friendly. See the
[CLI guide](https://rennerdo30.github.io/any-i18n/guides/cli/) — including the known gap between
`bundle`'s output index and the manifest the extension reads.

## Build for distribution

```bash
npm run build            # chrome, firefox, edge -> dist/<browser>/
npm run build:chrome
npm run build:firefox
npm run build:edge
```

Each run clears `dist/`, copies `extension/`, and patches the Firefox manifest with
`browser_specific_settings.gecko`.

## Documentation site

The docs are an Astro Starlight site in `docs/`, deployed to GitHub Pages by
`.github/workflows/deploy.yml` on every push to `main`.

```bash
npm run install:docs
npm run docs:dev
npm run docs:build
```

## Project structure

```
any-i18n/
├── extension/            Manifest V3 extension (plain JS, no bundler)
│   ├── manifest.json     permissions + content script load order
│   ├── shared/           constants.js, utils.js, storage.js
│   ├── content/          dom-scanner, key-generator, text-replacer,
│   │                     mutation-handler, content-script, toolbar
│   ├── background/       service-worker.js (server calls, import, indexing)
│   ├── popup/            popup.html, popup.js, popup.css, browser-shim.js
│   ├── translations/     bundled translation manifest
│   └── icons/
├── server/               FastAPI translation service
│   ├── main.py           HTTP + SSE endpoints
│   ├── translator.py     backends, batching, prompt, length budgets
│   ├── db.py             SQLite cache (parameterized statements)
│   ├── config.py         environment configuration
│   ├── run.py            uvicorn entry point
│   └── start.sh          venv bootstrap + run
├── cli/                  Node 18+ ESM CLI (commander)
│   ├── bin/any-i18n.js
│   └── src/commands/     translate.js, validate.js, bundle.js
├── scripts/build.js      per-browser packaging
└── docs/                 Astro Starlight documentation site
```

## How it works

1. **Scan** — content scripts walk `document.body` in two `TreeWalker` passes (text nodes, then
   translatable attributes) and filter out anything too short or purely numeric/punctuation.
2. **Key generation** — each normalized string becomes `firstthreewords_fnv1ahash`.
3. **Translate** — unknown keys go to the local server (cache first, provider second) or are exported
   and translated with the CLI.
4. **Apply** — matching keys are written back with `textContent` / `setAttribute`; originals are
   remembered and a defensive stylesheet limits layout damage from longer strings.
5. **Stay applied** — a 50 ms-debounced `MutationObserver` translates new nodes; SPA navigation is
   detected and handled.
6. **Revert** — every original text node and attribute value is restored.

Because long translation jobs outlive the extension message port, the service worker publishes
progress through `browser.storage.local` and the UI listens on `storage.onChanged`.

## Tech stack

| Part | Stack |
| --- | --- |
| Extension | Vanilla JavaScript, WebExtensions API, Manifest V3, Shadow DOM, no bundler |
| Server | Python 3.10+, FastAPI, uvicorn, SQLite, `openai` / `anthropic` SDKs |
| CLI | Node.js 18+, ESM, `commander` |
| Docs | Astro, Starlight, `starlight-theme-galaxy`, GitHub Pages |

## Limitations

- One key per unique string: identical text in different contexts shares one translation.
- The translation server is unauthenticated with open CORS — intended for localhost only.
- `any-i18n bundle` does not yet write the `translations/manifest.json` the extension indexes.
- The extension UI is English only.
- No automated test suite yet.

## Contributing

Issues and pull requests are welcome. Keep the extension bundler-free, keep DOM writes on
`textContent` / `setAttribute`, and keep SQL parameterized.

## License

[MIT](LICENSE) © rennerdo30
