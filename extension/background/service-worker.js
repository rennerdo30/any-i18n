// Browser API compatibility shim
if (typeof browser === 'undefined') var browser = chrome;

var TRANSLATION_SERVER_URL = 'http://localhost:39418';

/**
 * Background service worker for the any-i18n extension.
 * Handles translation management, import/export, and lifecycle events.
 */

/**
 * Initialize default settings on first install.
 */
browser.runtime.onInstalled.addListener(function(details) {
  if (details.reason === 'install') {
    // Set default settings
    browser.storage.local.set({
      settings: {
        enabled: true,
        autoScan: true,
        highlightTranslated: false
      },
      translations: {},
      domainKeys: {}
    });

    // Index any bundled translations
    indexBundledTranslations();
  }
});

/**
 * Index bundled translations from the extension's translations directory.
 * Reads the manifest.json file that lists available domains and languages.
 */
function indexBundledTranslations() {
  // Attempt to load the translations manifest
  fetch(browser.runtime.getURL('translations/manifest.json'))
    .then(function(response) {
      if (!response.ok) return null;
      return response.json();
    })
    .then(function(manifest) {
      if (!manifest || !manifest.domains) return;

      var domains = Object.keys(manifest.domains);
      var loadPromises = [];

      domains.forEach(function(domain) {
        var domainConfig = manifest.domains[domain];
        var languages = domainConfig.languages || [];

        languages.forEach(function(lang) {
          var translationUrl = browser.runtime.getURL(
            'translations/' + domain + '/' + lang + '.json'
          );

          var promise = fetch(translationUrl)
            .then(function(response) {
              if (!response.ok) return null;
              return response.json();
            })
            .then(function(data) {
              if (data && data.translations) {
                return {
                  domain: domain,
                  language: lang,
                  translations: data.translations
                };
              }
              return null;
            })
            .catch(function() {
              return null;
            });

          loadPromises.push(promise);
        });
      });

      return Promise.all(loadPromises);
    })
    .then(function(results) {
      if (!results) return;

      // Store all loaded translations
      browser.storage.local.get('translations').then(function(stored) {
        var allTranslations = (stored && stored.translations) || {};

        results.forEach(function(result) {
          if (!result) return;
          if (!allTranslations[result.domain]) {
            allTranslations[result.domain] = {};
          }
          allTranslations[result.domain][result.language] = result.translations;
        });

        browser.storage.local.set({ translations: allTranslations });
      });
    })
    .catch(function(err) {
      // Manifest not found or failed to load - this is fine for fresh installs
    });
}

/**
 * Listen for messages from content scripts and popup.
 */
browser.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  switch (message.type) {

    case 'GET_LANGUAGES':
      // Return available languages for a given domain
      browser.storage.local.get('translations').then(function(stored) {
        var allTranslations = (stored && stored.translations) || {};
        var domain = message.domain;
        var languages = [];

        if (allTranslations[domain]) {
          languages = Object.keys(allTranslations[domain]);
        }

        sendResponse({ languages: languages });
      });
      return true; // Async response

    case 'IMPORT_TRANSLATIONS':
      // Import translation data from uploaded JSON
      handleImportTranslations(message).then(sendResponse);
      return true; // Async response

    case 'TRANSLATE_KEYS':
      // Translate keys via the translation server
      // Store result in storage since the message port may close during long LLM calls
      handleTranslateKeys(message).then(function(result) {
        browser.storage.local.set({ _translateResult: result });
      });
      sendResponse({ started: true });
      break;
  }
});

/**
 * Handle importing translation data.
 * Expects message.data to contain parsed translation JSON with:
 * - _meta.domain and _meta.language
 * - translations: { key: "translated text" }
 */
function handleImportTranslations(message) {
  var data = message.data;

  if (!data || !data._meta || !data._meta.domain || !data._meta.language || !data.translations) {
    return Promise.resolve({
      success: false,
      error: 'Invalid translation file format. Expected _meta (with domain, language) and translations.'
    });
  }

  var domain = data._meta.domain;
  var language = data._meta.language;
  var translations = data.translations;

  return browser.storage.local.get('translations').then(function(stored) {
    var allTranslations = (stored && stored.translations) || {};

    if (!allTranslations[domain]) {
      allTranslations[domain] = {};
    }
    allTranslations[domain][language] = translations;

    return browser.storage.local.set({ translations: allTranslations });
  }).then(function() {
    return {
      success: true,
      domain: domain,
      language: language,
      keyCount: Object.keys(translations).length
    };
  });
}

/**
 * Handle translating keys via the translation server.
 * Sends keys to the server, stores results in browser.storage.local.
 */
function handleTranslateKeys(message) {
  var keys = message.keys;
  var language = message.language;
  var domain = message.domain;

  if (!keys || !language || !domain) {
    return Promise.resolve({
      success: false,
      error: 'Missing keys, language, or domain.'
    });
  }

  var serverUrl = TRANSLATION_SERVER_URL;

  return fetch(serverUrl + '/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys: keys, language: language, domain: domain })
  })
    .then(function(response) {
      if (!response.ok) {
        return response.text().then(function(text) {
          throw new Error('Server error: ' + response.status + ' ' + text);
        });
      }
      return response.json();
    })
    .then(function(data) {
      // Store translations in browser.storage.local using existing pattern
      return browser.storage.local.get('translations').then(function(stored) {
        var allTranslations = (stored && stored.translations) || {};

        if (!allTranslations[domain]) {
          allTranslations[domain] = {};
        }
        allTranslations[domain][language] = data.translations;

        return browser.storage.local.set({ translations: allTranslations });
      }).then(function() {
        return {
          success: true,
          translations: data.translations,
          cached: data.cached,
          translated: data.translated
        };
      });
    })
    .catch(function(err) {
      return {
        success: false,
        error: err.message || 'Translation server request failed.'
      };
    });
}

// Index bundled translations on service worker startup
indexBundledTranslations();
