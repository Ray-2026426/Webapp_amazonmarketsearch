import assert from 'node:assert/strict';
import {
  buildEndpoint,
  isValidCustomApiUrl,
  sanitizeAiApiUrls,
  sanitizeAiSettings,
  type AiSettings,
} from '../src/utils/aiConfig.ts';

assert.equal(isValidCustomApiUrl('ljh15874760218@gmail.com'), false);
assert.equal(isValidCustomApiUrl('/api-proxy/deepseek'), true);
assert.equal(isValidCustomApiUrl('https://api.deepseek.com/v1'), true);

const settings: AiSettings = {
  provider: 'deepseek',
  apiKey: 'sk-test',
  model: 'deepseek-chat',
  apiUrls: {
    deepseek: 'ljh15874760218@gmail.com',
    openai: 'https://openrouter.example/v1',
  },
};

assert.deepEqual(sanitizeAiApiUrls(settings.apiUrls), {
  openai: 'https://openrouter.example/v1',
});

const cleaned = sanitizeAiSettings(settings);
assert.equal(cleaned.apiUrls?.deepseek, undefined);
assert.equal(buildEndpoint(cleaned, 'deepseek'), '/api-proxy/deepseek/v1/chat/completions');

console.log('aiConfig tests passed');
