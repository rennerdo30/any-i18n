/* global browser */

var MESSAGES = {
  SCAN_PAGE: 'SCAN_PAGE',
  GET_KEYS: 'GET_KEYS',
  APPLY_TRANSLATION: 'APPLY_TRANSLATION',
  REVERT_TRANSLATION: 'REVERT_TRANSLATION',
  GET_LANGUAGES: 'GET_LANGUAGES',
  IMPORT_TRANSLATIONS: 'IMPORT_TRANSLATIONS',
  EXPORT_KEYS: 'EXPORT_KEYS',
  GET_STATUS: 'GET_STATUS',
  TRANSLATE_KEYS: 'TRANSLATE_KEYS',
  GET_AUTO_TRANSLATE: 'GET_AUTO_TRANSLATE',
  SET_AUTO_TRANSLATE: 'SET_AUTO_TRANSLATE',
  REMOVE_AUTO_TRANSLATE: 'REMOVE_AUTO_TRANSLATE'
};

var CONTENT_SCRIPT_FILES = [
  'shared/constants.js',
  'shared/utils.js',
  'shared/storage.js',
  'content/key-generator.js',
  'content/dom-scanner.js',
  'content/text-replacer.js',
  'content/mutation-handler.js',
  'content/content-script.js'
];

var domainEl = document.getElementById('domain');
var languageInput = document.getElementById('language-input');
var languageOptions = document.getElementById('language-options');
var scanBtn = document.getElementById('scan-btn');
var keyCountEl = document.getElementById('key-count');
var applyBtn = document.getElementById('apply-btn');
var exportBtn = document.getElementById('export-btn');
var importInput = document.getElementById('import-input');
var statusEl = document.getElementById('status');
var keysListEl = document.getElementById('keys-list');
var keysToggleEl = document.getElementById('keys-toggle');
var keysBodyEl = document.getElementById('keys-body');
var keysCountLabel = document.getElementById('keys-count-label');

var translateBtn = document.getElementById('translate-btn');
var translateLabel = translateBtn.querySelector('.translate-label');
var autoTranslateToggle = document.getElementById('auto-translate-toggle');
var autoTranslateLangEl = document.getElementById('auto-translate-lang');

var scanLabel = scanBtn.querySelector('.scan-label');
var currentTabId = null;
var isTranslationApplied = false;
var contentScriptReady = false;
var collectedKeys = null;

function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = 'status ' + type;
}

function clearStatus() {
  statusEl.className = 'status hidden';
  statusEl.textContent = '';
}

/**
 * Inject content scripts into the active tab if they aren't already loaded.
 * Returns a promise that resolves when scripts are ready.
 */
function ensureContentScript() {
  if (contentScriptReady) return Promise.resolve();

  return browser.tabs.sendMessage(currentTabId, { type: MESSAGES.GET_STATUS })
    .then(function() {
      contentScriptReady = true;
    })
    .catch(function() {
      // Content script not loaded — inject it programmatically
      return browser.scripting.executeScript({
        target: { tabId: currentTabId },
        files: CONTENT_SCRIPT_FILES
      }).then(function() {
        contentScriptReady = true;
      });
    });
}

function sendToContentScript(message) {
  return ensureContentScript().then(function() {
    return browser.tabs.sendMessage(currentTabId, message);
  });
}

function sendToBackground(message) {
  return browser.runtime.sendMessage(message);
}

/**
 * Scan the page and update UI. Returns a promise resolving to the keys object.
 */
function scanPage() {
  return sendToContentScript({ type: MESSAGES.SCAN_PAGE }).then(function(response) {
    if (response && response.keyCount !== undefined) {
      keyCountEl.textContent = response.keyCount;
      exportBtn.disabled = response.keyCount === 0;
      applyBtn.disabled = response.keyCount === 0;

      return sendToContentScript({ type: MESSAGES.GET_KEYS }).then(function(keysResp) {
        if (keysResp && keysResp.keys) {
          renderKeys(keysResp.keys);
          return keysResp.keys;
        }
        return null;
      });
    }
    return null;
  });
}

/**
 * Auto-scan on popup open: check status first, scan if no keys yet.
 */
