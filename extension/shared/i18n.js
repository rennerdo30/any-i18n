/**
 * UI localization for extension pages (popup, options). Content scripts use t() from
 * shared/constants.js instead.
 *
 * Markup: data-i18n (text), data-i18n-placeholder, data-i18n-title, data-i18n-aria-label.
 */
if (typeof browser === 'undefined') var browser = chrome;

function t(key, substitutions, fallback) {
  var message = browser.i18n.getMessage(key, substitutions);
  return message || fallback || key;
}

function localizePage(root) {
  var scope = root || document;
  var bindings = [
    ['data-i18n', function(el, text) { el.textContent = text; }],
    ['data-i18n-placeholder', function(el, text) { el.placeholder = text; }],
    ['data-i18n-title', function(el, text) { el.title = text; }],
    ['data-i18n-aria-label', function(el, text) { el.setAttribute('aria-label', text); }]
  ];
  bindings.forEach(function(binding) {
    var nodes = scope.querySelectorAll('[' + binding[0] + ']');
    for (var i = 0; i < nodes.length; i++) {
      var text = t(nodes[i].getAttribute(binding[0]), undefined, '');
      if (text) binding[1](nodes[i], text);
    }
  });
  document.documentElement.lang = browser.i18n.getUILanguage().split('-')[0] || 'en';
}
