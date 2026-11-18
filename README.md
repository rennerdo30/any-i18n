# any-i18n

**Translate any website in place with a local or hosted AI model, and keep the translations as
reusable keys.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-GitHub%20Pages-f97316.svg)](https://rennerdo30.github.io/any-i18n/)

A Manifest V3 browser extension walks the live DOM, gives every visible string and translatable
attribute a deterministic key, sends the missing keys to an AI model and swaps the translations in
place, keeping the originals so the page can be restored exactly. Point it at **LM Studio** or
**Ollama** to keep page text on your machine, or at **OpenAI, DeepSeek, OpenRouter** or any other
OpenAI-compatible API. An optional FastAPI server and a Node CLI cover batch and offline workflows.

📖 **[Documentation](https://rennerdo30.github.io/any-i18n/)**

## Why

Plenty of pages you have to read, demo, or hand to someone else are simply not localized: internal
tools, legacy admin panels, vendor dashboards, single-language docs. Built-in page translation gives
you a black box: nothing is stored, nothing is fixable, and a string has no stable identity.

any-i18n gives every string a reproducible key (`prefix_fnv1ahash`). Each translated key is stored
per site, so a revisit costs no API calls and only new or changed text goes to the model. The whole
translation set is a plain JSON file you can export, fix, diff and ship inside the extension.

## Features

- **Bring your own model**: LM Studio, Ollama, OpenAI, DeepSeek, OpenRouter and any
  OpenAI-compatible endpoint, called directly from the extension (no server needed), or the
  any-i18n server with its CLI backends
- **Per-site translation store**: translations are stored per site and language and reused on every
  visit; only new or changed strings are sent to the provider
- **Robust batching**: configurable strings per request and parallel requests per provider; a
  reply that does not line up is retried, then every string is translated on its own
- **Dynamic content**: text added after translation (single-page apps, infinite scroll, lazy loading)
  is translated automatically, each string once
- **Image translation**: right-click an image → *Translate image text*; text is read by the bundled
  Tesseract OCR (no setup) or a vision model, translated by your provider and shown below the image
- **Hover to compare**: hovering translated text shows the original; translated text can optionally
  be underlined
- **Reversible**: originals are kept in memory and restored on revert, attributes included
- **Auto-translate per site**: remember a site and language and translate on every visit
- **Context menu**: *Translate page* uses the site's auto-translate language or the last one used
- **TreeWalker DOM scan**: text nodes plus `title`, `aria-label`, `placeholder`, `alt` and
  button-like `value` attributes; skips scripts, styles, `<textarea>`, editable content and anything
  marked `translate="no"`
- **SPA aware**: `pushState` / `replaceState` / `popstate` / `hashchange` keep translations applied
- **Floating in-page toolbar** isolated in a closed shadow root
- **Export / import** of keys and translations as JSON, plus a Node CLI (`translate`, `validate`,
  `bundle`)
- **English and German UI**, light and dark theme, `prefers-reduced-motion` respected
- **Multi-browser**: Chrome and Edge 116+; Firefox 128+ (everything except the built-in OCR)

## Install

```bash
git clone https://github.com/rennerdo30/any-i18n.git
cd any-i18n
```

**Chrome / Edge**: open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and
select the `extension/` directory.

**Firefox**: run `npm run build:firefox`, open `about:debugging#/runtime/this-firefox`, click
**Load Temporary Add-on** and select `dist/firefox/manifest.json`.

## Quick start

1. Open the extension's **Settings** (gear icon in the popup) and pick a provider:

   | Provider | Default endpoint | API key | Notes |
   | --- | --- | --- | --- |
   | LM Studio | `http://localhost:1234` | no | Enable CORS in the server settings |
   | Ollama | `http://localhost:11434` | no | Start with `OLLAMA_ORIGINS="*" ollama serve` |
   | OpenAI compatible | `https://api.openai.com` | yes | Also OpenRouter: `https://openrouter.ai/api/v1` |
   | DeepSeek | `https://api.deepseek.com` | yes | Default model `deepseek-v4-flash` |
   | any-i18n server | `http://localhost:39418` | no | See [Translation server](#translation-server) |

2. Press **Test connection**. It also fills the model suggestions from the provider's model list.
3. On any page, open the popup, enter a language (`de`, `fr`, `ja`, `pt-BR`, …) and press
   **Translate**, or right-click the page and choose **Translate page**.
4. Hover translated text to see the original; **Revert** restores the page.

Turn on **Auto-translate this site** to translate a site on every visit. Together with the
per-site store this gives any website a locale for your language: stored strings appear
immediately and only new text is sent to the model.

### Recommended models

| Provider | Recommended | Alternatives |
| --- | --- | --- |
| DeepSeek | `deepseek-v4-flash` | `deepseek-v4-pro` (higher quality) |
| OpenAI | `gpt-5-mini` | `gpt-5-nano` (cheapest), `gpt-5.4-mini` |
| Ollama | `qwen3` | `llama3.3`, `gemma3` |
| LM Studio | the loaded model | leave the model field empty |

### Execution settings

| Setting | Range | Local default | Cloud default |
| --- | --- | --- | --- |
| Strings per request | 1–50 | 10 | 20 |
| Parallel requests | 1–10 | 1 | 4 |

A request is also capped at about 6,000 characters, whatever the batch size.

### Image translation

Right-click an image and choose **Translate image text**. Text extraction runs in one of two modes:

- **Built-in OCR** (default, Chrome and Edge): the bundled Tesseract.js engine runs in an offscreen
  document. Set the OCR languages as `+`-joined Tesseract codes (`eng+deu+jpn`); language data is
  downloaded once from the tessdata CDN and cached.
- **Vision model**: any OpenAI-compatible endpoint with a vision-capable model (`qwen3-vl` via Ollama,
  GPT-5-family models). DeepSeek's hosted API is text only.

The extracted text is translated by the regular provider. Results are cached per image URL.

### Without a model

1. Press **Scan page**, then **Export keys** to download `_keys.json`.
2. Translate the file with the CLI, or by hand.
3. Press **Import**, enter the language, press **Apply**.

## Translation server

The optional FastAPI server batches, caches in SQLite and can use local CLI tools as the model, which
suits large pages and shared caches. Select **any-i18n server** as the provider to use it.

```bash
./server/start.sh          # creates server/.venv, installs deps, starts on :39418
```

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
backends call the provider SDK and need the matching key.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/translate` | Translate a key map, returning cached and freshly translated strings |
| `POST /api/translate/stream` | Same, as an SSE stream (`cached`, `batch`, `error`, `done` events) |
| `GET /api/languages` | Languages present in the cache |
| `GET /api/stats` | Cache totals per language |
| `GET /api/health` | Liveness plus the configured backend |

## Privacy

- Settings, including API keys, are stored in `browser.storage.local` of your browser profile and
  are never synced.
- Page text is sent only to the endpoint you configure. With LM Studio, Ollama or the local server it
  stays on your machine; with a cloud provider their privacy policy applies.
- No analytics, no telemetry, no remote code. The only download besides your provider is OCR language
  data from the tessdata CDN, and only when you use the built-in OCR.

## CLI

```bash
cd cli && npm install

npx any-i18n translate --input _keys.json --language de   # -> de.json
npx any-i18n validate --input de.json --keys _keys.json   # exits non-zero on problems
npx any-i18n bundle --input ./translations --output ../extension/translations
```

`translate` sends one prompt to the local `claude` command. See the
[CLI guide](https://rennerdo30.github.io/any-i18n/guides/cli/), including the known gap between
`bundle`'s output index and the manifest the extension reads.

## Development

```bash
npm run check            # syntax, manifest paths, message keys in both locales
npm test                 # unit tests (node --test)
npm run build            # chrome, firefox, edge -> dist/<browser>/
```

The extension has no build step: load `extension/` directly. The Firefox build switches the
background to an event page and drops the offscreen OCR.

The docs are an Astro Starlight site in `docs/`, deployed to GitHub Pages by
`.github/workflows/deploy.yml` on every push to `main`.

```bash
npm run install:docs
npm run docs:dev
```

## Project structure

```
any-i18n/
├── extension/            Manifest V3 extension (plain JS, no bundler)
│   ├── manifest.json     permissions + content script load order
│   ├── _locales/         UI strings (en, de)
│   ├── shared/           constants, utils, storage, providers (endpoint/prompt/reply helpers), i18n
│   ├── content/          dom-scanner, key-generator, text-replacer, mutation-handler,
│   │                     page-ui (tooltip, image overlay), content-script, toolbar
│   ├── background/       service-worker.js (providers, server stream, context menu, image OCR)
│   ├── offscreen/        offscreen document hosting Tesseract
│   ├── options/          settings page
│   ├── popup/            popup.html, popup.js, popup.css
│   ├── vendor/tesseract/ Tesseract.js (Apache-2.0)
│   ├── translations/     bundled translation manifest
│   └── icons/
├── server/               FastAPI translation service
├── cli/                  Node 22.12+ ESM CLI (commander)
├── tests/                unit tests for the provider helpers
├── scripts/              build.js (per-browser packaging), check.js (static checks)
└── docs/                 Astro Starlight documentation site
```

## How it works

1. **Scan**: content scripts walk `document.body` in two `TreeWalker` passes (text nodes, then
   translatable attributes) and filter out anything too short or purely numeric/punctuation.
2. **Key generation**: each normalized string becomes `firstthreewords_fnv1ahash`. Text we already
   translated keeps the key of its original.
3. **Translate**: keys the site has no translation for go to the provider as a JSON array; the
   reply must be an array of the same length. The any-i18n server streams results over SSE instead.
4. **Apply**: matching keys are written back with `textContent` / `setAttribute`; originals are
   remembered and a defensive stylesheet limits layout damage from longer strings.
5. **Stay applied**: a debounced `MutationObserver` applies stored translations to new nodes and
   requests the missing ones; SPA navigation is detected and handled.
6. **Revert**: every original text node and attribute value is restored.

Because long translation jobs outlive the extension message port, the service worker publishes
progress through `browser.storage.local` and the UI listens on `storage.onChanged`.

## Limitations

- One key per unique string: identical text in different contexts shares one translation.
- Translations are stored per site; the same sentence on another site is translated again.
- The translation server is unauthenticated with open CORS: intended for localhost only.
- `any-i18n bundle` does not yet write the `translations/manifest.json` the extension indexes.
- The built-in OCR needs Chrome or Edge (offscreen documents); Firefox can use a vision model.
- Plain-HTTP providers on other machines (a LAN Ollama) need a one-time permission, requested when
  you press **Test connection**.

## History

any-i18n absorbed [chrome-translator-extension](https://github.com/rennerdo30/chrome-translator-extension)
(now archived): its direct provider support, image translation, hover-to-compare and
localized UI live on here.

## Contributing

Issues and pull requests are welcome. Keep the extension bundler-free, keep DOM writes on
`textContent` / `setAttribute`, keep SQL parameterized, and run `npm run check && npm test`.

## License

[MIT](LICENSE) © rennerdo30. Tesseract.js in `extension/vendor/tesseract/` is Apache-2.0.
