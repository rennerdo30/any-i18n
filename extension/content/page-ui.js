/**
 * In-page UI that is not the toolbar: the "original text" tooltip on translated text, image
 * translation overlays and short notices. Everything lives in one closed shadow root, so host
 * page styles cannot reach it and the DOM scanner (which does not enter shadow roots) never
 * picks it up as page content.
 */
var PageUi = (function() {
  'use strict';

  var NOTICE_DURATION_MS = 6000;
  var TOOLTIP_OFFSET_PX = 8;
  var VIEWPORT_MARGIN_PX = 8;
  var MIN_OVERLAY_WIDTH_PX = 220;

  var host = null;
  var root = null;
  var tooltip = null;
  var notice = null;
  var noticeTimer = null;
  var hoverTimer = null;
  var hoverTarget = null;
  var showOriginalOnHover = true;
  var imageOverlays = new Map(); // srcUrl -> overlay element
  var progress = null;           // { el, bar, text, stop, timer }
  var PROGRESS_DONE_MS = 2600;

  var STYLE = [
    ':host { all: initial; }',
    '.layer {',
    '  --surface: #ffffff; --text: #1c1e26; --muted: #5f6370; --border: #dddee3;',
    '  --accent: #0e7c6b; --danger: #c33d3d; --tip-bg: #1c1e26; --tip-text: #f5f6f8;',
    '  --shadow: 0 8px 24px rgba(15, 23, 42, 0.18);',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;',
    '  font-size: 13px; line-height: 1.45; color: var(--text); direction: ltr; text-align: left;',
    '}',
    '@media (prefers-color-scheme: dark) {',
    '  .layer { --surface: #1d2027; --text: #eceef3; --muted: #a3a8b5; --border: #343843;',
    '    --accent: #3cc7ad; --danger: #f07a7a; --tip-bg: #0d0f13; --tip-text: #eceef3;',
    '    --shadow: 0 8px 24px rgba(0, 0, 0, 0.55); }',
    '}',
    '.tooltip { position: fixed; z-index: 2147483647; max-width: 360px; padding: 6px 10px;',
    '  border-radius: 6px; background: var(--tip-bg); color: var(--tip-text); font-size: 12px;',
    '  box-shadow: var(--shadow); pointer-events: none; overflow-wrap: break-word; white-space: pre-wrap; }',
    '.tooltip-label { display: block; margin-bottom: 2px; font-size: 10px; letter-spacing: 0.04em;',
    '  text-transform: uppercase; opacity: 0.7; }',
    '.notice, .overlay { box-sizing: border-box; padding: 10px 32px 10px 12px; border: 1px solid var(--border);',
    '  border-radius: 8px; background: var(--surface); color: var(--text); box-shadow: var(--shadow); }',
    '.notice { position: fixed; right: 16px; bottom: 76px; z-index: 2147483647; width: 300px; }',
    '.notice.error, .overlay.error { border-color: var(--danger); }',
    '.overlay { position: absolute; z-index: 2147483646; max-height: 260px; overflow: auto; white-space: pre-wrap; }',
    '.overlay.floating { position: fixed; right: 16px; top: 16px; width: 320px; }',
    '.overlay.loading .text { color: var(--muted); }',
    '.overlay .original { display: block; margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--border);',
    '  color: var(--muted); font-size: 12px; }',
    '.close { position: absolute; top: 4px; right: 4px; width: 24px; height: 24px; border: none; border-radius: 4px;',
    '  background: transparent; color: var(--muted); font-size: 16px; line-height: 1; cursor: pointer; }',
    '.close:hover, .close:focus-visible { background: var(--border); color: var(--text); }',
    '.progress { position: fixed; left: 50%; bottom: 20px; z-index: 2147483647; transform: translateX(-50%);',
    '  display: flex; align-items: center; gap: 10px; min-width: 260px; max-width: calc(100vw - 32px);',
    '  padding: 8px 8px 8px 14px; border: 1px solid var(--border); border-radius: 999px;',
    '  background: var(--surface); color: var(--text); box-shadow: var(--shadow); overflow: hidden; }',
    '.progress-text { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
    '  font-variant-numeric: tabular-nums; }',
    '.progress-bar { position: absolute; left: 0; bottom: 0; height: 3px; width: 0; background: var(--accent);',
    '  transition: width 200ms ease-out; }',
    '.progress.indeterminate .progress-bar { width: 30%; animation: slide 1.1s ease-in-out infinite; }',
    '@keyframes slide { from { left: -30%; } to { left: 100%; } }',
    '.progress.done .progress-bar { width: 100%; }',
    '.progress .spinner { width: 14px; height: 14px; flex: none; border: 2px solid var(--border);',
    '  border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }',
    '.progress.done .spinner { border-color: var(--accent); animation: none; background: var(--accent); }',
    '@keyframes spin { to { transform: rotate(360deg); } }',
    '.stop { flex: none; padding: 4px 12px; border: 1px solid var(--border); border-radius: 999px;',
    '  background: transparent; color: var(--text); font: inherit; font-weight: 600; cursor: pointer; }',
    '.stop:hover, .stop:focus-visible { border-color: var(--danger); color: var(--danger); }',
    '.progress.done .stop { display: none; }',
    '@media (prefers-reduced-motion: reduce) {',
    '  .progress .spinner, .progress.indeterminate .progress-bar { animation: none; }',
    '}',
    '@media (prefers-reduced-motion: no-preference) {',
    '  .notice, .overlay, .progress { animation: appear 160ms ease-out; }',
    '  @keyframes appear { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }',
    '}'
  ].join('\n');

  function ensureRoot() {
    if (root && host && host.isConnected) return root;
    host = document.createElement('div');
    host.id = 'anyi18n-page-ui';
    host.setAttribute('translate', 'no');
    host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;';
    root = host.attachShadow({ mode: 'closed' });
    var style = document.createElement('style');
    style.textContent = STYLE;
    var layer = document.createElement('div');
    layer.className = 'layer';
    root.appendChild(style);
    root.appendChild(layer);
    document.documentElement.appendChild(host);
    return root;
  }

  function layer() {
    return ensureRoot().querySelector('.layer');
  }

  function closeButton(onClose) {
    var button = document.createElement('button');
    button.className = 'close';
    button.type = 'button';
    button.textContent = '×';
    button.title = t('actionClose', undefined, 'Close');
    button.setAttribute('aria-label', button.title);
    button.addEventListener('click', onClose);
    return button;
  }

  // --- Notices ---

  function notify(message, isError) {
    hideNotice();
    notice = document.createElement('div');
    notice.className = 'notice' + (isError ? ' error' : '');
    notice.setAttribute('role', isError ? 'alert' : 'status');
    var text = document.createElement('div');
    text.textContent = message;
    notice.appendChild(text);
    notice.appendChild(closeButton(hideNotice));
    layer().appendChild(notice);
    noticeTimer = setTimeout(hideNotice, NOTICE_DURATION_MS);
  }

  function hideNotice() {
    clearTimeout(noticeTimer);
    if (notice) notice.remove();
    notice = null;
  }

  // --- Translation progress pill ---

  function languageLabel(language) {
    var ui = (typeof browser !== 'undefined' && browser.i18n) ? browser.i18n.getUILanguage() : 'en';
    return AnyI18nLanguages.name(language, ui);
  }

  /** Show (or update) the pill: "Translating to German · 12 / 40" with a Stop button. */
  function showProgress(language, done, total, onStop) {
    if (!progress) {
      var el = document.createElement('div');
      el.className = 'progress';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      var spinner = document.createElement('span');
      spinner.className = 'spinner';
      spinner.setAttribute('aria-hidden', 'true');
      var text = document.createElement('span');
      text.className = 'progress-text';
      var stop = document.createElement('button');
      stop.className = 'stop';
      stop.type = 'button';
      stop.textContent = t('actionStop', undefined, 'Stop');
      var bar = document.createElement('span');
      bar.className = 'progress-bar';
      el.appendChild(spinner);
      el.appendChild(text);
      el.appendChild(stop);
      el.appendChild(bar);
      layer().appendChild(el);
      progress = { el: el, text: text, bar: bar, stop: stop, timer: null };
    }
    clearTimeout(progress.timer);
    progress.el.classList.remove('done');
    progress.stop.onclick = onStop || null;
    progress.stop.hidden = !onStop;

    var name = languageLabel(language);
    if (total > 0) {
      progress.el.classList.remove('indeterminate');
      progress.text.textContent = t('progressTranslating', [name, String(Math.min(done, total)), String(total)],
        'Translating to ' + name + ' · ' + done + ' / ' + total);
      progress.bar.style.width = Math.round(Math.min(1, done / total) * 100) + '%';
    } else {
      progress.el.classList.add('indeterminate');
      progress.text.textContent = t('progressStarting', [name], 'Translating to ' + name + '…');
    }
  }

  /** Turn the pill into a short confirmation, then remove it. */
  function finishProgress(message) {
    if (!progress) return;
    progress.el.classList.remove('indeterminate');
    progress.el.classList.add('done');
    progress.text.textContent = message;
    clearTimeout(progress.timer);
    progress.timer = setTimeout(hideProgress, PROGRESS_DONE_MS);
  }

  function hideProgress() {
    if (!progress) return;
    clearTimeout(progress.timer);
    progress.el.remove();
    progress = null;
  }

  // --- Original-text tooltip ---

  function hideTooltip() {
    clearTimeout(hoverTimer);
    hoverTarget = null;
    if (tooltip) tooltip.remove();
    tooltip = null;
  }

  function showTooltip(element, originals) {
    if (tooltip) tooltip.remove();
    tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    var label = document.createElement('span');
    label.className = 'tooltip-label';
    label.textContent = t('labelOriginal', undefined, 'Original');
    tooltip.appendChild(label);
    tooltip.appendChild(document.createTextNode(originals.join('\n')));
    layer().appendChild(tooltip);

    // Below the text when it fits, otherwise above; clamped to the viewport horizontally.
    var rect = element.getBoundingClientRect();
    var box = tooltip.getBoundingClientRect();
    var fitsBelow = rect.bottom + TOOLTIP_OFFSET_PX + box.height + VIEWPORT_MARGIN_PX <= window.innerHeight;
    var top = fitsBelow
      ? rect.bottom + TOOLTIP_OFFSET_PX
      : Math.max(VIEWPORT_MARGIN_PX, rect.top - TOOLTIP_OFFSET_PX - box.height);
    var maxLeft = Math.max(VIEWPORT_MARGIN_PX, window.innerWidth - box.width - VIEWPORT_MARGIN_PX);
    tooltip.style.top = top + 'px';
    tooltip.style.left = Math.min(Math.max(VIEWPORT_MARGIN_PX, rect.left), maxLeft) + 'px';
  }

  function onMouseOver(event) {
    if (!showOriginalOnHover || !TextReplacer.isApplied()) return;
    var target = event.target && event.target.closest ? event.target.closest('[data-anyi18n]') : null;
    if (target === hoverTarget) return;
    hideTooltip();
    if (!target) return;

    hoverTarget = target;
    hoverTimer = setTimeout(function() {
      if (hoverTarget !== target) return;
      var originals = TextReplacer.originalsInside(target);
      if (originals.length > 0) showTooltip(target, originals);
    }, HOVER_DELAY_MS);
  }

  // --- Image overlays ---

  function findImage(srcUrl) {
    var images = document.images;
    for (var i = 0; i < images.length; i++) {
      if (images[i].currentSrc === srcUrl || images[i].src === srcUrl) return images[i];
    }
    return null;
  }

  function removeImageOverlay(srcUrl) {
    var existing = imageOverlays.get(srcUrl);
    if (existing) existing.remove();
    imageOverlays.delete(srcUrl);
  }

  function showImageOverlay(srcUrl, text, options) {
    options = options || {};
    removeImageOverlay(srcUrl);

    var overlay = document.createElement('div');
    overlay.className = 'overlay' + (options.error ? ' error' : '') + (options.loading ? ' loading' : '');
    overlay.setAttribute('role', options.error ? 'alert' : 'status');

    var body = document.createElement('div');
    body.className = 'text';
    body.textContent = text;
    overlay.appendChild(body);

    if (options.original) {
      var original = document.createElement('span');
      original.className = 'original';
      original.textContent = t('labelOriginal', undefined, 'Original') + ': ' + options.original;
      overlay.appendChild(original);
    }

    overlay.appendChild(closeButton(function() { removeImageOverlay(srcUrl); }));

    var image = findImage(srcUrl);
    if (image) {
      var rect = image.getBoundingClientRect();
      overlay.style.left = (rect.left + window.scrollX) + 'px';
      overlay.style.top = (rect.bottom + window.scrollY + 4) + 'px';
      overlay.style.width = Math.max(rect.width, MIN_OVERLAY_WIDTH_PX) + 'px';
    } else {
      // CSS background images and the like: show in a corner instead.
      overlay.classList.add('floating');
    }

    layer().appendChild(overlay);
    imageOverlays.set(srcUrl, overlay);
  }

  function showImageLoading(srcUrl) {
    showImageOverlay(srcUrl, t('statusImageTranslating', undefined, 'Reading and translating the image...'), { loading: true });
  }

  function showImageResult(result) {
    if (result.error) {
      showImageOverlay(result.srcUrl, t('statusImageFailed', [result.error], 'Image translation failed: ' + result.error), { error: true });
    } else if (result.noText) {
      showImageOverlay(result.srcUrl, t('statusImageNoText', undefined, 'No readable text found in this image.'));
    } else {
      showImageOverlay(result.srcUrl, result.translation, { original: result.extractedText });
    }
  }

  // --- Settings ---

  function applySettings(stored) {
    var settings = stored || {};
    showOriginalOnHover = settings.showOriginalOnHover !== false;
    document.documentElement.classList.toggle('anyi18n-highlight', settings.highlightTranslated === true);
    if (!showOriginalOnHover) hideTooltip();
  }

  browser.storage.local.get(PROVIDER_SETTINGS_KEY).then(function(stored) {
    applySettings(stored && stored[PROVIDER_SETTINGS_KEY]);
  }).catch(function() {});

  browser.storage.onChanged.addListener(function(changes, area) {
    if (area === 'local' && changes[PROVIDER_SETTINGS_KEY]) {
      applySettings(changes[PROVIDER_SETTINGS_KEY].newValue);
    }
  });

  document.addEventListener('mouseover', onMouseOver, { passive: true });
  window.addEventListener('scroll', hideTooltip, { passive: true, capture: true });

  return {
    notify: notify,
    showImageLoading: showImageLoading,
    showImageResult: showImageResult,
    showProgress: showProgress,
    finishProgress: finishProgress,
    hideProgress: hideProgress,
    languageLabel: languageLabel,
    hideTooltip: hideTooltip
  };
})();
