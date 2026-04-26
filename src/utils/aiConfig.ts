// AI Provider Configuration & Unified Call Layer

export type AiProvider = 'gemini' | 'openai' | 'claude' | 'deepseek' | 'qwen' | 'moonshot' | 'zhipu';

export interface AiProviderConfig {
  id: AiProvider;
  name: string;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  apiKeyPlaceholder: string;
}

export const AI_PROVIDERS: AiProviderConfig[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: '/api-proxy/gemini',
    defaultModel: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-1.5-pro', 'gemini-2.5-flash-preview-05-20', 'gemini-2.5-pro-preview-05-06'],
    apiKeyPlaceholder: 'AIza...',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: '/api-proxy/openai',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-3.5-turbo'],
    apiKeyPlaceholder: 'sk-...',
  },
  {
    id: 'claude',
    name: 'Anthropic Claude',
    baseUrl: '/api-proxy/claude',
    defaultModel: 'claude-3-5-haiku-20241022',
    models: ['claude-3-5-haiku-20241022', 'claude-3-5-sonnet-20241022', 'claude-3-7-sonnet-20250219', 'claude-opus-4-5'],
    apiKeyPlaceholder: 'sk-ant-...',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: '/api-proxy/deepseek',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    apiKeyPlaceholder: 'sk-...',
  },
  {
    id: 'qwen',
    name: '\u901a\u4e49\u5343\u95ee (Qwen)',
    baseUrl: '/api-proxy/qwen/compatible-mode',
    defaultModel: 'qwen-turbo',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen2.5-72b-instruct'],
    apiKeyPlaceholder: 'sk-...',
  },
  {
    id: 'moonshot',
    name: 'Moonshot (Kimi)',
    baseUrl: '/api-proxy/moonshot',
    defaultModel: 'moonshot-v1-8k',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    apiKeyPlaceholder: 'sk-...',
  },
  {
    id: 'zhipu',
    name: '\u667a\u8c31 AI (GLM)',
    baseUrl: '/api-proxy/zhipu',
    defaultModel: 'glm-4-flash',
    models: ['glm-4-flash', 'glm-4-air', 'glm-4', 'glm-4-plus'],
    apiKeyPlaceholder: '\u8bf7\u8f93\u5165\u667a\u8c31 API Key',
  },
];

export interface AiSettings {
  provider: AiProvider;
  apiKey: string;
  model: string;
}

const AI_SETTINGS_KEY = 'amzdev_ai_settings';

export function loadAiSettings(): AiSettings | null {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_KEY);
    if (raw) return JSON.parse(raw) as AiSettings;
    // \u56de\u9000\u5230 .env.local \u9ed8\u8ba4\u914d\u7f6e\uff0c\u65e0\u9700\u624b\u52a8\u8f93\u5165
    const defaultKey = import.meta.env.VITE_DEFAULT_AI_KEY as string | undefined;
    const defaultProvider = (import.meta.env.VITE_DEFAULT_AI_PROVIDER ?? 'gemini') as AiProvider;
    const defaultModel = (import.meta.env.VITE_DEFAULT_AI_MODEL ?? 'gemini-2.5-flash-preview-05-20') as string;
    if (defaultKey) return { provider: defaultProvider, apiKey: defaultKey, model: defaultModel };
    return null;
  } catch {
    return null;
  }
}

export function saveAiSettings(settings: AiSettings): void {
  localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings));
}

export function getProviderConfig(provider: AiProvider): AiProviderConfig {
  return AI_PROVIDERS.find(p => p.id === provider) ?? AI_PROVIDERS[0];
}

// \u2500\u2500\u2500 Unified AI Text Generation \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

