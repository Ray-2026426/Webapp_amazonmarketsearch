// M4 · 机会卡「决策包」的确定性推导（PRD §6.5 执行路线图 / 前置资源 / 控制点）。
//
// 用户要求原话里的四个问题：先做什么、后做什么、需要投入哪些前置资源、要哪些控制点。
// 这里全部按规则从数据推出来（成本最低、信息增益最高的动作排前面），**AI 只解释与补充**，
// 且：
// - 前置资源里"已知缺口"要对照看自己的背景库标出来（缺的标红），不能假装都有；
// - 控制点默认从利润假设 + 风险推导，但**必须由用户确认**（confirmed=false 时界面提示"待你确认"）；
// - 硬约束（毛利红线/认证/MOQ）不满足时，路线图第一步就是补它，而不是继续往前冲。

import type { RequiredResource, RoadmapAction, ControlPoint, OpportunityDecisionPackage } from '../types/opportunity';
import type { ProfitAssumption, RiskItem } from '../types/researchProject';
import type { UnmetNeedCandidate } from './userLook';
import { CAPABILITY_ITEMS, type CapabilityLibrary } from './capabilityLibrary';
import { capabilityHardConstraints } from './capabilityLibrary';

let seq = 0;
function id(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

/** 利润假设 → 可用的数字（缺失返回 undefined，绝不默认成"能赚钱"） */
export function profitMetrics(pa?: ProfitAssumption | null): {
  margin: number;
  unitProfit: number;
  breakEvenAcos: number;
} | null {
  if (!pa || !(pa.price > 0)) return null;
  const cost = pa.cost || 0;
  const cpc = pa.cpc || 0;
  const unitProfit = pa.price - cost - cpc;
  const margin = unitProfit / pa.price;
  // 保本 ACOS ≈ 毛利率（单位经济口径）
  return { margin, unitProfit, breakEvenAcos: Math.max(0, margin) };
}

/**
 * 执行路线图（两段：先做 0-30 天 / 后做 30-90 天）。
 * 排序原则：验证成本最低、信息增益最高 → 打样/测评/认证预沟通在前，备货/上架/放量在后。
 */
export function buildRoadmap(input: {
  need?: UnmetNeedCandidate | null;
  library?: CapabilityLibrary;
  profit?: ProfitAssumption | null;
}): RoadmapAction[] {
  const out: RoadmapAction[] = [];
  const need = input.need;
  const needLabel = (need?.needStatement || '').trim() || '这条未满足需求';
  const hard = capabilityHardConstraints(input.library);
  const metrics = profitMetrics(input.profit);

  // ① 硬约束优先：不先补它，后面全是白干
  for (const h of hard.slice(0, 2)) {
    out.push({
      id: id('rm'),
      phase: 'now',
      action: `先解决硬约束：${h}`,
      cost: h.includes('认证') ? 2000 : 0,
      note: '硬约束不满足时机会不能直接进入（§6.4）：这一步的产出是"能不能做"，不是"做多少"',
      done: false,
    });
  }

  out.push({
    id: id('rm'),
    phase: 'now',
    action: `送检 3 家工厂打样，验证能否满足「${needLabel}」`,
    cost: 1500,
    note: '打样是最便宜的"证伪"手段：先确认供给端做得出来，再谈市场',
    done: false,
  });
  out.push({
    id: id('rm'),
    phase: 'now',
    action: `小批量测评 20 件目标用户，验证「${needLabel}」是不是真痛点`,
    cost: 800,
    note: '把需求卡的关键词与评论痛点做成测评问卷；测完再决定要不要备货',
    done: false,
  });
  if (!hard.some((h) => h.includes('认证'))) {
    out.push({
      id: id('rm'),
      phase: 'now',
      action: '认证预沟通（CPC / 加州 65 / 目标站点准入）',
      cost: 500,
      note: '预沟通不影响打样，但能提前暴露合规周期（通常是最长的一条前置线）',
      done: false,
    });
  }

  out.push({
    id: id('rm'),
    phase: 'next',
    action: '首批 500 件 FBA 备货',
    cost: metrics ? Math.round(500 * ((input.profit?.cost || 0) + 8)) : 12000,
    note: metrics ? `按采购 $${input.profit?.cost || 0} + 头程/FBA 估算` : '成本口径待填利润假设后自动精算',
    done: false,
  });
  out.push({
    id: id('rm'),
    phase: 'next',
    action: `Listing 按「${needLabel}」的关键词矩阵上线（标题/五点/主图对齐需求）`,
    cost: 0,
    note: '把看用户的关键词与竞对未满足点直接写进 Listing，是"人无我有/人有我优"的落地点',
    done: false,
  });
  const adSpend = metrics && metrics.breakEvenAcos > 0 ? Math.round(Math.min(60, Math.max(20, metrics.breakEvenAcos * 200))) : 30;
  out.push({
    id: id('rm'),
    phase: 'next',
    action: `广告按 $${adSpend}/天 起量，验证转化是否达到准入控制点`,
    cost: adSpend * 30,
    note: metrics ? `保本 ACOS ≈ ${(metrics.breakEvenAcos * 100).toFixed(0)}%，起量预算据此反推` : '缺利润假设，按经验值 $30/天 起量',
    done: false,
  });

  return out;
}

/**
 * 前置资源清单：从四看推导（资金/供应链/合规/素材/团队/数据），
 * 对照背景库把**已知缺口**标出来（knownGap=true），不假装都有。
 */
export function buildRequiredResources(input: {
  need?: UnmetNeedCandidate | null;
  library?: CapabilityLibrary;
  profit?: ProfitAssumption | null;
  /** 项目 Evidence 条数（判断"数据资源"是否已具备） */
  evidenceCount?: number;
}): RequiredResource[] {
  const out: RequiredResource[] = [];
  const library = input.library;
  const entries = library?.entries ?? {};
  const gapOf = (key: string): boolean => {
    const e = entries[key];
    return !!e && (e.status === 'lack' || e.status === 'partial');
  };
  const labelOf = (key: string): string => CAPABILITY_ITEMS.find((i) => i.key === key)?.label ?? key;

  const metrics = profitMetrics(input.profit);
  out.push({
    id: id('res'),
    label: '打样与测评费用',
    category: 'funding',
    knownGap: gapOf('startup_capital'),
    note: gapOf('startup_capital') ? `背景库「${labelOf('startup_capital')}」未具备/仅部分具备` : '约 $2,300（打样 $1,500 + 测评 $800）',
  });
  out.push({
    id: id('res'),
    label: '首批备货资金',
    category: 'funding',
    knownGap: gapOf('startup_capital'),
    note: metrics ? `按售价 $${input.profit?.price} / 采购 $${input.profit?.cost} 估约 $${Math.round(500 * ((input.profit?.cost || 0) + 8)).toLocaleString()}` : '待利润假设确认后精算',
  });
  out.push({
    id: id('res'),
    label: '可打样的工厂与账期',
    category: 'supply',
    knownGap: gapOf('factory') || gapOf('payment_terms'),
    note: gapOf('factory') ? `背景库「${labelOf('factory')}」未具备` : '需能承接小批量 + 有账期（影响现金流）',
  });
  out.push({
    id: id('res'),
    label: '认证与合规资质',
    category: 'compliance',
    knownGap: gapOf('certification') || gapOf('category_access'),
    note: gapOf('certification') ? `背景库「${labelOf('certification')}」未具备（硬约束）` : '目标站点准入要求需在首批前拿到',
  });
  out.push({
    id: id('res'),
    label: '关键词与素材包（标题/五点/主图/A+）',
    category: 'content',
    knownGap: (input.evidenceCount ?? 0) === 0,
    note: (input.evidenceCount ?? 0) === 0 ? '项目还没有任何 Evidence：关键词与评论素材尚未沉淀' : '可直接用看用户的关键词矩阵与竞对未满足点',
  });
  out.push({
    id: id('res'),
    label: '运营与设计人手',
    category: 'team',
    knownGap: gapOf('ops') || gapOf('design'),
    note: gapOf('ops') || gapOf('design') ? `背景库「${gapOf('ops') ? labelOf('ops') : labelOf('design')}」未具备/仅部分具备` : '能做 Listing 与广告操盘',
  });
  out.push({
    id: id('res'),
    label: '需求验证数据（评论样本 / 测评结果）',
    category: 'data',
    knownGap: (input.need?.evidence?.reviewQuotes?.length ?? 0) === 0,
    note:
      (input.need?.evidence?.reviewQuotes?.length ?? 0) === 0
        ? '该需求目前只有关键词证据、没有评论原文：属于"待验证"'
        : `已有 ${input.need?.evidence?.reviewQuotes?.length} 条评论原文支撑`,
  });
  return out;
}

/**
 * 控制点（三类）：准入（满足才继续）/ 过程（监控）/ 止损（触发即撤）。
 * 数值默认从利润假设与风险推导；**confirmed 一律 false**，等用户拍板（确认是拍板动作）。
 */
export function buildControlPoints(input: {
  profit?: ProfitAssumption | null;
  risks?: RiskItem[];
}): ControlPoint[] {
  const metrics = profitMetrics(input.profit);
  const out: ControlPoint[] = [];

  out.push({
    id: id('cp'),
    kind: 'entry',
    label: '准入：转化率达到门槛才放量',
    metric: 'CVR',
    threshold: '≥8%',
    confirmed: false,
    note: '来源：品类经验门槛（可在利润假设精算后改成按保本 ACOS 反推的门槛）',
  });
  out.push({
    id: id('cp'),
    kind: 'entry',
    label: '准入：认证/合规通过',
    metric: '认证状态',
    threshold: '通过',
    confirmed: false,
    note: '合规未通过前不得备货（对应背景库合规维度）',
  });
  out.push({
    id: id('cp'),
    kind: 'process',
    label: '过程：退货率与评分',
    metric: '退货率 / 星级',
    threshold: '<3% 且 ≥4.2 星',
    confirmed: false,
    note: '退货率与评分是"需求是否真被满足"的现场指标',
  });
  out.push({
    id: id('cp'),
    kind: 'stop',
    label: '止损：广告效率',
    metric: 'ACOS',
    threshold: metrics ? `14 天 ACOS > ${Math.round(Math.max(metrics.breakEvenAcos * 1.5, 0.35) * 100)}%` : '14 天 ACOS > 35%',
    confirmed: false,
    note: metrics ? `按保本 ACOS ${(metrics.breakEvenAcos * 100).toFixed(0)}% × 1.5 推导` : '缺利润假设，按经验值 35%',
  });
  out.push({
    id: id('cp'),
    kind: 'stop',
    label: '止损：累计亏损额',
    metric: '累计亏损',
    threshold: '>$5,000',
    confirmed: false,
    note: '与"可承受亏损周期/金额"（背景库风险偏好）对齐后再确认',
  });

  // 高风险项各加一条过程控制点（从机会卡风险推导，避免风险只写不管）
  for (const r of (input.risks ?? []).filter((x) => x.severity === 'high').slice(0, 2)) {
    out.push({
      id: id('cp'),
      kind: 'process',
      label: `过程：盯住高风险项「${r.label}」`,
      metric: r.label,
      threshold: '按缓解方案验证',
      confirmed: false,
      note: r.mitigation ? `缓解方案：${r.mitigation}` : '风险未写缓解方案，需补',
    });
  }
  return out;
}

/** 组装决策包（§6.5） */
export function buildDecisionPackage(input: {
  need?: UnmetNeedCandidate | null;
  library?: CapabilityLibrary;
  profit?: ProfitAssumption | null;
  risks?: RiskItem[];
  evidenceCount?: number;
}): OpportunityDecisionPackage {
  return {
    roadmap: buildRoadmap(input),
    resources: buildRequiredResources(input),
    controlPoints: buildControlPoints(input),
  };
}

export interface PriorityItem {
  cardId: string;
  title: string;
  score: number;
  coverage: number;
  /** 排序理由（确定性生成） */
  reason: string;
}

/**
 * 全局"先做哪个机会"（§6.5 优先级）。
 * 确定性排序：评分降序 → 覆盖度降序 → 资源缺口少者优先 → 稳定按 id。
 * 理由里明确写出"为什么它排在这个位置"，并且**最终由用户拍板**（AI/系统只给建议）。
 */
export function rankOpportunities(
  cards: { id: string; title: string; score: number; coverage: number; knownResourceGaps?: number }[]
): PriorityItem[] {
  const sorted = [...cards].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.coverage !== a.coverage) return b.coverage - a.coverage;
    const ga = a.knownResourceGaps ?? 0;
    const gb = b.knownResourceGaps ?? 0;
    if (ga !== gb) return ga - gb;
    return a.id.localeCompare(b.id);
  });
  return sorted.map((c, i) => {
    const reasons: string[] = [`评分 ${c.score}（覆盖度 ${(c.coverage * 100).toFixed(0)}%）`];
    if (i > 0) {
      const first = sorted[0];
      if (c.score < first.score) reasons.push(`比第一名「${first.title}」低 ${first.score - c.score} 分`);
    } else {
      reasons.push('当前评分最高');
    }
    if ((c.knownResourceGaps ?? 0) > 0) reasons.push(`有 ${c.knownResourceGaps} 项前置资源存在已知缺口`);
    return {
      cardId: c.id,
      title: c.title,
      score: c.score,
      coverage: c.coverage,
      reason: `${reasons.join('；')}。这只是排序建议，先做哪个由你拍板。`,
    };
  });
}
