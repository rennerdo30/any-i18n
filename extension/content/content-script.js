/**
 * Main content script orchestrator.
 * Coordinates DOM scanning, key generation, translation application,
 * mutation observation, and SPA navigation handling.
 * Communicates with popup and background via browser.runtime.onMessage.
 */
(function() {
  'use strict';

  /** Current URL for SPA navigation detection */
  var currentUrl = window.location.href;

  /** Current domain */
  var currentDomain = getDomain(currentUrl);

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
   * Reset internal state without reverting text (nodes may be detached after SPA navigation).
   */
  function resetState() {
    MutationHandler.stop();
    TextReplacer.reset();
    DomScanner.clear();
    collectedKeys = {};
    isScanned = false;
  }

  /**
   * Handle SPA navigation (pushState, replaceState, popstate, hashchange).
   * Detects URL changes, resets stale state, and re-applies translations if appropriate.
   */
  function handleNavigation() {
    var newUrl = window.location.href;
    if (newUrl === currentUrl) return;

    var previousLanguage = activeLanguage;
    var previousDomain = currentDomain;

    currentUrl = newUrl;
    currentDomain = getDomain(newUrl);

    resetState();
    activeLanguage = null;

    // Wait for SPA to render new content before re-translating
    setTimeout(function() {
      if (previousDomain === currentDomain && previousLanguage) {
        // Same domain, had active translation — re-apply
        applyTranslation(previousLanguage);
      } else {
        // Different domain or no previous translation — check auto-translate
        checkAutoTranslate();
      }
    }, 200);
  }

  /**
   * Check if auto-translate is configured for the current domain and apply if so.
   */
  function checkAutoTranslate() {
    StorageManager.getAutoTranslate(currentDomain).then(function(config) {
      if (!config || !config.enabled || !config.language) return;

      var language = config.language;

      // Always scan the page for translatable keys
      scanPage();

      StorageManager.getTranslations(currentDomain, language).then(function(translations) {
        // Apply whatever translations we already have
        if (translations && Object.keys(translations).length > 0) {
          applyTranslation(language);
        }

        // Check for keys that still need translation
        var untranslated = {};
        var keys = Object.keys(collectedKeys);
        for (var i = 0; i < keys.length; i++) {
          if (!translations || !translations[keys[i]]) {
            untranslated[keys[i]] = collectedKeys[keys[i]];
          }
        }

        // Request translations for any untranslated keys
        if (Object.keys(untranslated).length > 0) {
          browser.runtime.sendMessage({
            type: MESSAGES.TRANSLATE_KEYS,
            keys: untranslated,
            language: language,
            domain: currentDomain,
            source: 'auto'
          });
        }
      });
    });
  }

  // --- SPA Navigation Detection ---

  // Monkey-patch history.pushState and history.replaceState
  var originalPushState = history.pushState;
  var originalReplaceState = history.replaceState;

  history.pushState = function() {
    originalPushState.apply(this, arguments);
    handleNavigation();
  };

  history.replaceState = function() {
    originalReplaceState.apply(this, arguments);
    handleNavigation();
  };

  // Listen for popstate and hashchange
  window.addEventListener('popstate', handleNavigation);
  window.addEventListener('hashchange', handleNavigation);

  // --- Listen for auto-translate results from background ---
  browser.storage.onChanged.addListener(function(changes) {
    if (!changes._translateResult) return;
    var result = changes._translateResult.newValue;
    if (!result) return;

    // Only process auto-translate results here
    if (result.source !== 'auto') return;

    // Handle partial (streaming) results — apply progressively
    if (result.partial) {
      if (result.success) {
        StorageManager.getAutoTranslate(currentDomain).then(function(config) {
          if (config && config.enabled && config.language) {
            applyTranslation(config.language);
          }
        });
      }
      return; // Don't clean up for partial results
    }

    // Final result — clean up the flag
    browser.storage.local.remove('_translateResult');

    if (result.success) {
      // Apply the translation
      StorageManager.getAutoTranslate(currentDomain).then(function(config) {
        if (config && config.enabled && config.language) {
          applyTranslation(config.language);
        }
      });
    }
  });

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
    getKeys: function() { return collectedKeys; },
    handleNavigation: handleNavigation
  };

  // Auto-translate takes priority, then autoScan
  StorageManager.getAutoTranslate(currentDomain).then(function(config) {
    if (config && config.enabled && config.language) {
      checkAutoTranslate();
    } else {
      // Fall back to auto-scan
      StorageManager.getSettings().then(function(settings) {
        if (settings.enabled && settings.autoScan) {
          scanPage();
        }
      });
    }
  });

})();
