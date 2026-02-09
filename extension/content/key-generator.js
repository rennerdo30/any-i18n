/**
 * Generates deterministic translation keys for text content.
 * Keys follow the format: prefix_fnv1ahash
 * The prefix is derived from the first 3 words of the text.
 */
var KeyGenerator = {

  /**
   * Generate a translation key for a given text and domain.
   * @param {string} text - The text to generate a key for
   * @param {string} domain - The domain (currently unused, reserved for future namespacing)
   * @returns {string|null} The generated key, or null if text is not translatable
   */
  generateKeyForText: function(text, domain) {
    if (!text || typeof text !== 'string') return null;

    var normalized = normalizeText(text);
    if (!isTranslatableText(normalized)) return null;

    var prefix = this._createPrefix(normalized);
    return generateKey(prefix, normalized);
  },

  /**
   * Create a prefix from the first 3 words of text.
   * Words are lowercased and stripped of non-alphanumeric characters.
   * Falls back to 'txt' if no usable words are found.
   */
  _createPrefix: function(text) {
    // Extract words: split on whitespace, take first 3
    var words = text.split(/\s+/).slice(0, 3);

    // Clean each word: lowercase, keep only alphanumeric chars
    var parts = [];
    for (var i = 0; i < words.length; i++) {
      var cleaned = words[i].toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleaned.length > 0) {
        parts.push(cleaned);
      }
    }

    // If no usable latin/numeric words, use a fallback prefix
    if (parts.length === 0) return 'txt';

    return parts.join('_');
  }
};
