# any-i18n

Browser extension that adds multilanguage i18n support to any website.

## Project Structure

- `extension/` - Browser extension (Manifest V3, WebExtensions API)
  - `shared/` - Constants, utilities, storage abstraction (loaded first)
  - `content/` - Content scripts for DOM scanning and translation
  - `background/` - Service worker for translation indexing
  - `popup/` - Extension popup UI
  - `translations/` - Bundled translation files
- `cli/` - Node.js CLI tool for translation management
- `scripts/` - Build and utility scripts

## Development

### Load Extension (Chrome)
1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" → select `extension/` directory

### Load Extension (Firefox)
1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on" → select `extension/manifest.json`

### Build for Distribution
```bash
node scripts/build.js          # Build all browsers
node scripts/build.js --browser chrome  # Chrome only
```

### CLI Tool
```bash
cd cli && npm install
npx any-i18n translate --input keys.json --language de
npx any-i18n validate --input de.json --keys keys.json
npx any-i18n bundle --input ./translations --output ../extension/translations
```

## Conventions

- No bundler - plain JS files loaded via manifest content_scripts
- Browser shim: `if (typeof browser === 'undefined') var browser = chrome;`
- Content script files share global scope (loaded in order from manifest)
- Use `var` for top-level shared declarations in content scripts
- CLI is ESM (type: module)
- Translation keys: `prefix_fnv1ahash` format (deterministic)

## Key Files

| File | Purpose |
|------|---------|
| extension/manifest.json | Extension config, content script load order |
| extension/shared/constants.js | All constants, message types, browser shim |
| extension/content/content-script.js | Main content script orchestrator |
| extension/background/service-worker.js | Translation indexing, message handling |
| extension/popup/popup.js | Popup UI logic |
| cli/bin/any-i18n.js | CLI entry point |

## Testing

1. Load extension in browser
2. Visit any website
3. Click popup → Scan Page
4. Export keys → validate JSON format
5. Run CLI translate on exported keys
6. Import translation → Apply → verify text changes
7. Revert → verify text restores
