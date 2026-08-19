/**
 * Scans the DOM for translatable text nodes and element attributes using TreeWalker.
 * Collects text nodes and translatable attributes (placeholder, alt, title, aria-label, value)
 * while skipping non-translatable elements.
 */
var DomScanner = {

  /** Collected text nodes and attribute entries with metadata */
  _textNodes: [],

  /**
   * Scan a root element for translatable text nodes and attributes.
   * @param {Element} rootElement - The element to scan (typically document.body)
   * @returns {Array} Array of {node, originalText, key, attr?} objects
   */
  scan: function(rootElement) {
    this.clear();

    if (!rootElement) return this._textNodes;

    var domain = getDomain(window.location.href);

    // Pass 1: Scan text nodes
    var textWalker = document.createTreeWalker(
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

    while (textWalker.nextNode()) {
      var node = textWalker.currentNode;
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

    // Pass 2: Scan element attributes (placeholder, alt, title, aria-label, value)
    var attrWalker = document.createTreeWalker(
      rootElement,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: function(node) {
          if (SKIP_TAGS.has(node.tagName)) {
            return NodeFilter.FILTER_REJECT;
          }
          if (node.getAttribute('translate') === 'no') {
            return NodeFilter.FILTER_REJECT;
          }
          if (DomScanner._getTranslatableAttrs(node).length > 0) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_SKIP;
        }
      }
    );

    while (attrWalker.nextNode()) {
      var el = attrWalker.currentNode;
      var attrs = this._getTranslatableAttrs(el);

      for (var a = 0; a < attrs.length; a++) {
        var attrName = attrs[a];
        var attrValue = el.getAttribute(attrName);
        var normalized = normalizeText(attrValue);

        if (isTranslatableText(normalized)) {
          var attrKey = KeyGenerator.generateKeyForText(normalized, domain);
          if (attrKey) {
            this._textNodes.push({
              node: el,
              originalText: normalized,
              key: attrKey,
              attr: attrName
            });
          }
        }
      }
    }

    return this._textNodes;
  },

  /**
   * Return the currently collected text nodes and attribute entries.
   */
  getTextNodes: function() {
    return this._textNodes;
  },

  /**
   * Reset the collected entries.
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
      if (parent.getAttribute('translate') === 'no') {
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
  },

  /**
   * Get list of translatable attribute names for an element.
   * Returns an array of attribute names that contain translatable text.
   */
  _getTranslatableAttrs: function(element) {
    var attrs = [];
    var tag = element.tagName;

    // Skip contenteditable (user-generated content)
    if (element.isContentEditable) return attrs;

    // Common attributes for all elements
    if (element.hasAttribute('title')) attrs.push('title');
    if (element.hasAttribute('aria-label')) attrs.push('aria-label');

    // Element-specific attributes
    if (tag === 'INPUT') {
      if (element.hasAttribute('placeholder')) attrs.push('placeholder');
      var type = (element.type || '').toLowerCase();
      if (TRANSLATABLE_INPUT_TYPES.has(type) && element.hasAttribute('value')) {
        attrs.push('value');
      }
    } else if (tag === 'TEXTAREA') {
      if (element.hasAttribute('placeholder')) attrs.push('placeholder');
    } else if (tag === 'IMG') {
      if (element.hasAttribute('alt')) attrs.push('alt');
    }

    return attrs;
  }
};
