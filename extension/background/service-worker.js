// Browser API compatibility shim
if (typeof browser === 'undefined') var browser = chrome;

// Chrome runs this file as a service worker; Firefox loads shared/providers.js first through
// background.scripts (see scripts/build.js).
if (typeof AnyI18nProviders === 'undefined' && typeof importScripts === 'function') {
  importScripts('../shared/providers.js', '../shared/languages.js');
}

/**
 * Background service worker for the any-i18n extension.
 *
 * - Translates page keys, either through the any-i18n server (SSE stream) or directly against an
 *   OpenAI-compatible provider (LM Studio, Ollama, OpenAI, DeepSeek, OpenRouter, ...).
 * - Imports translation files and indexes bundled translations.
 * - Context menu: translate the page, translate an image (OCR + translation).
 *
 * Long-running results are written to storage (`_translateResult`) instead of being returned
 * through the message port, which closes before slow model calls finish.
 */

var Providers = AnyI18nProviders;

var SETTINGS_KEY = 'providerSettings';
var LAST_LANGUAGE_KEY = 'lastLanguage';
var RECENT_LANGUAGES_KEY = 'recentLanguages';
var MAX_RECENT_LANGUAGES = 5;
var BADGE_COLOR = '#0e7c6b';
var BADGE_BUSY_TEXT = '\u2026';
var COMMAND_TOGGLE = 'toggle-translation';
var IMAGE_CACHE_KEY = 'imageCache';
var MAX_IMAGE_CACHE_ENTRIES = 200;

var REQUEST_TIMEOUT_MS = 90000;      // Local models can take a while for a full batch
var MODELS_TIMEOUT_MS = 10000;
var IMAGE_FETCH_TIMEOUT_MS = 15000;
var VISION_TIMEOUT_MS = 120000;
var IMAGE_MAX_DIMENSION = 1600;      // Downscale larger images before OCR / vision
var NO_TEXT_MARKER = 'NO_TEXT';

var MENU_TRANSLATE_PAGE = 'anyi18n-translate-page';
var MENU_TRANSLATE_IMAGE = 'anyi18n-translate-image';

