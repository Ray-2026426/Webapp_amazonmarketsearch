// M5 · 密钥掩码（PRD §11.2「**平台**密钥只在服务端，前端永不接触」/ §11.4 环境自检「不回显密钥值」）。
//
// §15.26 BYO Key 之后口径精确化为：平台密钥仍只在服务端；**用户自带**的密钥存在他本机，
// 但任何**对外返回体 / 日志 / 审计详情**里都不许出现明文 —— 掩码与脱敏照样一律走这里。
//
// 后端任何对外返回体都要经过这里：只给"配没配 + 指纹"，不给值。
// 指纹口径：长度 > 8 时给 `前3…后4`；短 key 只给 `前2…后2`；空 key 给空串。
// 这样管理员能核对"是不是我以为的那个 key"，但拿不回密钥。

export interface KeyStatus {
  configured: boolean;
  fingerprint: string;
}

export function maskKey(value: unknown): string {
  const v = String(value ?? '').trim();
  if (!v) return '';
  if (v.length <= 8) return `${v.slice(0, 2)}…${v.slice(-2)}`;
  return `${v.slice(0, 3)}…${v.slice(-4)}`;
}

/** 单个配置项的状态 */
export function describeKey(value: unknown): KeyStatus {
  const v = String(value ?? '').trim();
  return { configured: v.length > 0, fingerprint: maskKey(v) };
}

/** 一组配置项的状态（键名原样保留，值一律掩码） */
export function describeKeys(values: Record<string, unknown>): Record<string, KeyStatus> {
  const out: Record<string, KeyStatus> = {};
  for (const [k, v] of Object.entries(values ?? {})) out[k] = describeKey(v);
  return out;
}

/** 自检项：只回状态 + 可选计数（如管理员邮箱个数），不回值 */
export function describeCheck(value: unknown, extra?: { count?: number }): KeyStatus & { count?: number } {
  const base = describeKey(value);
  return extra && typeof extra.count === 'number' ? { ...base, count: extra.count } : base;
}

/**
 * 兜底防线：从任意对象里剔除看起来像密钥的字段（值替换为掩码）。
 * 用在"日志/错误上报/调试回显"这类不该出现明文的地方。
 */
export function redactSecrets<T extends Record<string, unknown>>(input: T): T {
  const SECRETISH = /(secret|token|api[_-]?key|password|authorization|service[_-]?role)/i;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (SECRETISH.test(k)) out[k] = maskKey(v);
    else out[k] = v;
  }
  return out as T;
}

/**
 * 从**任意文本**里抹掉看起来像密钥的片段（上游返回的报错经常会把 Key 原样回显）。
 * 与 `redactSecrets` 同一处实现、同一套口径，避免"两处各写一份掩码"。
 *
 * 抹掉的对象：
 * - `Bearer xxx` / `Authorization: xxx` 这类鉴权头；
 * - 常见 Key 前缀（`sk-`、`sk-ant-`、`AIza`、`github_pat_`、`mcp_`、`eyJ` 开头的 JWT）；
 * - 长度 ≥ 24 的连续字母数字串（绝大多数真实 Key 都落在这里）。
 */
export function redactText(text: unknown): string {
  let out = String(text ?? '');
  out = out.replace(/(bearer\s+)[A-Za-z0-9._\-]{8,}/gi, '$1<已隐藏>');
  out = out.replace(/(authorization["'\s:]+)[A-Za-z0-9._\-]{8,}/gi, '$1<已隐藏>');
  out = out.replace(/\b(sk-[A-Za-z0-9._\-]{6,}|sk-ant-[A-Za-z0-9._\-]{6,}|AIza[A-Za-z0-9._\-]{10,}|github_pat_[A-Za-z0-9_]{10,}|mcp_[A-Za-z0-9._\-]{6,}|eyJ[A-Za-z0-9._\-]{10,})/g, '<已隐藏>');
  out = out.replace(/\b[A-Za-z0-9]{24,}\b/g, '<已隐藏>');
  return out;
}
