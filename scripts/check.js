// Static checks for the extension: every script parses, every manifest path exists, every
// localized message key used in the code is defined in both locales.
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ext = join(root, 'extension');
const problems = [];

function walk(dir) {
  return readdirSync(dir).flatMap(function(name) {
    const path = join(dir, name);
    if (name === 'vendor') return [];
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(ext);
const scripts = files.filter(function(f) { return f.endsWith('.js'); });

for (const file of scripts) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    problems.push('Syntax error in ' + file + ':\n' + error.stderr);
  }
}

const manifest = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
const referenced = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  manifest.options_ui.page,
  ...Object.values(manifest.icons),
  ...manifest.content_scripts.flatMap(function(cs) { return [...(cs.js || []), ...(cs.css || [])]; })
];
for (const path of referenced) {
  if (!existsSync(join(ext, path))) problems.push('Manifest references a missing file: ' + path);
}

const locales = ['en', 'de'].map(function(locale) {
  return { locale: locale, messages: JSON.parse(readFileSync(join(ext, '_locales', locale, 'messages.json'), 'utf8')) };
});
const used = new Set();
const sources = files.filter(function(f) { return /\.(js|html|json)$/.test(f) && !f.includes('_locales'); });
for (const file of sources) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/\bt\('([A-Za-z0-9_]+)'/g)) used.add(match[1]);
  for (const match of text.matchAll(/data-i18n(?:-[a-z-]+)?="([A-Za-z0-9_]+)"/g)) used.add(match[1]);
  for (const match of text.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) used.add(match[1]);
}
for (const key of used) {
  for (const { locale, messages } of locales) {
    if (!messages[key]) problems.push('Message "' + key + '" is missing in _locales/' + locale);
  }
}
const [en, de] = locales.map(function(l) { return Object.keys(l.messages); });
for (const key of en) if (!de.includes(key)) problems.push('Message "' + key + '" is missing in _locales/de');
for (const key of de) if (!en.includes(key)) problems.push('Message "' + key + '" is missing in _locales/en');

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('Checked ' + scripts.length + ' scripts, ' + referenced.length + ' manifest paths, ' + used.size + ' message keys.');
