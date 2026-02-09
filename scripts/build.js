import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');
const extensionDir = join(rootDir, 'extension');
const distDir = join(rootDir, 'dist');

const browsers = ['chrome', 'firefox', 'edge'];

// Parse --browser flag
const browserArg = process.argv.find(function(arg, i) {
  return process.argv[i - 1] === '--browser';
});
const targetBrowsers = browserArg ? [browserArg] : browsers;

// Validate target browsers
for (const b of targetBrowsers) {
  if (!browsers.includes(b)) {
    console.error('Unknown browser: ' + b + '. Supported: ' + browsers.join(', '));
    process.exit(1);
  }
}

// Clean dist directory
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true });
}

console.log('Building any-i18n extension...\n');

for (const browser of targetBrowsers) {
  const outDir = join(distDir, browser);

  // Copy extension directory
  cpSync(extensionDir, outDir, { recursive: true });

  // Patch manifest per browser
  const manifestPath = join(outDir, 'manifest.json');

  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

    if (browser === 'firefox') {
      manifest.browser_specific_settings = {
        gecko: {
          id: 'any-i18n@extension',
          strict_min_version: '109.0'
        }
      };
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    }
  }

  console.log('Built: dist/' + browser + '/');
}

console.log('\nBuild complete.');
