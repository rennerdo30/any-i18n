/**
 * Handles replacing text node content and element attributes with translations
 * and reverting back. Maintains maps of original values for safe reversion.
 * Injects defensive CSS on translated elements to prevent layout breakage.
 */
var TextReplacer = {

  /** Map of text DOM node -> original text content */
  _originals: new Map(),

  /** Map of element -> Map(attrName -> originalValue) for attribute translations */
  _attrOriginals: new Map(),

  /** WeakMap of text DOM node -> current translated text (skip-if-already-translated) */
  _translated: new WeakMap(),

  /** WeakMap of element -> { attrName: translatedValue } for attribute skip checks */
  _translatedAttrs: new WeakMap(),

  /** Whether the defensive stylesheet has been injected */
  _styleInjected: false,

  /**
   * Inject a defensive stylesheet to prevent translated text from breaking layouts.
   * Uses a data attribute selector so styles only apply to elements we've translated.
   */
  _ensureStyles: function() {
    if (this._styleInjected) return;
    this._styleInjected = true;

    var style = document.createElement('style');
    style.id = 'anyi18n-translate-styles';
    style.textContent = [
      '[data-anyi18n] {',
      '  overflow-wrap: break-word !important;',
      '  word-break: break-word !important;',
      '  white-space: normal !important;',
      '  min-width: 0 !important;',
      '}',
      '[data-anyi18n] > * {',
      '  overflow-wrap: break-word !important;',
      '  word-break: break-word !important;',
      '}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  },

  /**
   * Mark an element as containing translated text.
   */
  _markElement: function(element) {
    if (!element.hasAttribute('data-anyi18n')) {
      element.setAttribute('data-anyi18n', '');
    }
  },

  /**
   * Apply translations to the given text nodes and attribute entries.
   * @param {Array} textNodes - Array of {node, originalText, key, attr?} from DomScanner
   * @param {Object} translations - Map of key -> translated text
   */
  applyTranslations: function(textNodes, translations) {
    if (!textNodes || !translations) return;

    var hasTranslations = false;

    for (var i = 0; i < textNodes.length; i++) {
      var entry = textNodes[i];
      var translated = translations[entry.key];

      if (translated && translated !== entry.originalText) {
        if (entry.attr) {
          // Attribute translation
          var existing = this._translatedAttrs.get(entry.node) || {};
          if (existing[entry.attr] === translated) continue;

          // Save original attribute value
          if (!this._attrOriginals.has(entry.node)) {
            this._attrOriginals.set(entry.node, new Map());
          }
          var attrMap = this._attrOriginals.get(entry.node);
          if (!attrMap.has(entry.attr)) {
            attrMap.set(entry.attr, entry.node.getAttribute(entry.attr));
          }

          entry.node.setAttribute(entry.attr, translated);
          existing[entry.attr] = translated;
          this._translatedAttrs.set(entry.node, existing);
          this._markElement(entry.node);
          hasTranslations = true;
        } else {
          // Text node translation
          if (this._translated.get(entry.node) === translated) continue;

          if (!this._originals.has(entry.node)) {
            this._originals.set(entry.node, entry.node.textContent);
          }
          entry.node.textContent = translated;
          this._translated.set(entry.node, translated);

          // Mark the parent element for CSS
          if (entry.node.parentElement) {
            this._markElement(entry.node.parentElement);
          }
          hasTranslations = true;
        }
      }
    }

    if (hasTranslations) {
      this._ensureStyles();
    }
  },

  /**
   * Revert all translated nodes and attributes back to their original values.
   */
  revert: function() {
    this._originals.forEach(function(originalText, node) {
      node.textContent = originalText;
      // Remove marker from parent
      if (node.parentElement) {
        node.parentElement.removeAttribute('data-anyi18n');
      }
    });
    this._originals.clear();

    this._attrOriginals.forEach(function(attrMap, element) {
      attrMap.forEach(function(originalValue, attrName) {
        element.setAttribute(attrName, originalValue);
      });
      element.removeAttribute('data-anyi18n');
    });
    this._attrOriginals.clear();

    this._translated = new WeakMap();
    this._translatedAttrs = new WeakMap();
  },

  /**
   * Reset internal state without reverting text (for SPA navigation where nodes may be detached).
   */
  reset: function() {
    this._originals.clear();
    this._attrOriginals.clear();
    this._translated = new WeakMap();
    this._translatedAttrs = new WeakMap();
  },

  /**
   * Check whether translations are currently applied.
   */
  isApplied: function() {
    return this._originals.size > 0 || this._attrOriginals.size > 0;
  },

  /**
   * Return the number of nodes/attributes that have been translated.
   */
  getAppliedCount: function() {
    var attrCount = 0;
    this._attrOriginals.forEach(function(attrMap) {
      attrCount += attrMap.size;
    });
    return this._originals.size + attrCount;
  }
};
