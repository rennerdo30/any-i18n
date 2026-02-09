/**
 * FNV-1a 32-bit hash function.
 * Returns a hex string hash of the input string.
 */
function fnv1aHash(str) {
  var hash = 0x811c9dc5; // FNV offset basis
  for (var i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  // Convert to unsigned 32-bit integer, then to hex
  return (hash >>> 0).toString(16);
}

/**
 * Normalize text by trimming and collapsing internal whitespace.
 */
function normalizeText(text) {
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * Generate a translation key in the format: prefix_hash.
 * Prefix is derived from the first few words, hash from the full normalized text.
 */
function generateKey(prefix, text) {
  var hash = fnv1aHash(text);
  return prefix + '_' + hash;
}

/**
 * Standard debounce: delays calling fn until delay ms have passed
 * since the last invocation.
 */
function debounce(fn, delay) {
  var timer = null;
  return function() {
    var context = this;
    var args = arguments;
    clearTimeout(timer);
    timer = setTimeout(function() {
      fn.apply(context, args);
    }, delay);
  };
}

/**
 * Extract the hostname from a URL string.
 */
function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return '';
  }
}

/**
 * Check if text is suitable for translation.
 * Rejects text that is too short or consists only of numbers/punctuation/whitespace.
 */
function isTranslatableText(text) {
  if (!text) return false;
  var trimmed = text.trim();
  if (trimmed.length < MIN_TEXT_LENGTH) return false;
  // Reject if only numbers, punctuation, and whitespace
  if (/^[\d\s\p{P}\p{S}]+$/u.test(trimmed)) return false;
  return true;
}
