import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// The extension loads the file as a classic script; evaluate it the same way.
const source = readFileSync(new URL('../extension/shared/providers.js', import.meta.url), 'utf8');
const context = {};
vm.runInNewContext(source, context);
const Providers = context.AnyI18nProviders;

// Values from the vm context have foreign prototypes; compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));

test('chatEndpoint accepts bare hosts, /v1 bases and full endpoints', () => {
  assert.equal(Providers.chatEndpoint('http://localhost:1234'), 'http://localhost:1234/v1/chat/completions');
  assert.equal(Providers.chatEndpoint('http://localhost:1234/'), 'http://localhost:1234/v1/chat/completions');
  assert.equal(Providers.chatEndpoint('https://openrouter.ai/api/v1'), 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(
    Providers.chatEndpoint('https://api.example.com/v1/chat/completions'),
    'https://api.example.com/v1/chat/completions'
  );
});

test('modelsEndpoint mirrors chatEndpoint', () => {
  assert.equal(Providers.modelsEndpoint('http://localhost:11434'), 'http://localhost:11434/v1/models');
  assert.equal(Providers.modelsEndpoint('https://openrouter.ai/api/v1'), 'https://openrouter.ai/api/v1/models');
  assert.equal(
    Providers.modelsEndpoint('https://api.example.com/v1/chat/completions'),
    'https://api.example.com/v1/models'
  );
});

test('resolve fills provider defaults and clamps execution settings', () => {
  const local = Providers.resolve({ provider: 'ollama' });
  assert.equal(local.baseUrl, 'http://localhost:11434');
  assert.equal(local.model, 'qwen3');
  assert.equal(local.parallel, 1);
  assert.equal(local.needsKey, false);

  const cloud = Providers.resolve({
    provider: 'deepseek',
    apiKeys: { deepseek: 'k' },
    batchSize: { deepseek: 500 },
    parallel: { deepseek: 0 },
    urls: { deepseek: 'https://proxy.example.com/' }
  });
  assert.equal(cloud.baseUrl, 'https://proxy.example.com');
  assert.equal(cloud.model, 'deepseek-v4-flash');
  assert.equal(cloud.apiKey, 'k');
  assert.equal(cloud.batchSize, Providers.LIMITS.batchSize.max);
  assert.equal(cloud.parallel, Providers.LIMITS.parallel.min);

  assert.equal(Providers.resolve({ provider: 'nope' }).provider, Providers.DEFAULT_SETTINGS.provider);
  assert.equal(Providers.resolve(undefined).provider, 'lmstudio');
});

test('resolve does not share nested maps with the defaults', () => {
  const first = Providers.resolve({});
  first.settings.urls.lmstudio = 'http://changed';
  assert.equal(Providers.resolve({}).baseUrl, 'http://localhost:1234');
});

test('languageName turns codes into names and passes free text through', () => {
  assert.equal(Providers.languageName('de'), 'German');
  assert.equal(Providers.languageName('ja'), 'Japanese');
  assert.equal(Providers.languageName('pt-BR'), 'Brazilian Portuguese');
  assert.equal(Providers.languageName('German'), 'German');
  assert.equal(Providers.languageName('Klingon'), 'Klingon');
});

test('makeBatches limits by count and by characters', () => {
  assert.deepEqual(plain(Providers.makeBatches(['a', 'b', 'c'], 2)), [['a', 'b'], ['c']]);
  const long = 'x'.repeat(4000);
  assert.deepEqual(plain(Providers.makeBatches([long, long, 'y'], 10)), [[long], [long, 'y']]);
  assert.deepEqual(plain(Providers.makeBatches(['z'.repeat(9000)], 10)), [['z'.repeat(9000)]]);
  assert.deepEqual(plain(Providers.makeBatches([], 10)), []);
});

test('parseBatchReply accepts clean, fenced and reasoning-wrapped arrays', () => {
  assert.deepEqual(plain(Providers.parseBatchReply('["Hallo","Welt"]', 2)), ['Hallo', 'Welt']);
  assert.deepEqual(plain(Providers.parseBatchReply('```json\n["Hallo", "Welt"]\n```', 2)), ['Hallo', 'Welt']);
  assert.deepEqual(plain(Providers.parseBatchReply('<think>the user wants [German]</think>\n["Hallo","Welt"]', 2)),
    ['Hallo', 'Welt']
  );
  assert.deepEqual(plain(Providers.parseBatchReply('Here you go: ["Eins", 2]', 2)), ['Eins', '2']);
});

test('parseBatchReply rejects replies that do not line up', () => {
  assert.equal(Providers.parseBatchReply('["Hallo"]', 2), null);
  assert.equal(Providers.parseBatchReply('Hallo, Welt', 2), null);
  assert.equal(Providers.parseBatchReply('["Hallo", {"x": 1}]', 2), null);
  assert.equal(Providers.parseBatchReply('[broken', 1), null);
});

test('batchMessages names the language and carries the texts as JSON', () => {
  const messages = Providers.batchMessages(['Hello', 'A "quote"'], 'de');
  assert.match(messages[0].content, /into German/);
  assert.match(messages[0].content, /exactly 2 items/);
  assert.deepEqual(JSON.parse(messages[1].content), ['Hello', 'A "quote"']);
});

test('replyContent and modelIds read OpenAI and Ollama shapes', () => {
  assert.equal(Providers.replyContent({ choices: [{ message: { content: 'ok' } }] }), 'ok');
  assert.throws(() => Providers.replyContent({ choices: [] }));
  assert.deepEqual(plain(Providers.modelIds({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }] })), ['a', 'b']);
  assert.deepEqual(plain(Providers.modelIds({ models: [{ name: 'qwen3:8b' }] })), ['qwen3:8b']);
  assert.deepEqual(plain(Providers.modelIds(null)), []);
});

test('samplingOptions omits temperature for reasoning models', () => {
  assert.deepEqual(plain(Providers.samplingOptions('gpt-5-mini')), {});
  assert.deepEqual(plain(Providers.samplingOptions('openai/gpt-5.4-mini')), {});
  assert.deepEqual(plain(Providers.samplingOptions('o4-mini')), {});
  assert.deepEqual(plain(Providers.samplingOptions('deepseek-v4-flash')), { temperature: 0.2 });
  assert.deepEqual(plain(Providers.samplingOptions('qwen3')), { temperature: 0.2 });
  assert.deepEqual(plain(Providers.samplingOptions('')), { temperature: 0.2 });
});

test('describeHttpError explains common statuses', () => {
  assert.match(Providers.describeHttpError(401, ''), /API key/);
  assert.match(Providers.describeHttpError(503, 'down'), /Server error \(503\).*down/);
  assert.match(Providers.describeHttpError(418, ''), /Provider error \(418\)/);
});