function autoScan() {
  browser.tabs.sendMessage(currentTabId, { type: MESSAGES.GET_STATUS }).then(function(response) {
    contentScriptReady = true;
    if (response) {
      keyCountEl.textContent = response.keyCount || 0;
      isTranslationApplied = response.isTranslated || false;
      updateApplyButton();
      if (response.keyCount > 0) {
        exportBtn.disabled = false;
        applyBtn.disabled = false;
        // Already have keys, fetch them
        sendToContentScript({ type: MESSAGES.GET_KEYS }).then(function(keysResp) {
          if (keysResp && keysResp.keys) renderKeys(keysResp.keys);
        }).catch(function() {});
      } else {
        // Content script loaded but no keys — scan now
        scanPage();
      }
    }
  }).catch(function() {
    // Content script not loaded — inject and scan
    scanPage();
  });
}

var applyLabel = applyBtn.querySelector('.apply-label');

function updateApplyButton() {
  if (isTranslationApplied) {
    if (applyLabel) applyLabel.textContent = 'Revert';
    applyBtn.classList.remove('btn-success');
    applyBtn.classList.add('btn-danger');
  } else {
    if (applyLabel) applyLabel.textContent = 'Apply';
    applyBtn.classList.remove('btn-danger');
    applyBtn.classList.add('btn-success');
  }
}

function populateLanguages(languages) {
  languageOptions.innerHTML = '';
  if (languages && languages.length > 0) {
    languages.forEach(function(lang) {
      var opt = document.createElement('option');
      opt.value = lang;
      languageOptions.appendChild(opt);
    });
  }
}

/**
 * Render collected keys into the keys viewer panel.
 */
function renderKeys(keys) {
  collectedKeys = keys;
  if (!keysBodyEl) return;

  keysBodyEl.innerHTML = '';

  var entries = Object.entries(keys || {});
  if (keysCountLabel) {
    keysCountLabel.textContent = entries.length;
  }

  if (entries.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'keys-empty';
    empty.textContent = 'No keys scanned yet.';
    keysBodyEl.appendChild(empty);
    return;
  }

  entries.forEach(function(pair) {
    var key = pair[0];
    var text = pair[1];

    var row = document.createElement('div');
    row.className = 'key-row';

    var keyEl = document.createElement('span');
    keyEl.className = 'key-id';
    keyEl.textContent = key;
    keyEl.title = key;

    var valEl = document.createElement('span');
    valEl.className = 'key-text';
    valEl.textContent = text;
    valEl.title = text;

    row.appendChild(keyEl);
    row.appendChild(valEl);
    keysBodyEl.appendChild(row);
  });
}

// Keys viewer toggle
if (keysToggleEl) {
  keysToggleEl.addEventListener('click', function() {
    var isOpen = keysListEl.classList.toggle('open');
    keysToggleEl.setAttribute('aria-expanded', isOpen);

    // Fetch keys if opening and we don't have them yet
    if (isOpen && !collectedKeys && currentTabId) {
      sendToContentScript({ type: MESSAGES.GET_KEYS }).then(function(response) {
        if (response && response.keys) {
          renderKeys(response.keys);
        }
      }).catch(function() {});
    }
  });
}

// Initialize popup
browser.tabs.query({ active: true, currentWindow: true }).then(function(tabs) {
  if (!tabs || tabs.length === 0) return;

  var tab = tabs[0];
  currentTabId = tab.id;

  // Show domain
  try {
    domainEl.textContent = new URL(tab.url).hostname;
  } catch (e) {
    domainEl.textContent = '--';
  }

  // Auto-scan on popup open
  autoScan();

  // Pre-fill with browser's language (e.g. "en-US" → "en")
  var systemLang = (navigator.language || '').split('-')[0];
  if (systemLang) {
    languageInput.value = systemLang;
    updateTranslateButton();
  }

  // Get available languages from background
  sendToBackground({ type: MESSAGES.GET_LANGUAGES, domain: domainEl.textContent }).then(function(response) {
    if (response && response.languages) {
      populateLanguages(response.languages);
      if (response.activeLanguage) {
        languageInput.value = response.activeLanguage;
        updateTranslateButton();
      }
    }
  }).catch(function() {});

  // Check auto-translate state for current domain
  sendToBackground({ type: MESSAGES.GET_AUTO_TRANSLATE, domain: domainEl.textContent }).then(function(response) {
    if (response && response.config && response.config.enabled) {
      autoTranslateToggle.checked = true;
      autoTranslateLangEl.textContent = 'Auto: ' + response.config.language;
      if (response.config.language) {
        languageInput.value = response.config.language;
        updateTranslateButton();
      }
    }
  }).catch(function() {});
});

