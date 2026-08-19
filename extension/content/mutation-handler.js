/**
 * MutationObserver wrapper for detecting DOM changes in SPAs.
 * Debounces rapid mutations and invokes a callback for processing new content.
 */
var MutationHandler = {

  /** MutationObserver instance */
  _observer: null,

  /** Debounce timer ID */
  _debounceTimer: null,

  /** Whether the observer is currently active */
  _observing: false,

  /** Whether we're currently processing mutations (to ignore our own DOM changes) */
  _processing: false,

  /**
   * Start observing DOM changes on document.body.
   * @param {Function} callback - Called (debounced at 50ms) when mutations are detected
   */
  start: function(callback) {
    if (this._observer) {
      this.stop();
    }

    var self = this;

    this._observer = new MutationObserver(function(mutations) {
      // Ignore mutations triggered by our own text replacements
      if (self._processing) return;

      // Debounce rapid mutations to avoid excessive processing
      clearTimeout(self._debounceTimer);
      self._debounceTimer = setTimeout(function() {
        self._processing = true;
        try {
          callback(mutations);
        } finally {
          self._processing = false;
        }
      }, 50);
    });

    this._observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    this._observing = true;
  },

  /**
   * Stop observing DOM changes.
   */
  stop: function() {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    clearTimeout(this._debounceTimer);
    this._debounceTimer = null;
    this._observing = false;
  },

  /**
   * Check whether the observer is currently active.
   */
  isObserving: function() {
    return this._observing;
  }
};
