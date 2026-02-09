#!/usr/bin/env node

import { Command } from 'commander';
import { translate } from '../src/commands/translate.js';
import { validate } from '../src/commands/validate.js';
import { bundle } from '../src/commands/bundle.js';

const program = new Command();

program
  .name('any-i18n')
  .description('CLI tool for any-i18n translation management')
  .version('1.0.0');

program
  .command('translate')
  .description('Translate keys to a target language using Claude')
  .requiredOption('--input <file>', 'Path to _keys.json file')
  .requiredOption('--language <lang>', 'Target language (e.g., de, fr, es)')
  .option('--output <file>', 'Output file path (defaults to <lang>.json)')
  .action(translate);

program
  .command('validate')
  .description('Validate a translation file')
  .requiredOption('--input <file>', 'Path to translation JSON file')
  .option('--keys <keysFile>', 'Path to _keys.json to compare against')
  .action(validate);

program
  .command('bundle')
  .description('Bundle translation files into the extension')
  .requiredOption('--input <dir>', 'Directory containing translation files')
  .requiredOption('--output <dir>', 'Output directory (e.g., extension/translations/)')
  .action(bundle);

program.parse();
