import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken, json } from '../auth/_shared.js';
import { redactText } from '../../src/utils/keyMasking';
import { validateRelayTarget } from '../../src/utils/aiEndpoints';
import { parseModelsResponse } from '../../src/utils/aiModels';

/**
 * AI 请求的服务端转发（`/api/ai/chat`）。
 *
 * 为什么需要它：用户在设置里填的第三方中转地址是**绝对地址**，浏览器直连会被 CORS 拦死
 * （这正是内置供应商都走 `/api-proxy/*` 同源代理的原因）。所以"自定义地址"必须由服务端代为请求。
 *
 * 三条硬规则：
 * 1. **必须登录**：这个接口能让服务器去请求任意地址，绝不能对游客开放；
 * 2. **目标必须过校验**（`validateRelayTarget`，与前端共用同一份实现）：只允许 http/https，
 *    拒绝内网/环回/链路本地/云元数据地址与 URL 里的账号密码；
 * 3. **不保存、不记录、不回显 Key**：本接口是无状态转发，不落库、不写缓存、不进用量记账、
 *    不打印请求体；任何错误信息都先过 `redactSecrets` 再返回。
 *
 * 已知边界（写在这里而不是藏着）：`validateRelayTarget` 只做**字面量**校验，不做 DNS 解析后的
 * 二次复核，因此理论上存在"域名解析到内网 IP"的绕过。当前是内部团队自用 + 需登录，
 * 风险可接受；对外多租户前必须在解析后复核（见 PRD §15.15 遗留项）。
 */

/** 请求体上限：AI 对话正常远小于此，超过直接拒绝（防内存与上游放大） */
const MAX_REQUEST_BYTES = 1024 * 1024; // 1 MB
/** 上游响应上限 */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024; // 4 MB
/** 上游超时 */
const UPSTREAM_TIMEOUT_MS = 120_000;

interface ChatBody {
  token?: string;
  /** 目标地址（绝对 http(s) URL；同源地址不需要走这里） */
  url?: string;
  /** 上游接口形态：目前只支持 OpenAI 兼容 */
  shape?: string;
  model?: string;
  messages?: unknown;
  temperature?: number;
  maxTokens?: number;
  /** 用户自己的 Key；本接口只用它做一次转发，不保存 */
  apiKey?: string;
}

function fail(res: VercelResponse, status: number, error: string) {
  return json(res, status, { ok: false, error: redactText(error) });
}

export interface RelayUpstreamResult {
  ok: boolean;
  content: string;
  error: string;
}

/**
 * 解析上游返回（纯函数，可单测）。
 * 用户最常见的错误是"把网站首页当成 API 地址"，或者中转站的返回不是 OpenAI 兼容格式；
 * 这两种都要给出**能照着改**的中文提示，而不是抛一个 JSON 解析错误。
 */
export function parseRelayUpstream(status: number, text: string): RelayUpstreamResult {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return { ok: false, content: '', error: `上游返回空内容（HTTP ${status}）` };
  if (/^<!doctype/i.test(trimmed) || /^<html/i.test(trimmed)) {
    return {
      ok: false,
      content: '',
      error: '上游返回的是网页而不是 API 数据：请求地址可能填成了网站首页，请填完整的 API 地址（通常以 /v1 结尾）',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, content: '', error: `上游返回的不是 JSON（HTTP ${status}）：${trimmed.slice(0, 200)}` };
  }

  if (status >= 400) {
    const obj = parsed as { error?: { message?: string }; message?: string };
    const detail = obj?.error?.message || obj?.message || trimmed.slice(0, 200);
    return { ok: false, content: '', error: `上游返回 ${status}：${detail}` };
  }

  const content = (parsed as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    return {
      ok: false,
      content: '',
      error: '上游返回格式不符合 OpenAI 兼容约定（缺少 choices[0].message.content）：请确认中转站提供的是 OpenAI 兼容接口',
    };
  }
  return { ok: true, content, error: '' };
}