function t(key, substitutions, fallback) {
  var message = browser.i18n.getMessage(key, substitutions);
  return message || fallback || key;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

browser.runtime.onInstalled.addListener(function(details) {
  if (details.reason === 'install') {
    browser.storage.local.set({
      settings: {
        enabled: true,
        autoScan: true
      },
      translations: {},
      domainKeys: {}
    });
    indexBundledTranslations();
    // First run: the settings page detects local models and walks through the setup.
    browser.tabs.create({ url: browser.runtime.getURL('options/options.html?welcome=1') });
  }

  // Installs from before direct providers existed keep using the translation server.
  browser.storage.local.get(SETTINGS_KEY).then(function(stored) {
    if (stored && stored[SETTINGS_KEY]) return;
    var initial = { provider: details.reason === 'install' ? 'lmstudio' : Providers.SERVER_PROVIDER };
    return browser.storage.local.set({ [SETTINGS_KEY]: initial });
  });

  createContextMenus();
});

function createContextMenus() {
  if (!browser.contextMenus) return;
  Promise.resolve(browser.contextMenus.removeAll()).then(function() {
    browser.contextMenus.create({
      id: MENU_TRANSLATE_PAGE,
      title: t('menuTranslatePage', undefined, 'Translate page'),
      contexts: ['page', 'selection']
    });
    browser.contextMenus.create({
      id: MENU_TRANSLATE_IMAGE,
      title: t('menuTranslateImage', undefined, 'Translate image text'),
      contexts: ['image']
    });
  });
}

/**
 * Index bundled translations from the extension's translations directory.
 * Reads the manifest.json file that lists available domains and languages.
 */
function indexBundledTranslations() {
  fetch(browser.runtime.getURL('translations/manifest.json'))
    .then(function(response) {
      if (!response.ok) return null;
      return response.json();
    })
    .then(function(manifest) {
      if (!manifest || !manifest.domains) return null;

      var loadPromises = [];
      Object.keys(manifest.domains).forEach(function(domain) {
        var languages = manifest.domains[domain].languages || [];
        languages.forEach(function(lang) {
          var url = browser.runtime.getURL('translations/' + domain + '/' + lang + '.json');
          loadPromises.push(fetch(url)
            .then(function(response) { return response.ok ? response.json() : null; })
            .then(function(data) {
              return data && data.translations
                ? { domain: domain, language: lang, translations: data.translations }
                : null;
            })
            .catch(function() { return null; }));
        });
      });
      return Promise.all(loadPromises);
    })
    .then(function(results) {
      if (!results) return null;
      return browser.storage.local.get('translations').then(function(stored) {
        var all = (stored && stored.translations) || {};
        results.forEach(function(result) {
          if (!result) return;
          all[result.domain] = all[result.domain] || {};
          // Bundled files never overwrite translations the user already has.
          all[result.domain][result.language] =
            Object.assign({}, result.translations, all[result.domain][result.language] || {});
        });
        return browser.storage.local.set({ translations: all });
      });
    })
    .catch(function() {
      // No bundled translations: normal for development installs.
    });
}

// ---------------------------------------------------------------------------
// Settings and storage helpers
// ---------------------------------------------------------------------------

function loadProvider() {
  return browser.storage.local.get(SETTINGS_KEY).then(function(stored) {
    return Providers.resolve(stored && stored[SETTINGS_KEY]);
  });
}

// Serialize read-modify-write cycles on storage: parallel batches would otherwise drop entries.
var storageQueue = Promise.resolve();

function queueStorage(task) {
  var run = storageQueue.then(task);
  storageQueue = run.catch(function(error) {
    console.error('any-i18n: storage write failed', error);
  });
  return run;
}

/** Merge translations for a domain/language into storage. */
function storeTranslations(domain, language, translations) {
  return queueStorage(function() {
    return browser.storage.local.get('translations').then(function(stored) {
      var all = (stored && stored.translations) || {};
      all[domain] = all[domain] || {};
      all[domain][language] = Object.assign({}, all[domain][language] || {}, translations);
      return browser.storage.local.set({ translations: all });
    });
  });
}

function getStoredTranslations(domain, language) {
  return browser.storage.local.get('translations').then(function(stored) {
    var all = (stored && stored.translations) || {};
    return (all[domain] && all[domain][language]) || {};
  });
}

function publishResult(result) {
  return queueStorage(function() {
    return browser.storage.local.set({ _translateResult: result });
  });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

browser.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (!message || !message.type) return undefined;

  switch (message.type) {
    case 'GET_LANGUAGES':
      browser.storage.local.get('translations').then(function(stored) {
        var all = (stored && stored.translations) || {};
        sendResponse({ languages: all[message.domain] ? Object.keys(all[message.domain]) : [] });
      });
      return true;

    case 'IMPORT_TRANSLATIONS':
      handleImportTranslations(message).then(sendResponse);
      return true;

    case 'TRANSLATE_KEYS':
      if (message.language) rememberLanguage(message.language);
      handleTranslateKeys(message).then(function(result) {
        result.source = message.source || 'unknown';
        result.domain = message.domain;
        result.language = message.language;
        return publishResult(result);
      });
      sendResponse({ started: true });
      return undefined;

    case 'GET_AUTO_TRANSLATE':
      browser.storage.local.get('autoTranslate').then(function(stored) {
        var all = (stored && stored.autoTranslate) || {};
        sendResponse({ config: all[message.domain] || null });
      });
      return true;

    case 'SET_AUTO_TRANSLATE':
      browser.storage.local.get('autoTranslate').then(function(stored) {
        var all = (stored && stored.autoTranslate) || {};
        all[message.domain] = { language: message.language, enabled: true };
        return browser.storage.local.set({ autoTranslate: all });
      }).then(function() {
        sendResponse({ success: true });
      });
      return true;

    case 'REMOVE_AUTO_TRANSLATE':
      browser.storage.local.get('autoTranslate').then(function(stored) {
        var all = (stored && stored.autoTranslate) || {};
        delete all[message.domain];
        return browser.storage.local.set({ autoTranslate: all });
      }).then(function() {
        sendResponse({ success: true });
      });
      return true;

    case 'GET_PROVIDER':
      loadProvider().then(function(resolved) {
        sendResponse({ provider: resolved.provider, model: resolved.model, baseUrl: resolved.baseUrl });
      });
      return true;

    case 'LIST_MODELS':
      listModels(message.provider, message.baseUrl, message.apiKey)
        .then(function(models) { sendResponse({ success: true, models: models }); })
        .catch(function(error) { sendResponse({ success: false, error: error.message }); });
      return true;

    case 'TEST_CONNECTION':
      testConnection(message.provider, message.baseUrl, message.apiKey)
        .then(function(info) { sendResponse(Object.assign({ success: true }, info)); })
        .catch(function(error) { sendResponse({ success: false, error: error.message }); });
      return true;

    case 'CANCEL_TRANSLATION':
      sendResponse({ cancelled: cancelTranslation(message.domain, message.language) });
      return undefined;

    case 'PAGE_STATE':
      if (sender.tab && sender.tab.id !== undefined) updateBadge(sender.tab.id, message);
      return undefined;

    case 'CHECK_PROVIDER':
      loadProvider().then(function(resolved) {
        if (resolved.needsKey && !resolved.apiKey) {
          throw new Error(t('errorMissingKey', undefined, 'Add an API key for this provider in the settings.'));
        }
        return testConnection(resolved.provider, resolved.baseUrl, resolved.apiKey);
      }).then(function() {
        sendResponse({ success: true });
      }).catch(function(error) {
        sendResponse({ success: false, error: error.message });
      });
      return true;

    case 'DETECT_PROVIDERS':
      detectLocalProviders().then(sendResponse);
      return true;

    case 'GET_CACHE_STATS':
      browser.storage.local.get(['translations', IMAGE_CACHE_KEY]).then(function(stored) {
        var all = (stored && stored.translations) || {};
        var strings = 0;
        Object.keys(all).forEach(function(domain) {
          Object.keys(all[domain]).forEach(function(lang) {
            strings += Object.keys(all[domain][lang] || {}).length;
          });
        });
        sendResponse({
          domains: Object.keys(all).length,
          strings: strings,
          images: Object.keys((stored && stored[IMAGE_CACHE_KEY]) || {}).length
        });
      });
      return true;

    case 'CLEAR_CACHE':
      browser.storage.local.set({ translations: {}, [IMAGE_CACHE_KEY]: {} }).then(function() {
        sendResponse({ success: true });
      });
      return true;
  }
  return undefined;
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
      error: t('errorImportFormat', undefined,
        'Invalid translation file format. Expected _meta (with domain, language) and translations.')
    });
  }

  var domain = data._meta.domain;
  var language = data._meta.language;
  var translations = data.translations;

  return storeTranslations(domain, language, translations).then(function() {
    return {
      success: true,
      domain: domain,
      language: language,
      keyCount: Object.keys(translations).length
    };
  });
}

