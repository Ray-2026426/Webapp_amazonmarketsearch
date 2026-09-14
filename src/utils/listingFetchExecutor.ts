// M5 · Listing 抓取执行器：按计划走**服务端数据池**抓取（PRD §11.2）。
//
// 与 planListingFetch 的分工：计划器决定"抓什么、按什么顺序、花多少钱"（纯函数、可测），
// 执行器只负责"按计划调用、隔离失败、汇总进度"。执行器**永远不接触密钥**：
// 它只把 tool/args 发给 /api/data/mcp，密钥由服务端解析。
//
// 为什么要把并发限住：MCP 是外部服务，一次打十几个并发容易被限流或超时，
// 反而让"抓取成功率"这项验收指标变差。默认并发 3，并按优先级顺序推进。

import { planListingFetch, assembleListingDetails, evaluateFetchPlan, type FetchDepth, type FetchPlanEvaluation, type FetchStep, type FetchStepResult } from './listingFetchPlan';
import type { FieldGroup, ListingDetail, TrafficDetail } from './listingFields';

export interface ExecuteOptions {
  token: string;
  workspaceId?: string;
  projectId?: string;
  concurrency?: number;
  onProgress?: (done: number, total: number, step: FetchStep, ok: boolean) => void;
}

export interface ExecuteResult {
  results: FetchStepResult[];
  /** 是否真的走了服务端网关（false = 没登录，调用方决定要不要降级） */
  usedGateway: boolean;
  note: string;
}

/** 单步调用：只发 tool/args，密钥由服务端解析（前端永不接触） */
async function callGateway(step: FetchStep, opts: ExecuteOptions): Promise<FetchStepResult> {
  const started = Date.now();
  try {
    const res = await fetch('/api/data/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: opts.token,
        provider: step.provider,
        tool: step.tool,
        args: step.args,
        type: step.type,
        usageTool: step.usageTool,
        workspaceId: opts.workspaceId ?? 'default',
        projectId: opts.projectId,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      data?: unknown;
      error?: string;
      cached?: boolean;
      cacheReason?: string;
    };
    return {
      stepId: step.id,
      ok: Boolean(body.ok),
      data: body.data,
      error: body.ok ? undefined : body.error || `HTTP ${res.status}`,
      durationMs: Date.now() - started,
      cacheHit: Boolean(body.cached),
    };
  } catch (e) {
    return { stepId: step.id, ok: false, error: e instanceof Error ? e.message : '网络错误', durationMs: Date.now() - started };
  }
}

/**
 * 按计划执行（并发受限，失败隔离）。
 * 顺序：仍按计划优先级推进——先抓便宜且信息量大的，再抓贵的；某一步失败不影响后续步骤。
 */
export async function executeListingFetchPlan(plan: FetchStep[], opts: ExecuteOptions): Promise<ExecuteResult> {
  if (!opts.token) {
    return { results: [], usedGateway: false, note: '未登录：平台数据池需要登录后使用（前端不保存任何密钥）' };
  }
  if (plan.length === 0) return { results: [], usedGateway: true, note: '没有需要抓取的步骤' };

  const concurrency = Math.max(1, Math.min(6, opts.concurrency ?? 3));
  const results: FetchStepResult[] = new Array(plan.length);
  let cursor = 0;
  let done = 0;

  const worker = async () => {
    for (;;) {
      const index = cursor++;
      if (index >= plan.length) return;
      const step = plan[index];
      const r = await callGateway(step, opts);
      results[index] = r;
      done += 1;
      opts.onProgress?.(done, plan.length, step, r.ok);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, plan.length) }, () => worker()));
  const failures = results.filter((r) => !r.ok).length;
  return {
    results,
    usedGateway: true,
    note:
      failures === 0
        ? `已抓取 ${plan.length} 步（全部成功）`
        : `已抓取 ${plan.length} 步，其中 ${failures} 步失败（其它步骤的结果已保留，可重试失败项）`,
  };
}

export interface FetchListingResult {
  listing: Record<string, ListingDetail>;
  traffic: Record<string, TrafficDetail>;
  evaluation: FetchPlanEvaluation;
  usedGateway: boolean;
  note: string;
  failures: { stepId: string; error: string }[];
}

/**
 * 一站式：计划 → 执行（网关）→ 装配 → 评估。
 * 看竞对页"抓取全字段"按钮直接用这个，拿到 listingDetails/trafficDetails 与覆盖率。
 */
export async function fetchListingDetails(input: {
  asins: string[];
  marketplace: string;
  depth?: FetchDepth;
  groups?: FieldGroup[];
  alreadyHave?: Record<string, string[]>;
  token: string;
  workspaceId?: string;
  projectId?: string;
  concurrency?: number;
  onProgress?: ExecuteOptions['onProgress'];
}): Promise<FetchListingResult> {
  const plan = planListingFetch({
    asins: input.asins,
    marketplace: input.marketplace,
    depth: input.depth,
    groups: input.groups,
    alreadyHave: input.alreadyHave,
  });
  const exec = await executeListingFetchPlan(plan, {
    token: input.token,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    concurrency: input.concurrency,
    onProgress: input.onProgress,
  });
  const assembled = plan.length > 0
    ? assembleListingDetails(plan, exec.results)
    : { listing: {}, traffic: {}, applied: [], failures: [] };
  return {
    listing: assembled.listing,
    traffic: assembled.traffic,
    evaluation: evaluateFetchPlan(plan, assembled, input.asins),
    usedGateway: exec.usedGateway,
    note: exec.note,
    failures: assembled.failures,
  };
}

/** 只抓流量组（二级页⑨"流量结构"用） */
export async function fetchTrafficDetails(input: Omit<Parameters<typeof fetchListingDetails>[0], 'groups'>): Promise<FetchListingResult> {
  return fetchListingDetails({ ...input, groups: ['traffic'] });
}
