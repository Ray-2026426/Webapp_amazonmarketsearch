/**
 * AI 请求地址的**唯一事实来源**（纯数据 + 纯函数，无 React、无浏览器 API）。
 *
 * 为什么需要这个模块（用户诉求：请求地址默认对应大模型的地址、可以改、能接第三方中转）：
 * 1. 现在界面上那个「API 请求地址」框，语义是"自定义地址，留空=走本站默认代理"，
 *    **看不出实际会打到哪个站点**。而 8 个内置供应商里，7 个的默认代理目标就是官方站点，
 *    **只有 DeepSeek 被转发到第三方中转 `openrouter.fans`**（见 `vercel.json` 与 `vite.config.ts`）。
 *    这件事必须在界面上可见 —— 所以这里把"官方地址"与"本站默认实际转发到的地址"都记下来。
 * 2. 浏览器**不能**直接请求这些官方站点（CORS）。所以"填一个绝对地址"必须决定走哪条通道：
 *    同源路径 → 直连；绝对地址 → 经本站服务端转发（`api/ai/*`）。
 * 3. 服务端转发意味着"用户填什么地址，服务器就去请求什么地址"，这是典型的 SSRF 面。
 *    校验规则写在这里（`validateRelayTarget`），**服务端与前端共用同一份实现**，
 *    避免"两边各写一份、只补了一边"的经典漏洞。
 */

import type { AiProvider } from './aiConfig';

/** 单个供应商的地址事实 */
export interface AiEndpointFact {
  /** 厂商官方 API 地址（主机级，路径由各调用点按接口形态拼） */
  officialUrl: string;
  /**
   * **本站默认转发实际会打到的地址**。
   * 前 7 个供应商等于官方地址；DeepSeek 因为历史原因指向第三方中转 openrouter.fans。
   *
   * ⚠️ 改这里的值必须**同时**改 `vercel.json` 的 rewrites 与 `vite.config.ts` 的 dev proxy，
   * 否则线上与本地会各走各的（本模块只负责"如实描述"，不负责真正改写转发）。
   */
  proxyTarget: string;
  /** 本站默认走的是不是第三方中转（而不是厂商官方） */
  relayedByDefault?: boolean;
  /** 该供应商没有默认地址，必须由用户填写请求地址 */
  requiresCustomUrl?: boolean;
}

export const AI_ENDPOINT_FACTS: Record<AiProvider, AiEndpointFact> = {
  gemini: { officialUrl: 'https://generativelanguage.googleapis.com', proxyTarget: 'https://generativelanguage.googleapis.com' },
  openai: { officialUrl: 'https://api.openai.com', proxyTarget: 'https://api.openai.com' },
  claude: { officialUrl: 'https://api.anthropic.com', proxyTarget: 'https://api.anthropic.com' },
  deepseek: {
    officialUrl: 'https://api.deepseek.com',
    proxyTarget: 'https://openrouter.fans',
    relayedByDefault: true,
  },
  qwen: { officialUrl: 'https://dashscope.aliyuncs.com', proxyTarget: 'https://dashscope.aliyuncs.com' },
  moonshot: { officialUrl: 'https://api.moonshot.cn', proxyTarget: 'https://api.moonshot.cn' },
  zhipu: { officialUrl: 'https://open.bigmodel.cn', proxyTarget: 'https://open.bigmodel.cn' },
  doubao: { officialUrl: 'https://ark.cn-beijing.volces.com', proxyTarget: 'https://ark.cn-beijing.volces.com' },
  /**
   * 自定义 / 第三方中转：没有官方地址，也**没有本站默认目标** ——
   * 它必须由用户自己填 Base URL（填了就一定是绝对地址 → 走服务端转发）。
   */
  custom: { officialUrl: '', proxyTarget: '', requiresCustomUrl: true },
};

/** 该供应商是否必须由用户自己填请求地址（当前只有「自定义 / 第三方中转」） */
export function providerRequiresCustomUrl(provider: AiProvider): boolean {
  return AI_ENDPOINT_FACTS[provider]?.requiresCustomUrl === true;
}

export function providerEndpointFact(provider: AiProvider): AiEndpointFact {
  return AI_ENDPOINT_FACTS[provider];
}

/** 本站默认目标与官方地址不一致的供应商（当前只有 deepseek），界面上要显著提示 */
export function providersWithNonOfficialDefault(): AiProvider[] {
  return (Object.keys(AI_ENDPOINT_FACTS) as AiProvider[]).filter(
    (p) => AI_ENDPOINT_FACTS[p].relayedByDefault === true
  );
}

/** 同源（以 / 开头的相对路径）地址：浏览器直连即可，不需要服务端转发 */
export function isSameOriginUrl(url: string): boolean {
  return url.trim().startsWith('/');
}

export type AiTransport = 'proxy' | 'relay' | 'direct';

export interface AiTransportDecision {
  transport: AiTransport;
  /** 给用户看的中文理由（界面直接显示，别让用户猜） */
  reason: string;
}