// Scan Page
scanBtn.addEventListener('click', function() {
  clearStatus();
  scanBtn.disabled = true;
  if (scanLabel) scanLabel.textContent = 'Scanning...';

  scanPage().then(function() {
    scanBtn.disabled = false;
    if (scanLabel) scanLabel.textContent = 'Scan Page';
    showStatus('Found ' + keyCountEl.textContent + ' translatable text nodes.', 'success');
    updateTranslateButton();
  }).catch(function(err) {
    scanBtn.disabled = false;
    if (scanLabel) scanLabel.textContent = 'Scan Page';
    showStatus('Scan failed: ' + (err.message || 'unknown error'), 'error');
  });
});

// Apply / Revert Translation
applyBtn.addEventListener('click', function() {
  clearStatus();

  if (isTranslationApplied) {
    sendToContentScript({ type: MESSAGES.REVERT_TRANSLATION }).then(function(response) {
      if (response && response.success) {
        isTranslationApplied = false;
        updateApplyButton();
        showStatus('Translation reverted.', 'info');
      }
    }).catch(function(err) {
      showStatus('Revert failed: ' + (err.message || 'unknown error'), 'error');
    });
  } else {
    var lang = languageInput.value.trim();
    if (!lang) {
      showStatus('Please enter a language first.', 'error');
      return;
    }

    applyBtn.disabled = true;
    sendToContentScript({ type: MESSAGES.APPLY_TRANSLATION, language: lang }).then(function(response) {
      applyBtn.disabled = false;
      if (response && response.success) {
        isTranslationApplied = true;
        updateApplyButton();
        showStatus('Translation applied (' + lang + ').', 'success');
      } else {
        showStatus(response && response.error ? response.error : 'No translations found for this language.', 'error');
      }
    }).catch(function(err) {
      applyBtn.disabled = false;
      showStatus('Apply failed: ' + (err.message || 'unknown error'), 'error');
    });
  }
});

