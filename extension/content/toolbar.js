/**
 * In-page floating language toolbar.
 * Provides quick access to translation without opening the extension popup.
 * Uses Shadow DOM for style isolation from the host page.
 */
(function() {
  'use strict';

  // Bail if toolbar is disabled or API not available
  if (!TOOLBAR_ENABLED) return;
  if (!window.__anyi18n) return;

  var api = window.__anyi18n;
  var isExpanded = false;
  var isTranslated = false;
  var isDragging = false;
  var dragOffsetX = 0;
  var dragOffsetY = 0;
  var statusTimer = null;

  // Create host element and shadow root
  var host = document.createElement('div');
  host.id = 'anyi18n-toolbar-host';
  var shadow = host.attachShadow({ mode: 'closed' });

  // Inline styles (scoped to shadow DOM)
  var style = document.createElement('style');
  style.textContent = [
    ':host { all: initial; }',

    '.toolbar {',
    '  position: fixed;',
    '  bottom: 20px;',
    '  right: 20px;',
    '  z-index: 2147483647;',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;',
    '  font-size: 14px;',
    '  line-height: 1.4;',
    '  color: #333;',
    '  direction: ltr;',
    '  text-align: left;',
    '}',

    '.icon-btn {',
    '  width: 40px;',
    '  height: 40px;',
    '  border-radius: 50%;',
    '  border: none;',
    '  background: #0e7c6b;',
    '  color: #fff;',
    '  font-size: 20px;',
    '  cursor: pointer;',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  box-shadow: 0 2px 8px rgba(0,0,0,0.25);',
    '  transition: background 0.15s;',
    '  user-select: none;',
    '  -webkit-user-select: none;',
    '}',
    '.icon-btn:hover { background: #0a5f52; }',

    '.panel {',
    '  display: none;',
    '  background: #fff;',
    '  border-radius: 8px;',
    '  box-shadow: 0 4px 16px rgba(0,0,0,0.18);',
    '  padding: 10px 12px;',
    '  margin-bottom: 8px;',
    '  min-width: 220px;',
    '}',
    '.panel.open { display: block; }',

    '.panel-row {',
    '  display: flex;',
    '  align-items: center;',
    '  gap: 8px;',
    '}',

    '.lang-input {',
    '  flex: 1;',
    '  padding: 6px 8px;',
    '  border: 1px solid #ccc;',
    '  border-radius: 6px;',
    '  font-size: 14px;',
    '  font-family: inherit;',
    '  outline: none;',
    '  min-width: 0;',
    '  color: #333;',
    '  background: #fff;',
    '}',
    '.lang-input:focus { border-color: #0e7c6b; }',

    '.action-btn {',
    '  padding: 6px 14px;',
    '  border: none;',
    '  border-radius: 6px;',
    '  font-size: 13px;',
    '  font-weight: 600;',
    '  font-family: inherit;',
    '  cursor: pointer;',
    '  white-space: nowrap;',
    '  transition: background 0.15s;',
    '}',
    '.action-btn.translate {',
    '  background: #0e7c6b;',
    '  color: #fff;',
    '}',
    '.action-btn.translate:hover { background: #0a5f52; }',
    '.action-btn.translate:disabled {',
    '  background: #93c5be;',
    '  cursor: not-allowed;',
    '}',
    '.action-btn.revert {',
    '  background: #dc3545;',
    '  color: #fff;',
    '}',
    '.action-btn.revert:hover { background: #b02a37; }',

    '.status-line {',
    '  font-size: 12px;',
    '  color: #666;',
    '  margin-top: 6px;',
    '  min-height: 16px;',
    '  transition: opacity 0.3s;',
    '}',
    '.status-line.error { color: #dc3545; }',
    '.status-line.hidden { opacity: 0; }',

    '.auto-indicator {',
    '  font-size: 11px;',
    '  color: #0e7c6b;',
    '  font-weight: 600;',
    '  margin-top: 4px;',
    '  min-height: 0;',
    '}',
    '.auto-indicator:empty { display: none; }'
  ].join('\n');

  // Build DOM structure
  var toolbar = document.createElement('div');
  toolbar.className = 'toolbar';

  // Panel (expanded state)
  var panel = document.createElement('div');
  panel.className = 'panel';

  var panelRow = document.createElement('div');
  panelRow.className = 'panel-row';

  var langInput = document.createElement('input');
  langInput.className = 'lang-input';
  langInput.type = 'text';
  langInput.placeholder = 'Language (e.g. de)';
  langInput.setAttribute('list', 'anyi18n-langs');

  var datalist = document.createElement('datalist');
  datalist.id = 'anyi18n-langs';

  var actionBtn = document.createElement('button');
  actionBtn.className = 'action-btn translate';
  actionBtn.textContent = 'Translate';

  panelRow.appendChild(langInput);
  panelRow.appendChild(datalist);
  panelRow.appendChild(actionBtn);

  var statusLine = document.createElement('div');
  statusLine.className = 'status-line hidden';

  var autoIndicator = document.createElement('div');
  autoIndicator.className = 'auto-indicator';

  panel.appendChild(panelRow);
  panel.appendChild(statusLine);
  panel.appendChild(autoIndicator);

  // Icon button (always visible)
  var iconBtn = document.createElement('button');
  iconBtn.className = 'icon-btn';
  iconBtn.textContent = '\uD83C\uDF10'; // globe emoji
  iconBtn.title = 'any-i18n toolbar';

  toolbar.appendChild(panel);
  toolbar.appendChild(iconBtn);

  shadow.appendChild(style);
  shadow.appendChild(toolbar);

  // Pre-fill language from navigator
  var systemLang = (navigator.language || '').split('-')[0];
  if (systemLang) {
    langInput.value = systemLang;
  }

  // --- Behavior ---

  function showStatus(msg, isError) {
    if (statusTimer) clearTimeout(statusTimer);
    statusLine.textContent = msg;
    statusLine.className = 'status-line' + (isError ? ' error' : '');
    statusTimer = setTimeout(function() {
      statusLine.className = 'status-line hidden';
    }, 5000);
  }

  function updateButton() {
    if (isTranslated) {
      actionBtn.textContent = 'Revert';
      actionBtn.className = 'action-btn revert';
      actionBtn.disabled = false;
    } else {
      actionBtn.textContent = 'Translate';
      actionBtn.className = 'action-btn translate';
      actionBtn.disabled = false;
    }
  }

  function populateLanguages() {
    var domain = getDomain(window.location.href);
    browser.runtime.sendMessage({ type: MESSAGES.GET_LANGUAGES, domain: domain }).then(function(response) {
      if (response && response.languages) {
        datalist.innerHTML = '';
        response.languages.forEach(function(lang) {
          var opt = document.createElement('option');
          opt.value = lang;
          datalist.appendChild(opt);
        });
      }
    }).catch(function() {});
  }

  function updateAutoIndicator() {
    var domain = getDomain(window.location.href);
    StorageManager.getAutoTranslate(domain).then(function(config) {
      if (config && config.enabled && config.language) {
        autoIndicator.textContent = 'Auto: ' + config.language;
      } else {
        autoIndicator.textContent = '';
      }
    });
  }

  // Toggle expand/collapse
  iconBtn.addEventListener('click', function(e) {
    if (isDragging) return;
    isExpanded = !isExpanded;
    panel.className = isExpanded ? 'panel open' : 'panel';
    if (isExpanded) {
      populateLanguages();
      updateAutoIndicator();
      langInput.focus();
    }
  });

  // Translate / Revert
  actionBtn.addEventListener('click', function() {
    if (isTranslated) {
      // Revert
      api.revert();
      isTranslated = false;
      updateButton();
      showStatus('Translation reverted.', false);
      return;
    }

    var lang = langInput.value.trim();
    if (!lang) {
      showStatus('Enter a language code first.', true);
      return;
    }

    actionBtn.disabled = true;
    actionBtn.textContent = 'Scanning...';

    // Ensure page is scanned
    var keys = api.getKeys();
    if (!keys || Object.keys(keys).length === 0) {
      api.scan();
      keys = api.getKeys();
    }

    if (!keys || Object.keys(keys).length === 0) {
      showStatus('No translatable text found.', true);
      updateButton();
      return;
    }

    actionBtn.textContent = 'Translating...';

    var domain = getDomain(window.location.href);

    // Fire translate request to background (result comes via storage.onChanged)
    browser.runtime.sendMessage({
      type: MESSAGES.TRANSLATE_KEYS,
      keys: keys,
      language: lang,
      domain: domain,
      source: 'toolbar'
    });
  });

  // Listen for translation result from background
  browser.storage.onChanged.addListener(function(changes) {
    if (!changes._translateResult) return;
    var result = changes._translateResult.newValue;
    if (!result) return;

    // Only process toolbar-initiated results
    if (result.source !== 'toolbar') return;

    // Handle partial (streaming) results
    if (result.partial) {
      var soFar = Object.keys(result.translations || {}).length;
      actionBtn.disabled = true;
      actionBtn.textContent = 'Translating...';
      showStatus('Translating... ' + soFar + ' keys so far', false);

      // Progressively apply translations
      var lang = langInput.value.trim();
      if (lang) {
        api.apply(lang).then(function(applyResult) {
          if (applyResult && applyResult.success) {
            isTranslated = true;
          }
        });
      }
      return; // Don't clean up for partial results
    }

    // Final result — clean up the flag
    browser.storage.local.remove('_translateResult');

    if (result.success) {
      var lang = langInput.value.trim();
      var msg = 'Translated ' + (result.translated || 0) + ' keys';
      if (result.cached > 0) {
        msg += ' (' + result.cached + ' cached)';
      }

      // Auto-apply
      api.apply(lang).then(function(applyResult) {
        if (applyResult && applyResult.success) {
          isTranslated = true;
          updateButton();
          showStatus(msg, false);
        } else {
          showStatus(applyResult && applyResult.error ? applyResult.error : 'Apply failed.', true);
          updateButton();
        }
      });
    } else {
      showStatus(result.error || 'Translation failed.', true);
      updateButton();
    }
  });

  // --- Dragging ---
  var dragStartX, dragStartY, moved;

  iconBtn.addEventListener('mousedown', function(e) {
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    moved = false;

    var rect = toolbar.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;

    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
    e.preventDefault();
  });

  function onDragMove(e) {
    var dx = e.clientX - dragStartX;
    var dy = e.clientY - dragStartY;
    if (!moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    moved = true;
    isDragging = true;

    var x = e.clientX - dragOffsetX;
    var y = e.clientY - dragOffsetY;

    // Clamp to viewport
    x = Math.max(0, Math.min(x, window.innerWidth - toolbar.offsetWidth));
    y = Math.max(0, Math.min(y, window.innerHeight - toolbar.offsetHeight));

    toolbar.style.left = x + 'px';
    toolbar.style.top = y + 'px';
    toolbar.style.right = 'auto';
    toolbar.style.bottom = 'auto';
  }

  function onDragEnd() {
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    // Delay resetting isDragging so the click handler can check it
    setTimeout(function() { isDragging = false; }, 0);
  }

  // --- Sync state on load ---
  // Check if translation is already applied (e.g. from popup)
  var status = api.getStatus();
  if (status.isTranslated && status.activeLanguage) {
    isTranslated = true;
    langInput.value = status.activeLanguage;
    updateButton();
  }

  // Check settings, then inject
  StorageManager.getSettings().then(function(settings) {
    if (settings.enabled) {
      document.documentElement.appendChild(host);
    }
  });

})();
