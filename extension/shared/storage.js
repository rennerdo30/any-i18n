/**
 * Storage abstraction over browser.storage.local.
 * Provides typed accessors for translations, settings, and domain keys.
 */
var StorageManager = {

  /**
   * Get a value from storage by key.
   * Returns the value or undefined if not found.
   */
  get: function(key) {
    return browser.storage.local.get(key).then(function(result) {
      return result[key];
    });
  },

  /**
   * Set a value in storage.
   */
  set: function(key, value) {
    var data = {};
    data[key] = value;
    return browser.storage.local.set(data);
  },

  /**
   * Get translations for a specific domain and language.
   * Translations are stored as: { translations: { "domain.com": { "en": {...}, "de": {...} } } }
   */
  getTranslations: function(domain, language) {
    return this.get(STORAGE_KEYS.translations).then(function(allTranslations) {
      if (!allTranslations || !allTranslations[domain] || !allTranslations[domain][language]) {
        return {};
      }
      return allTranslations[domain][language];
    });
  },

  /**
   * Store translations for a specific domain and language.
   */
  setTranslations: function(domain, language, translations) {
    return this.get(STORAGE_KEYS.translations).then(function(allTranslations) {
      allTranslations = allTranslations || {};
      if (!allTranslations[domain]) {
        allTranslations[domain] = {};
      }
      allTranslations[domain][language] = translations;
      return StorageManager.set(STORAGE_KEYS.translations, allTranslations);
    });
  },

  /**
   * Get extension settings, falling back to DEFAULT_SETTINGS.
   */
  getSettings: function() {
    return this.get(STORAGE_KEYS.settings).then(function(settings) {
      return settings || Object.assign({}, DEFAULT_SETTINGS);
    });
  },

  /**
   * Save extension settings.
   */
  setSettings: function(settings) {
    return this.set(STORAGE_KEYS.settings, settings);
  },

  /**
   * Get generated keys for a domain.
   * Keys are stored as: { domainKeys: { "domain.com": { key: "original text", ... } } }
   */
  getDomainKeys: function(domain) {
    return this.get(STORAGE_KEYS.domainKeys).then(function(allKeys) {
      if (!allKeys || !allKeys[domain]) {
        return {};
      }
      return allKeys[domain];
    });
  },

  /**
   * Store generated keys for a domain.
   */
  setDomainKeys: function(domain, keys) {
    return this.get(STORAGE_KEYS.domainKeys).then(function(allKeys) {
      allKeys = allKeys || {};
      allKeys[domain] = keys;
      return StorageManager.set(STORAGE_KEYS.domainKeys, allKeys);
    });
  },

  /**
   * Get auto-translate config for a domain.
   * Returns { language, enabled } or null if not configured.
   */
  getAutoTranslate: function(domain) {
    return this.get(STORAGE_KEYS.autoTranslate).then(function(all) {
      if (!all || !all[domain]) return null;
      return all[domain];
    });
  },

  /**
   * Set auto-translate config for a domain.
   * Pass config = null to remove the entry.
   */
  setAutoTranslate: function(domain, config) {
    return this.get(STORAGE_KEYS.autoTranslate).then(function(all) {
      all = all || {};
      if (config === null) {
        delete all[domain];
      } else {
        all[domain] = config;
      }
      return StorageManager.set(STORAGE_KEYS.autoTranslate, all);
    });
  },

  /**
   * Get all auto-translate configs.
   */
  getAllAutoTranslate: function() {
    return this.get(STORAGE_KEYS.autoTranslate).then(function(all) {
      return all || {};
    });
  }
};