async function chat(req: VercelRequest, res: VercelResponse, body: ChatBody) {
  const token = String(body.token || req.headers['x-auth-token'] || '');
  const auth = await verifyToken(token);
  if (!auth) return fail(res, 401, '未登录或登录已过期：自定义请求地址需要登录后才能由服务端转发');

  const shape = String(body.shape || 'openai').toLowerCase();
  if (shape !== 'openai') {
    return fail(res, 400, `暂不支持该接口形态：${shape}（当前只转发 OpenAI 兼容的 /chat/completions）`);
  }

  const check = validateRelayTarget(String(body.url || ''));
  if (!check.ok) {
    const reason = check.reason;
    return fail(res, 400, `请求地址被拒绝：${reason}`);
  }
  const targetUrl = check.url;

  const apiKey = String(body.apiKey || '').trim();
  if (!apiKey) return fail(res, 400, '缺少 API Key');

  const model = String(body.model || '').trim();
  if (!model) return fail(res, 400, '缺少模型名');

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) return fail(res, 400, '缺少对话内容（messages）');

  const payload = {
    model,
    messages,
    ...(typeof body.temperature === 'number' ? { temperature: body.temperature } : {}),
    ...(typeof body.maxTokens === 'number' ? { max_tokens: body.maxTokens } : {}),
  };
  const serialized = JSON.stringify(payload);
  if (serialized.length > MAX_REQUEST_BYTES) {
    return fail(res, 413, `请求体过大（${serialized.length} 字节 > ${MAX_REQUEST_BYTES}）`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: serialized,
      signal: controller.signal,
    });

    const text = await upstream.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      return fail(res, 502, `上游返回内容过大（${text.length} 字节）`);
    }

    const parsedUpstream = parseRelayUpstream(upstream.status, text);
    if (!parsedUpstream.ok) {
      return fail(res, upstream.status >= 400 ? upstream.status : 502, parsedUpstream.error);
    }

    // 只回内容，不回上游原文，避免任何形式的 Key/内部信息外带
    return json(res, 200, { ok: true, content: parsedUpstream.content, model });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/abort/i.test(msg)) return fail(res, 504, `上游超时（${UPSTREAM_TIMEOUT_MS}ms）`);
    return fail(res, 502, `转发失败：${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 取模型列表（`POST /api/ai/models`）。
 * 与聊天转发同一套底线：必须登录、目标过 `validateRelayTarget`、Key 不保存不记录、错误脱敏。
 * 只做 GET，且只回"模型名数组"，不回上游原文。
 */
async function models(req: VercelRequest, res: VercelResponse, body: ChatBody & { authStyle?: string; extraHeaders?: Record<string, string> }) {
  const token = String(body.token || req.headers['x-auth-token'] || '');
  const auth = await verifyToken(token);
  if (!auth) return fail(res, 401, '未登录或登录已过期：自定义请求地址需要登录后才能由服务端转发');

  const check = validateRelayTarget(String(body.url || ''));
  if (!check.ok) {
    const reason = check.reason;
    return fail(res, 400, `请求地址被拒绝：${reason}`);
  }

  const apiKey = String(body.apiKey || '').trim();
  if (!apiKey) return fail(res, 400, '缺少 API Key');

  const authStyle = String(body.authStyle || 'bearer');
  const extraHeaders = (body.extraHeaders ?? {}) as Record<string, string>;
  const headers: Record<string, string> = { ...extraHeaders };
  let target = check.url;
  if (authStyle === 'bearer') headers.Authorization = `Bearer ${apiKey}`;
  else if (authStyle === 'x-api-key') headers['x-api-key'] = apiKey;
  else if (authStyle === 'query') {
    target = `${target}${target.includes('?') ? '&' : '?'}key=${encodeURIComponent(apiKey)}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const upstream = await fetch(target, { method: 'GET', headers, signal: controller.signal });
    const text = await upstream.text();
    if (text.length > MAX_RESPONSE_BYTES) return fail(res, 502, `上游返回内容过大（${text.length} 字节）`);

    const parsed = parseModelsResponse(upstream.status, text);
    if (!parsed.ok) {
      // parseModelsResponse 的提示里可能带上游原文 → 统一脱敏
      return fail(res, upstream.status >= 400 ? upstream.status : 502, parsed.error);
    }
    return json(res, 200, { ok: true, models: parsed.models });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/abort/i.test(msg)) return fail(res, 504, '取模型列表超时（30s）');
    return fail(res, 502, `取模型列表失败：${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

const handlers: Record<string, (req: VercelRequest, res: VercelResponse, body: ChatBody) => Promise<void>> = {
  chat,
  models: models as (req: VercelRequest, res: VercelResponse, body: ChatBody) => Promise<void>,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
  const action = String(req.query.action || (req.url || '').split('/').pop() || '').split('?')[0];
  const fn = handlers[action];
  if (!fn) return json(res, 404, { ok: false, error: `未知操作：${action}`, actions: Object.keys(handlers) });

  const body = (typeof req.body === 'string' ? safeParse(req.body) : req.body) as ChatBody;
  try {
    await fn(req, res, body ?? {});
  } catch (e) {
    return fail(res, 500, e instanceof Error ? e.message : '服务端转发内部错误');
  }
}

function safeParse(text: string): ChatBody {
  try {
    return JSON.parse(text) as ChatBody;
  } catch {
    return {};
  }
}
