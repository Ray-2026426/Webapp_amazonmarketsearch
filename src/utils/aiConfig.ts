import { buildUserBackgroundSystemPrompt } from './userBackground';
import { getCurrentUser, isAdminSession } from './auth';

// AI Provider Configuration & Unified Call Layer

export type AiProvider = 'gemini' | 'openai' | 'claude' | 'deepseek' | 'qwen' | 'moonshot' | 'zhipu' | 'doubao';

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
  {
    id: 'doubao',
    name: '\u8c46\u5305 / \u706b\u5c71\u65b9\u821f',
    baseUrl: '/api-proxy/doubao/api/v3',
    defaultModel: 'doubao-seed-1-6-flash-250615',
    models: ['doubao-seed-1-6-flash-250615', 'doubao-seed-1-6-thinking-250715', 'doubao-1-5-pro-32k-250115', 'doubao-1-5-lite-32k-250115'],
    apiKeyPlaceholder: 'Volcengine Ark API Key',
  },
];

export interface AiSettings {
  provider: AiProvider;
  apiKey: string;
  model: string;
  /** 自定义 API URL（按供应商存储） */
  apiUrls?: Partial<Record<AiProvider, string>>;
  /** 自定义模型名列表（按供应商存储） */
  customModels?: Partial<Record<AiProvider, string[]>>;
}

/** 获取某个供应商生效的 API URL（优先使用自定义 URL，否则返回默认 URL） */
export function getEffectiveApiUrl(settings: AiSettings, provider: AiProvider): string {
  return settings.apiUrls?.[provider]?.trim() || getProviderConfig(provider).baseUrl;
}

/** 获取某个供应商的完整模型列表（默认模型 + 自定义模型） */
export function getEffectiveModels(settings: AiSettings, provider: AiProvider): string[] {
  const cfg = getProviderConfig(provider);
  const customs = settings.customModels?.[provider] || [];
  return [...cfg.models, ...customs];
}

const AI_SETTINGS_KEY = 'amzdev_ai_settings';

function getAiSettingsKey(): string {
  const user = getCurrentUser();
  return user?.id ? `${AI_SETTINGS_KEY}__${user.id}` : AI_SETTINGS_KEY;
}

function canUseDefaultAiKey(): boolean {
  return isAdminSession(getCurrentUser());
}

export function loadAiSettings(): AiSettings | null {
  try {
    const storageKey = getAiSettingsKey();
    const raw = localStorage.getItem(storageKey);
    if (raw) return JSON.parse(raw) as AiSettings;
    const legacyRaw = canUseDefaultAiKey() ? localStorage.getItem(AI_SETTINGS_KEY) : null;
    if (legacyRaw) {
      localStorage.setItem(storageKey, legacyRaw);
      return JSON.parse(legacyRaw) as AiSettings;
    }
    // \u56de\u9000\u5230 .env.local \u9ed8\u8ba4\u914d\u7f6e\uff0c\u65e0\u9700\u624b\u52a8\u8f93\u5165
    const defaultKey = canUseDefaultAiKey() ? (import.meta.env.VITE_DEFAULT_AI_KEY as string | undefined) : '';
    const defaultProvider = (import.meta.env.VITE_DEFAULT_AI_PROVIDER ?? 'deepseek') as AiProvider;
    const defaultModel = (import.meta.env.VITE_DEFAULT_AI_MODEL ?? 'deepseek-chat') as string;
    // 无密钥时也返回 DeepSeek 默认项，方便你在「AI 设置」里直接填 Key
    return {
      provider: defaultProvider,
      apiKey: defaultKey?.trim() || '',
      model: defaultModel,
    };
  } catch {
    return null;
  }
}