export interface GenerateOptions {
  systemPrompt?: string;
  jsonMode?: boolean;
  signal?: AbortSignal;
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shortenErrorMessage(msg: string, maxLen = 240): string {
  const clean = String(msg || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length > maxLen ? `${clean.slice(0, maxLen)}...` : clean;
}

function shouldRetry(status: number, message: string, attempt: number, maxAttempts: number): boolean {
  if (attempt >= maxAttempts) return false;
  const hint = String(message || '');
  return RETRYABLE_STATUSES.has(status) || /ROUTER_EXTERNAL_TARGET_ERROR/i.test(hint);
}

function normalizeAiError(providerName: string, status: number, rawMessage: string): string {
  const detail = shortenErrorMessage(rawMessage);
  if (status === 401 || status === 403) {
    return `${providerName} 鉴权失败（${status}），请检查 API Key 是否正确或是否有权限。${detail ? ` 原始信息：${detail}` : ''}`;
  }
  if (status === 429) {
    return `${providerName} 请求过于频繁（429），请稍等 30-60 秒后重试，或切换到其他模型。${detail ? ` 原始信息：${detail}` : ''}`;
  }
  if (status === 502 || /ROUTER_EXTERNAL_TARGET_ERROR/i.test(detail)) {
    return `${providerName} 服务暂时不可用（网关 502）。通常是上游服务波动，请稍后重试或切换模型/供应商。${detail ? ` 原始信息：${detail}` : ''}`;
  }
  if (status >= 500) {
    return `${providerName} 服务暂时异常（${status}），建议稍后重试。${detail ? ` 原始信息：${detail}` : ''}`;
  }
  return `${providerName} API Error ${status}: ${detail || '请求失败'}`;
}

/**
 * Auto-select a sensible default model for each provider.
 */
function resolveModel(settings: AiSettings): string {
  if (settings.model && settings.model.trim()) return settings.model.trim();
  return getProviderConfig(settings.provider).defaultModel;
}

export async function generateText(
  prompt: string,
  settings: AiSettings,
  options: GenerateOptions = {}
): Promise<string> {
  const { systemPrompt, jsonMode } = options;
  const resolved = { ...settings, model: resolveModel(settings) };
  if (resolved.provider === 'gemini') {
    return callGemini(prompt, resolved, { systemPrompt, jsonMode });
  }
  return callOpenAICompat(prompt, resolved, { systemPrompt, jsonMode });
}

// \u2500\u2500\u2500 Gemini (direct from browser, works with browser proxy extensions) \u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function callGemini(
  prompt: string,
  settings: AiSettings,
  opts: { systemPrompt?: string; jsonMode?: boolean }
): Promise<string> {
  const fullPrompt = opts.systemPrompt ? `${opts.systemPrompt}\n\n${prompt}` : prompt;
  const url = `/api-proxy/gemini/v1beta/models/${settings.model}:generateContent?key=${settings.apiKey}`;

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
  };
  if (opts.jsonMode) {
    body.generationConfig = { responseMimeType: 'application/json' };
  }

  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    }

    const text = await res.text();
    let errMsg = text;
    try {
      const errJson = JSON.parse(text);
      errMsg = errJson?.error?.message || errJson?.error?.status || text;
    } catch {}

    if (shouldRetry(res.status, errMsg, attempt, maxAttempts)) {
      await sleep(1200 * attempt);
      continue;
    }
    throw new Error(normalizeAiError('Gemini', res.status, errMsg));
  }

  throw new Error('Gemini 请求失败，请稍后重试。');
}

// \u2500\u2500\u2500 OpenAI-Compatible (OpenAI / DeepSeek / Qwen / Moonshot / Zhipu) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function callOpenAICompat(
  prompt: string,
  settings: AiSettings,
  opts: { systemPrompt?: string; jsonMode?: boolean }
): Promise<string> {
  const cfg = getProviderConfig(settings.provider);
  const endpoint = settings.provider === 'zhipu'
    ? `${cfg.baseUrl}/api/paas/v4/chat/completions`
    : `${cfg.baseUrl}/v1/chat/completions`;

  const messages: { role: string; content: string }[] = [];
  if (opts.systemPrompt) {
    messages.push({ role: 'system', content: opts.systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const body: Record<string, unknown> = {
    model: settings.model,
    messages,
  };
  if (opts.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${settings.apiKey}`,
  };

  if (settings.provider === 'claude') {
    headers['x-api-key'] = settings.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    delete headers['Authorization'];
  }

  const providerName = cfg.name || 'AI';
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? '';
    }

    const text = await res.text();
    let errMsg = text;
    try {
      const errJson = JSON.parse(text);
      errMsg = errJson?.error?.message || errJson?.message || text;
    } catch {}

    if (shouldRetry(res.status, errMsg, attempt, maxAttempts)) {
      await sleep(1200 * attempt);
      continue;
    }
    throw new Error(normalizeAiError(providerName, res.status, errMsg));
  }

  throw new Error(`${providerName} 请求失败，请稍后重试。`);
}

// \u2500\u2500\u2500 Streaming (OpenAI-compatible only, for chatbot) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
export async function* streamText(
  prompt: string,
  settings: AiSettings,
  systemPrompt?: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  if (settings.provider === 'gemini') {
    const text = await generateText(prompt, settings, { systemPrompt });
    yield text;
    return;
  }

  const cfg = getProviderConfig(settings.provider);
  const endpoint = settings.provider === 'zhipu'
    ? `${cfg.baseUrl}/api/paas/v4/chat/completions`
    : `${cfg.baseUrl}/v1/chat/completions`;

  const messages: { role: string; content: string }[] = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${settings.apiKey}`,
  };
  if (settings.provider === 'claude') {
    headers['x-api-key'] = settings.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    delete headers['Authorization'];
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: settings.model, messages, stream: true }),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(`AI API Error ${res.status}: ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // ignore malformed SSE lines
      }
    }
  }
}