// ---------------------------------------------------------------------------
// Translation: dispatch
// ---------------------------------------------------------------------------

// Keys currently being translated, per domain and language. A second request for the same keys
// (popup and dynamic content at once, two tabs of one site) does not pay for them twice.
var inFlight = {};

// Running requests per domain and language; Stop marks them cancelled. Workers finish the batch
// they are on (its result is still stored) and take no new ones.
var activeRequests = {};

function cancelTranslation(domain, language) {
  var tokens = activeRequests[domain + '\u0000' + language];
  if (!tokens || tokens.size === 0) return false;
  tokens.forEach(function(token) {
    token.cancelled = true;
    if (token.onCancel) token.onCancel();
  });
  return true;
}

function rememberLanguage(language) {
  browser.storage.local.get(RECENT_LANGUAGES_KEY).then(function(stored) {
    var recent = (stored[RECENT_LANGUAGES_KEY] || []).filter(function(code) { return code !== language; });
    recent.unshift(language);
    var update = {};
    update[LAST_LANGUAGE_KEY] = language;
    update[RECENT_LANGUAGES_KEY] = recent.slice(0, MAX_RECENT_LANGUAGES);
    return browser.storage.local.set(update);
  });
}

function handleTranslateKeys(message) {
  if (!message.keys || !message.language || !message.domain) {
    return Promise.resolve({ success: false, error: 'Missing keys, language, or domain.' });
  }

  var scope = message.domain + '\u0000' + message.language;
  var busy = inFlight[scope] || (inFlight[scope] = new Set());
  var keys = {};
  Object.keys(message.keys).forEach(function(key) {
    if (busy.has(key)) return;
    keys[key] = message.keys[key];
    busy.add(key);
  });
  var token = { cancelled: false, onCancel: null };
  var request = Object.assign({}, message, { keys: keys, token: token });
  var tokens = activeRequests[scope] || (activeRequests[scope] = new Set());
  tokens.add(token);

  function release() {
    Object.keys(keys).forEach(function(key) { busy.delete(key); });
    if (busy.size === 0) delete inFlight[scope];
    tokens.delete(token);
    if (tokens.size === 0) delete activeRequests[scope];
  }

  if (Object.keys(keys).length === 0) {
    release();
    return Promise.resolve({ success: true, translations: {}, cached: 0, translated: 0 });
  }

  return loadProvider().then(function(resolved) {
    if (resolved.provider === Providers.SERVER_PROVIDER) {
      return translateViaServer(request, resolved.baseUrl);
    }
    return translateDirect(request, resolved);
  }).catch(function(error) {
    return { success: false, error: error.message || 'Translation failed.' };
  }).then(function(result) {
    release();
    if (token.cancelled) {
      result.cancelled = true;
      result.success = true;
    }
    return result;
  });
}

