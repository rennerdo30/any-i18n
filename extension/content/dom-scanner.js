/**
 * Scans the DOM for translatable text nodes using TreeWalker.
 * Collects text nodes while skipping non-translatable elements.
 */
var DomScanner = {

  /** Collected text nodes with metadata */
  _textNodes: [],

  /**
   * Scan a root element for translatable text nodes.
   * @param {Element} rootElement - The element to scan (typically document.body)
   * @returns {Array} Array of {node, originalText, key} objects
   */
  scan: function(rootElement) {
    this.clear();

    if (!rootElement) return this._textNodes;

    var domain = getDomain(window.location.href);
    var walker = document.createTreeWalker(
      rootElement,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          if (DomScanner._isSkippable(node)) {
            return NodeFilter.FILTER_REJECT;
          }
          if (DomScanner._shouldTranslate(node.textContent)) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_REJECT;
        }
      }
    );

    while (walker.nextNode()) {
      var node = walker.currentNode;
      var originalText = normalizeText(node.textContent);
      var key = KeyGenerator.generateKeyForText(originalText, domain);

      if (key) {
        this._textNodes.push({
          node: node,
          originalText: originalText,
          key: key
        });
      }
    }

    return this._textNodes;
  },

  /**
   * Return the currently collected text nodes.
   */
  getTextNodes: function() {
    return this._textNodes;
  },

  /**
   * Reset the collected text nodes.
   */
  clear: function() {
    this._textNodes = [];
  },

  /**
   * Check if a text node should be skipped based on its ancestors.
   */
  _isSkippable: function(node) {
    var parent = node.parentElement;
    while (parent) {
      if (SKIP_TAGS.has(parent.tagName)) {
        return true;
      }
      parent = parent.parentElement;
    }
    return false;
  },

  /**
   * Check if text content should be translated.
   */
  _shouldTranslate: function(text) {
    return isTranslatableText(text);
  }
};
