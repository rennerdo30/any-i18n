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
      var translateSource = message.source || 'unknown';
      handleTranslateKeys(message).then(function(result) {
        result.source = translateSource;
        browser.storage.local.set({ _translateResult: result });
      });
      sendResponse({ started: true });
      break;

    case 'GET_AUTO_TRANSLATE':
      browser.storage.local.get('autoTranslate').then(function(stored) {
        var all = (stored && stored.autoTranslate) || {};
        sendResponse({ config: all[message.domain] || null });
      });
      return true; // Async response

    case 'SET_AUTO_TRANSLATE':
      browser.storage.local.get('autoTranslate').then(function(stored) {
        var all = (stored && stored.autoTranslate) || {};
        all[message.domain] = { language: message.language, enabled: true };
        browser.storage.local.set({ autoTranslate: all }).then(function() {
          sendResponse({ success: true });
        });
      });
      return true; // Async response

    case 'REMOVE_AUTO_TRANSLATE':
      browser.storage.local.get('autoTranslate').then(function(stored) {
        var all = (stored && stored.autoTranslate) || {};
        delete all[message.domain];
        browser.storage.local.set({ autoTranslate: all }).then(function() {
          sendResponse({ success: true });
        });
      });
      return true; // Async response
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
 * Parse SSE events from a text chunk.
 * Returns an array of { event: string, data: object } and any remaining incomplete text.
 */
function parseSSE(text) {
  var events = [];
  var remaining = '';
  var blocks = text.split('\n\n');

  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i];
    // Last block may be incomplete (no trailing \n\n)
    if (i === blocks.length - 1 && !text.endsWith('\n\n')) {
      remaining = block;
      break;
    }
    if (!block.trim()) continue;

    var eventType = 'message';
    var dataStr = '';
    var lines = block.split('\n');
    for (var j = 0; j < lines.length; j++) {
      var line = lines[j];
      if (line.indexOf('event: ') === 0) {
        eventType = line.substring(7);
      } else if (line.indexOf('data: ') === 0) {
        dataStr = line.substring(6);
      }
    }
    if (dataStr) {
      try {
        events.push({ event: eventType, data: JSON.parse(dataStr) });
      } catch (e) {
        // Skip malformed data
      }
    }
  }

  return { events: events, remaining: remaining };
}

/**
 * Handle translating keys via the streaming SSE endpoint.
 * Sends partial results to storage as batches arrive.
 */
function handleTranslateKeysStreaming(message) {
  var keys = message.keys;
  var language = message.language;
  var domain = message.domain;
  var source = message.source || 'unknown';

  var serverUrl = TRANSLATION_SERVER_URL;
  var accumulated = {};
  var cachedCount = 0;
  var translatedCount = 0;

  return fetch(serverUrl + '/api/translate/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys: keys, language: language, domain: domain })
  }).then(function(response) {
    if (!response.ok) {
      throw new Error('Server error: ' + response.status);
    }

    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';

    function processEvents(events) {
      var storePromises = [];
      for (var i = 0; i < events.length; i++) {
        var evt = events[i];

        if (evt.event === 'cached' || evt.event === 'batch') {
          // Merge translations into accumulator
          var translations = evt.data.translations || {};
          var tkeys = Object.keys(translations);
          for (var j = 0; j < tkeys.length; j++) {
            accumulated[tkeys[j]] = translations[tkeys[j]];
          }

          if (evt.event === 'cached') {
            cachedCount = evt.data.cached || 0;
          } else {
            translatedCount += Object.keys(translations).length;
          }

          // Store partial translations and notify UI
          storePromises.push(
            storeTranslations(domain, language, accumulated).then(function() {
              return browser.storage.local.set({
                _translateResult: {
                  success: true,
                  translations: accumulated,
                  cached: cachedCount,
                  translated: translatedCount,
                  partial: true,
                  source: source
                }
              });
            })
          );
        } else if (evt.event === 'error') {
          // Log but continue — other batches may succeed
        }
        // 'done' is handled after the read loop
      }
      return Promise.all(storePromises);
    }

    function read() {
      return reader.read().then(function(result) {
        if (result.done) {
          // Process any remaining buffer
          if (buffer.trim()) {
            var parsed = parseSSE(buffer + '\n\n');
            return processEvents(parsed.events);
          }
          return;
        }

        buffer += decoder.decode(result.value, { stream: true });
        var parsed = parseSSE(buffer);
        buffer = parsed.remaining;

        return processEvents(parsed.events).then(function() {
          return read();
        });
      });
    }

    return read();
  }).then(function() {
    // Write final result (partial: false)
    return storeTranslations(domain, language, accumulated).then(function() {
      return {
        success: true,
        translations: accumulated,
        cached: cachedCount,
        translated: translatedCount
      };
    });
  });
}

/**
 * Store translations for a domain/language in browser.storage.local.
 */
function storeTranslations(domain, language, translations) {
  return browser.storage.local.get('translations').then(function(stored) {
    var allTranslations = (stored && stored.translations) || {};
    if (!allTranslations[domain]) {
      allTranslations[domain] = {};
    }
    allTranslations[domain][language] = translations;
    return browser.storage.local.set({ translations: allTranslations });
  });
}

/**
 * Handle translating keys via the translation server.
 * Tries the streaming endpoint first, falls back to the non-streaming endpoint.
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

  // Try streaming endpoint first, fall back to non-streaming
  return handleTranslateKeysStreaming(message).catch(function(streamErr) {
    // Fallback to non-streaming endpoint
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
        return storeTranslations(domain, language, data.translations).then(function() {
          return {
            success: true,
            translations: data.translations,
            cached: data.cached,
            translated: data.translated
          };
        });
      });
  }).catch(function(err) {
    return {
      success: false,
      error: err.message || 'Translation server request failed.'
    };
  });
}

// Index bundled translations on service worker startup
indexBundledTranslations();