// ---------------------------------------------------------------------------
// Translation: any-i18n server
// ---------------------------------------------------------------------------

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
    if (i === blocks.length - 1 && !text.endsWith('\n\n')) {
      remaining = block;
      break;
    }
    if (!block.trim()) continue;

    var eventType = 'message';
    var dataStr = '';
    var lines = block.split('\n');
    for (var j = 0; j < lines.length; j++) {
      if (lines[j].indexOf('event: ') === 0) {
        eventType = lines[j].substring(7);
      } else if (lines[j].indexOf('data: ') === 0) {
        dataStr = lines[j].substring(6);
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

function translateViaServerStreaming(message, serverUrl) {
  var domain = message.domain;
  var language = message.language;
  var source = message.source || 'unknown';
  var accumulated = {};
  var cachedCount = 0;
  var translatedCount = 0;
  var total = Object.keys(message.keys).length;
  var token = message.token || {};

  return fetch(serverUrl + '/api/translate/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys: message.keys, language: language, domain: domain })
  }).then(function(response) {
    if (!response.ok) {
      throw new Error('Server error: ' + response.status);
    }

    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    token.onCancel = function() {
      reader.cancel().catch(function() {});
    };

    function processEvents(events) {
      var writes = [];
      events.forEach(function(evt) {
        if (evt.event !== 'cached' && evt.event !== 'batch') return;
        var translations = evt.data.translations || {};
        Object.assign(accumulated, translations);
        if (evt.event === 'cached') {
          cachedCount = evt.data.cached || 0;
        } else {
          translatedCount += Object.keys(translations).length;
        }
        writes.push(storeTranslations(domain, language, translations).then(function() {
          return publishResult({
            success: true,
            translations: accumulated,
            cached: cachedCount,
            translated: translatedCount,
            total: total,
            done: cachedCount + translatedCount,
            partial: true,
            source: source,
            domain: domain,
            language: language
          });
        }));
      });
      return Promise.all(writes);
    }

    function read() {
      return reader.read().then(function(result) {
        if (result.done || token.cancelled) {
          return buffer.trim() ? processEvents(parseSSE(buffer + '\n\n').events) : undefined;
        }
        buffer += decoder.decode(result.value, { stream: true });
        var parsed = parseSSE(buffer);
        buffer = parsed.remaining;
        return processEvents(parsed.events).then(read);
      });
    }

    return read();
  }).then(function() {
    return {
      success: true,
      translations: accumulated,
      cached: cachedCount,
      translated: translatedCount,
      total: total,
      done: cachedCount + translatedCount
    };
  });
}

/** Translate through the server; falls back to the non-streaming endpoint. */
function translateViaServer(message, serverUrl) {
  return translateViaServerStreaming(message, serverUrl).catch(function(streamError) {
    if (message.token && message.token.cancelled) throw streamError;
    return fetch(serverUrl + '/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: message.keys, language: message.language, domain: message.domain })
    }).then(function(response) {
      if (!response.ok) {
        return response.text().then(function(text) {
          throw new Error('Server error: ' + response.status + ' ' + text);
        });
      }
      return response.json();
    }).then(function(data) {
      return storeTranslations(message.domain, message.language, data.translations).then(function() {
        return {
          success: true,
          translations: data.translations,
          cached: data.cached,
          translated: data.translated
        };
      });
    });
  }).catch(function(error) {
    var reason = error && error.message === 'Failed to fetch'
      ? t('errorServerUnreachable', [serverUrl], 'Cannot reach the translation server at ' + serverUrl + '.')
      : (error.message || 'Translation server request failed.');
    return { success: false, error: reason };
  });
}

// ---------------------------------------------------------------------------
// Translation: direct OpenAI-compatible provider
// ---------------------------------------------------------------------------