/**
 * 决定一次 AI 请求走哪条通道。三种通道的取舍：
 * - `proxy`  ：没有填自定义地址 → 保持今天的同源代理路径（**零回归**）；
 * - `direct` ：填了同源相对路径（自建网关）或用户明确要求直连 → 浏览器直接请求；
 * - `relay`  ：填了绝对地址 → 浏览器直连会被 CORS 拦，改由本站服务端转发。
 */
export function decideAiTransport(input: {
  customUrl?: string | null;
  /** 用户明确选择"直连"（前提：他的中转允许浏览器跨域） */
  preferDirect?: boolean;
}): AiTransportDecision {
  const custom = String(input.customUrl ?? '').trim();

  if (!custom) {
    return { transport: 'proxy', reason: '未填自定义地址：走本站默认转发（同源，不受浏览器跨域限制）' };
  }
  if (isSameOriginUrl(custom)) {
    return { transport: 'direct', reason: `同源地址 ${custom}：浏览器直接请求` };
  }
  if (input.preferDirect) {
    return { transport: 'direct', reason: '已选择直连：浏览器直接请求（对方必须允许跨域，否则会被 CORS 拦）' };
  }
  return {
    transport: 'relay',
    reason: '绝对地址：浏览器直连会被跨域拦截，改由本站服务端转发（不保存、不记录你的 Key）',
  };
}

/* ────────────────────────── SSRF 防护 ────────────────────────── */

/**
 * 校验结果用**扁平**结构（三个字段永远都在），不用"可辨识联合"：
 * 本仓库的 tsconfig 没有开 `strict`/`strictNullChecks`，字面量布尔的可辨识联合在窄化时不可靠
 * （实测 `if (!res.ok) res.reason` 会报"属性不存在"）。扁平结构在调用点不需要窄化，也不会写错。
 */
export interface RelayTargetCheck {
  ok: boolean;
  /** 校验通过时是规范化后的地址，否则为空串 */
  url: string;
  /** 校验失败的原因（中文，可直接展示）；通过时为空串 */
  reason: string;
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'instance-data',
  'kubernetes.default',
  'kubernetes.default.svc',
]);

/** IPv4 字面量是否落在私有/环回/链路本地/保留段 */
function isBlockedIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, Number(m[3]), Number(m[4])].some((n) => n > 255)) return true; // 非法写法一律拒绝
  if (a === 0 || a === 10 || a === 127) return true; // 本机 / 私有 / 未指定
  if (a === 169 && b === 254) return true; // 链路本地，含 169.254.169.254 云元数据
  if (a === 172 && b >= 16 && b <= 31) return true; // 私有
  if (a === 192 && b === 168) return true; // 私有
  if (a === 100 && b >= 64 && b <= 127) return true; // 运营商级 NAT
  if (a >= 224) return true; // 组播与保留
  return false;
}

/** IPv6 字面量是否落在环回/唯一本地/链路本地/映射到内网 */
function isBlockedIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h.includes(':')) return false;
  if (h === '::' || h === '::1') return true;
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // fc00::/7 唯一本地
  if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) return true; // fe80::/10
  // ::ffff:127.0.0.1 之类的映射写法
  const mapped = /^::ffff:(.+)$/.exec(h);
  if (mapped) return isBlockedIpv4(mapped[1]) || true;
  return false;
}

/**
 * 服务端转发前的目标校验（**服务端必须调用这一份**，不能只信前端）。
 * 拒绝：非 http/https、带账号密码、无点号的主机名、localhost/*.local 等已知内网名、
 *       私有/环回/链路本地/云元数据地址（IPv4 与 IPv6）。
 *
 * 诚实边界：这里只做**字面量**校验，不做 DNS 解析后的二次校验，
 * 因此理论上存在"域名解析到内网 IP"的绕过。真正上线到多租户环境前，
 * 应在服务端解析后再对解析结果复核一次（见 PRD §15.15 的遗留项）。
 */
export function validateRelayTarget(rawUrl: string): RelayTargetCheck {
  const trimmed = String(rawUrl ?? '').trim();
  const no = (reason: string): RelayTargetCheck => ({ ok: false, url: '', reason });

  if (!trimmed) return no('请求地址为空');

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return no('不是合法的 URL（需要 http(s):// 开头的完整地址）');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return no(`只允许 http/https，收到的是 ${parsed.protocol.replace(':', '')}`);
  }
  if (parsed.username || parsed.password) {
    return no('地址里不允许带账号密码（请把 Key 放在鉴权头里）');
  }

  const host = parsed.hostname.toLowerCase();
  if (!host) return no('地址缺少主机名');
  if (BLOCKED_HOSTNAMES.has(host)) return no(`禁止访问 ${host}（本机/内网服务）`);
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    return no(`禁止访问 ${host}（内网域名）`);
  }
  if (isBlockedIpv4(host)) return no(`禁止访问内网/环回/元数据地址 ${host}`);
  if (isBlockedIpv6(host)) return no(`禁止访问内网/环回地址 ${host}`);
  // 没有点号又不是 IP，说明是内网短名（如 http://router/、http://nas/）
  if (!host.includes('.') && !host.includes(':')) {
    return no(`禁止访问内网短名主机 ${host}`);
  }

  return { ok: true, url: trimmed, reason: '' };
}
