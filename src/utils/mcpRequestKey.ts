// BYO Key（自带密钥）· 请求级密钥解析（纯函数）。
//
// 用户决策变更（2026-09，原话："需要其他用户也能填 key，后续我们再考虑做付费，
// 那时候再关闭 mcp 入口，换成计费模式。"）：
//   旧的「决策 A：浏览器不保存任何密钥」被推翻 —— 现在**所有用户**都可以在界面上填自己的 MCP Key。
//   平台仍然保留服务端默认 Key 作为兜底：没填自己 Key 的人走平台 Key（团队共享）。
//
// 解析顺序**只有一条**，写在这里，服务端网关与前端共用同一份实现（避免两边各写一份而漂移）：
//   ① 本次请求携带的用户 Key（只在当次请求内使用）
//   ② 服务端 app_config / 环境变量里的平台 Key（兜底）
//   ③ 两边都没有 → source='none'（调用方明确报"未配置"，不要编造）
//
// 安全口径（这里是唯一入口，所以校验也放在这里）：
//   - 用户 Key **只做请求内使用**：不落库、不落日志、不进任何返回体；
//   - 非法（非字符串 / 空 / 超长 / 含控制字符）一律**当作"没提供"**回退平台默认，
//     不抛错、不回报错细节（错误信息本身就是一种泄露）。
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
 * 返回空串 = 视为未提供（要走平台兜底），调用方不得据此报错。
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
 * 第一步决策：这次请求该用谁的 Key（还没去读平台 Key）。
 *
 * 单独成函数的意义：**用户 Key 可用时，平台 Key 一次都不读**（最小暴露面），
 * 而"要不要读平台 Key"这个判断只在这里做一次、可单测。
 */
export function decideProviderKeySource(userKeyRaw: unknown): { source: 'user' | 'platform'; userKey: string } {
  const userKey = sanitizeUserKey(userKeyRaw);
  return userKey ? { source: 'user', userKey } : { source: 'platform', userKey: '' };
}

/**
 * 完整解析（用户 Key 优先 → 平台兜底 → 都没有）。
 * `platformKey` 由调用方在**用户没带 Key 时**才去取（服务端读 app_config / 环境变量）。
 */
export function resolveProviderKey(input: { userKey?: unknown; platformKey?: unknown }): {
  key: string;
  source: ProviderKeySource;
} {
  const decision = decideProviderKeySource(input.userKey);
  if (decision.source === 'user') return { key: decision.userKey, source: 'user' };
  const platformKey = typeof input.platformKey === 'string' ? input.platformKey.trim() : '';
  return platformKey ? { key: platformKey, source: 'platform' } : { key: '', source: 'none' };
}
