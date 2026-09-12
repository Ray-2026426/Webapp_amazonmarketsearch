// M5 · 性能预算（PRD §11.3/§12 M5：项目中心 ≤2s）。
//
// 为什么要有这个模块：这是一条**验收线**，但我在无浏览器环境里量不了。
// 与其含糊地说"应该很快"，不如把"怎么量、多少算达标、超了报什么"做成确定性代码：
//   - 在关键路径打点（项目中心加载等），把最近一次测量记下来；
//   - 用固定预算判定达标与否，超了明确说超了多少；
//   - 管理员后台/诊断里直接显示数字，用户实测时能一眼读出来。
//
// 纯函数负责判定与汇总，打点只是薄薄一层（localStorage 保存最近一次，便于复核）。

export interface PerfBudget {
  /** 打点名（稳定标识） */
  key: string;
  label: string;
  /** 预算毫秒 */
  budgetMs: number;
  /** 这条预算从哪来（PRD 依据） */
  source: string;
}

/** 预算表：数字来自 PRD 验收标准，改动必须同步 PRD */
export const PERF_BUDGETS: PerfBudget[] = [
  { key: 'project_center_load', label: '项目中心加载', budgetMs: 2000, source: 'PRD §12 M5「项目中心 ≤2s」' },
  { key: 'project_open', label: '打开项目（含首屏）', budgetMs: 3000, source: 'PRD §11.3 交互响应经验值（与项目中心同档）' },
  { key: 'look_ai_step', label: '单看 AI 分析', budgetMs: 60_000, source: 'PRD §15.1-3「10 分钟跑完五看」按 5 步分摊' },
  { key: 'pool_fetch_batch', label: '数据池批量抓取（3 竞对全字段）', budgetMs: 120_000, source: 'PRD §11.2 抓取编排（外部 MCP 时间不可控，给 2 分钟）' },
];

export function budgetFor(key: string): PerfBudget | undefined {
  return PERF_BUDGETS.find((b) => b.key === key);
}

export interface PerfSample {
  key: string;
  durationMs: number;
  at: string;
  /** 上下文（如项目数、ASIN 数），便于解释"为什么这次慢" */
  context?: Record<string, number | string>;
}

export interface BudgetVerdict {
  key: string;
  label: string;
  durationMs: number;
  budgetMs: number;
  ok: boolean;
  /** 超出比例 0-1（达标时为 0） */
  overBy: number;
  /** 人话结论，可直接显示在诊断面板 */
  verdict: string;
}

/** 单次测量判定（确定性） */
export function checkBudget(sample: PerfSample): BudgetVerdict {
  const budget = budgetFor(sample.key);
  const budgetMs = budget?.budgetMs ?? 0;
  const label = budget?.label ?? sample.key;
  const ok = budgetMs > 0 ? sample.durationMs <= budgetMs : true;
  const overBy = !ok || budgetMs <= 0 ? 0 : Math.max(0, (sample.durationMs - budgetMs) / budgetMs);
  return {
    key: sample.key,
    label,
    durationMs: Math.round(sample.durationMs),
    budgetMs,
    ok,
    overBy: ok ? 0 : Math.round(((sample.durationMs - budgetMs) / Math.max(1, budgetMs)) * 1000) / 1000,
    verdict: budget
      ? ok
        ? `${label} ${Math.round(sample.durationMs)}ms ≤ ${budgetMs}ms：达标`
        : `${label} ${Math.round(sample.durationMs)}ms 超出预算 ${budgetMs}ms（超 ${Math.round(((sample.durationMs - budgetMs) / budgetMs) * 100)}%）：未达标`
      : `${label} ${Math.round(sample.durationMs)}ms（没有为它设预算）`,
  };
}

/** 一组测量的汇总（同一 key 多次测量取中位数，避免偶发慢样本误导判断） */
export function summarizePerf(samples: PerfSample[]): {
  verdicts: BudgetVerdict[];
  failures: BudgetVerdict[];
  summary: string;
} {
  const byKey = new Map<string, number[]>();
  for (const s of Array.isArray(samples) ? samples : []) {
    const arr = byKey.get(s.key) ?? [];
    arr.push(s.durationMs);
    byKey.set(s.key, arr);
  }
  const verdicts: BudgetVerdict[] = [];
  for (const [key, list] of byKey) {
    const sorted = [...list].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    verdicts.push(checkBudget({ key, durationMs: median, at: new Date().toISOString() }));
  }
  const failures = verdicts.filter((v) => !v.ok);
  return {
    verdicts: verdicts.sort((a, b) => a.key.localeCompare(b.key)),
    failures,
    summary:
      verdicts.length === 0
        ? '还没有性能测量数据：跑一次项目中心/打开项目后回来看'
        : failures.length === 0
          ? `${verdicts.length} 项预算全部达标（中位数口径）`
          : `${verdicts.length} 项里有 ${failures.length} 项超预算：${failures.map((f) => f.label).join('、')}`,
  };
}

/* ── 打点（薄层：只做测量与本地记录，不参与判定） ── */

const STORAGE_KEY = 'kairo_perf_samples';
const MAX_SAMPLES = 200;

export function loadPerfSamples(): PerfSample[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as PerfSample[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function recordPerfSample(sample: PerfSample): void {
  try {
    const list = loadPerfSamples();
    list.push(sample);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(-MAX_SAMPLES)));
  } catch {
    /* 记录失败不影响业务 */
  }
}

/** 计时器：const done = startPerf('project_center_load'); ... done({ projects: n }) */
export function startPerf(key: string): (context?: Record<string, number | string>) => BudgetVerdict {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return (context) => {
    const ended = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const sample: PerfSample = {
      key,
      durationMs: ended - started,
      at: new Date().toISOString(),
      context,
    };
    recordPerfSample(sample);
    return checkBudget(sample);
  };
}

export function clearPerfSamples(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
