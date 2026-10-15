// 密钥槽位口径（**唯一真相**）· 纯函数 · 客户端与服务端共用同一份实现，避免两边各算一套而漂移。
//
// 为什么需要这个文件：`public.user_provider_keys` 的主键是 (user_id, provider)，而设置页允许加**多个**
// 自定义 MCP（「自定义 MCP 1」「自定义 MCP 2」…）。在 2026-09-16 之前，所有自定义条目共用
// `provider='custom'` 这一格 —— 配第二个会把第一个的 Key 覆盖掉，而两张卡片都显示"已配置"，
// 点「验证」还会拿**别人的那把 Key** 去握手（PRD §15.28 遗留②，已于 §15.32 修掉）。
//
// 现在的口径：
//   · 四家内置数据源 → 槽位就是它的 kind（sellersprite / xydc / lingxing / sorftime），与历史数据完全兼容；
//   · 每个自定义 MCP   → 槽位由**端点地址**派生：`custom:<归一化后的地址>`。
//
// 为什么按地址派生、而不是按条目的 id：条目 id 是添加时随机生成、且只存在本机设置里（`amzdev_mcp_settings__<userId>`）。
// 换设备后重新添加同一个端点会得到**新的 id**，那就命中不到同一格、等于把"密钥跟着账号走"这条用户明确要求弄断。
// 端点地址是用户自己填的、跨设备可复现，所以只有按地址派生才能跨设备命中同一格。

/** 四家内置数据源的槽位（历史数据用的就是这四个值，不许改） */
export const BUILTIN_KEY_SLOTS = ['sellersprite', 'xydc', 'lingxing', 'sorftime'] as const;
export type BuiltinKeySlot = (typeof BUILTIN_KEY_SLOTS)[number];

/** 自定义 MCP 槽位前缀 */
export const CUSTOM_SLOT_PREFIX = 'custom:';

/** 槽位长度上限（端点地址可长可短，这里给一个远大于正常值的上限，避免把超长串写进主键） */
export const KEY_SLOT_MAX_LENGTH = 400;

/**
 * 端点地址归一化：让"同一个人在不同设备上填的同一个地址"落到同一格。
 *   - 去首尾空白；去掉 `#fragment`（不参与寻址）；
 *   - 协议与主机名统一小写（大小写不敏感）；**路径与查询串原样保留**（它们是端点身份的一部分）；
 *   - 去掉结尾的多余斜杠（`https://a.com/mcp/` 与 `https://a.com/mcp` 视为同一端点）。
 * 非 URL（比如用户还没填、或填了个纯 host）→ 只做 trim + 去尾斜杠，交给上层判定合法性。
 */
export function normalizeMcpEndpoint(raw: unknown): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  const noHash = trimmed.split('#')[0] ?? trimmed;
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)(.*)$/.exec(noHash);
  if (!m) return noHash.replace(/\/+$/, '');
  const scheme = m[1].toLowerCase();
  const authority = m[2].toLowerCase();
  const rest = (m[3] || '').replace(/\/+$/, '');
  return `${scheme}://${authority}${rest}`;
}

/** 自定义 MCP 的槽位：`custom:<归一化地址>`；地址为空时返回空串（调用方必须当作"还没有槽位"处理） */
export function customKeySlot(endpoint: unknown): string {
  const norm = normalizeMcpEndpoint(endpoint);
  if (!norm) return '';
  return `${CUSTOM_SLOT_PREFIX}${norm}`;
}

/**
 * 某个数据源条目该用哪一格 Key。
 * @param kind 数据源类型（sellersprite / xydc / lingxing / sorftime / custom）
 * @param endpoint 自定义 MCP 的端点地址（内置数据源不需要）
 */
export function keySlotFor(kind: string, endpoint?: unknown): string {
  if (kind === 'custom') return customKeySlot(endpoint);
  return isBuiltinKeySlot(kind) ? kind : '';
}

export function isBuiltinKeySlot(value: unknown): value is BuiltinKeySlot {
  return typeof value === 'string' && (BUILTIN_KEY_SLOTS as readonly string[]).includes(value);
}

export function isCustomKeySlot(value: unknown): boolean {
  if (typeof value !== 'string' || !value.startsWith(CUSTOM_SLOT_PREFIX)) return false;
  return Boolean(customSlotEndpoint(value));
}

/**
 * 槽位是否合法（服务端写入前的闸门）。
 * 关键一条：自定义槽位必须是**归一化后的规范形式**（`normalize(endpoint) === endpoint`），
 * 这样客户端只能通过本文件的 `customKeySlot()` 生成槽位，不会出现"同一个端点两种写法、各存一份 Key"。
 */
export function isKeySlot(value: unknown): boolean {
  if (isBuiltinKeySlot(value)) return true;
  if (typeof value !== 'string' || value.length === 0 || value.length > KEY_SLOT_MAX_LENGTH) return false;
  return Boolean(customSlotEndpoint(value));
}

/** 取出自定义槽位里的端点地址；不合法一律回空串（不抛错、不回细节） */
export function customSlotEndpoint(slot: unknown): string {
  if (typeof slot !== 'string' || !slot.startsWith(CUSTOM_SLOT_PREFIX)) return '';
  const endpoint = slot.slice(CUSTOM_SLOT_PREFIX.length);
  if (!endpoint || endpoint.length > KEY_SLOT_MAX_LENGTH) return '';
  if (/[\s\u0000-\u001f\u007f]/.test(endpoint)) return '';
  if (!/^https?:\/\//i.test(endpoint)) return '';
  // 必须已是规范形式：否则说明调用方自己拼的，宁可拒绝也不接受第二种写法
  if (normalizeMcpEndpoint(endpoint) !== endpoint) return '';
  return endpoint;
}