export function saveAiSettings(settings: AiSettings): void {
  localStorage.setItem(getAiSettingsKey(), JSON.stringify(settings));
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

export interface ImageInput {
  base64: string;
  mimeType: string;
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
  const allModels = getEffectiveModels(settings, settings.provider);
  return allModels[0] || getProviderConfig(settings.provider).defaultModel;
}

function mergeSystemPrompt(systemPrompt?: string): string | undefined {
  const userCtx = buildUserBackgroundSystemPrompt();
  const parts = [userCtx, systemPrompt?.trim()].filter(Boolean) as string[];
  if (parts.length === 0) return undefined;
  return parts.join('\n\n');
}

export async function generateText(
  prompt: string,
  settings: AiSettings,
  options: GenerateOptions = {}
): Promise<string> {
  const { jsonMode } = options;
  const systemPrompt = mergeSystemPrompt(options.systemPrompt);
  const resolved = { ...settings, model: resolveModel(settings) };
  if (resolved.provider === 'gemini') {
    return callGemini(prompt, resolved, { systemPrompt, jsonMode });
  }
  return callOpenAICompat(prompt, resolved, { systemPrompt, jsonMode });
}

/**
 * 多模态 AI 调用：发送文本 + 图片（base64）给 AI 进行视觉分析。
 * 支持 Gemini / OpenAI / Claude 及所有 OpenAI 兼容接口。
 */
export async function generateWithImages(
  prompt: string,
  images: ImageInput[],
  settings: AiSettings,
  options: GenerateOptions = {}
): Promise<string> {
  const { jsonMode } = options;
  const systemPrompt = mergeSystemPrompt(options.systemPrompt);
  const resolved = { ...settings, model: resolveModel(settings) };
  if (resolved.provider === 'gemini') {
    return callGeminiWithImages(prompt, images, resolved, { systemPrompt, jsonMode });
  }
  return callOpenAICompatWithImages(prompt, images, resolved, { systemPrompt, jsonMode });
}

// \u2500\u2500\u2500 Gemini (direct from browser, works with browser proxy extensions) \u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function callGemini(
  prompt: string,
  settings: AiSettings,
  opts: { systemPrompt?: string; jsonMode?: boolean }
): Promise<string> {
  const fullPrompt = opts.systemPrompt ? `${opts.systemPrompt}\n\n${prompt}` : prompt;
  const customUrl = settings.apiUrls?.[settings.provider]?.trim();
  let url: string;
  if (customUrl) {
    url = customUrl;
    if (!/[?&]key=/.test(url)) {
      url += `${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(settings.apiKey)}`;
    }
  } else {
    const baseUrl = getProviderConfig('gemini').baseUrl.replace(/\/+$/, '');
    url = `${baseUrl}/v1beta/models/${settings.model}:generateContent?key=${settings.apiKey}`;
  }

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

// ─── Gemini with Images (multimodal) ───────────────────────────────────────────
async function callGeminiWithImages(
  prompt: string,
  images: ImageInput[],
  settings: AiSettings,
  opts: { systemPrompt?: string; jsonMode?: boolean }
): Promise<string> {
  const fullPrompt = opts.systemPrompt ? `${opts.systemPrompt}\n\n${prompt}` : prompt;
  const customUrl = settings.apiUrls?.[settings.provider]?.trim();
  let url: string;
  if (customUrl) {
    url = customUrl;
    if (!/[?&]key=/.test(url)) {
      url += `${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(settings.apiKey)}`;
    }
  } else {
    const baseUrl = getProviderConfig('gemini').baseUrl.replace(/\/+$/, '');
    url = `${baseUrl}/v1beta/models/${settings.model}:generateContent?key=${settings.apiKey}`;
  }

  const parts: Record<string, unknown>[] = [{ text: fullPrompt }];
  for (const img of images) {
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
  }

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts }],
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

  throw new Error('Gemini 视觉分析请求失败，请稍后重试。');
}

/** 是否填写了自定义 API URL */
export function hasCustomApiUrl(settings: AiSettings, provider: AiProvider): boolean {
  return Boolean(settings.apiUrls?.[provider]?.trim());
}

/** 将用户填写的中转 API 地址补全为可请求的完整 endpoint（不会重复添加 /v1） */
export function resolveCustomApiUrl(url: string, provider: AiProvider): string {
  const cleaned = url.trim().replace(/\/+$/, '');
  if (!cleaned) return cleaned;

  if (provider === 'gemini') {
    if (/\/models\/.*:generateContent$/i.test(cleaned) || /\/generateContent$/i.test(cleaned)) {
      return cleaned;
    }
    return cleaned;
  }

  if (/\/chat\/completions$/i.test(cleaned)) return cleaned;

  if (provider === 'zhipu') {
    if (/\/api\/paas\/v4\/chat\/completions$/i.test(cleaned)) return cleaned;
    if (/\/api\/paas\/v4$/i.test(cleaned)) return `${cleaned}/chat/completions`;
    try {
      const path = new URL(cleaned).pathname.replace(/\/+$/, '') || '/';
      if (path === '/' || path === '') return `${cleaned}/api/paas/v4/chat/completions`;
    } catch {}
    return cleaned;
  }

  if (provider === 'doubao') {
    if (/\/api\/v3\/chat\/completions$/i.test(cleaned)) return cleaned;
    if (/\/api\/v3$/i.test(cleaned)) return `${cleaned}/chat/completions`;
    try {
      const path = new URL(cleaned).pathname.replace(/\/+$/, '') || '/';
      if (path === '/' || path === '') return `${cleaned}/api/v3/chat/completions`;
    } catch {}
    return cleaned;
  }

  // 中转 API 常见：.../v1 → 只补 /chat/completions
  if (/\/v1$/i.test(cleaned)) return `${cleaned}/chat/completions`;

  // 只有域名：.../v1/chat/completions
  try {
    const path = new URL(cleaned).pathname.replace(/\/+$/, '') || '/';
    if (path === '/' || path === '') return `${cleaned}/v1/chat/completions`;
  } catch {}

  return cleaned;
}