/** POST a chat-completions request and return the assistant text. */
function chat(resolved, messages, timeoutMs, overrides) {
  var target = overrides || resolved;
  var controller = new AbortController();
  var timer = setTimeout(function() { controller.abort(); }, timeoutMs || REQUEST_TIMEOUT_MS);
  var endpoint = Providers.chatEndpoint(target.baseUrl);

  return fetch(endpoint, {
    method: 'POST',
    headers: Providers.authHeaders(target.apiKey),
    signal: controller.signal,
    body: JSON.stringify(Object.assign({
      model: target.model || 'local-model',
      messages: messages
    }, Providers.samplingOptions(target.model)))
  }).then(function(response) {
    if (!response.ok) {
      return response.text().catch(function() { return ''; }).then(function(text) {
        throw new Error(Providers.describeHttpError(response.status, text));
      });
    }
    return response.json();
  }).then(Providers.replyContent).catch(function(error) {
    if (error.name === 'AbortError') {
      throw new Error(t('errorTimeout', undefined, 'The provider did not answer in time.'));
    }
    if (error instanceof TypeError) {
      throw new Error(t('errorUnreachable', [endpoint],
        'Cannot reach ' + endpoint + '. Is it running, and does it allow browser requests (CORS)?'));
    }
    throw error;
  }).finally(function() {
    clearTimeout(timer);
  });
}

function translateOne(resolved, text, language) {
  return chat(resolved, Providers.singleMessages(text, language)).then(function(content) {
    var cleaned = Providers.cleanContent(content);
    return cleaned || null;
  });
}

/**
 * Translate one batch. A reply that does not line up is retried once, then every string is
 * translated on its own. Returns an array aligned with `texts` (null for failures).
 */
function translateBatch(resolved, texts, language) {
  function attempt() {
    return chat(resolved, Providers.batchMessages(texts, language)).then(function(content) {
      return Providers.parseBatchReply(content, texts.length);
    });
  }

  return attempt().then(function(parsed) {
    return parsed || attempt();
  }).then(function(parsed) {
    if (parsed) return parsed;
    var results = [];
    return texts.reduce(function(chain, text) {
      return chain.then(function() {
        return translateOne(resolved, text, language)
          .catch(function() { return null; })
          .then(function(value) { results.push(value); });
      });
    }, Promise.resolve()).then(function() { return results; });
  });
}

function translateDirect(message, resolved) {
  var domain = message.domain;
  var language = message.language;
  var source = message.source || 'unknown';

  if (resolved.needsKey && !resolved.apiKey) {
    return Promise.resolve({
      success: false,
      error: t('errorMissingKey', undefined, 'Add an API key for this provider in the settings.')
    });
  }

  return getStoredTranslations(domain, language).then(function(existing) {
    // Strings this site already has a translation for are not sent again.
    var textToKeys = {};
    var cached = {};
    Object.keys(message.keys).forEach(function(key) {
      if (existing[key]) {
        cached[key] = existing[key];
        return;
      }
      var text = message.keys[key];
      if (!text) return;
      (textToKeys[text] = textToKeys[text] || []).push(key);
    });

    var texts = Object.keys(textToKeys);
    var accumulated = Object.assign({}, cached);
    var cachedCount = Object.keys(cached).length;
    var translatedCount = 0;
    var failedCount = 0;
    var lastError = null;

    if (texts.length === 0) {
      return { success: true, translations: accumulated, cached: cachedCount, translated: 0 };
    }

    var queue = Providers.makeBatches(texts, resolved.batchSize);
    var workerCount = Math.min(resolved.parallel, queue.length);
    var total = texts.length;
    var token = message.token || {};

    function runWorker() {
      if (token.cancelled) return Promise.resolve();
      var batch = queue.shift();
      if (!batch) return Promise.resolve();

      return translateBatch(resolved, batch, language).then(function(results) {
        var fresh = {};
        batch.forEach(function(text, index) {
          var translated = results[index];
          if (!translated) {
            failedCount++;
            return;
          }
          textToKeys[text].forEach(function(key) { fresh[key] = translated; });
          translatedCount++;
        });
        Object.assign(accumulated, fresh);
        return storeTranslations(domain, language, fresh).then(function() {
          return publishResult({
            success: true,
            translations: accumulated,
            cached: cachedCount,
            translated: translatedCount,
            failed: failedCount,
            total: total,
            done: translatedCount + failedCount,
            partial: true,
            source: source,
            domain: domain,
            language: language
          });
        });
      }).catch(function(error) {
        failedCount += batch.length;
        lastError = error;
      }).then(runWorker);
    }

    var workers = [];
    for (var i = 0; i < workerCount; i++) workers.push(runWorker());

    return Promise.all(workers).then(function() {
      if (translatedCount === 0 && failedCount > 0) {
        return {
          success: false,
          error: lastError ? lastError.message : t('errorNothingTranslated', undefined, 'Nothing could be translated.')
        };
      }
      return {
        success: true,
        translations: accumulated,
        cached: cachedCount,
        translated: translatedCount,
        failed: failedCount,
        total: total,
        done: translatedCount + failedCount
      };
    });
  });
}

