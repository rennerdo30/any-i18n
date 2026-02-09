import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, copyFileSync } from 'fs';
import { resolve, join, basename } from 'path';

export function bundle(options) {
  const inputDir = resolve(options.input);
  const outputDir = resolve(options.output);

  if (!existsSync(inputDir)) {
    console.error('Input directory does not exist: ' + inputDir);
    process.exit(1);
  }

  // Create output directory if needed
  mkdirSync(outputDir, { recursive: true });

  // Find all JSON files in input directory
  const files = readdirSync(inputDir).filter(function(f) {
    return f.endsWith('.json');
  });

  if (files.length === 0) {
    console.error('No JSON files found in ' + inputDir);
    process.exit(1);
  }

  const bundled = [];

  for (const file of files) {
    const srcPath = join(inputDir, file);
    const destPath = join(outputDir, file);

    try {
      // Validate that it's valid JSON
      const data = JSON.parse(readFileSync(srcPath, 'utf-8'));

      copyFileSync(srcPath, destPath);

      const lang = data._meta && data._meta.language ? data._meta.language : basename(file, '.json');
      const domain = data._meta && data._meta.domain ? data._meta.domain : 'unknown';

      bundled.push({ file: file, language: lang, domain: domain });
      console.log('Bundled: ' + file + ' (' + lang + ')');
    } catch (err) {
      console.error('Skipping ' + file + ': ' + err.message);
    }
  }

  // Generate a manifest of bundled translations
  if (bundled.length > 0) {
    const manifest = {
      generatedAt: new Date().toISOString(),
      translations: bundled.map(function(b) {
        return {
          file: b.file,
          language: b.language,
          domain: b.domain
        };
      })
    };

    writeFileSync(
      join(outputDir, '_manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8'
    );

    console.log('\nBundled ' + bundled.length + ' translation file(s) to ' + outputDir);
    console.log('Generated _manifest.json');
  }
}
