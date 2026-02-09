# any-i18n - Development TODO

## Phase 1: Core Extension
- [x] Shared constants, utilities, storage
- [x] Content scripts (scanner, key generator, replacer, mutation handler)
- [x] Background service worker
- [x] Popup UI
- [x] Manifest V3 configuration
- [x] CLI tool (translate, validate, bundle)
- [x] Build script (Chrome, Firefox, Edge)
- [x] Documentation (SPECIFICATION.md, CLAUDE.md)

## Phase 2: Enhanced Features
- [ ] Context-aware translation (preserve HTML structure around text)
- [ ] Translation memory (reuse translations across similar pages)
- [ ] Batch translation (translate multiple pages at once)
- [ ] Translation preview mode (highlight translated text)
- [ ] Settings page for advanced configuration
- [ ] Keyboard shortcuts for common actions
- [ ] Right-click context menu for selective translation
- [ ] Translation quality scoring
- [ ] Support for RTL languages
- [ ] Plural forms and gender-aware translations

## Phase 3: Publishing
- [ ] Chrome Web Store listing
- [ ] Firefox Add-ons listing
- [ ] Edge Add-ons listing
- [ ] npm publish CLI tool
- [ ] Documentation website
- [ ] Demo video/GIF
- [ ] Contributing guide
- [ ] GitHub Actions CI/CD

## Known Issues
- Icons are SVG only; need PNG generation for full browser compat
- CLI requires Claude Code CLI installed separately
- No automated tests yet

## Architecture Decisions
| Decision | Rationale |
|----------|-----------|
| No bundler | Simplicity, direct debugging, no build step for extension |
| FNV-1a hash | Fast, deterministic, no dependencies, good distribution |
| TreeWalker | Most efficient DOM traversal for text nodes |
| browser.storage.local | Content scripts can't fetch extension URLs |
| 50ms debounce | Balance between responsiveness and performance for SPAs |
| Manifest V3 | Future-proof, required by Chrome, supported by Firefox |
