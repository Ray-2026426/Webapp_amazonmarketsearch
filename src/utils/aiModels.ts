/**
 * 「获取模型」：用你填的 Key 去问供应商"这个 Key 能用哪些模型"，然后让你选。
 *
 * 为什么单独一层纯逻辑：模型列表接口跟聊天接口**不是同一套规矩**，各家都不一样——
 *   - OpenAI / DeepSeek / Qwen / Moonshot / 豆包 / 自定义中转：`GET {base}/v1/models`，`Authorization: Bearer`
 *   - 智谱：`GET {base}/api/paas/v4/models`（路径不同）
 *   - Claude：`GET {base}/v1/models`，但要 `x-api-key` + `anthropic-version` 头
 *   - Gemini：`GET {base}/v1beta/models?key=...`（Key 在 query 里，不是头）
 * 而且**浏览器直连同样会被 CORS 拦**，所以这里只负责"算出席请求长什么样"，
 * 真正的收发由 `aiConfig.fetchAvailableModels` 按既有通道判定决定（同源直连 / 服务端转发）。
 *
 * 返回体形状也各家不同，所以解析收敛到 `parseModelsResponse` 一处，前端与服务端共用同一份。
 */

import { decideAiTransport, isSameOriginUrl, type AiTransport } from './aiEndpoints';
import type { AiProvider } from './aiConfig';

/** 鉴权方式：决定 Key 放在哪（头 / x-api-key / query） */
export type AiModelsAuthStyle = 'bearer' | 'x-api-key' | 'query';

export interface AiModelsRequestPlan {
  /** 要 GET 的地址（同源路径或绝对地址） */
  url: string;
  authStyle: AiModelsAuthStyle;
  /** 除鉴权外的固定头（如 Claude 的 anthropic-version） */
  extraHeaders: Record<string, string>;
  transport: AiTransport;
  /** 给用户看的说明（例如"Key 会经本站服务端转发"） */
  note: string;
}

/** 各供应商的模型列表路径（相对 base；Gemini 特殊，Key 在 query） */
const MODELS_PATH: Record<AiProvider, string> = {
  openai: '/v1/models',
  deepseek: '/v1/models',
  qwen: '/v1/models',
  moonshot: '/v1/models',
  doubao: '/api/v3/models',
  zhipu: '/api/paas/v4/models',
  claude: '/v1/models',
  gemini: '/v1beta/models',
  custom: '/v1/models',
};

/** 各供应商的鉴权方式 */
const AUTH_STYLE: Record<AiProvider, AiModelsAuthStyle> = {
  openai: 'bearer',
  deepseek: 'bearer',
  qwen: 'bearer',
  moonshot: 'bearer',
  doubao: 'bearer',
  zhipu: 'bearer',
  claude: 'x-api-key',
  gemini: 'query',
  custom: 'bearer',
};

/** 内置供应商的同源代理前缀（与 vercel.json / vite.config.ts 一致） */
const PROXY_BASE: Record<AiProvider, string> = {
  openai: '/api-proxy/openai',
  deepseek: '/api-proxy/deepseek',
  qwen: '/api-proxy/qwen/compatible-mode',
  moonshot: '/api-proxy/moonshot',
  doubao: '/api-proxy/doubao',
  zhipu: '/api-proxy/zhipu',
  claude: '/api-proxy/claude',
  gemini: '/api-proxy/gemini',
  custom: '',
};

/** 去掉末尾斜杠 */
function trimSlash(url: string): string {
  return String(url ?? '').trim().replace(/\/+$/, '');
}

/**
 * 算出"取模型列表"这次请求长什么样。
 * @param customBaseUrl 用户在设置里填的自定义地址（可空；空=走本站默认转发）
 */
