/**
 * Main content script orchestrator.
 * Coordinates DOM scanning, key generation, translation application,
 * and mutation observation. Communicates with popup and background
 * via browser.runtime.onMessage.
 */
(function() {
  'use strict';

  /** Current domain */
  var currentDomain = getDomain(window.location.href);

  /** Whether the page has been scanned */
  var isScanned = false;

  /** Currently collected keys: { key: originalText } */
  var collectedKeys = {};

  /** The language currently being applied, if any */
  var activeLanguage = null;

  /**
   * Scan the page for translatable text nodes and generate keys.
   */
  function scanPage() {
    DomScanner.scan(document.body);
    var textNodes = DomScanner.getTextNodes();

    collectedKeys = {};
    for (var i = 0; i < textNodes.length; i++) {
      collectedKeys[textNodes[i].key] = textNodes[i].originalText;
    }

    // Persist keys for this domain
    StorageManager.setDomainKeys(currentDomain, collectedKeys);
    isScanned = true;

    return {
      keyCount: Object.keys(collectedKeys).length
    };
  }

  /**
   * Apply translations for a given language.
   */
  function applyTranslation(language) {
    return StorageManager.getTranslations(currentDomain, language).then(function(translations) {
      if (!translations || Object.keys(translations).length === 0) {
        return { success: false, error: 'No translations found for ' + language };
      }

      // Ensure page is scanned
      if (!isScanned) {
        scanPage();
      }

      var textNodes = DomScanner.getTextNodes();
      TextReplacer.applyTranslations(textNodes, translations);
      activeLanguage = language;

      // Start mutation handler to auto-translate new content
      startMutationHandler(translations);

      return {
        success: true,
        translatedCount: TextReplacer.getAppliedCount()
      };
    });
  }

  /**
   * Revert all translations to original text.
   */
  function revertTranslation() {
    TextReplacer.revert();
    MutationHandler.stop();
    activeLanguage = null;

    return { success: true };
  }

  /**
   * Start the mutation handler to auto-translate dynamically added content.
   */
  function startMutationHandler(translations) {
    MutationHandler.stop();
    MutationHandler.start(function() {
      // Re-scan for new nodes and apply translations
      DomScanner.scan(document.body);
      var textNodes = DomScanner.getTextNodes();

      // Update collected keys
      for (var i = 0; i < textNodes.length; i++) {
        collectedKeys[textNodes[i].key] = textNodes[i].originalText;
      }

      TextReplacer.applyTranslations(textNodes, translations);
    });
  }

  /**
   * Get the current status of the content script.
   */
  function getStatus() {
    return {
      isScanned: isScanned,
      isTranslated: TextReplacer.isApplied(),
      keyCount: Object.keys(collectedKeys).length,
      translatedCount: TextReplacer.getAppliedCount(),
      activeLanguage: activeLanguage,
      domain: currentDomain
    };
  }

  /**
   * Export collected keys in _keys.json format.
   */
  function exportKeys() {
    return {
      _meta: {
        domain: currentDomain,
        exportedAt: new Date().toISOString(),
        keyCount: Object.keys(collectedKeys).length
      },
      keys: Object.assign({}, collectedKeys)
    };
  }

  // Listen for messages from popup and background
  browser.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    switch (message.type) {
      case MESSAGES.SCAN_PAGE:
        sendResponse(scanPage());
        break;

      case MESSAGES.GET_KEYS:
        sendResponse({ keys: collectedKeys });
        break;

      case MESSAGES.APPLY_TRANSLATION:
        applyTranslation(message.language).then(sendResponse);
        return true; // Async response

      case MESSAGES.REVERT_TRANSLATION:
        sendResponse(revertTranslation());
        break;

      case MESSAGES.GET_STATUS:
        sendResponse(getStatus());
        break;

      case MESSAGES.EXPORT_KEYS:
        sendResponse(exportKeys());
        break;
    }
  });

  // Expose API for in-page toolbar (shares execution context)
  window.__anyi18n = {
    scan: scanPage,
    apply: applyTranslation,
    revert: revertTranslation,
    getStatus: getStatus,
    getKeys: function() { return collectedKeys; }
  };

  // Auto-scan on load if settings allow
  StorageManager.getSettings().then(function(settings) {
    if (settings.enabled && settings.autoScan) {
      scanPage();
    }
  });

})();
