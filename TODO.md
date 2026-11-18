# any-i18n - Development TODO

## Done
- [x] Shared constants, utilities, storage abstraction
- [x] Content scripts (scanner, key generator, replacer, mutation handler, orchestrator)
- [x] Attribute translation (`title`, `aria-label`, `placeholder`, `alt`, button-like `value`)
- [x] Floating in-page toolbar (shadow DOM, draggable)
- [x] Background service worker (server calls, import, bundled translation indexing)
- [x] Popup UI with auto-translate, import/export, key viewer
- [x] Manifest V3 configuration
- [x] SPA navigation handling (`pushState`, `replaceState`, `popstate`, `hashchange`)
- [x] FastAPI translation server with SQLite cache
- [x] Multiple LLM backends (three local CLI tools, two HTTP APIs)
- [x] Streaming (SSE) translation with progressive application
- [x] CLI tool (translate, validate, bundle)
- [x] Build script (Chrome, Firefox, Edge)
- [x] PNG icons alongside the SVG sources
- [x] Documentation site (Astro Starlight) + GitHub Pages workflow
- [x] Direct providers: LM Studio, Ollama, OpenAI-compatible, DeepSeek (merged from chrome-translator-extension)
- [x] Settings page (provider, endpoint, model, API key, batching, OCR, on-page options)
- [x] Image translation (bundled Tesseract OCR or vision model) via context menu
- [x] Context menu: translate page
- [x] Hover tooltip with the original text; optional underline of translated text
- [x] Dynamic content translated automatically while a language is active
- [x] UI localized (English, German); light and dark theme
- [x] Static checks and unit tests for the provider helpers, CI workflow

## Next
- [ ] Make `any-i18n bundle` emit `translations/manifest.json` with the `domains` map and the
      `<domain>/<lang>.json` layout the service worker actually reads
- [ ] Pin `server/requirements.txt` versions
- [ ] Replace the deprecated FastAPI `@app.on_event("startup")` with a lifespan handler
- [ ] Toolbar on/off switch on the settings page (currently `TOOLBAR_ENABLED`)
- [ ] Automated tests: key generation, scanner filtering, replace/revert round-trip, server batching
- [ ] Stop button for a running translation
- [ ] Optional cross-site reuse of translations (same sentence on another site)
- [ ] Verify the Firefox build end to end
- [ ] Context-aware translation (preserve inline HTML structure around text)
- [ ] Keyboard shortcuts and translating only the selected text
- [ ] RTL language support; plural and gender-aware forms

## Publishing
- [ ] Chrome Web Store listing
- [ ] Firefox Add-ons listing
- [ ] Edge Add-ons listing
- [ ] npm publish for the CLI
- [ ] Demo GIF in the README
- [ ] CONTRIBUTING guide
- [ ] CI: run the CLI against fixtures

## Known issues
- `any-i18n bundle` writes `_manifest.json`, which the extension does not read
- The CLI's `translate` command is hardwired to one provider command, unlike the server
- The translation server is unauthenticated with permissive CORS and binds `0.0.0.0`
- One key per unique string: no per-context translations
- Automated tests cover only `shared/providers.js`

## Architecture decisions
| Decision | Rationale |
|----------|-----------|
| No bundler | Simplicity, direct debugging, no build step for the extension |
| FNV-1a hash | Fast, deterministic, dependency-free, good distribution |
| TreeWalker | Cheapest filtered traversal of text nodes |
| browser.storage.local | Content scripts cannot fetch extension URLs |
| 50ms debounce | Balance between responsiveness and cost on SPAs |
| Results via storage, not messages | Message ports close before long translations finish |
| SQLite cache on the server | Repeat visits and shared strings cost nothing |
| Manifest V3 | Required by Chrome, supported by Firefox 109+ |
