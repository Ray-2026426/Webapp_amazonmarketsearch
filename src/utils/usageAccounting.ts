// M5 · 用量记账与配额（PRD §11.2「用量记账（workspace × 工具 × 次数，Phase B 计费预埋）」/ §11.4 用量统计）。
//
// 为什么是纯函数：用量直接关系到成本与配额，必须可复核、可测试，不能靠"页面上显示个数字"。
// 记账口径：
//   - 每次数据池调用产生一条 UsageEvent（谁 / 哪个工作区 / 哪个工具 / 哪个项目 / 成功失败 / 耗时 / 成本）；
//   - 成本估算用"单位成本表"（MCP 次数、LLM token），表可配置，但换算逻辑固定；
//   - 缓存命中不计费（§12 M3 验收里也强调"缓存命中不计"），但**仍然记账**（cacheHit=true），
//     因为要能回答"这个月有多少次本来会花钱的调用被缓存省掉了"；
//   - BYO Key（2026-09 用户决策变更）：多记一个 `keySource` 字面量 —— 这次用的是**谁的** Key。
//     只记标签（user / platform / none），**绝不记 Key 本身**；付费阶段据此把成本归到
//     "用户自付"还是"平台承担"。

export type UsageTool =
  | 'market'
  | 'keywords'
  | 'reviews'
  | 'competitor_listing'
  | 'traffic'
  | 'ai'
  | 'other';

export const USAGE_TOOL_LABELS: Record<UsageTool, string> = {
  market: '市场大盘取数',
  keywords: '关键词取数',
  reviews: '评论取数',
  competitor_listing: '竞品 Listing 抓取',
  traffic: '流量词取数',
  ai: 'AI 调用',
  other: '其他',
};

/**
 * 这次外部调用花的是**谁的** Key（成本归因用；**不是** Key 本身，也永远不是）。
 *   user     = 调用者自己在界面上填的 Key（只存他的本机浏览器）
 *   platform = 服务端 app_config / 环境变量里的平台 Key（团队共享）
 *   none     = 两边都没有，本次调用必然失败（如实记账，便于区分"没配 Key"与"Key 不好用"）
 */
export type UsageKeySource = 'user' | 'platform' | 'none';

export const USAGE_KEY_SOURCE_LABELS: Record<UsageKeySource, string> = {
  user: '用户自带 Key',
  platform: '平台 Key',
  none: '未配置 Key',
};

export interface UsageEvent {
  id: string;
  /** 工作区（Phase B 按工作区计费的口径） */
  workspaceId: string;
  userId: string;
  projectId?: string;
  tool: UsageTool;
  /** 供应商：sellersprite / xydc / deepseek / ... */
  provider: string;
  ok: boolean;
  /** 缓存命中：省了钱，但仍然记录 */
  cacheHit?: boolean;
  /** MCP/HTTP 调用次数（一次业务动作可能打多次接口） */
  calls: number;
  /** LLM token（仅 AI 类事件有） */
  inputTokens?: number;
  outputTokens?: number;
  /** 耗时毫秒 */
  durationMs?: number;
  /** 失败原因（ok=false 时） */
  error?: string;
  /** 本次用的是谁的 Key（user=用户自带 / platform=平台兜底 / none=没配）——**只记标签，不记 Key** */
  keySource?: UsageKeySource;
  createdAt: string;
}

export interface UsageCostTable {
  /** 每次 MCP 调用单价（美元） */
  mcpCallUsd: number;
  /** LLM 每百万 token 单价（美元） */
  llmInputPerMillionUsd: number;
  llmOutputPerMillionUsd: number;
}

/** 默认成本表（可被管理员配置覆盖，但换算逻辑不变） */
export const DEFAULT_COST_TABLE: UsageCostTable = {
  mcpCallUsd: 0.002,
  llmInputPerMillionUsd: 0.28,
  llmOutputPerMillionUsd: 0.42,
};

