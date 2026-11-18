import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../extension/shared/languages.js', import.meta.url), 'utf8');
const context = {};
vm.runInNewContext(source, context);
const Languages = context.AnyI18nLanguages;

test('resolve accepts codes, English names, UI-language names and native names', () => {
  assert.equal(Languages.resolve('de', 'en'), 'de');
  assert.equal(Languages.resolve('German', 'en'), 'de');
  assert.equal(Languages.resolve('deutsch', 'en'), 'de');
  assert.equal(Languages.resolve('Japanisch', 'de'), 'ja');
  assert.equal(Languages.resolve('  PT-br ', 'en'), 'pt-BR');
  assert.equal(Languages.resolve('Klingon', 'en'), 'Klingon');
  assert.equal(Languages.resolve('', 'en'), '');
});

test('labels combine the UI name with the native name', () => {
  assert.equal(Languages.label('de', 'en'), 'German · Deutsch');
  assert.equal(Languages.label('en', 'en'), 'English');
  assert.equal(Languages.name('ja', 'de'), 'Japanisch');
});

test('list is sorted by name in the UI language and covers every code', () => {
  const list = Languages.list('en');
  assert.equal(list.length, Languages.CODES.length);
  const names = list.map((entry) => entry.name);
  assert.deepEqual([...names], [...names].sort((a, b) => a.localeCompare(b, 'en')));
});

test('browserDefault maps regional variants to picker codes', () => {
  assert.equal(Languages.browserDefault('de-AT'), 'de');
  assert.equal(Languages.browserDefault('pt-BR'), 'pt-BR');
  assert.equal(Languages.browserDefault('xx-YY'), 'en');
  assert.equal(Languages.browserDefault(undefined), 'en');
});
