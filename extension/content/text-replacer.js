/**
 * Handles replacing text node content with translations and reverting back.
 * Maintains a map of original text for safe reversion.
 */
var TextReplacer = {

  /** Map of DOM node -> original text content */
  _originals: new Map(),

  /**
   * Apply translations to the given text nodes.
   * @param {Array} textNodes - Array of {node, originalText, key} from DomScanner
   * @param {Object} translations - Map of key -> translated text
   */
  applyTranslations: function(textNodes, translations) {
    if (!textNodes || !translations) return;

    for (var i = 0; i < textNodes.length; i++) {
      var entry = textNodes[i];
      var translated = translations[entry.key];

      if (translated && translated !== entry.originalText) {
        // Save original before replacing (only if not already saved)
        if (!this._originals.has(entry.node)) {
          this._originals.set(entry.node, entry.node.textContent);
        }
        entry.node.textContent = translated;
      }
    }
  },

  /**
   * Revert all translated nodes back to their original text.
   */
  revert: function() {
    this._originals.forEach(function(originalText, node) {
      node.textContent = originalText;
    });
    this._originals.clear();
  },

  /**
   * Check whether translations are currently applied.
   */
  isApplied: function() {
    return this._originals.size > 0;
  },

  /**
   * Return the number of nodes that have been translated.
   */
  getAppliedCount: function() {
    return this._originals.size;
  }
};
