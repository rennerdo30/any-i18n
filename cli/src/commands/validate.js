import { readFileSync } from 'fs';
import { resolve } from 'path';

export function validate(options) {
  const inputPath = resolve(options.input);

  // Read translation file
  let data;
  try {
    data = JSON.parse(readFileSync(inputPath, 'utf-8'));
  } catch (err) {
    console.error('Error reading input file:', err.message);
    process.exit(1);
  }

  let hasErrors = false;

  // Check _meta fields
  if (!data._meta) {
    console.error('[ERROR] Missing _meta object.');
    hasErrors = true;
  } else {
    const requiredMeta = ['domain', 'language', 'translatedAt'];
    for (const field of requiredMeta) {
      if (!data._meta[field]) {
        console.error('[ERROR] Missing _meta.' + field);
        hasErrors = true;
      }
    }
  }

  // Check translations object
  if (!data.translations) {
    console.error('[ERROR] Missing translations object.');
    hasErrors = true;
  } else {
    const translationKeys = Object.keys(data.translations);
    console.log('Found ' + translationKeys.length + ' translation(s).');

    // Check for empty translations
    const empty = translationKeys.filter(function(key) {
      return !data.translations[key] || data.translations[key].trim() === '';
    });
    if (empty.length > 0) {
      console.error('[WARN] ' + empty.length + ' empty translation(s): ' + empty.join(', '));
      hasErrors = true;
    }
  }

  // Compare against keys file if provided
  if (options.keys) {
    let keysData;
    try {
      keysData = JSON.parse(readFileSync(resolve(options.keys), 'utf-8'));
    } catch (err) {
      console.error('Error reading keys file:', err.message);
      process.exit(1);
    }

    if (!keysData.keys) {
      console.error('[ERROR] Keys file missing "keys" object.');
      process.exit(1);
    }

    const expectedKeys = new Set(Object.keys(keysData.keys));
    const actualKeys = new Set(Object.keys(data.translations || {}));

    const missing = [...expectedKeys].filter(function(k) { return !actualKeys.has(k); });
    const extra = [...actualKeys].filter(function(k) { return !expectedKeys.has(k); });

    if (missing.length > 0) {
      console.error('[ERROR] ' + missing.length + ' missing key(s): ' + missing.join(', '));
      hasErrors = true;
    }

    if (extra.length > 0) {
      console.warn('[WARN] ' + extra.length + ' extra key(s): ' + extra.join(', '));
    }
  }

  if (hasErrors) {
    console.error('\nValidation failed.');
    process.exit(1);
  } else {
    console.log('\nValidation passed.');
  }
}
