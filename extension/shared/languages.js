/**
 * Language list and naming for the language pickers (popup, toolbar, settings).
 * Names come from Intl.DisplayNames, so they follow the browser's UI language, plus each
 * language's own name ("German · Deutsch").
 */
var AnyI18nLanguages = (function() {
  'use strict';

  /** Languages offered in the pickers; any other BCP 47 code can still be typed. */
  var CODES = [
    'ar', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fa', 'fi', 'fil', 'fr',
    'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'ms', 'nb', 'nl', 'pl', 'pt',
    'pt-BR', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'sw', 'th', 'tr', 'uk', 'ur', 'vi', 'zh-Hans',
    'zh-Hant'
  ];

  var displayCache = {};

  function displayNames(locale) {
    if (!displayCache[locale]) {
      try {
        displayCache[locale] = new Intl.DisplayNames([locale], { type: 'language' });
      } catch (e) {
        displayCache[locale] = new Intl.DisplayNames(['en'], { type: 'language' });
      }
    }
    return displayCache[locale];
  }

  function nameIn(code, locale) {
    try {
      return displayNames(locale).of(code) || code;
    } catch (e) {
      return code;
    }
  }

  function capitalize(text) {
    return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text;
  }

  /** "German" in the UI language. Unknown values (free text) are returned unchanged. */
  function name(code, uiLocale) {
    return capitalize(nameIn(code, uiLocale || 'en'));
  }

  /** The language's own name, e.g. "Deutsch". */
  function nativeName(code) {
    return capitalize(nameIn(code, code));
  }

  /** "German · Deutsch", or just "German" when both are the same. */
  function label(code, uiLocale) {
    var local = name(code, uiLocale);
    var own = nativeName(code);
    return own && own !== local ? local + ' · ' + own : local;
  }

  /** Picker entries sorted by their name in the UI language. */
  function list(uiLocale) {
    return CODES.map(function(code) {
      return { code: code, label: label(code, uiLocale), name: name(code, uiLocale) };
    }).sort(function(a, b) {
      return a.name.localeCompare(b.name, uiLocale || 'en');
    });
  }

  /**
   * Turn user input ("de", "German", "Deutsch", "deutsch") into a code from the list, or return
   * the trimmed input when it matches nothing (any code or name the model understands works).
   */
  function resolve(input, uiLocale) {
    var value = String(input || '').trim();
    if (!value) return '';
    var lower = value.toLowerCase();
    for (var i = 0; i < CODES.length; i++) {
      var code = CODES[i];
      if (code.toLowerCase() === lower ||
          name(code, uiLocale).toLowerCase() === lower ||
          name(code, 'en').toLowerCase() === lower ||
          nativeName(code).toLowerCase() === lower) {
        return code;
      }
    }
    return value;
  }

  /** The browser language reduced to a picker code where possible ("de-AT" -> "de"). */
  function browserDefault(navigatorLanguage) {
    var value = String(navigatorLanguage || 'en');
    if (CODES.indexOf(value) !== -1) return value;
    var base = value.split('-')[0];
    return CODES.indexOf(base) !== -1 ? base : 'en';
  }

  return {
    CODES: CODES,
    name: name,
    nativeName: nativeName,
    label: label,
    list: list,
    resolve: resolve,
    browserDefault: browserDefault
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AnyI18nLanguages;
}
