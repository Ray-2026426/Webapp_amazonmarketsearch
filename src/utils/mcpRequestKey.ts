// BYO Key（自带密钥）· 请求级密钥解析（纯函数）。
//
// 口径（§15.28，2026-09 用户拍板「我的mcp没有跟着账号走吗，需要跟着账号」）：
//   用户自己的 Key 的**唯一真相**是服务端表 `public.user_provider_keys`（主键 user_id + provider），
//   由网关按 JWT 里的 userId 取用；平台 Key **不再作为 MCP 数据的兜底**（政策 A）。
//
// 本文件只负责"**这次请求带上来/校验过的那把 Key**"这一层的纯函数：
//   `sanitizeUserKey` 是**唯一**的密钥格式口径 —— 服务端网关（keySet 写入 + 请求体兼容路径）
//   与客户端（保存前自检）共用同一份实现，避免两边各写一套而漂移。
//
// 校验口径：去首尾空白 / 非空 / 长度 ≤512 / 拒绝控制字符（含换行、制表 —— 那是 header 注入或误粘贴）。
// 不合法一律当作"没提供"：不抛错、不回报错细节（错误信息本身就是一种泄露）。
//
// 注意区分两件事：
//   · 本文件里的"用户 Key"是**请求级**的（用完即弃，绝不落库）；
//   · 落到 `user_provider_keys` 的是用户在设置页保存的那一份（写库只发生在 keySet，见 api/data/[action].ts）。
export type ProviderKeySource = 'user' | 'platform' | 'none';

/** 用户 Key 长度上限（超过一律视为未提供；真实 Key 远小于这个数） */
export const USER_KEY_MAX_LENGTH = 512;

/** 人话标签（界面与用量面板共用同一份口径） */
export const PROVIDER_KEY_SOURCE_LABELS: Record<ProviderKeySource, string> = {
  user: '你自己的 Key',
  platform: '平台 Key',
  none: '未配置',
};

/**
 * 归一化"用户自带的 Key"。
 * 返回空串 = 视为未提供，调用方不得据此报错或读取任何平台兜底 Key。
 */
export function sanitizeUserKey(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.length > USER_KEY_MAX_LENGTH) return '';
  // 控制字符（含换行/制表）不是合法凭证的一部分：带上它多半是 header 注入或误粘贴
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return '';
  return trimmed;
}

/**
 * 第一步决策：这次请求该用谁的 Key（还没去读服务端存的 Key）。
 *
 * 单独成函数的意义：把"必须用户自带 Key"这条口径钉死，避免服务端悄悄回退平台 Key。
 */
export function decideProviderKeySource(userKeyRaw: unknown): { source: 'user' | 'none'; userKey: string } {
  const userKey = sanitizeUserKey(userKeyRaw);
  return userKey ? { source: 'user', userKey } : { source: 'none', userKey: '' };
}

/**
 * 完整解析（只接受用户 Key）。
 * `platformKey` 参数保留兼容历史调用签名，但这里刻意不再使用（政策 A：平台 Key 不作 MCP 兜底）。
 */
export function resolveProviderKey(input: { userKey?: unknown; platformKey?: unknown }): {
  key: string;
  source: ProviderKeySource;
} {
  const decision = decideProviderKeySource(input.userKey);
  if (decision.source === 'user') return { key: decision.userKey, source: 'user' };
  return { key: '', source: 'none' };
}
