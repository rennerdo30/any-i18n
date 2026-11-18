/* global AnyI18nProviders, localizePage, t */

/**
 * Settings page: translation provider, image text extraction and on-page behaviour.
 * Every change is saved immediately to storage.local (`providerSettings`); the service worker
 * and the content scripts read it from there.
 */
(function() {
  'use strict';

  var Providers = AnyI18nProviders;
  var SETTINGS_KEY = 'providerSettings';
  var SAVE_DELAY_MS = 300;
  var SAVED_NOTICE_MS = 1500;
  var LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

  var settings = null;
  var saveTimer = null;
  var savedTimer = null;

  var el = {
    provider: document.getElementById('provider'),
    url: document.getElementById('url'),
    urlHint: document.getElementById('url-hint'),
    serverHint: document.getElementById('server-hint'),
    model: document.getElementById('model'),
    modelOptions: document.getElementById('model-options'),
    refreshModels: document.getElementById('refresh-models'),
    apiKey: document.getElementById('api-key'),
    toggleKey: document.getElementById('toggle-key'),
    batchSize: document.getElementById('batch-size'),
    parallel: document.getElementById('parallel'),
    test: document.getElementById('test'),
    testResult: document.getElementById('test-result'),
    ocrLanguages: document.getElementById('ocr-languages'),
    visionUrl: document.getElementById('vision-url'),
    visionModel: document.getElementById('vision-model'),
    visionKey: document.getElementById('vision-key'),
    showOriginal: document.getElementById('show-original'),
    highlight: document.getElementById('highlight'),
    cacheStats: document.getElementById('cache-stats'),
    clearCache: document.getElementById('clear-cache'),
    saved: document.getElementById('saved')
  };

  localizePage();

  // --- Helpers ---

  function currentProvider() {
    return el.provider.value;
  }

  function setResult(message, kind) {
    el.testResult.textContent = message;
    el.testResult.className = 'result' + (kind ? ' ' + kind : '');
  }

  function showFor(name, visible) {
    var nodes = document.querySelectorAll('[data-for="' + name + '"]');
    for (var i = 0; i < nodes.length; i++) nodes[i].hidden = !visible;
  }

  function setOrDelete(map, key, value) {
    if (value === '' || value === null || value === undefined) {
      delete map[key];
    } else {
      map[key] = value;
    }
  }

  function fillModelOptions(models) {
    var provider = currentProvider();
    var seen = {};
    el.modelOptions.innerHTML = '';
    (Providers.RECOMMENDED_MODELS[provider] || []).concat(models || []).forEach(function(id) {
      if (!id || seen[id]) return;
      seen[id] = true;
      var option = document.createElement('option');
      option.value = id;
      el.modelOptions.appendChild(option);
    });
  }

  /** Values the background needs to reach the provider being edited (not necessarily saved yet). */
  function draftTarget() {
    var provider = currentProvider();
    return {
      provider: provider,
      baseUrl: (el.url.value.trim() || Providers.PROVIDERS[provider].url).replace(/\/+$/, ''),
      apiKey: el.apiKey.value.trim()
    };
  }

  /**
   * Plain-http endpoints on other machines (a LAN box running Ollama) are not covered by the
   * manifest's host permissions; ask for them while the user is clicking a button.
   */
  function ensureHostPermission(url) {
    var parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      return Promise.resolve(true);
    }
    if (parsed.protocol !== 'http:' || LOCAL_HOSTS.indexOf(parsed.hostname) !== -1) {
      return Promise.resolve(true);
    }
    var origins = [parsed.protocol + '//' + parsed.hostname + '/*'];
    return browser.permissions.contains({ origins: origins }).then(function(granted) {
      return granted || browser.permissions.request({ origins: origins });
    }).catch(function() {
      return false;
    });
  }

  // --- Rendering ---

  function renderProvider() {
    var provider = currentProvider();
    var preset = Providers.PROVIDERS[provider];
    var isServer = provider === Providers.SERVER_PROVIDER;
    var resolved = Providers.resolve(Object.assign({}, settings, { provider: provider }));

    el.url.value = settings.urls[provider] || '';
    el.url.placeholder = preset.url;
    el.model.value = settings.models[provider] || '';
    el.model.placeholder = Providers.DEFAULT_MODELS[provider] || '';
    el.apiKey.value = settings.apiKeys[provider] || '';
    el.batchSize.value = resolved.batchSize;
    el.parallel.value = resolved.parallel;

    el.urlHint.hidden = isServer;
    el.serverHint.hidden = !isServer;
    showFor('direct', !isServer);
    showFor('key', preset.needsKey);
    fillModelOptions([]);
    setResult('', '');
  }

  function renderOcr() {
    var mode = settings.ocrMode === Providers.OCR_MODE_VISION ? Providers.OCR_MODE_VISION : Providers.OCR_MODE_BUILTIN;
    var radios = document.querySelectorAll('input[name="ocr-mode"]');
    for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === mode;
    showFor('builtin', mode === Providers.OCR_MODE_BUILTIN);
    showFor('vision', mode === Providers.OCR_MODE_VISION);
  }

  function render() {
    el.provider.value = settings.provider;
    renderProvider();
    renderOcr();
    el.ocrLanguages.value = settings.ocrLanguages;
    el.visionUrl.value = settings.visionUrl;
    el.visionModel.value = settings.visionModel;
    el.visionKey.value = settings.visionApiKey;
    el.showOriginal.checked = settings.showOriginalOnHover !== false;
    el.highlight.checked = settings.highlightTranslated === true;
  }

  function renderCacheStats() {
    browser.runtime.sendMessage({ type: 'GET_CACHE_STATS' }).then(function(stats) {
      if (!stats) return;
      el.cacheStats.textContent = t('optionsCacheStats',
        [String(stats.strings), String(stats.domains), String(stats.images)]);
    }).catch(function() {});
  }

  // --- Saving ---

  function collect() {
    var provider = currentProvider();
    var preset = Providers.PROVIDERS[provider];
    settings.provider = provider;
    setOrDelete(settings.urls, provider, el.url.value.trim().replace(/\/+$/, ''));

    if (provider !== Providers.SERVER_PROVIDER) {
      setOrDelete(settings.models, provider, el.model.value.trim());
      var batch = parseInt(el.batchSize.value, 10);
      var parallel = parseInt(el.parallel.value, 10);
      setOrDelete(settings.batchSize, provider, batch === preset.batchSize || isNaN(batch) ? '' : batch);
      setOrDelete(settings.parallel, provider, parallel === preset.parallel || isNaN(parallel) ? '' : parallel);
    }
    if (preset.needsKey) setOrDelete(settings.apiKeys, provider, el.apiKey.value.trim());

    var mode = document.querySelector('input[name="ocr-mode"]:checked');
    settings.ocrMode = mode ? mode.value : Providers.OCR_MODE_BUILTIN;
    settings.ocrLanguages = el.ocrLanguages.value.trim().replace(/\s+/g, '') || 'eng';
    settings.visionUrl = el.visionUrl.value.trim() || Providers.DEFAULT_SETTINGS.visionUrl;
    settings.visionModel = el.visionModel.value.trim() || Providers.DEFAULT_SETTINGS.visionModel;
    settings.visionApiKey = el.visionKey.value.trim();
    settings.showOriginalOnHover = el.showOriginal.checked;
    settings.highlightTranslated = el.highlight.checked;
  }

  function save() {
    collect();
    return browser.storage.local.set({ [SETTINGS_KEY]: settings }).then(function() {
      clearTimeout(savedTimer);
      el.saved.textContent = t('statusSaved', undefined, 'Saved');
      savedTimer = setTimeout(function() { el.saved.textContent = ''; }, SAVED_NOTICE_MS);
    });
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY_MS);
  }

  // --- Events ---

  el.provider.addEventListener('change', function() {
    clearTimeout(saveTimer);
    // Keep what was typed for the previous provider before switching the fields.
    var next = el.provider.value;
    el.provider.value = settings.provider;
    collect();
    el.provider.value = next;
    renderProvider();
    save();
  });

  [el.url, el.model, el.apiKey, el.batchSize, el.parallel, el.ocrLanguages,
    el.visionUrl, el.visionModel, el.visionKey].forEach(function(input) {
    input.addEventListener('input', scheduleSave);
  });

  [el.showOriginal, el.highlight].forEach(function(input) {
    input.addEventListener('change', save);
  });

  Array.prototype.forEach.call(document.querySelectorAll('input[name="ocr-mode"]'), function(radio) {
    radio.addEventListener('change', function() {
      settings.ocrMode = radio.value;
      renderOcr();
      save();
    });
  });

  el.toggleKey.addEventListener('click', function() {
    var hidden = el.apiKey.type === 'password';
    el.apiKey.type = hidden ? 'text' : 'password';
    el.toggleKey.textContent = hidden ? t('actionHide', undefined, 'Hide') : t('actionShow', undefined, 'Show');
  });

  el.refreshModels.addEventListener('click', function() {
    var target = draftTarget();
    el.refreshModels.disabled = true;
    ensureHostPermission(target.baseUrl).then(function() {
      return browser.runtime.sendMessage(Object.assign({ type: 'LIST_MODELS' }, target));
    }).then(function(response) {
      if (response && response.success) {
        fillModelOptions(response.models);
        setResult(t('statusModelsLoaded', [String(response.models.length)]), 'ok');
      } else {
        setResult(t('statusConnectionFailed', [(response && response.error) || t('errorUnknown')]), 'error');
      }
    }).finally(function() {
      el.refreshModels.disabled = false;
    });
  });

  el.test.addEventListener('click', function() {
    var target = draftTarget();
    el.test.disabled = true;
    setResult(t('statusTesting', undefined, 'Testing…'), '');
    ensureHostPermission(target.baseUrl).then(function(granted) {
      if (!granted) throw new Error(t('errorPermissionDenied', [target.baseUrl]));
      return browser.runtime.sendMessage(Object.assign({ type: 'TEST_CONNECTION' }, target));
    }).then(function(response) {
      if (!response || !response.success) {
        throw new Error((response && response.error) || t('errorUnknown'));
      }
      if (response.models && response.models.length) {
        fillModelOptions(response.models);
        setResult(t('statusConnectedModels', [String(response.models.length)]), 'ok');
      } else {
        setResult(t('statusConnected', undefined, 'Connected.') + (response.detail ? ' (' + response.detail + ')' : ''), 'ok');
      }
    }).catch(function(error) {
      setResult(t('statusConnectionFailed', [error.message]), 'error');
    }).finally(function() {
      el.test.disabled = false;
    });
  });

  el.clearCache.addEventListener('click', function() {
    if (!window.confirm(t('confirmClearCache'))) return;
    browser.runtime.sendMessage({ type: 'CLEAR_CACHE' }).then(function() {
      renderCacheStats();
      el.saved.textContent = t('statusCacheCleared');
    });
  });

  // Firefox has no offscreen documents, so the bundled OCR cannot run there.
  if (!browser.offscreen) {
    var builtin = document.querySelector('input[name="ocr-mode"][value="builtin"]');
    builtin.disabled = true;
    builtin.closest('label').title = t('errorOcrUnsupported');
  }

  // --- Init ---

  browser.storage.local.get(SETTINGS_KEY).then(function(stored) {
    settings = Providers.resolve(stored && stored[SETTINGS_KEY]).settings;
    if (!browser.offscreen) settings.ocrMode = Providers.OCR_MODE_VISION;
    render();
    renderCacheStats();
  });
})();
