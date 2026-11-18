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
      '}',
      // Optional marker for translated text (settings: "Underline translated text")
      'html.anyi18n-highlight [data-anyi18n] {',
      '  text-decoration: underline dashed rgba(14, 124, 107, 0.75) !important;',
      '  text-decoration-thickness: 1px !important;',
      '  text-underline-offset: 3px !important;',
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

          // Save original attribute value (again if the page changed it since)
          if (!this._attrOriginals.has(entry.node)) {
            this._attrOriginals.set(entry.node, new Map());
          }
          var attrMap = this._attrOriginals.get(entry.node);
          var currentValue = entry.node.getAttribute(entry.attr);
          if (!attrMap.has(entry.attr) || existing[entry.attr] !== currentValue) {
            attrMap.set(entry.attr, currentValue);
          }

          entry.node.setAttribute(entry.attr, translated);
          existing[entry.attr] = translated;
          this._translatedAttrs.set(entry.node, existing);
          this._markElement(entry.node);
          hasTranslations = true;
        } else {
          // Text node translation
          if (this._translated.get(entry.node) === translated) continue;

          // Save the original (again if the page replaced our translation with new text)
          if (!this._originals.has(entry.node) || this._translated.get(entry.node) !== entry.node.textContent) {
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
   * Text a node had before we translated it. Returns the current text for nodes we did not
   * translate, or whose text the page has changed since.
   */
  originalTextFor: function(node) {
    var current = node.textContent;
    if (this._originals.has(node) && this._translated.get(node) === current) {
      return this._originals.get(node);
    }
    return current;
  },

  /**
   * Attribute value an element had before we translated it (see originalTextFor).
   */
  originalAttrFor: function(element, attrName) {
    var current = element.getAttribute(attrName);
    var translated = this._translatedAttrs.get(element);
    var originals = this._attrOriginals.get(element);
    if (translated && originals && originals.has(attrName) && translated[attrName] === current) {
      return originals.get(attrName);
    }
    return current;
  },

  /**
   * Original texts of the translated text nodes directly inside an element (for the hover tooltip).
   */
  originalsInside: function(element) {
    var texts = [];
    var children = element.childNodes;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (child.nodeType === Node.TEXT_NODE && this._originals.has(child) &&
          this._translated.get(child) === child.textContent) {
        var original = normalizeText(this._originals.get(child));
        if (original) texts.push(original);
      }
    }
    return texts;
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