/** 单条事件成本（美元，保留 6 位小数避免小数额被抹平） */
export function estimateEventCost(event: UsageEvent, table: UsageCostTable = DEFAULT_COST_TABLE): number {
  if (event.cacheHit) return 0; // 缓存命中不花钱
  const calls = Math.max(0, event.calls || 0);
  const mcp = event.tool === 'ai' ? 0 : calls * table.mcpCallUsd;
  const input = ((event.inputTokens || 0) / 1_000_000) * table.llmInputPerMillionUsd;
  const output = ((event.outputTokens || 0) / 1_000_000) * table.llmOutputPerMillionUsd;
  return Math.round((mcp + input + output) * 1e6) / 1e6;
}

export interface UsageSummaryRow {
  key: string;
  label: string;
  events: number;
  calls: number;
  /** 实际计费事件数（不含缓存命中） */
  billedEvents: number;
  cacheHits: number;
  failures: number;
  /** 失败率 0-1 */
  failureRate: number;
  costUsd: number;
  /** 缓存省下的成本（用同样口径估算"如果没命中缓存会花多少"） */
  savedUsd: number;
}

export interface UsageSummary {
  total: UsageSummaryRow;
  byTool: UsageSummaryRow[];
  byUser: UsageSummaryRow[];
  byProject: UsageSummaryRow[];
  byProvider: UsageSummaryRow[];
  /** 按"用的是谁的 Key"分组（付费阶段据此区分用户自付 / 平台承担） */
  byKeySource: UsageSummaryRow[];
  /** 明细（按时间倒序，最多 limit 条） */
  events: UsageEvent[];
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

function summarize(key: string, label: string, events: UsageEvent[], table: UsageCostTable): UsageSummaryRow {
  const failures = events.filter((e) => !e.ok).length;
  const cacheHits = events.filter((e) => e.cacheHit).length;
  const billedEvents = events.length - cacheHits;
  const costUsd = round6(events.reduce((s, e) => s + estimateEventCost(e, table), 0));
  // "省下的钱"：把缓存命中的事件按非缓存重新估一遍
  const savedUsd = round6(
    events.filter((e) => e.cacheHit).reduce((s, e) => s + estimateEventCost({ ...e, cacheHit: false }, table), 0)
  );
  return {
    key,
    label,
    events: events.length,
    calls: events.reduce((s, e) => s + Math.max(0, e.calls || 0), 0),
    billedEvents,
    cacheHits,
    failures,
    failureRate: events.length > 0 ? Math.round((failures / events.length) * 1000) / 1000 : 0,
    costUsd,
    savedUsd,
  };
}

function groupBy(
  events: UsageEvent[],
  keyOf: (e: UsageEvent) => string,
  labelOf: (key: string) => string,
  table: UsageCostTable
): UsageSummaryRow[] {
  const map = new Map<string, UsageEvent[]>();
  for (const e of events) {
    const k = keyOf(e) || 'unknown';
    const arr = map.get(k) ?? [];
    arr.push(e);
    map.set(k, arr);
  }
  return [...map.entries()]
    .map(([k, list]) => summarize(k, labelOf(k), list, table))
    .sort((a, b) => b.costUsd - a.costUsd || b.events - a.events || a.key.localeCompare(b.key));
}

/**
 * 汇总用量（§11.4 用量统计：按工具 × 项目 × 用户 + 失败率 + 成本）。
 * 排序口径统一为"成本降序"，方便一眼看出钱花在哪。
 */
export function summarizeUsage(
  events: UsageEvent[],
  opts: { table?: UsageCostTable; limit?: number } = {}
): UsageSummary {
  const table = opts.table ?? DEFAULT_COST_TABLE;
  const list = Array.isArray(events) ? events : [];
  const sorted = [...list].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return {
    total: summarize('total', '合计', list, table),
    byTool: groupBy(list, (e) => e.tool, (k) => USAGE_TOOL_LABELS[k as UsageTool] ?? k, table),
    byUser: groupBy(list, (e) => e.userId, (k) => k, table),
    byProject: groupBy(list, (e) => e.projectId ?? '（未关联项目）', (k) => k, table),
    byProvider: groupBy(list, (e) => e.provider, (k) => k, table),
    byKeySource: groupBy(list, (e) => e.keySource ?? 'none', (k) => USAGE_KEY_SOURCE_LABELS[k as UsageKeySource] ?? k, table),
    events: sorted.slice(0, Math.max(1, opts.limit ?? 100)),
  };
}

/** 时间窗口过滤（按天/月汇总用；不含端点右边界） */
export function filterUsageByRange(events: UsageEvent[], fromIso: string, toIso: string): UsageEvent[] {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  return (Array.isArray(events) ? events : []).filter((e) => {
    const t = new Date(e.createdAt || '').getTime();
    if (!Number.isFinite(t)) return false;
    return t >= from && t < to;
  });
}

/** 按天汇总（趋势图用，日期升序，空日不补） */
export function summarizeUsageByDay(events: UsageEvent[], table: UsageCostTable = DEFAULT_COST_TABLE): {
  day: string;
  events: number;
  costUsd: number;
  failures: number;
}[] {
  const map = new Map<string, UsageEvent[]>();
  for (const e of Array.isArray(events) ? events : []) {
    const day = String(e.createdAt || '').slice(0, 10);
    if (!day) continue;
    const arr = map.get(day) ?? [];
    arr.push(e);
    map.set(day, arr);
  }
  return [...map.entries()]
    .map(([day, list]) => ({
      day,
      events: list.length,
      costUsd: round6(list.reduce((s, e) => s + estimateEventCost(e, table), 0)),
      failures: list.filter((e) => !e.ok).length,
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export interface QuotaCheck {
  allowed: boolean;
  used: number;
  limit: number | null;
  /** 剩余（无上限时为 null） */
  remaining: number | null;
  reason?: string;
}

/**
 * 配额校验（§11.4 配置中心「每用户配额」）。
 * 规则：只计"实际计费事件"（缓存命中不占额度）；limit 为 null/0 表示不限制。
 */
export function checkQuota(input: {
  events: UsageEvent[];
  userId: string;
  monthlyLimit: number | null | undefined;
  /** 统计窗口内的事件（调用方通常传本月事件） */
}): QuotaCheck {
  const used = (Array.isArray(input.events) ? input.events : []).filter(
    (e) => e.userId === input.userId && !e.cacheHit
  ).length;
  const limit = typeof input.monthlyLimit === 'number' && input.monthlyLimit > 0 ? input.monthlyLimit : null;
  if (limit === null) return { allowed: true, used, limit: null, remaining: null };
  const remaining = Math.max(0, limit - used);
  return {
    allowed: used < limit,
    used,
    limit,
    remaining,
    reason: used >= limit ? `已达到本月配额（${used}/${limit}）` : undefined,
  };
}

/** 生成一条记账事件（id 与时间戳在这里统一生成，便于服务端与本地一致） */
export function createUsageEvent(input: Omit<UsageEvent, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): UsageEvent {
  const now = new Date().toISOString();
  return {
    ...input,
    id: input.id || `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: input.createdAt || now,
    calls: Math.max(0, input.calls || 0),
  };
}

/** 人话摘要（管理员面板顶部一行） */
export function describeUsage(summary: UsageSummary): string {
  const t = summary.total;
  const cacheNote = t.cacheHits > 0 ? `，缓存命中 ${t.cacheHits} 次（省 $${t.savedUsd.toFixed(4)}）` : '';
  const failNote = t.failures > 0 ? `，失败 ${t.failures} 次（${(t.failureRate * 100).toFixed(1)}%）` : '';
  // BYO Key：把"用户自付"的次数单独说出来，付费阶段这就是账单分界线
  const userKeyEvents = summary.byKeySource.find((r) => r.key === 'user')?.events ?? 0;
  const keyNote = userKeyEvents > 0 ? `，其中 ${userKeyEvents} 次用的是用户自带 Key` : '';
  return `本月 ${t.events} 次记账 / ${t.calls} 次外部调用，估算成本 $${t.costUsd.toFixed(4)}${cacheNote}${failNote}${keyNote}`;
}