// ---------------------------------------------------------------------------
// Provider discovery (options page)
// ---------------------------------------------------------------------------

function fetchJson(url, headers, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function() { controller.abort(); }, timeoutMs || MODELS_TIMEOUT_MS);
  return fetch(url, { headers: headers, signal: controller.signal }).then(function(response) {
    if (!response.ok) {
      var error = new Error(Providers.describeHttpError(response.status, ''));
      error.status = response.status;
      throw error;
    }
    return response.json();
  }).catch(function(error) {
    if (error.name === 'AbortError') {
      throw new Error(t('errorTimeout', undefined, 'The provider did not answer in time.'));
    }
    if (error instanceof TypeError) {
      throw new Error(t('errorUnreachable', [url],
        'Cannot reach ' + url + '. Is it running, and does it allow browser requests (CORS)?'));
    }
    throw error;
  }).finally(function() {
    clearTimeout(timer);
  });
}

function listModels(provider, baseUrl, apiKey) {
  if (provider === Providers.SERVER_PROVIDER) return Promise.resolve([]);
  var base = String(baseUrl || '').replace(/\/+$/, '');
  return fetchJson(Providers.modelsEndpoint(base), Providers.authHeaders(apiKey)).then(Providers.modelIds)
    .catch(function(error) {
      // Older Ollama builds only expose their native model list.
      if (provider === 'ollama' && error.status === 404) {
        return fetchJson(base + '/api/tags', {}).then(Providers.modelIds);
      }
      throw error;
    });
}

