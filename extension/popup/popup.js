/* global AnyI18nLanguages, localizePage, t */

/**
 * Popup: pick a language, translate the page, watch the progress, switch back to the original.
 * The page itself (content script) scans, requests and applies translations, so closing the
 * popup never interrupts a translation; the popup only mirrors the page state.
 */
(function() {
  'use strict';

  var Languages = AnyI18nLanguages;
  var OTHER = '__other__';
  var UI_LOCALE = browser.i18n.getUILanguage();
  var MAX_KEY_ROWS = 300;
  var PROVIDER_LABELS = {
    server: 'providerServer',
    lmstudio: 'providerLmstudio',
    ollama: 'providerOllama',
    openai: 'providerOpenai',
    deepseek: 'providerDeepseek'
  };

  var el = {
    site: document.getElementById('site'),
    settings: document.getElementById('settings-btn'),
    provider: document.getElementById('provider'),
    providerText: document.getElementById('provider-text'),
    restricted: document.getElementById('restricted'),
    main: document.getElementById('main'),
    language: document.getElementById('language'),
    other: document.getElementById('language-other'),
    recent: document.getElementById('recent'),
    translate: document.getElementById('translate-btn'),
    translateLabel: document.getElementById('translate-label'),
    progress: document.getElementById('progress'),
    progressText: document.getElementById('progress-text'),
    progressBar: document.getElementById('progress-bar'),
    stop: document.getElementById('stop-btn'),
    translated: document.getElementById('translated'),
    translatedText: document.getElementById('translated-text'),
    original: document.getElementById('original-btn'),
    autoText: document.getElementById('auto-text'),
    autoToggle: document.getElementById('auto-toggle'),
    status: document.getElementById('status'),
    tools: document.getElementById('tools'),
    keyCount: document.getElementById('key-count'),
    scan: document.getElementById('scan-btn'),
    apply: document.getElementById('apply-btn'),
    exportBtn: document.getElementById('export-btn'),
    importInput: document.getElementById('import-input'),
    keys: document.getElementById('keys'),
    footer: document.getElementById('shortcut-hint')
  };

  var tabId = null;
  var domain = '';
  var page = { isTranslated: false, busy: false, activeLanguage: null, keyCount: 0 };
  var progress = { done: 0, total: 0 };

  localizePage();

  // --- Messaging ---

  function toPage(message) {
    return browser.tabs.sendMessage(tabId, message);
  }

  function toBackground(message) {
    return browser.runtime.sendMessage(message);
  }

  /** Make sure the content scripts run in the tab (tabs opened before installation have none). */
  function ensureContentScript() {
    return toPage({ type: 'GET_STATUS' }).catch(function() {
      var scripts = (browser.runtime.getManifest().content_scripts || [])[0] || { js: [] };
      return browser.scripting.executeScript({ target: { tabId: tabId }, files: scripts.js }).then(function() {
        return toPage({ type: 'GET_STATUS' });
      });
    });
  }

  function refreshStatus() {
    return toPage({ type: 'GET_STATUS' }).then(function(status) {
      if (status) page = status;
      render();
      return page;
    });
  }

  // --- Status line ---

  function showStatus(message, kind, withSettingsLink) {
    el.status.textContent = message;
    el.status.className = 'status' + (kind ? ' ' + kind : '');
    if (withSettingsLink) {
      el.status.appendChild(document.createTextNode(' '));
      var link = document.createElement('a');
      link.href = '#';
      link.textContent = t('popupOpenSettings', undefined, 'Open settings');
      link.addEventListener('click', function(event) {
        event.preventDefault();
        openSettings();
      });
      el.status.appendChild(link);
    }
    el.status.hidden = false;
  }

  function clearStatus() {
    el.status.hidden = true;
    el.status.textContent = '';
  }

  function errorText(error) {
    return (error && error.message) || t('errorUnknown', undefined, 'unknown error');
  }

  // --- Language picker ---

  function fillLanguageSelect() {
    el.language.innerHTML = '';
    Languages.list(UI_LOCALE).forEach(function(entry) {
      var option = document.createElement('option');
      option.value = entry.code;
      option.textContent = entry.label;
      el.language.appendChild(option);
    });
    var other = document.createElement('option');
    other.value = OTHER;
    other.textContent = t('popupOtherLanguage', undefined, 'Other language…');
    el.language.appendChild(other);
  }

  function setLanguage(code) {
    var resolved = Languages.resolve(code, UI_LOCALE);
    if (Languages.CODES.indexOf(resolved) !== -1) {
      el.language.value = resolved;
      el.other.hidden = true;
    } else {
      el.language.value = OTHER;
      el.other.hidden = false;
      el.other.value = resolved;
    }
    render();
  }

  function selectedLanguage() {
    if (el.language.value !== OTHER) return el.language.value;
    return Languages.resolve(el.other.value, UI_LOCALE);
  }

  function languageName(code) {
    return Languages.name(code, UI_LOCALE);
  }

  function renderRecent(recent) {
    el.recent.innerHTML = '';
    (recent || []).slice(0, 4).forEach(function(code) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = Languages.nativeName(code);
      chip.title = languageName(code);
      chip.dataset.code = code;
      chip.addEventListener('click', function() {
        setLanguage(code);
        translate();
      });
      el.recent.appendChild(chip);
    });
    markRecent();
  }

  function markRecent() {
    var current = selectedLanguage();
    Array.prototype.forEach.call(el.recent.children, function(chip) {
      chip.setAttribute('aria-pressed', String(chip.dataset.code === current));
    });
  }

  // --- Rendering ---

  function render() {
    var language = selectedLanguage();
    var showingOther = page.isTranslated && page.activeLanguage && page.activeLanguage !== language;

    el.progress.hidden = !page.busy;
    el.translated.hidden = page.busy || !page.isTranslated;
    el.translate.hidden = page.busy || (page.isTranslated && !showingOther);
    el.translate.disabled = !language;
    el.translateLabel.textContent = language
      ? t('actionTranslateTo', [languageName(language)], 'Translate to ' + languageName(language))
      : t('actionTranslate', undefined, 'Translate');

    if (page.isTranslated && page.activeLanguage) {
      el.translatedText.textContent = t('popupTranslatedTo', [languageName(page.activeLanguage)],
        'Translated to ' + languageName(page.activeLanguage));
    }

    if (page.busy) {
      var name = languageName(page.activeLanguage || language);
      if (progress.total > 0) {
        el.progress.classList.remove('indeterminate');
        el.progressText.textContent = t('progressTranslating', [name, String(Math.min(progress.done, progress.total)), String(progress.total)]);
        el.progressBar.style.width = Math.round(Math.min(1, progress.done / progress.total) * 100) + '%';
      } else {
        el.progress.classList.add('indeterminate');
        el.progressBar.style.width = '';
        el.progressText.textContent = t('progressStarting', [name]);
      }
    }

    el.keyCount.textContent = String(page.keyCount || 0);
    el.exportBtn.disabled = !page.keyCount;
    markRecent();
  }

  function renderKeys(keys) {
    el.keys.innerHTML = '';
    Object.keys(keys || {}).slice(0, MAX_KEY_ROWS).forEach(function(key) {
      var row = document.createElement('div');
      row.className = 'key-row';
      var id = document.createElement('span');
      id.className = 'key-id';
      id.textContent = key;
      id.title = key;
      var text = document.createElement('span');
      text.className = 'key-text';
      text.textContent = keys[key];
      text.title = keys[key];
      row.appendChild(id);
      row.appendChild(text);
      el.keys.appendChild(row);
    });
  }

  // --- Provider chip ---

  function renderProvider() {
    toBackground({ type: 'GET_PROVIDER' }).then(function(info) {
      if (!info || !info.provider) return;
      var label = t(PROVIDER_LABELS[info.provider] || 'providerServer');
      if (info.model) label += ' · ' + info.model;
      el.providerText.textContent = label;
      el.provider.title = info.baseUrl || '';
      el.provider.dataset.state = 'checking';
      return toBackground({ type: 'CHECK_PROVIDER' }).then(function(check) {
        if (check && check.success) {
          el.provider.dataset.state = 'ok';
        } else {
          el.provider.dataset.state = 'error';
          el.providerText.textContent = t('popupProviderError', [t(PROVIDER_LABELS[info.provider] || 'providerServer')]);
          el.provider.title = (check && check.error) || '';
        }
      });
    }).catch(function() {});
  }

  function openSettings() {
    browser.runtime.openOptionsPage();
    window.close();
  }

  // --- Actions ---

  function translate() {
    var language = selectedLanguage();
    if (!language) return;
    clearStatus();

    var switching = page.isTranslated && page.activeLanguage && page.activeLanguage !== language;
    var prepare = switching ? toPage({ type: 'REVERT_TRANSLATION' }) : Promise.resolve();

    page.busy = true;
    page.activeLanguage = language;
    progress = { done: 0, total: 0 };
    render();

    prepare.then(function() {
      return toPage({ type: 'TRANSLATE_PAGE', language: language, source: 'popup' });
    }).then(function(response) {
      if (!response || !response.keyCount) {
        page.busy = false;
        render();
        showStatus(t('errorNoText', undefined, 'No translatable text found on this page.'), 'error');
        return undefined;
      }
      if (autoEnabled()) setAutoTranslate(true);
      return refreshStatus();
    }).catch(function(error) {
      page.busy = false;
      render();
      showStatus(t('statusTranslateFailed', undefined, 'Translation failed.') + ' ' + errorText(error), 'error');
    });
  }

  el.translate.addEventListener('click', translate);

  el.original.addEventListener('click', function() {
    clearStatus();
    toPage({ type: 'REVERT_TRANSLATION' }).then(refreshStatus);
  });

  el.stop.addEventListener('click', function() {
    toPage({ type: 'CANCEL_TRANSLATION' });
  });

  el.language.addEventListener('change', function() {
    el.other.hidden = el.language.value !== OTHER;
    if (!el.other.hidden) el.other.focus();
    if (autoEnabled()) setAutoTranslate(true);
    render();
  });

  el.other.addEventListener('input', render);
  el.other.addEventListener('keydown', function(event) {
    if (event.key === 'Enter') translate();
  });

  el.provider.addEventListener('click', openSettings);
  el.settings.addEventListener('click', openSettings);

  // --- Auto-translate ---

  function autoEnabled() {
    return el.autoToggle.checked;
  }

  function setAutoTranslate(enabled) {
    var language = selectedLanguage();
    if (enabled && language) {
      return toBackground({ type: 'SET_AUTO_TRANSLATE', domain: domain, language: language });
    }
    return toBackground({ type: 'REMOVE_AUTO_TRANSLATE', domain: domain });
  }

  el.autoToggle.addEventListener('change', function() {
    setAutoTranslate(el.autoToggle.checked).then(function() {
      if (el.autoToggle.checked && !page.isTranslated && !page.busy) translate();
    });
  });

  // --- Progress from the background (shared storage channel) ---

  browser.storage.onChanged.addListener(function(changes, area) {
    if (area !== 'local' || !changes._translateResult) return;
    var result = changes._translateResult.newValue;
    if (!result || result.domain !== domain || result.source === 'dynamic') return;

    if (result.partial) {
      progress = { done: result.done || 0, total: result.total || 0 };
      page.busy = true;
      render();
      return;
    }

    if (result.source === 'popup') browser.storage.local.remove('_translateResult');
    progress = { done: 0, total: 0 };
    // Give the page a moment to apply the last batch before reading its state.
    setTimeout(function() {
      refreshStatus().then(function() {
        if (!result.success) {
          showStatus(result.error || t('statusTranslateFailed', undefined, 'Translation failed.'), 'error', true);
        } else if (result.cancelled) {
          showStatus(t('progressStopped', undefined, 'Stopped. What was translated so far stays.'), '');
        } else if (result.failed > 0) {
          showStatus(t('statusFailedCount', [String(result.failed)]), 'error');
        }
      });
    }, 150);
  });

  // --- Keys and files ---

  el.tools.addEventListener('toggle', function() {
    if (!el.tools.open) return;
    toPage({ type: 'GET_KEYS' }).then(function(response) {
      if (response) renderKeys(response.keys);
    }).catch(function() {});
  });

  el.scan.addEventListener('click', function() {
    toPage({ type: 'SCAN_PAGE' }).then(function(response) {
      showStatus(t('statusScanFound', [String((response && response.keyCount) || 0)]), 'ok');
      return toPage({ type: 'GET_KEYS' });
    }).then(function(response) {
      if (response) renderKeys(response.keys);
      return refreshStatus();
    }).catch(function(error) {
      showStatus(t('statusScanFailed', [errorText(error)]), 'error');
    });
  });

  el.apply.addEventListener('click', function() {
    var language = selectedLanguage();
    toPage({ type: 'APPLY_TRANSLATION', language: language }).then(function(response) {
      if (response && response.success) {
        clearStatus();
      } else {
        showStatus(t('statusNoTranslations', undefined, 'No translations for this language yet.'), 'error');
      }
      return refreshStatus();
    }).catch(function(error) {
      showStatus(t('statusApplyFailed', [errorText(error)]), 'error');
    });
  });

  el.exportBtn.addEventListener('click', function() {
    toPage({ type: 'EXPORT_KEYS' }).then(function(response) {
      if (!response || !response.keys) return;
      var blob = new Blob([JSON.stringify(response, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = '_keys.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showStatus(t('statusExported', undefined, 'Keys exported as _keys.json'), 'ok');
    }).catch(function(error) {
      showStatus(t('statusExportFailed', [errorText(error)]), 'error');
    });
  });

  el.importInput.addEventListener('change', function(event) {
    var file = event.target.files[0];
    el.importInput.value = '';
    if (!file) return;
    file.text().then(function(text) {
      var data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        showStatus(t('errorInvalidJson', undefined, 'Invalid JSON file.'), 'error');
        return undefined;
      }
      return toBackground({ type: 'IMPORT_TRANSLATIONS', data: data }).then(function(response) {
        if (response && response.success) {
          setLanguage(response.language);
          showStatus(t('statusImportedCount', [String(response.keyCount), languageName(response.language)]), 'ok');
        } else {
          showStatus(t('statusImportFailed', [(response && response.error) || t('errorUnknown')]), 'error');
        }
      });
    });
  });

  // --- Shortcut hint ---

  function renderShortcut() {
    if (!browser.commands || !browser.commands.getAll) return;
    browser.commands.getAll().then(function(commands) {
      var toggle = commands.filter(function(c) { return c.name === 'toggle-translation'; })[0];
      if (!toggle || !toggle.shortcut) return;
      var marker = '\u2063'; // invisible separator, survives message substitution
      var parts = t('popupShortcutHint', [marker], marker + ' translates or restores any page').split(marker);
      el.footer.textContent = parts[0];
      var kbd = document.createElement('kbd');
      kbd.textContent = toggle.shortcut;
      el.footer.appendChild(kbd);
      el.footer.appendChild(document.createTextNode(parts[1] || ''));
    }).catch(function() {});
  }

  // --- Init ---

  function showRestricted() {
    el.restricted.hidden = false;
    el.main.hidden = true;
    el.tools.hidden = true;
  }

  fillLanguageSelect();
  renderProvider();
  renderShortcut();

  browser.tabs.query({ active: true, currentWindow: true }).then(function(tabs) {
    var tab = tabs && tabs[0];
    if (!tab) return;
    tabId = tab.id;

    var url = null;
    try {
      url = new URL(tab.url || '');
    } catch (e) {
      url = null;
    }
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
      el.site.textContent = tab.title || '';
      showRestricted();
      return;
    }
    domain = url.hostname;
    el.site.textContent = domain;
    el.autoText.textContent = t('popupAlwaysTranslate', [domain], 'Always translate ' + domain);

    Promise.all([
      ensureContentScript().catch(function() { return null; }),
      browser.storage.local.get(['recentLanguages', 'lastLanguage', 'autoTranslate'])
    ]).then(function(results) {
      var status = results[0];
      var stored = results[1] || {};
      if (!status) {
        showRestricted();
        return;
      }
      page = status;
      var auto = (stored.autoTranslate || {})[domain];
      el.autoToggle.checked = Boolean(auto && auto.enabled);
      renderRecent(stored.recentLanguages);
      setLanguage(page.activeLanguage || (auto && auto.language) || stored.lastLanguage ||
        Languages.browserDefault(navigator.language));
    });
  });
})();