export function planModelsRequest(input: { provider: AiProvider; customBaseUrl?: string | null }): AiModelsRequestPlan {
  const { provider } = input;
  const custom = trimSlash(input.customBaseUrl ?? '');
  const authStyle = AUTH_STYLE[provider];
  const extraHeaders =
    provider === 'claude'
      ? { 'anthropic-version': '2023-06-01' }
      : {};

  // 用户填了自定义地址 → 用他的地址（绝对地址由服务端转发）
  if (custom) {
    const transport = decideAiTransport({ customUrl: custom }).transport;
    // 自定义地址通常已经带了 /v1 之类的版本段：只在没有版本段时补
    const base = /\/v\d+([a-z]+)?$/i.test(custom) ? custom : custom;
    return {
      url: `${base}${MODELS_PATH[provider]}`,
      authStyle,
      extraHeaders,
      transport,
      note:
        transport === 'relay'
          ? '你的 Key 会经本站服务端转发去取模型列表（不保存、不记录）'
          : '浏览器直接请求你的自定义地址',
    };
  }

  const proxyBase = PROXY_BASE[provider];
  if (!proxyBase) {
    // 自定义供应商却没有填地址：没有可用的默认地址
    return {
      url: '',
      authStyle,
      extraHeaders,
      transport: 'proxy',
      note: '请先填写「API 请求地址」，再点获取模型',
    };
  }

  return {
    url: `${proxyBase}${MODELS_PATH[provider]}`,
    authStyle,
    extraHeaders,
    transport: 'proxy',
    note: isSameOriginUrl(proxyBase) ? '经本站同源转发去取模型列表（不受浏览器跨域限制）' : '',
  };
}

/** 把 Key 按该供应商的方式放进 headers（query 方式的 Key 由调用方拼进 URL） */
export function modelsAuthHeaders(plan: AiModelsRequestPlan, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { ...plan.extraHeaders };
  if (!apiKey) return headers;
  if (plan.authStyle === 'bearer') headers.Authorization = `Bearer ${apiKey}`;
  if (plan.authStyle === 'x-api-key') headers['x-api-key'] = apiKey;
  return headers;
}

/** query 方式（Gemini）：把 Key 拼进 URL */
export function modelsUrlWithKey(plan: AiModelsRequestPlan, apiKey: string): string {
  if (plan.authStyle !== 'query' || !apiKey) return plan.url;
  const sep = plan.url.includes('?') ? '&' : '?';
  return `${plan.url}${sep}key=${encodeURIComponent(apiKey)}`;
}

export interface AiModelsResult {
  ok: boolean;
  models: string[];
  error: string;
}

/** Gemini 的模型名带 `models/` 前缀，界面里要去掉；`models/` 之外的前缀原样保留 */
function normalizeModelId(raw: string): string {
  const id = String(raw ?? '').trim();
  if (!id) return '';
  return id.replace(/^models\//i, '');
}

/**
 * 解析模型列表返回（纯函数，前端与服务端共用）。
 * 兼容四种常见形状：
 *   1. OpenAI 兼容：`{ data: [{ id }] }`
 *   2. Gemini：`{ models: [{ name: 'models/gemini-2.0-flash' }] }`
 *   3. 直接数组：`[{ id }]` / `['a','b']`
 *   4. 中转站常见包装：`{ data: { models: [...] } }` / `{ models: ['a','b'] }`
 * 拿不到模型时给出**能照着改**的中文提示，而不是空列表。
 */
export function parseModelsResponse(status: number, text: string): AiModelsResult {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) {
    return { ok: false, models: [], error: `取模型列表失败：上游返回空内容（HTTP ${status}）` };
  }
  if (/^<!doctype/i.test(trimmed) || /^<html/i.test(trimmed)) {
    return {
      ok: false,
      models: [],
      error: '取模型列表拿到的是网页而不是接口数据：地址可能填成了网站首页，请填完整的 API 地址（通常以 /v1 结尾）',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, models: [], error: `取模型列表失败：返回的不是 JSON（HTTP ${status}）` };
  }

  const collect = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const item of value) {
      if (typeof item === 'string') out.push(normalizeModelId(item));
      else if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        const id = obj.id ?? obj.name ?? obj.model ?? obj.model_name;
        if (typeof id === 'string') out.push(normalizeModelId(id));
      }
    }
    return out.filter(Boolean);
  };

  const root = parsed as Record<string, unknown>;
  let models: string[] = [];

  if (Array.isArray(root)) models = collect(root);
  else if (root && typeof root === 'object') {
    if (Array.isArray(root.data)) models = collect(root.data);
    else if (Array.isArray(root.models)) models = collect(root.models);
    else if (root.data && typeof root.data === 'object') {
      const nested = root.data as Record<string, unknown>;
      models = collect(nested.models ?? nested.data);
    }
  }

  models = Array.from(new Set(models));
  if (models.length === 0) {
    const message =
      status >= 400
        ? `上游返回 ${status}：${trimmed.slice(0, 200)}`
        : '上游没有返回可识别的模型列表（可能该中转站不提供 /models 接口，可手动填写模型名）';
    return { ok: false, models: [], error: message };
  }

  return { ok: true, models: models.sort((a, b) => a.localeCompare(b)), error: '' };
}