/** 判断是否为网站首页（只有域名，没有 API 路径） */
export function isBareDomainUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const path = new URL(trimmed).pathname.replace(/\/+$/, '') || '/';
    return path === '/' || path === '';
  } catch {
    return true;
  }
}

/** @deprecated 使用 resolveCustomApiUrl */
export function isIncompleteApiUrl(url: string): boolean {
  return isBareDomainUrl(url);
}

/** 根据基础地址补全为标准 API 路径 */
export function suggestFullApiUrl(baseUrl: string, provider: AiProvider = 'openai'): string {
  return resolveCustomApiUrl(baseUrl, provider);
}

function parseOpenAICompatResponse(text: string, endpoint: string): string {
  const trimmed = text.trim();
  if (/^<!doctype/i.test(trimmed) || /^<html/i.test(trimmed)) {
    throw new Error(
      `请求地址返回了网页而不是 API 数据。您可能只填了网站域名，请填写完整 API 地址，例如：${suggestFullApiUrl(endpoint)}`
    );
  }
  try {
    const data = JSON.parse(text);
    return data.choices?.[0]?.message?.content ?? '';
  } catch {
    throw new Error(`API 返回了无法识别的格式，请确认请求地址是否正确。当前地址：${endpoint}`);
  }
}

/** 构建 API endpoint */
export function buildEndpoint(settings: AiSettings, provider: AiProvider): string {
  const customUrl = settings.apiUrls?.[provider]?.trim();
  if (customUrl) {
    return resolveCustomApiUrl(customUrl, provider);
  }

  const baseUrl = getProviderConfig(provider).baseUrl.replace(/\/+$/, '');
  if (provider === 'zhipu') {
    return `${baseUrl}/api/paas/v4/chat/completions`;
  }
  if (provider === 'doubao') {
    return `${baseUrl}/chat/completions`;
  }
  return `${baseUrl}/v1/chat/completions`;
}

/** 构建请求头：中转 API（自定义 URL）统一用 Bearer；Claude 官方接口用 x-api-key */
function buildRequestHeaders(settings: AiSettings): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${settings.apiKey}`,
  };

  if (settings.provider === 'claude' && !hasCustomApiUrl(settings, settings.provider)) {
    headers['x-api-key'] = settings.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    delete headers['Authorization'];
  }

  return headers;
}

// \u2500\u2500\u2500 OpenAI-Compatible (OpenAI / DeepSeek / Qwen / Moonshot / Zhipu) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function callOpenAICompat(
  prompt: string,
  settings: AiSettings,
  opts: { systemPrompt?: string; jsonMode?: boolean }
): Promise<string> {
  const cfg = getProviderConfig(settings.provider);
  const endpoint = buildEndpoint(settings, settings.provider);

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

  const headers = buildRequestHeaders(settings);

  const providerName = cfg.name || 'AI';
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const text = await res.text();
      return parseOpenAICompatResponse(text, endpoint);
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

// ─── OpenAI-Compatible with Images (multimodal vision) ────────────────────────
async function callOpenAICompatWithImages(
  prompt: string,
  images: ImageInput[],
  settings: AiSettings,
  opts: { systemPrompt?: string; jsonMode?: boolean }
): Promise<string> {
  const cfg = getProviderConfig(settings.provider);
  const endpoint = buildEndpoint(settings, settings.provider);

  const userContent: Record<string, unknown>[] = [{ type: 'text', text: prompt }];
  for (const img of images) {
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
    });
  }

  const messages: Record<string, unknown>[] = [];
  if (opts.systemPrompt) {
    messages.push({ role: 'system', content: opts.systemPrompt });
  }
  messages.push({ role: 'user', content: userContent });

  const body: Record<string, unknown> = {
    model: settings.model,
    messages,
  };
  if (opts.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const headers = buildRequestHeaders(settings);
  const providerName = cfg.name || 'AI';
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const text = await res.text();
      return parseOpenAICompatResponse(text, endpoint);
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

  throw new Error(`${providerName} 视觉分析请求失败，请稍后重试。`);
}

// ─── Streaming (OpenAI-compatible only, for chatbot) ──────────────────────────
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

  const mergedSystem = mergeSystemPrompt(systemPrompt);
  const cfg = getProviderConfig(settings.provider);
  const endpoint = buildEndpoint(settings, settings.provider);

  const messages: { role: string; content: string }[] = [];
  if (mergedSystem) messages.push({ role: 'system', content: mergedSystem });
  messages.push({ role: 'user', content: prompt });

  const headers = buildRequestHeaders(settings);

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