function testConnection(provider, baseUrl, apiKey) {
  if (provider === Providers.SERVER_PROVIDER) {
    var base = String(baseUrl || '').replace(/\/+$/, '');
    return fetchJson(base + '/api/health', {}).then(function(body) {
      return { detail: body && body.backend ? body.backend : '' };
    });
  }
  return listModels(provider, baseUrl, apiKey).then(function(models) {
    return { models: models };
  });
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

function contentScriptFiles() {
  var scripts = browser.runtime.getManifest().content_scripts || [];
  return {
    js: scripts.length ? scripts[0].js : [],
    css: scripts.length ? (scripts[0].css || []) : []
  };
}

/** Send a message to the tab, injecting the content scripts first when they are missing. */
function sendToTab(tabId, message) {
  return browser.tabs.sendMessage(tabId, message).catch(function() {
    var files = contentScriptFiles();
    var css = files.css.length
      ? browser.scripting.insertCSS({ target: { tabId: tabId }, files: files.css })
      : Promise.resolve();
    return css.then(function() {
      return browser.scripting.executeScript({ target: { tabId: tabId }, files: files.js });
    }).then(function() {
      return browser.tabs.sendMessage(tabId, message);
    });
  });
}

function targetLanguageFor(url) {
  var domain = '';
  try {
    domain = new URL(url).hostname;
  } catch (e) {
    domain = '';
  }
  return browser.storage.local.get(['autoTranslate', LAST_LANGUAGE_KEY]).then(function(stored) {
    var auto = (stored.autoTranslate || {})[domain];
    if (auto && auto.language) return auto.language;
    if (stored[LAST_LANGUAGE_KEY]) return stored[LAST_LANGUAGE_KEY];
    return AnyI18nLanguages.browserDefault(navigator.language);
  });
}

if (browser.contextMenus) {
  browser.contextMenus.onClicked.addListener(function(info, tab) {
    if (!tab || tab.id === undefined) return;

    if (info.menuItemId === MENU_TRANSLATE_PAGE) {
      targetLanguageFor(tab.url).then(function(language) {
        return sendToTab(tab.id, { type: 'TRANSLATE_PAGE', language: language });
      }).catch(function(error) {
        console.warn('any-i18n: cannot translate this page', error);
      });
    } else if (info.menuItemId === MENU_TRANSLATE_IMAGE && info.srcUrl) {
      handleImageTranslation(info.srcUrl, tab);
    }
  });
}

// ---------------------------------------------------------------------------
// Image translation: extract text (bundled OCR or a vision model), then translate it
// ---------------------------------------------------------------------------

function handleImageTranslation(srcUrl, tab) {
  var language;
  targetLanguageFor(tab.url).then(function(lang) {
    language = lang;
    return sendToTab(tab.id, { type: 'IMAGE_TRANSLATION_STARTED', srcUrl: srcUrl });
  }).then(function() {
    return translateImage(srcUrl, language);
  }).then(function(result) {
    return browser.tabs.sendMessage(tab.id, Object.assign({ type: 'IMAGE_TRANSLATION_RESULT', srcUrl: srcUrl }, result));
  }).catch(function(error) {
    console.error('any-i18n: image translation failed', error);
    return browser.tabs.sendMessage(tab.id, {
      type: 'IMAGE_TRANSLATION_RESULT',
      srcUrl: srcUrl,
      error: error.message
    }).catch(function() {});
  });
}

function imageCacheKey(srcUrl, language, resolved) {
  var s = resolved.settings;
  var extractor = s.ocrMode === Providers.OCR_MODE_VISION ? 'vision:' + s.visionModel : 'ocr:' + s.ocrLanguages;
  return JSON.stringify([resolved.provider, resolved.model, extractor, language, srcUrl]);
}

function translateImage(srcUrl, language) {
  return loadProvider().then(function(resolved) {
    var cacheKey = imageCacheKey(srcUrl, language, resolved);
    return browser.storage.local.get(IMAGE_CACHE_KEY).then(function(stored) {
      var hit = ((stored && stored[IMAGE_CACHE_KEY]) || {})[cacheKey];
      if (hit) return { extractedText: hit.extractedText, translation: hit.translation, fromCache: true };

      return fetchImageAsDataUrl(srcUrl).then(function(dataUrl) {
        return extractImageText(dataUrl, resolved.settings);
      }).then(function(text) {
        if (!text || text === NO_TEXT_MARKER) return { noText: true };
        return translateText(resolved, text, language).then(function(translation) {
          var result = { extractedText: text, translation: translation };
          storeImageResult(cacheKey, result);
          return result;
        });
      });
    });
  });
}

function storeImageResult(key, result) {
  return queueStorage(function() {
    return browser.storage.local.get(IMAGE_CACHE_KEY).then(function(stored) {
      var cache = (stored && stored[IMAGE_CACHE_KEY]) || {};
      cache[key] = { extractedText: result.extractedText, translation: result.translation, ts: Date.now() };
      var keys = Object.keys(cache);
      if (keys.length > MAX_IMAGE_CACHE_ENTRIES) {
        keys.sort(function(a, b) { return (cache[a].ts || 0) - (cache[b].ts || 0); });
        keys.slice(0, keys.length - MAX_IMAGE_CACHE_ENTRIES).forEach(function(stale) { delete cache[stale]; });
      }
      return browser.storage.local.set({ [IMAGE_CACHE_KEY]: cache });
    });
  });
}

/** Translate free text (image contents) with the configured provider. */
function translateText(resolved, text, language) {
  if (resolved.provider !== Providers.SERVER_PROVIDER) {
    if (resolved.needsKey && !resolved.apiKey) {
      return Promise.reject(new Error(t('errorMissingKey', undefined, 'Add an API key for this provider in the settings.')));
    }
    return translateOne(resolved, text, language).then(function(value) {
      if (!value) throw new Error(t('errorNothingTranslated', undefined, 'Nothing could be translated.'));
      return value;
    });
  }
  return fetch(resolved.baseUrl + '/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys: { image_text: text }, language: language, domain: '_images' })
  }).then(function(response) {
    if (!response.ok) throw new Error('Server error: ' + response.status);
    return response.json();
  }).then(function(data) {
    var value = data && data.translations && data.translations.image_text;
    if (!value) throw new Error(t('errorNothingTranslated', undefined, 'Nothing could be translated.'));
    return value;
  });
}

function fetchImageAsDataUrl(srcUrl) {
  if (srcUrl.indexOf('data:') === 0) return Promise.resolve(srcUrl);

  var controller = new AbortController();
  var timer = setTimeout(function() { controller.abort(); }, IMAGE_FETCH_TIMEOUT_MS);
  return fetch(srcUrl, { signal: controller.signal }).then(function(response) {
    if (!response.ok) throw new Error(t('errorImageFetch', [String(response.status)], 'Could not load the image (HTTP ' + response.status + ').'));
    return response.blob();
  }).then(function(blob) {
    return downscaleImage(blob).catch(function() { return blob; });
  }).then(blobToDataUrl).catch(function(error) {
    if (error.name === 'AbortError') throw new Error(t('errorImageTimeout', undefined, 'Loading the image timed out.'));
    throw error;
  }).finally(function() {
    clearTimeout(timer);
  });
}

