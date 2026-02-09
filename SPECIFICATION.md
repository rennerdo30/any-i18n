# any-i18n Specification

## Overview

any-i18n is a browser extension that adds multilanguage i18n support to any website. It scans pages for translatable text, exports key collections, integrates with a CLI tool that uses Claude Code to translate, and applies translations at runtime.

## Architecture

### Browser Extension
- WebExtensions API + Manifest V3 for cross-browser support (Chrome, Firefox, Edge)
- Content scripts scan the DOM via TreeWalker, replace text, and observe mutations
- Background service worker indexes bundled translations into `browser.storage.local`
- Popup UI provides language selection, key collection management, and import/export

### CLI Tool
- Node.js CLI tool calls Claude Code CLI to perform translations
- Supports translating, validating, and bundling translation files

### Build System
- Build script packages the extension for each browser with manifest patching

## Project Structure

```
any-i18n/
├── SPECIFICATION.md
├── CLAUDE.md
├── TODO.md
├── package.json
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
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   ├── shared/
│   │   ├── constants.js
│   │   ├── utils.js
│   │   └── storage.js
│   └── translations/
│       └── manifest.json
├── cli/
│   ├── package.json
│   ├── bin/
│   │   └── any-i18n.js
│   └── src/
│       └── commands/
│           ├── translate.js
│           ├── validate.js
│           └── bundle.js
└── scripts/
    └── build.js
```

## Key Generation

### Algorithm
- Uses FNV-1a 32-bit hash
- Format: `prefix_hexhash` where prefix is the first 3 words of the text, lowercased
- Deterministic: the same text always produces the same key

### Example
- Input: `"Welcome to our website"`
- Prefix: `welcome_to_our`
- Hash: FNV-1a 32-bit of the full text
- Result: `welcome_to_our_a1b2c3d4`

## DOM Scanning

### Strategy
- Uses the TreeWalker API with `NodeFilter.SHOW_TEXT` for efficient DOM traversal
- Walks the entire document body to find all text nodes

### Skip List
The following elements are skipped during scanning:
- `SCRIPT`
- `STYLE`
- `NOSCRIPT`
- `IFRAME`
- `SVG`
- `META`
- `LINK`
- `HEAD`

### Text Filtering
- Minimum text length: 2 characters
- Ignores text that consists only of numbers and/or punctuation
- Trims whitespace before evaluation

## Translation File Format

### Key Export File (`_keys.json`)
```json
{
  "_meta": {
    "domain": "example.com",
    "exportedAt": "2026-01-15T10:30:00.000Z",
    "version": "1.0.0"
  },
  "keys": {
    "welcome_to_our_a1b2c3d4": "Welcome to our website",
    "click_here_to_e5f6a7b8": "Click here to learn more"
  }
}
```

### Translation File (`{lang}.json`)
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

### Translation Manifest (`manifest.json`)
```json
{
  "_meta": {
    "version": "1.0.0",
    "description": "Translation manifest for any-i18n"
  },
  "domains": {
    "example.com": {
      "languages": ["de", "fr"],
      "lastUpdated": "2026-01-15T11:00:00.000Z"
    }
  }
}
```

## Translation Application

### Applying Translations
- When a language is selected and translations are available, the content script walks the DOM
- For each text node, it generates the key and looks up the translation
- Original text is stored so it can be reverted
- Text nodes are replaced with translated content

### Reverting Translations
- Original text is stored in a map keyed by the generated translation key
- When reverting, the content script walks the DOM again and restores original text
- All stored originals are cleared after revert

## SPA Support

### MutationObserver
- Watches for `childList`, `subtree`, and `characterData` changes
- 50ms debounce on the callback to batch rapid DOM changes
- Automatically translates newly added text nodes when translations are active
- Handles dynamic content loading, route changes, and AJAX updates

## CLI Tool

### Commands

#### `any-i18n translate`
Translates keys using Claude Code CLI.
```bash
any-i18n translate --input keys.json --language de
```
- Reads the key export file
- Sends text to Claude Code for translation
- Outputs a properly formatted translation file

#### `any-i18n validate`
Validates translation files against source keys.
```bash
any-i18n validate --input de.json --keys keys.json
```
- Checks all keys are present in the translation
- Checks for orphaned translations (keys not in source)
- Reports missing and extra keys

#### `any-i18n bundle`
Bundles translations for the extension.
```bash
any-i18n bundle --input ./translations --output ./extension/translations
```
- Copies and organizes translation files
- Updates the translation manifest
- Prepares files for extension packaging

## Build Process

### Building
```bash
node scripts/build.js                    # Build for all browsers
node scripts/build.js --browser chrome   # Build for Chrome only
node scripts/build.js --browser firefox  # Build for Firefox only
```

### What the Build Does
1. Copies `extension/` to `dist/{browser}/`
2. Patches `manifest.json` per browser:
   - Firefox: adds `browser_specific_settings.gecko.id`
3. Produces ready-to-package directories

## Security Considerations

- Content scripts run in the page context -- avoid `eval()` and `innerHTML` for untrusted content
- CLI tool validates all file inputs before processing
- No external network requests from the extension (all translations are local)
- Translation files are JSON-only, no executable code
- DOM manipulation uses `textContent` only, not `innerHTML`
