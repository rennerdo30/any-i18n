// Browser API compatibility shim (Chrome uses 'chrome', Firefox uses 'browser')
if (typeof browser === 'undefined') var browser = chrome;

// Storage keys used throughout the extension
var STORAGE_KEYS = {
  translations: 'translations',
  settings: 'settings',
  activeLanguage: 'activeLanguage',
  domainKeys: 'domainKeys',
  autoTranslate: 'autoTranslate'
};

// Default extension settings
var DEFAULT_SETTINGS = {
  enabled: true,
  autoScan: true,
  highlightTranslated: false
};

// HTML tags whose descendants should be skipped during DOM scanning
var SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG', 'META', 'LINK', 'HEAD', 'TITLE'
]);

// Minimum text length to consider for translation
var MIN_TEXT_LENGTH = 2;

// Input types whose value attribute contains translatable UI text
var TRANSLATABLE_INPUT_TYPES = new Set(['submit', 'button', 'reset']);

// Translation server URL
var TRANSLATION_SERVER_URL = 'http://localhost:39418';

// Whether the in-page floating toolbar is enabled
var TOOLBAR_ENABLED = true;

// Message types for communication between content scripts, popup, and background
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
