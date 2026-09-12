// M5 · 密钥掩码（PRD §11.2「密钥只在服务端，前端永不接触」/ §11.4 环境自检「不回显密钥值」）。
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