// Export Keys
exportBtn.addEventListener('click', function() {
  clearStatus();

  sendToContentScript({ type: MESSAGES.EXPORT_KEYS }).then(function(response) {
    if (response && response.keys) {
      var blob = new Blob([JSON.stringify(response, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = '_keys.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showStatus('Keys exported as _keys.json', 'success');
    }
  }).catch(function(err) {
    showStatus('Export failed: ' + (err.message || 'unknown error'), 'error');
  });
});

// Import Translation
importInput.addEventListener('change', function(e) {
  clearStatus();
  var file = e.target.files[0];
  if (!file) return;

  var reader = new FileReader();
  reader.onload = function(event) {
    try {
      var data = JSON.parse(event.target.result);
      sendToBackground({
        type: MESSAGES.IMPORT_TRANSLATIONS,
        domain: domainEl.textContent,
        data: data
      }).then(function(response) {
        if (response && response.success) {
          showStatus('Translation imported successfully.', 'success');
          sendToBackground({ type: MESSAGES.GET_LANGUAGES, domain: domainEl.textContent }).then(function(resp) {
            if (resp && resp.languages) {
              populateLanguages(resp.languages);
            }
          });
        } else {
          showStatus(response && response.error ? response.error : 'Import failed.', 'error');
        }
      }).catch(function(err) {
        showStatus('Import failed: ' + (err.message || 'unknown error'), 'error');
      });
    } catch (parseErr) {
      showStatus('Invalid JSON file.', 'error');
    }
  };
  reader.readAsText(file);
  importInput.value = '';
});

// Translate just needs a language — it will auto-scan if needed
function updateTranslateButton() {
  translateBtn.disabled = !languageInput.value.trim();
}

languageInput.addEventListener('input', updateTranslateButton);
languageInput.addEventListener('change', updateTranslateButton);

// Listen for translation result from background (written to storage)
browser.storage.onChanged.addListener(function(changes) {
  if (!changes._translateResult) return;
  var result = changes._translateResult.newValue;
  if (!result) return;

  // Only process popup-initiated results
  if (result.source !== 'popup') return;

  // Handle partial (streaming) results
  if (result.partial) {
    var soFar = Object.keys(result.translations || {}).length;
    if (translateLabel) translateLabel.textContent = 'Translating...';
    showStatus('Translating... ' + soFar + ' keys so far', 'info');

    // Progressively apply translations
    var lang = languageInput.value.trim();
    if (lang) {
      sendToContentScript({ type: MESSAGES.APPLY_TRANSLATION, language: lang }).then(function(applyResp) {
        if (applyResp && applyResp.success) {
          isTranslationApplied = true;
          updateApplyButton();
        }
      }).catch(function() {});
    }
    return; // Don't clean up or re-enable button for partial results
  }

  // Final result — clean up the flag
  browser.storage.local.remove('_translateResult');

  translateBtn.disabled = false;
  if (translateLabel) translateLabel.textContent = 'Translate';

  if (result.success) {
    var lang = languageInput.value.trim();
    var msg = 'Translated ' + (result.translated || 0) + ' keys';
    if (result.cached > 0) {
      msg += ' (' + result.cached + ' from cache)';
    }

    // Auto-apply translations to the page
    sendToContentScript({ type: MESSAGES.APPLY_TRANSLATION, language: lang }).then(function(applyResp) {
      if (applyResp && applyResp.success) {
        isTranslationApplied = true;
        updateApplyButton();
        showStatus(msg + ' — applied!', 'success');
      } else {
        showStatus(msg + ' (stored, click Apply)', 'success');
      }
    }).catch(function() {
      showStatus(msg + ' (stored, click Apply)', 'success');
    });

    // Refresh languages list
    sendToBackground({ type: MESSAGES.GET_LANGUAGES, domain: domainEl.textContent }).then(function(resp) {
      if (resp && resp.languages) {
        populateLanguages(resp.languages);
        languageInput.value = lang;
      }
    });

    applyBtn.disabled = false;
  } else {
    showStatus(result.error || 'Translation failed.', 'error');
  }
});

// Auto-translate toggle
autoTranslateToggle.addEventListener('change', function() {
  var domain = domainEl.textContent;
  if (!domain || domain === '--') return;

  if (autoTranslateToggle.checked) {
    var lang = languageInput.value.trim();
    if (!lang) {
      showStatus('Please enter a language first.', 'error');
      autoTranslateToggle.checked = false;
      return;
    }
    sendToBackground({
      type: MESSAGES.SET_AUTO_TRANSLATE,
      domain: domain,
      language: lang
    }).then(function() {
      autoTranslateLangEl.textContent = 'Auto: ' + lang;
    });
  } else {
    sendToBackground({
      type: MESSAGES.REMOVE_AUTO_TRANSLATE,
      domain: domain
    }).then(function() {
      autoTranslateLangEl.textContent = '';
    });
  }
});

// Update auto-translate config when language changes while toggle is on
languageInput.addEventListener('change', function() {
  if (!autoTranslateToggle.checked) return;
  var lang = languageInput.value.trim();
  var domain = domainEl.textContent;
  if (!lang || !domain || domain === '--') return;

  sendToBackground({
    type: MESSAGES.SET_AUTO_TRANSLATE,
    domain: domain,
    language: lang
  }).then(function() {
    autoTranslateLangEl.textContent = 'Auto: ' + lang;
  });
});

// Translate via server (auto-scans if needed)
translateBtn.addEventListener('click', function() {
  clearStatus();
  var lang = languageInput.value.trim();
  if (!lang) {
    showStatus('Please enter a language first.', 'error');
    return;
  }

  translateBtn.disabled = true;
  if (translateLabel) translateLabel.textContent = 'Scanning...';

  // Get keys — auto-scan if we don't have them
  var keysPromise;
  if (collectedKeys && Object.keys(collectedKeys).length > 0) {
    keysPromise = Promise.resolve(collectedKeys);
  } else {
    keysPromise = scanPage();
  }

  keysPromise.then(function(keys) {
    if (!keys || Object.keys(keys).length === 0) {
      translateBtn.disabled = false;
      if (translateLabel) translateLabel.textContent = 'Translate';
      showStatus('No translatable text found on this page.', 'error');
      return;
    }

    if (translateLabel) translateLabel.textContent = 'Translating...';

    // Fire-and-forget — result comes back via storage.onChanged
    sendToBackground({
      type: MESSAGES.TRANSLATE_KEYS,
      keys: keys,
      language: lang,
      domain: domainEl.textContent,
      source: 'popup'
    });
  }).catch(function(err) {
    translateBtn.disabled = false;
    if (translateLabel) translateLabel.textContent = 'Translate';
    showStatus('Translation failed: ' + (err.message || 'unknown error'), 'error');
  });
});
