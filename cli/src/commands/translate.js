import { readFileSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve } from 'path';

export function translate(options) {
  const inputPath = resolve(options.input);
  const language = options.language;
  const outputPath = options.output
    ? resolve(options.output)
    : resolve(language + '.json');

  // Read and validate input
  let keysData;
  try {
    keysData = JSON.parse(readFileSync(inputPath, 'utf-8'));
  } catch (err) {
    console.error('Error reading input file:', err.message);
    process.exit(1);
  }

  if (!keysData._meta || !keysData.keys) {
    console.error('Invalid _keys.json format: must contain _meta and keys fields.');
    process.exit(1);
  }

  const keys = keysData.keys;
  const keyCount = Object.keys(keys).length;

  if (keyCount === 0) {
    console.error('No keys found in input file.');
    process.exit(1);
  }

  console.log('Translating ' + keyCount + ' keys to ' + language + '...');

  // Build prompt for Claude
  const keysJson = JSON.stringify(keys, null, 2);
  const prompt = 'Translate the following key-value pairs to ' + language + '. '
    + 'Return ONLY valid JSON with the same keys but translated values. '
    + 'Preserve any HTML tags or placeholders. '
    + 'Do not include any explanation, just the JSON object.\n\n'
    + keysJson;

  // Call the backend CLI.
  //
  // The prompt embeds text scraped from arbitrary web pages, so it must never
  // be interpolated into a shell command string. JSON.stringify escapes for
  // JSON, not for a shell: `$(...)`, backticks and backslashes all survive
  // inside double quotes, which would let page content execute commands here.
  // execFileSync passes argv directly to the binary with no shell involved.
  let result;
  try {
    result = execFileSync('claude', ['-p', prompt], {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120000
    });
  } catch (err) {
    console.error('Claude CLI failed:', err.message);
    console.error('Make sure Claude CLI is installed and configured.');
    process.exit(1);
  }

  // Parse response - extract JSON from response
  let translations;
  try {
    // Try to extract JSON from response (Claude may add markdown fences)
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON object found in response');
    }
    translations = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('Failed to parse Claude response as JSON:', err.message);
    console.error('Raw response:', result);
    process.exit(1);
  }

  // Build output
  const output = {
    _meta: {
      domain: keysData._meta.domain || 'unknown',
      language: language,
      translatedAt: new Date().toISOString(),
      sourceVersion: keysData._meta.version || keysData._meta.exportedAt || 'unknown'
    },
    translations: translations
  };

  writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log('Translation written to ' + outputPath);
  console.log('Translated ' + Object.keys(translations).length + '/' + keyCount + ' keys.');
}
