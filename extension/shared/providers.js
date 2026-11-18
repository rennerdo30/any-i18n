/**
 * Translation provider helpers shared by the service worker, the options page and the tests.
 *
 * Besides the any-i18n translation server, the extension can talk directly to any
 * OpenAI-compatible chat-completions endpoint (LM Studio, Ollama, OpenAI, DeepSeek,
 * OpenRouter, ...). Everything here is pure: no browser APIs, no network.
 */
var AnyI18nProviders = (function() {
  'use strict';

  /** Provider that forwards keys to the bundled FastAPI server (server/). */
  var SERVER_PROVIDER = 'server';

  /** Default endpoint, execution limits and API-key requirement per provider. */
  var PROVIDERS = {
    server:   { url: 'http://localhost:39418',     needsKey: false, local: true,  batchSize: 50, parallel: 1 },
    lmstudio: { url: 'http://localhost:1234',      needsKey: false, local: true,  batchSize: 10, parallel: 1 },
    ollama:   { url: 'http://localhost:11434',     needsKey: false, local: true,  batchSize: 10, parallel: 1 },
    openai:   { url: 'https://api.openai.com',     needsKey: true,  local: false, batchSize: 20, parallel: 4 },
    deepseek: { url: 'https://api.deepseek.com',   needsKey: true,  local: false, batchSize: 20, parallel: 4 }
  };

  /** Model used when the user has not chosen one. Empty means "whatever the server has loaded". */
  var DEFAULT_MODELS = {
    lmstudio: '',
    ollama: 'qwen3',
    openai: 'gpt-5-mini',
    deepseek: 'deepseek-v4-flash'
  };

  /** Suggestions shown in the model field before the provider's model list is fetched. */
  var RECOMMENDED_MODELS = {
    lmstudio: [],
    ollama: ['qwen3', 'llama3.3', 'gemma3'],
    openai: ['gpt-5-mini', 'gpt-5-nano', 'gpt-5.4-mini'],
    deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro']
  };

  var LIMITS = {
    batchSize: { min: 1, max: 50 },
    parallel: { min: 1, max: 10 }
  };

  /** Upper bound for the characters sent in one request, independent of the batch size. */
  var MAX_BATCH_CHARS = 6000;

  var OCR_MODE_BUILTIN = 'builtin';
  var OCR_MODE_VISION = 'vision';

  var DEFAULT_SETTINGS = {
    provider: 'lmstudio',
    urls: {},
    models: {},
    apiKeys: {},
    batchSize: {},
    parallel: {},
    ocrMode: OCR_MODE_BUILTIN,
    ocrLanguages: 'eng',
    visionUrl: 'http://localhost:11434',
    visionModel: 'qwen3-vl',
    visionApiKey: '',
    showOriginalOnHover: true,
    highlightTranslated: false,
    showToolbar: true
  };

  function isKnownProvider(provider) {
    return Object.prototype.hasOwnProperty.call(PROVIDERS, provider);
  }

  function clamp(value, limit, fallback) {
    var parsed = parseInt(value, 10);
    if (isNaN(parsed)) return fallback;
    return Math.min(limit.max, Math.max(limit.min, parsed));
  }

  function stripTrailingSlash(url) {
    var trimmed = String(url || '').trim();
    while (trimmed.endsWith('/')) trimmed = trimmed.slice(0, -1);
    return trimmed;
  }

  /**
   * Merge stored settings over the defaults and resolve the values for the active provider.
   */
  function resolve(stored) {
    var settings = Object.assign({}, DEFAULT_SETTINGS, stored || {});
    ['urls', 'models', 'apiKeys', 'batchSize', 'parallel'].forEach(function(name) {
      settings[name] = Object.assign({}, (stored && stored[name]) || {});
    });
    if (!isKnownProvider(settings.provider)) settings.provider = DEFAULT_SETTINGS.provider;

    var provider = settings.provider;
    var preset = PROVIDERS[provider];
    var model = settings.models[provider];
    return {
      settings: settings,
      provider: provider,
      baseUrl: stripTrailingSlash(settings.urls[provider] || preset.url),
      model: model !== undefined && model !== '' ? model : (DEFAULT_MODELS[provider] || ''),
      apiKey: settings.apiKeys[provider] || '',
      needsKey: preset.needsKey,
      batchSize: clamp(settings.batchSize[provider], LIMITS.batchSize, preset.batchSize),
      parallel: clamp(settings.parallel[provider], LIMITS.parallel, preset.parallel)
    };
  }

  /**
   * Build the chat-completions URL. Accepts a bare host, a base ending in /v1 (OpenRouter's
   * https://openrouter.ai/api/v1) or the full endpoint.
   */
  function chatEndpoint(baseUrl) {
    var url = stripTrailingSlash(baseUrl);
    if (url.endsWith('/chat/completions')) return url;
    if (/\/v1(\/|$)/.test(url)) return url + '/chat/completions';
    return url + '/v1/chat/completions';
  }

  /** Build the model-list URL for the same base URL forms as chatEndpoint. */
  function modelsEndpoint(baseUrl) {
    var url = stripTrailingSlash(baseUrl).replace(/\/chat\/completions$/, '');
    var v1 = url.lastIndexOf('/v1');
    if (v1 !== -1 && /\/v1(\/|$)/.test(url.slice(v1))) {
      return url.slice(0, v1 + 3) + '/models';
    }
    return url + '/v1/models';
  }

  function authHeaders(apiKey) {
    var headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
    return headers;
  }

  /**
   * Turn a language code ("de", "pt-BR") into an English language name for the prompt.
   * Free text ("German", "Klingon") is passed through unchanged.
   */
  function languageName(code) {
    var value = String(code || '').trim();
    if (!value) return value;
    try {
      var names = new Intl.DisplayNames(['en'], { type: 'language' });
      var name = names.of(value);
      if (name && name.toLowerCase() !== value.toLowerCase()) return name;
    } catch (e) {
      // Not a BCP 47 tag: treat it as a language name.
    }
    return value;
  }

  /** Split texts into batches limited by count and by total characters. */
  function makeBatches(texts, batchSize, maxChars) {
    var limit = maxChars || MAX_BATCH_CHARS;
    var batches = [];
    var current = [];
    var chars = 0;
    for (var i = 0; i < texts.length; i++) {
      var length = texts[i].length;
      if (current.length > 0 && (current.length >= batchSize || chars + length > limit)) {
        batches.push(current);
        current = [];
        chars = 0;
      }
      current.push(texts[i]);
      chars += length;
    }
    if (current.length > 0) batches.push(current);
    return batches;
  }

  function batchMessages(texts, language) {
    var name = languageName(language);
    return [
      {
        role: 'system',
        content: 'You are a professional translator for website text. Translate every string in the ' +
          'JSON array from the user into ' + name + '. Reply with only a JSON array of strings: the ' +
          'translations in the same order, exactly ' + texts.length + ' items, no explanations. Keep ' +
          'numbers, URLs, e-mail addresses, code, placeholders such as {name} or %s, and brand names ' +
          'unchanged. Return a string unchanged if it is already in ' + name + '.'
      },
      { role: 'user', content: JSON.stringify(texts) }
    ];
  }

  function singleMessages(text, language) {
    var name = languageName(language);
    return [
      {
        role: 'system',
        content: 'You are a professional translator for website text. Translate the user\'s text into ' +
          name + '. Reply with only the translation, no quotes and no explanations. Return the text ' +
          'unchanged if it is already in ' + name + '.'
      },
      { role: 'user', content: text }
    ];
  }

  /** Remove reasoning blocks and Markdown code fences that some models wrap around answers. */
  function cleanContent(content) {
    return String(content || '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/^\s*```[a-zA-Z]*\s*\n?/, '')
      .replace(/\n?\s*```\s*$/, '')
      .trim();
  }

  /**
   * Parse a batch reply. Returns an array of strings with the expected length, or null when the
   * reply does not line up with the request (the caller then retries or falls back).
   */
  function parseBatchReply(content, expectedCount) {
    var text = cleanContent(content);
    var start = text.indexOf('[');
    var end = text.lastIndexOf(']');
    if (start === -1 || end <= start) return null;

    var parsed;
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch (e) {
      return null;
    }
    if (!Array.isArray(parsed) || parsed.length !== expectedCount) return null;

    for (var i = 0; i < parsed.length; i++) {
      if (typeof parsed[i] !== 'string') {
        if (typeof parsed[i] === 'number') {
          parsed[i] = String(parsed[i]);
        } else {
          return null;
        }
      }
    }
    return parsed;
  }

  /**
   * Sampling options for a model. GPT-5 and o-series reasoning models reject any temperature
   * other than the default, also behind OpenRouter-style "openai/" prefixes.
   */
  function samplingOptions(model) {
    if (/(^|\/)(gpt-5|o\d)/i.test(String(model || ''))) return {};
    return { temperature: 0.2 };
  }

  /** Extract the assistant text from a chat-completions response body. */
  function replyContent(body) {
    var choice = body && body.choices && body.choices[0];
    var content = choice && choice.message && choice.message.content;
    if (typeof content !== 'string') {
      throw new Error('The provider returned no message content.');
    }
    return content;
  }

  /** Describe an HTTP error from a provider with a hint on the usual cause. */
  function describeHttpError(status, bodyText) {
    var detail = bodyText ? ' - ' + String(bodyText).substring(0, 200) : '';
    var hints = {
      401: 'Authentication failed (401). Check the API key.',
      403: 'Access denied (403). The API key may lack permission or billing may be disabled.',
      404: 'Endpoint not found (404). Check the provider URL.',
      405: 'Method not allowed (405). The provider URL is probably wrong.',
      429: 'Rate limit exceeded (429). Lower the parallel requests or wait a moment.'
    };
    if (hints[status]) return hints[status] + detail;
    if (status >= 500) return 'Server error (' + status + '). The provider may be unavailable.' + detail;
    return 'Provider error (' + status + ')' + detail;
  }

  /** Normalize a model-list response (OpenAI /v1/models or Ollama /api/tags) into ids. */
  function modelIds(body) {
    var list = (body && (body.data || body.models)) || [];
    var ids = [];
    for (var i = 0; i < list.length; i++) {
      var id = list[i] && (list[i].id || list[i].name);
      if (id && ids.indexOf(id) === -1) ids.push(id);
    }
    return ids.sort();
  }

  return {
    SERVER_PROVIDER: SERVER_PROVIDER,
    PROVIDERS: PROVIDERS,
    DEFAULT_MODELS: DEFAULT_MODELS,
    RECOMMENDED_MODELS: RECOMMENDED_MODELS,
    LIMITS: LIMITS,
    MAX_BATCH_CHARS: MAX_BATCH_CHARS,
    OCR_MODE_BUILTIN: OCR_MODE_BUILTIN,
    OCR_MODE_VISION: OCR_MODE_VISION,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    isKnownProvider: isKnownProvider,
    resolve: resolve,
    chatEndpoint: chatEndpoint,
    modelsEndpoint: modelsEndpoint,
    authHeaders: authHeaders,
    languageName: languageName,
    makeBatches: makeBatches,
    batchMessages: batchMessages,
    singleMessages: singleMessages,
    cleanContent: cleanContent,
    parseBatchReply: parseBatchReply,
    replyContent: replyContent,
    samplingOptions: samplingOptions,
    describeHttpError: describeHttpError,
    modelIds: modelIds
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AnyI18nProviders;
}
