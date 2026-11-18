/**
 * Main content script orchestrator.
 * Coordinates DOM scanning, key generation, translation application,
 * mutation observation, and SPA navigation handling.
 * Communicates with popup and background via browser.runtime.onMessage.
 */
(function() {
  'use strict';

  // The popup and the context menu inject the scripts again when they get no answer; never run twice.
  if (window.__anyi18n) return;

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

  /** Keys already requested from the provider for activeLanguage (never re-requested) */
  var requestedKeys = new Set();

  /** Timer for batching translation requests of dynamically added text */
  var dynamicTimer = null;

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
      if (activeLanguage !== language) requestedKeys = new Set();
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
    clearTimeout(dynamicTimer);
    activeLanguage = null;
    requestedKeys = new Set();

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
      scheduleDynamicTranslation(translations);
    });
  }

  /**
   * Request translations for text that appeared after the page was translated
   * (single-page apps, infinite scroll, lazy loading). Each key is requested once.
   */
  function scheduleDynamicTranslation(translations) {
    clearTimeout(dynamicTimer);
    dynamicTimer = setTimeout(function() {
      if (!activeLanguage) return;
      var missing = {};
      var count = 0;
      Object.keys(collectedKeys).forEach(function(key) {
        if (translations[key] || requestedKeys.has(key)) return;
        missing[key] = collectedKeys[key];
        count++;
      });
      if (count > 0) requestTranslation(missing, activeLanguage, 'page');
    }, DYNAMIC_TRANSLATE_DELAY_MS);
  }

  /**
   * Ask the background to translate keys; results arrive through storage.onChanged.
   */
  function requestTranslation(keys, language, source) {
    Object.keys(keys).forEach(function(key) { requestedKeys.add(key); });
    browser.runtime.sendMessage({
      type: MESSAGES.TRANSLATE_KEYS,
      keys: keys,
      language: language,
      domain: currentDomain,
      source: source
    }).catch(function() {
      // Extension reloaded or updated: this page keeps its current state.
    });
  }

  /**
   * Scan, apply the translations this site already has, and request the missing ones.
   */
  function translatePage(language, source) {
    scanPage();

    return StorageManager.getTranslations(currentDomain, language).then(function(translations) {
      if (translations && Object.keys(translations).length > 0) {
        applyTranslation(language);
      } else {
        if (activeLanguage !== language) requestedKeys = new Set();
        activeLanguage = language;
      }

      var untranslated = {};
      var count = 0;
      Object.keys(collectedKeys).forEach(function(key) {
        if (translations && translations[key]) return;
        untranslated[key] = collectedKeys[key];
        count++;
      });

      if (count > 0) {
        requestTranslation(untranslated, language, source);
      }
      return {
        success: true,
        requested: count,
        keyCount: Object.keys(collectedKeys).length,
        stored: Object.keys(collectedKeys).length - count
      };
    });
  }

  /**
   * Reset internal state without reverting text (nodes may be detached after SPA navigation).
   */
  function resetState() {
    MutationHandler.stop();
    clearTimeout(dynamicTimer);
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
      translatePage(config.language, 'auto');
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

  // --- Apply translation results for this site while their language is active ---
  // Applying here (not only in the popup) keeps a translation going after the popup closes; a
  // result that arrives after Revert is ignored because no language is active any more.
  browser.storage.onChanged.addListener(function(changes) {
    if (!changes._translateResult) return;
    var result = changes._translateResult.newValue;
    if (!result) return;
    if (result.domain && result.domain !== currentDomain) return;
    var ownRequest = result.source === 'auto' || result.source === 'page';

    if (!result.partial) {
      if (ownRequest) browser.storage.local.remove('_translateResult');
      if (!result.success) {
        // The popup and the toolbar report their own failures.
        if (ownRequest) PageUi.notify(result.error || t('statusTranslateFailed', undefined, 'Translation failed.'), true);
        return;
      }
    }

    if (result.success && result.language && activeLanguage === result.language) {
      applyTranslation(result.language);
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

      case MESSAGES.TRANSLATE_PAGE:
        translatePage(message.language, message.source || 'page').then(sendResponse);
        return true; // Async response

      case MESSAGES.IMAGE_TRANSLATION_STARTED:
        PageUi.showImageLoading(message.srcUrl);
        sendResponse({ success: true });
        break;

      case MESSAGES.IMAGE_TRANSLATION_RESULT:
        PageUi.showImageResult(message);
        sendResponse({ success: true });
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
    translatePage: translatePage,
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
