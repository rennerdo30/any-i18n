# any-i18n

Add multilanguage i18n support to **any** website.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A browser extension that scans pages for translatable text, generates deterministic keys, and applies translations at runtime — no website source code changes required.

## Features

- **DOM scanning** — TreeWalker-based text extraction with smart filtering
- **Deterministic keys** — FNV-1a 32-bit hashing for stable, reproducible translation keys
- **SPA support** — MutationObserver watches for dynamic content changes
- **Floating toolbar** — in-page controls for quick language switching
- **Multi-browser** — Chrome, Firefox, and Edge (Manifest V3)
- **Translation server** — FastAPI server with pluggable LLM backends (Claude, Gemini, Codex, OpenAI API, Anthropic API)
- **CLI tool** — translate, validate, and bundle translation files

## Quick Start

### Chrome

1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` directory

### Firefox

1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on** → select `extension/manifest.json`

### Usage

1. Visit any website
2. Click the any-i18n popup → **Scan Page**
3. Export keys → translate → import translations → **Apply**

## Translation Server

The server provides an HTTP API for translating keys using various LLM backends.

```bash
cd server
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Configure via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_BACKEND` | `claude-cli` | Backend: `claude-cli`, `gemini-cli`, `codex-cli`, `openai-api`, `anthropic-api` |
| `OPENAI_API_KEY` | | Required for `openai-api` backend |
| `ANTHROPIC_API_KEY` | | Required for `anthropic-api` backend |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model for OpenAI backend |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-20250514` | Model for Anthropic backend |
| `BATCH_SIZE` | `50` | Max keys per LLM call |
| `MAX_PARALLEL` | `5` | Max concurrent LLM calls |
| `SERVER_PORT` | `39418` | Server port |

```bash
python run.py
```

## CLI

```bash
cd cli && npm install
```

```bash
# Translate keys using Claude Code CLI
npx any-i18n translate --input keys.json --language de

# Validate translations against source keys
npx any-i18n validate --input de.json --keys keys.json

# Bundle translations for the extension
npx any-i18n bundle --input ./translations --output ../extension/translations
```

## Build for Distribution

```bash
node scripts/build.js                    # All browsers
node scripts/build.js --browser chrome   # Chrome only
node scripts/build.js --browser firefox  # Firefox only
```

Outputs to `dist/{browser}/` with per-browser manifest patching.

## Project Structure

```
any-i18n/
├── extension/
│   ├── manifest.json
│   ├── icons/
│   ├── background/
│   │   └── service-worker.js
│   ├── content/
│   │   ├── dom-scanner.js
│   │   ├── key-generator.js
│   │   ├── text-replacer.js
│   │   ├── mutation-handler.js
│   │   └── content-script.js
│   ├── popup/
│   │   ├── popup.html, popup.js, popup.css
│   ├── shared/
│   │   ├── constants.js, utils.js, storage.js
│   └── translations/
│       └── manifest.json
├── server/
│   ├── main.py, run.py, config.py
│   ├── translator.py, db.py
│   └── requirements.txt
├── cli/
│   ├── bin/any-i18n.js
│   └── src/commands/
│       ├── translate.js, validate.js, bundle.js
└── scripts/
    └── build.js
```

## How It Works

1. **Scan** — Content scripts walk the DOM with TreeWalker, extracting visible text nodes
2. **Key generation** — Each text gets a deterministic key: `prefix_fnv1ahash` (first 3 words + FNV-1a 32-bit hash)
3. **Export** — Keys are exported as JSON for translation
4. **Translate** — Use the server, CLI, or translate manually
5. **Apply** — Import translations and the extension replaces text nodes in-place, storing originals for revert
6. **Live updates** — MutationObserver translates dynamically added content (50ms debounce)

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

[MIT](LICENSE)