function downscaleImage(blob) {
  return createImageBitmap(blob).then(function(bitmap) {
    var scale = Math.min(1, IMAGE_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    var common = ['image/png', 'image/jpeg', 'image/webp'].indexOf(blob.type) !== -1;
    if (scale >= 1 && common) {
      bitmap.close();
      return blob;
    }
    var canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale))
    );
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.convertToBlob({ type: 'image/png' });
  });
}

function blobToDataUrl(blob) {
  return blob.arrayBuffer().then(function(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return 'data:' + (blob.type || 'image/png') + ';base64,' + btoa(binary);
  });
}

function extractImageText(dataUrl, settings) {
  if (settings.ocrMode === Providers.OCR_MODE_VISION) {
    return extractWithVisionModel(dataUrl, settings);
  }
  return extractWithBuiltinOcr(dataUrl, settings.ocrLanguages);
}

function ensureOffscreenDocument() {
  if (!browser.offscreen) {
    return Promise.reject(new Error(t('errorOcrUnsupported', undefined,
      'The built-in OCR needs Chrome or Edge. Switch image text extraction to a vision model in the settings.')));
  }
  return browser.offscreen.hasDocument().then(function(exists) {
    if (exists) return undefined;
    return browser.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Run the bundled Tesseract OCR engine for image translation'
    });
  });
}

function extractWithBuiltinOcr(dataUrl, languages) {
  return ensureOffscreenDocument().then(function() {
    return browser.runtime.sendMessage({
      target: 'offscreen',
      action: 'ocr',
      imageDataUrl: dataUrl,
      languages: languages || 'eng'
    });
  }).then(function(response) {
    if (!response || !response.success) {
      throw new Error((response && response.error) || 'OCR failed.');
    }
    return response.text || NO_TEXT_MARKER;
  });
}

function extractWithVisionModel(dataUrl, settings) {
  var target = {
    baseUrl: String(settings.visionUrl || '').replace(/\/+$/, ''),
    model: settings.visionModel,
    apiKey: settings.visionApiKey
  };
  var messages = [{
    role: 'user',
    content: [
      {
        type: 'text',
        text: 'Extract all readable text from this image exactly as written, preserving line breaks. ' +
          'Reply with only the text. If the image contains no readable text, reply with exactly ' + NO_TEXT_MARKER + '.'
      },
      { type: 'image_url', image_url: { url: dataUrl } }
    ]
  }];
  return chat(null, messages, VISION_TIMEOUT_MS, target).then(function(content) {
    return Providers.cleanContent(content);
  });
}

// ---------------------------------------------------------------------------
// Toolbar badge, keyboard shortcut, local provider detection
// ---------------------------------------------------------------------------

/** Badge: "…" while translating, the language code while a translation is shown. */
function updateBadge(tabId, state) {
  var text = '';
  if (state.busy) {
    text = BADGE_BUSY_TEXT;
  } else if (state.language) {
    text = String(state.language).split('-')[0].slice(0, 3).toUpperCase();
  }
  browser.action.setBadgeBackgroundColor({ tabId: tabId, color: BADGE_COLOR }).catch(function() {});
  browser.action.setBadgeText({ tabId: tabId, text: text }).catch(function() {});
}

if (browser.commands) {
  browser.commands.onCommand.addListener(function(command, tab) {
    if (command !== COMMAND_TOGGLE) return;
    var target = tab ? Promise.resolve(tab) : browser.tabs.query({ active: true, currentWindow: true }).then(function(tabs) {
      return tabs[0];
    });
    target.then(function(activeTab) {
      if (!activeTab || activeTab.id === undefined) return undefined;
      return targetLanguageFor(activeTab.url).then(function(language) {
        return sendToTab(activeTab.id, { type: 'TOGGLE_TRANSLATION', language: language });
      });
    }).catch(function(error) {
      console.warn('any-i18n: shortcut failed on this page', error);
    });
  });
}

/** Probe LM Studio and Ollama on their default ports (first-run setup). */
function detectLocalProviders() {
  var candidates = ['lmstudio', 'ollama'];
  return Promise.all(candidates.map(function(provider) {
    var baseUrl = Providers.PROVIDERS[provider].url;
    return listModels(provider, baseUrl, '').then(function(models) {
      return { provider: provider, baseUrl: baseUrl, ok: true, models: models };
    }).catch(function(error) {
      return { provider: provider, baseUrl: baseUrl, ok: false, error: error.message };
    });
  }));
}
