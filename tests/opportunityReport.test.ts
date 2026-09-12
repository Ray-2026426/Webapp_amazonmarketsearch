// M4 · Go/No-Go 汇总 + HTML 审核报告 + AI 生成合并规则测试。
// M5 · 决策包固定叙事（线框图 §8）：§1-§7 顺序、首页只放结论、§7 证据索引与口径。
import assert from 'node:assert/strict';

import { summarizeProjectDecision, PROJECT_DECISION_LABELS } from '../src/utils/projectDecision';
import {
  buildOpportunityReportHtml,
  buildOpportunityMarkdownReport,
  escapeHtml,
  type OpportunityReportInput,
} from '../src/utils/opportunityHtmlReport';
import { LISTING_FIELDS } from '../src/utils/listingFields';
import { mergeGeneratedCards } from '../src/utils/opportunityAi';
import type { OpportunityCard, ResearchProject } from '../src/types/researchProject';
import type { OpportunityConclusion } from '../src/types/opportunity';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log('  OK ' + name);
  } catch (e) {
    failed++;
    console.error('  FAIL ' + name);
    console.error('    ' + (e instanceof Error ? e.message : String(e)));
  }
}

let seq = 0;
function card(over: Partial<OpportunityCard> = {}): OpportunityCard {
  seq += 1;
  return {
    id: `o${seq}`,
    projectId: 'p1',
    unmetNeedId: `n${seq}`,
    title: `机会${seq}`,
    targetUser: '侧睡者',
    scenario: '',
    jobToBeDone: '',
    needStatement: '需要可调高度的颈椎支撑',
    currentAlternative: '',
    currentAlternativeCost: '',
    solutionHypothesis: '记忆棉 + 分区高度',
    marketEvidenceIds: [],
    userEvidenceIds: [],
    competitorEvidenceIds: [],
    selfAssessmentId: '',
    profitScenarioIds: [],
    risks: [],
    validationActions: [],
    score: 70,
    coverage: 0.8,
    decision: 'undecided',
    createdAt: '2026-09-12T00:00:00.000Z',
    updatedAt: '2026-09-12T00:00:00.000Z',
    ...over,
  };
}

const project = {
  id: 'p1',
  name: '侧睡枕项目',
  marketplace: 'US',
} as unknown as ResearchProject;

console.log('project decision summary');

test('没有任何卡也没有结论 → 还未拍板（不假装有结论）', () => {
  const d = summarizeProjectDecision({ cards: [] });
  assert.equal(d.status, 'undecided');
  assert.equal(d.headline, '还未拍板');
  assert.ok(d.nextAction.includes('生成机会卡'));
  assert.equal(PROJECT_DECISION_LABELS[d.status], '还未拍板');
});

test('零机会结论（已判断无机会）→ 无机会，并要求人工确认', () => {
  const conclusion: OpportunityConclusion = {
    kind: 'judged_none',
    blocker: 'need_satisfied',
    reason: '需求已被满足',
    confirmed: false,
    updatedAt: '2026-09-12T00:00:00.000Z',
  };
  const d = summarizeProjectDecision({ cards: [], conclusion });
  assert.equal(d.status, 'no_opportunity');
  assert.ok(d.reasons.some((r) => r.includes('尚未人工确认')));
});

test('证据不足结论 → insufficient，并把缺什么带进下一步', () => {
  const conclusion: OpportunityConclusion = {
    kind: 'insufficient_evidence',
    reason: '证据不足',
    missingData: ['看竞对满足矩阵', '看自己品类题答案'],
    confirmed: false,
    updatedAt: '2026-09-12T00:00:00.000Z',
  };
  const d = summarizeProjectDecision({ cards: [], conclusion });
  assert.equal(d.status, 'insufficient');
  assert.ok(d.nextAction.includes('看竞对满足矩阵'));
});

test('有卡但未拍板 → undecided，理由说明"系统不替你拍板"', () => {
  const d = summarizeProjectDecision({ cards: [card(), card()] });
  assert.equal(d.status, 'undecided');
  assert.equal(d.cardCount, 2);
  assert.ok(d.reasons.some((r) => r.includes('不替你拍板')));
});

test('有已确认进入的卡 → go，并指出最先做哪一个（含排序理由）', () => {
  const d = summarizeProjectDecision({
    cards: [
      card({ title: '低分机会', score: 50, decision: 'enter' }),
      card({ title: '高分机会', score: 88, decision: 'enter' }),
    ],
  });
  assert.equal(d.status, 'go');
  assert.ok(d.reasons.some((r) => r.includes('最先做「高分机会」')));
  assert.equal(d.topOpportunity?.title, '高分机会');
  assert.ok(d.nextAction.includes('0-30 天'));
});

test('硬约束否决最优先：即使有"进入"的卡，结论也只能是"验证后进入"', () => {
  const d = summarizeProjectDecision({
    cards: [card({ decision: 'enter' })],
    hardConstraint: { blocked: true, notes: ['财务「净利率红线」不具备'] },
  });
  assert.equal(d.status, 'validate_first');
  assert.equal(d.hardBlocked, true);
  assert.ok(d.reasons[0].includes('硬约束否决'));
  assert.ok(d.nextAction.includes('硬约束'));
});

test('暂缓 / 全部放弃 的汇总口径', () => {
  const hold = summarizeProjectDecision({ cards: [card({ decision: 'hold' })] });
  assert.equal(hold.status, 'hold');
  assert.ok(hold.nextAction.includes('触发条件'));
  const reject = summarizeProjectDecision({ cards: [card({ decision: 'reject' }), card({ decision: 'reject' })] });
  assert.equal(reject.status, 'reject');
  assert.ok(reject.nextAction.includes('换'));
});

test('混合决策：有"进入"就是 go，并把四类计数写进理由', () => {
  const d = summarizeProjectDecision({
    cards: [
      card({ decision: 'enter' }),
      card({ decision: 'validate_first' }),
      card({ decision: 'hold' }),
      card({ decision: 'reject' }),
    ],
  });
  assert.equal(d.status, 'go');
  assert.equal(d.decidedCount, 4);
  assert.ok(d.reasons.some((r) => r.includes('进入 1') && r.includes('验证后进入 1') && r.includes('暂缓 1') && r.includes('放弃 1')));
});

console.log('html report');

test('HTML 报告：转义危险字符，且控制点/路线图/评分拆解/证据都在（§8.1 硬规则④）', () => {
  const html = buildOpportunityReportHtml({
    project,
    cards: [
      card({
        title: '<script>alert(1)</script>',
        enterMode: 'validate_first',
        confidence: 'medium',
        evidenceRefs: [{ evidenceId: 'e1', look: 'user', sourceRef: 'review:B0ABC #12', summary: '买家抱怨高度不可调' }],
        scoreBreakdown: {
          demandStrength: 85,
          marketOpportunity: 80,
          competitorGap: 70,
          selfFit: 60,
          evidenceConfidence: 50,
          weights: { demandStrength: 25, marketOpportunity: 25, competitorGap: 25, selfFit: 15, evidenceConfidence: 10 },
          total: 72,
        },
        counterEvidence: ['侧睡人群占比可能被高估'],
        missingEvidence: ['缺少 200 条以上评论样本'],
        decisionPackage: {
          roadmap: [
            { id: 'r1', phase: 'now', action: '送检 3 家工厂打样', cost: 1500, note: '先证伪供给' },
            { id: 'r2', phase: 'next', action: '首批 500 件 FBA', cost: 12000 },
          ],
          resources: [{ id: 'rs1', label: '首批备货资金', category: 'funding', knownGap: true, note: '背景库资金未具备' }],
          controlPoints: [
            { id: 'c1', kind: 'entry', label: '准入：CVR', metric: 'CVR', threshold: '≥8%', confirmed: false },
            { id: 'c2', kind: 'stop', label: '止损：ACOS', metric: 'ACOS', threshold: '>35%', confirmed: false },
          ],
        },
      }),
    ],
    conclusion: null,
    decision: summarizeProjectDecision({ cards: [card({ decision: 'validate_first' })] }),
    fourLook: { user: '3 条未满足需求', market: '82 分细分', competitor: '3 个竞对', self: '适配度 60', hardConstraint: '未触发' },
  });
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(!html.includes('<script>alert(1)</script>'), '必须转义注入的脚本');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('执行路线图') && html.includes('送检 3 家工厂打样'));
  assert.ok(html.includes('先做（0-30 天）') && html.includes('后做（30-90 天）'));
  assert.ok(html.includes('前置资源') && html.includes('[缺口]'));
  assert.ok(html.includes('准入控制点') && html.includes('止损控制点') && html.includes('待确认'));
  assert.ok(html.includes('评分拆解') && html.includes('数据覆盖度'));
  assert.ok(html.includes('review:B0ABC #12'));
  assert.ok(html.includes('反证') && html.includes('还缺的证据'));
  assert.ok(html.includes('硬约束未通过'), '硬约束否决必须在报告里显式警示');
});

test('HTML 报告：零机会也能导出（缺数据写"未提供"，不编造）', () => {
  const html = buildOpportunityReportHtml({
    project,
    cards: [],
    conclusion: {
      kind: 'insufficient_evidence',
      reason: '证据不足',
      missingData: ['看竞对满足矩阵'],
      confirmed: false,
      updatedAt: '2026-09-12T00:00:00.000Z',
    },
    decision: summarizeProjectDecision({ cards: [] }),
    fourLook: { user: '', market: '', competitor: '', self: '', hardConstraint: '' },
  });
  assert.ok(html.includes('没有机会卡'));
  assert.ok(html.includes('未提供'));
  assert.ok(html.includes('证据不足'));
  assert.ok(html.includes('缺：看竞对满足矩阵'));
  assert.equal(escapeHtml(undefined), '');
});

console.log('merge generated cards');

test('合并：AI 返回 0 条不删除任何已有卡（沿用 phase-0 防线）', () => {
  const existing = [card({ status: 'confirmed', decision: 'enter' })];
  const r = mergeGeneratedCards(existing, []);
  assert.equal(r.next.length, 1);
  assert.equal(r.added, 0);
  assert.equal(r.next[0].decision, 'enter');
});

test('合并：已确认/已决策的卡一张都不动；同需求重复卡只补缺失的证据引用', () => {
  const existing = [
    card({ id: 'keep', unmetNeedId: 'need-1', status: 'confirmed', decision: 'enter', title: '人工确认过的卡' }),
    card({ id: 'soft', unmetNeedId: 'need-2', status: 'ai_candidate', decision: 'undecided', evidenceRefs: [{ evidenceId: 'e1', look: 'user', sourceRef: 's1', summary: 'x' }] }),
  ];
  const generated = [
    card({ unmetNeedId: 'need-1', title: 'AI 想覆盖的卡' }),
    card({ unmetNeedId: 'need-2', evidenceRefs: [{ evidenceId: 'e1', look: 'user', sourceRef: 's1', summary: 'x' }, { evidenceId: 'e2', look: 'market', sourceRef: 's2', summary: 'y' }] }),
    card({ unmetNeedId: 'need-3', title: '全新机会' }),
  ];
  const r = mergeGeneratedCards(existing, generated);
  assert.equal(r.added, 1, '只新增全新需求的机会');
  assert.equal(r.preserved, 1, '已确认的卡被保护');
  const kept = r.next.find((c) => c.id === 'keep')!;
  assert.equal(kept.title, '人工确认过的卡', '人工确认的卡不被 AI 覆盖');
  const soft = r.next.find((c) => c.id === 'soft')!;
  assert.equal(soft.evidenceRefs?.length, 2, '未确认的重复卡补齐证据引用');
});

test('Markdown 报告：与 HTML 同源同口径（决策包/控制点/评分拆解/证据都在；不做 PPT）', () => {
  const md = buildOpportunityMarkdownReport({
    project,
    cards: [
      card({
        title: '侧睡颈椎支撑枕',
        enterMode: 'validate_first',
        confidence: 'medium',
        evidenceRefs: [{ evidenceId: 'e1', look: 'user', sourceRef: 'review:B0ABC #12', summary: '买家抱怨高度不可调' }],
        scoreBreakdown: {
          demandStrength: 85,
          marketOpportunity: 80,
          competitorGap: 70,
          selfFit: 60,
          evidenceConfidence: 50,
          weights: { demandStrength: 25, marketOpportunity: 25, competitorGap: 25, selfFit: 15, evidenceConfidence: 10 },
          total: 72,
        },
        counterEvidence: ['侧睡人群占比可能被高估'],
        decisionPackage: {
          roadmap: [{ id: 'r1', phase: 'now', action: '送检 3 家工厂打样', cost: 1500 }],
          resources: [{ id: 'rs1', label: '首批备货资金', category: 'funding', knownGap: true }],
          controlPoints: [{ id: 'c1', kind: 'stop', label: '止损：ACOS', metric: 'ACOS', threshold: '>35%', confirmed: false }],
        },
      }),
    ],
    conclusion: null,
    decision: summarizeProjectDecision({ cards: [card({ decision: 'validate_first' })] }),
    fourLook: { user: '3 条未满足需求', market: '82 分细分', competitor: '3 个竞对', self: '适配度 60', hardConstraint: '未触发' },
  });
  assert.ok(md.startsWith('# '), '必须是 Markdown 标题开头');
  assert.ok(md.includes('## Go / No-Go 汇总'));
  assert.ok(md.includes('## 四看摘要') && md.includes('| 看用户 |'));
  assert.ok(md.includes('**评分拆解（确定性公式，AI 不参与）**') && md.includes('| **综合分** |'), 'MD 必须与 HTML 同口径呈现评分拆解');
  assert.ok(md.includes('review:B0ABC #12'));
  assert.ok(md.includes('**执行路线图**') && md.includes('送检 3 家工厂打样'));
  assert.ok(md.includes('**[缺口]**'));
  assert.ok(md.includes('[ ] 止损：ACOS'), '未确认的控制点用未勾选方框');
  assert.ok(md.includes('硬约束未通过'));
  assert.ok(!md.includes('<!DOCTYPE'), 'Markdown 版不应含 HTML 外壳');
});

/* ────────────── M5 · 决策包固定叙事（线框图 §8）────────────── */

/** 固定叙事：§1-§7（顺序即线框图 §8 的顺序） */
const SECTION_TITLES = ['研究目标', '用户需求', '市场细分', '竞品缺口', '自身适配', '机会结论', '证据索引与口径'];

function htmlSectionIndex(html: string, n: number): number {
  return html.indexOf(`<h2>§${n} `);
}
function mdSectionIndex(md: string, n: number): number {
  return md.indexOf(`\n## §${n} `);
}

/** 把某一节从 MD 里切出来（§n 到 §n+1；§7 切到文末） */
function mdSection(md: string, n: number): string {
  const start = mdSectionIndex(md, n);
  assert.ok(start >= 0, `MD 里找不到 §${n}`);
  const end = n < 7 ? mdSectionIndex(md, n + 1) : md.length;
  return md.slice(start, end);
}
function htmlSection(html: string, n: number): string {
  const start = htmlSectionIndex(html, n);
  assert.ok(start >= 0, `HTML 里找不到 §${n}`);
  const end = n < 7 ? htmlSectionIndex(html, n + 1) : html.length;
  return html.slice(start, end);
}

/** 四看明细齐全的输入（§1-§5 与 §7 全部有真数据；所有数字都是构造的测试数据，不是编造的业务结论） */
function fullInput(over: Partial<OpportunityReportInput> = {}): OpportunityReportInput {
  const humanCard = card({
    id: 'oA',
    title: '侧睡颈椎支撑枕',
    status: 'confirmed',
    decision: 'enter',
    enterMode: 'validate_first',
    kind: 'new_product',
    confidence: 'medium',
    evidenceRefs: [{ evidenceId: 'ev2', look: 'competitor', sourceRef: 'review:B0XYZ#34', summary: '买家抱怨高度不可调' }],
    scoreBreakdown: {
      demandStrength: 85,
      marketOpportunity: 64,
      competitorGap: 70,
      selfFit: 72,
      evidenceConfidence: 50,
      weights: { demandStrength: 25, marketOpportunity: 25, competitorGap: 25, selfFit: 15, evidenceConfidence: 10 },
      total: 70,
    },
    decisionPackage: {
      roadmap: [
        { id: 'r1', phase: 'now', action: '送检 3 家工厂打样', cost: 1500, note: '先证伪供给' },
        { id: 'r2', phase: 'next', action: '首批 500 件 FBA', cost: 12000 },
      ],
      resources: [{ id: 'rs1', label: '首批备货资金', category: 'funding', knownGap: true, note: '背景库资金未具备' }],
      controlPoints: [
        { id: 'c1', kind: 'entry', label: '准入：CVR', metric: 'CVR', threshold: '≥8%', confirmed: false },
        { id: 'c2', kind: 'process', label: '过程：退货率', metric: '退货率', threshold: '≤5%', confirmed: true },
        { id: 'c3', kind: 'stop', label: '止损：ACOS', metric: 'ACOS', threshold: '>35%', confirmed: false },
      ],
    },
  });
  const aiCard = card({ id: 'oB', title: '低价位旅行枕', status: 'ai_candidate', decision: 'hold' });
  const cards = [humanCard, aiCard];

  const richProject = {
    ...project,
    objective: '验证侧睡人群的高度可调需求',
    categories: ['枕类'],
    coreKeywords: ['side sleeper pillow'],
    seedAsins: ['B0AAA'],
    targetUsers: '侧睡者',
  } as unknown as ResearchProject;

  const userLook = {
    projectId: 'p1',
    targetUser: '侧睡者',
    scenario: '夜间睡眠',
    jobToBeDone: '起床不落枕',
    satisfiedNeeds: ['基础支撑'],
    unmetNeedCandidates: [
      {
        id: 'n1',
        category: '体感需求',
        subCategory: '高度',
        targetUser: '侧睡者',
        scenario: '夜间睡眠',
        jobToBeDone: '起床不落枕',
        needStatement: '需要可调高度的颈椎支撑',
        currentAlternative: '普通记忆棉枕',
        evidenceStrength: 'high',
        evidence: {
          keywords: [{ word: 'adjustable pillow', volume: 1200 }],
          reviewQuotes: [{ quote: 'too flat for side sleeping', asin: 'B0XYZ' }],
          asins: ['B0XYZ', 'B0ABC'],
        },
      },
      {
        id: 'n2',
        category: '价格需求',
        targetUser: '预算敏感人群',
        scenario: '',
        jobToBeDone: '',
        needStatement: '希望 30 美元以内',
        currentAlternative: '',
        evidenceStrength: 'low',
        evidence: {},
      },
    ],
    searchPath: {
      summary: '大词 → 人群词 → 卖点词 → 场景词',
      layers: [
        { layer: 'awareness', words: [{ word: 'pillow', volume: 90000, share: 0.5 }] },
        { layer: 'consideration', words: [{ word: 'side sleeper pillow', volume: 4000, share: 0.3 }] },
        { layer: 'decision', words: [{ word: 'adjustable loft pillow', volume: 900, share: 0.1 }] },
        { layer: 'scenario', words: [{ word: 'travel pillow', volume: 200, share: 0.02 }] },
      ],
    },
    evidence: null,
    updatedAt: '2026-09-01T00:00:00.000Z',
  };

  const marketLook = {
    projectId: 'p1',
    attractiveness: '82 分细分，需求在涨、竞争可控',
    keyEvidences: [],
    risks: ['低价段价格战'],
    openQuestions: [],
    segmentSchemeId: 'demand',
    chosenSegmentIds: ['demand:体感需求'],
    evidence: null,
    updatedAt: '2026-09-01T00:00:00.000Z',
  };

  const scheme = {
    id: 'demand',
    name: '方案 A · 按需求域切（与看用户直接挂钩）',
    basis: 'demand',
    description: '细分名称就是看用户里的需求域，商品按标题命中需求词归属',
    segments: [
      {
        id: 'demand:体感需求',
        name: '体感需求',
        rule: '标题命中需求词 adjustable',
        basis: 'demand',
        asins: ['B0XYZ', 'B0ABC'],
        productCount: 12,
        revenueShare: 0.42,
        demandCategories: ['体感需求'],
        demandHits: [],
        titleKeywords: [],
        score: {
          segment: '体感需求',
          trend: 70,
          volume: 65,
          competition: 55,
          opportunity: 64,
          productCount: 12,
          totalRevenue: 500000,
          avgPrice: 32,
          avgRating: 4.3,
          topAsins: ['B0XYZ'],
        },
      },
      {
        id: 'demand:价格需求',
        name: '价格需求',
        rule: '标题命中价格词 cheap',
        basis: 'demand',
        asins: ['B0DEF'],
        productCount: 6,
        revenueShare: 0.18,
        demandCategories: ['价格需求'],
        demandHits: [],
        titleKeywords: [],
        score: {
          segment: '价格需求',
          trend: 50,
          volume: 45,
          competition: 60,
          opportunity: 51,
          productCount: 6,
          totalRevenue: 200000,
          avgPrice: 22,
          avgRating: 4.1,
          topAsins: ['B0DEF'],
        },
      },
    ],
    unassigned: 3,
    coverage: 0.8,
    grounding: 0.5,
    avgOpportunity: 60,
  };

  const comparison = {
    rows: [
      {
        field: LISTING_FIELDS.find((f) => f.key === 'price')!,
        cells: [
          { asin: 'B0XYZ', value: '$32', source: 'frontend', missing: false },
          { asin: 'B0ABC', value: '$29', source: 'frontend', missing: false },
          { asin: 'B0DEF', value: '未抓取', source: 'frontend', missing: true },
        ],
        captured: 2,
      },
    ],
    coverage: { overall: 0.4, byGroup: { product: 0.4, listing: 0, traffic: 0 }, captured: 4, total: 10, missingFields: [] },
  };

  const quote = { quote: 'too flat for side sleeping', asin: 'B0XYZ', rating: 2 };

  return {
    project: richProject,
    cards,
    conclusion: null,
    decision: summarizeProjectDecision({ cards }),
    fourLook: {
      user: '2 条未满足需求（目标用户：侧睡者）',
      market: '82 分细分，需求在涨、竞争可控',
      competitor: '3 个竞对样本；缺口 1 条',
      self: '适配度 72/100',
      hardConstraint: '已否决：决策边界「最低毛利」仅部分具备',
    },
    userLook: userLook as unknown as OpportunityReportInput['userLook'],
    marketLook: marketLook as unknown as OpportunityReportInput['marketLook'],
    competitorLook: {
      projectId: 'p1',
      samplePool: ['B0XYZ', 'B0ABC', 'B0DEF'],
      benchmarkAsins: ['B0XYZ'],
      barriers: '头部品牌有结构专利',
      needMatrix: '人工矩阵：体感需求三家都不达标',
      gaps: ['可调高度缺位'],
      evidence: null,
      updatedAt: '2026-09-01T00:00:00.000Z',
    } as unknown as OpportunityReportInput['competitorLook'],
    selfLook: {
      projectId: 'p1',
      items: [
        { id: 'boundary:最低毛利', category: 'boundary', label: '最低毛利', status: 'partial' },
        { id: 'capability:供应链', category: 'capability', label: '供应链', status: 'have' },
      ],
      hardConstraintVerdict: { blocked: true, notes: ['决策边界「最低毛利」仅部分具备'], updatedAt: '2026-09-01T00:00:00.000Z' },
      updatedAt: '2026-09-01T00:00:00.000Z',
    } as unknown as OpportunityReportInput['selfLook'],
    segmentSchemes: [scheme] as unknown as OpportunityReportInput['segmentSchemes'],
    segmentContext: {
      schemeName: scheme.name,
      targets: [
        {
          id: 'demand:体感需求',
          name: '体感需求',
          opportunity: 64,
          trend: 70,
          volume: 65,
          competition: 55,
          productCount: 12,
          revenueShare: 0.42,
          demandHits: 1,
        },
      ],
      targetOpportunity: 64,
      hasTargetSegment: true,
      note: '目标细分 体感需求（收入加权机会分 64）',
    } as unknown as OpportunityReportInput['segmentContext'],
    competitorRoles: [
      { asin: 'B0XYZ', role: 'head', reason: '细分内月收入最高：$120,000' },
      { asin: 'B0ABC', role: 'follower', reason: '价格差 $2.00、紧跟头部' },
      { asin: 'B0DEF', role: 'newcomer', reason: '上架 120 天、表现最好的代表性新人' },
    ] as unknown as OpportunityReportInput['competitorRoles'],
    listingComparison: comparison as unknown as OpportunityReportInput['listingComparison'],
    painMatrices: [
      {
        asin: 'B0XYZ',
        negativeCount: 8,
        reviewCount: 40,
        negativeRate: 0.2,
        hits: [
          {
            category: 'size_fit',
            label: '尺寸/适配',
            count: 5,
            share: 0.625,
            demandCategories: ['体感需求'],
            quotes: [quote],
          },
        ],
        untouchedDemandCategories: ['价格需求'],
      },
    ] as unknown as OpportunityReportInput['painMatrices'],
    satisfactionMatrices: [
      {
        asin: 'B0XYZ',
        cells: [
          {
            needId: 'n1',
            needStatement: '需要可调高度的颈椎支撑',
            category: '体感需求',
            evidenceStrength: 'high',
            status: 'unmet',
            evidence: [{ where: 'review_negative', ...quote }],
          },
          {
            needId: 'n2',
            needStatement: '希望 30 美元以内',
            category: '价格需求',
            evidenceStrength: 'low',
            status: 'met',
            evidence: [{ where: 'review_positive', quote: 'great value for money', asin: 'B0XYZ', rating: 5 }],
          },
        ],
        met: 1,
        partial: 0,
        unmet: 1,
        unmentioned: 0,
      },
    ] as unknown as OpportunityReportInput['satisfactionMatrices'],
    personas: [
      {
        asin: 'B0XYZ',
        audience: [{ keyword: 'side sleeper', evidence: quote }],
        scenarios: [{ keyword: 'neck pain', evidence: quote }],
        demands: [{ needStatement: '需要可调高度的颈椎支撑', category: '体感需求', polarity: 'negative', evidence: quote }],
        gaps: [],
      },
    ] as unknown as OpportunityReportInput['personas'],
    winningPath: {
      path: 'unique',
      label: '人无我有',
      conclusion: '人无我有：存在三家都没做到、而我们能接住的需求（硬约束未通过：最高只能"验证后进入"）',
      checks: [
        { path: 'unique', label: '人无我有', holds: true, detail: '2 条需求三家都没满足，其中我们能接住 1 条' },
        { path: 'better', label: '人有我优', holds: false, detail: '没有"竞对都自称有、用户却在抱怨"的需求' },
        { path: 'cheaper', label: '人优我廉', holds: false, detail: '目标售价 $28 不低于竞对最低价 $29' },
      ],
      crossList: [],
      reasons: ['需求「需要可调高度的颈椎支撑」（体感需求）未被 3 家满足，我们能接住'],
      blockers: ['硬约束否决：决策边界「最低毛利」仅部分具备（最高只能"验证后进入"）'],
      canEnterDirectly: false,
    } as unknown as OpportunityReportInput['winningPath'],
    fitScore: {
      fitScore: 72,
      answered: 6,
      excluded: 2,
      backgroundCompleteness: 0.8,
      note: '相关题 6 道（排除待确认 2 道）均分 0.90 × 背景库完整度 80% = 适配度 72',
    },
    evidence: [
      { id: 'ev1', projectId: 'p1', look: 'user', type: 'keyword', sourceRef: 'kw:侧睡枕#1', summary: '侧睡枕大词月搜索 9 万', createdAt: '2026-09-01T02:00:00.000Z' },
      { id: 'ev2', projectId: 'p1', look: 'competitor', type: 'review', sourceRef: 'review:B0XYZ#34', summary: '买家抱怨高度不可调', createdAt: '2026-09-02T02:00:00.000Z' },
      { id: 'ev3', projectId: 'p1', look: 'market', type: 'chart', sourceRef: 'chart:价格带@侧睡细分', summary: '中价段收入占比最高', createdAt: '2026-09-03T02:00:00.000Z' },
    ],
    sample: { products: 42, reviews: 300, keywords: 200, competitors: 3 },
    ...over,
  };
}

console.log('决策包固定叙事（线框图 §8：§1-§7）');

test('HTML 与 MD 都含 §1-§7 七个章节，且顺序固定（两份导出同构）', () => {
  const html = buildOpportunityReportHtml(fullInput());
  const md = buildOpportunityMarkdownReport(fullInput());

  SECTION_TITLES.forEach((title, i) => {
    const n = i + 1;
    assert.ok(html.includes(`<h2>§${n} ${title}</h2>`), `HTML 缺 §${n} ${title}`);
    assert.ok(md.includes(`## §${n} ${title}`), `MD 缺 §${n} ${title}`);
  });

  let lastHtml = -1;
  let lastMd = -1;
  for (let n = 1; n <= 7; n++) {
    const hi = htmlSectionIndex(html, n);
    const mi = mdSectionIndex(md, n);
    assert.ok(hi > lastHtml, `HTML 的 §${n} 必须排在 §${n - 1} 之后`);
    assert.ok(mi > lastMd, `MD 的 §${n} 必须排在 §${n - 1} 之后`);
    lastHtml = hi;
    lastMd = mi;
  }
});

test('首页只放结论：结论块在 §1 之前，且带 Go/No-Go 一句话与三类计数', () => {
  const html = buildOpportunityReportHtml(fullInput());
  const md = buildOpportunityMarkdownReport(fullInput());

  const mdHead = md.slice(0, mdSectionIndex(md, 1));
  assert.ok(mdHead.includes('结论（Go / No-Go）'), 'MD 首页必须有结论块');
  assert.ok(mdHead.includes('机会 2 ｜ 暂缓 1 ｜ 证据 3 条'), `MD 首页必须有计数（实际：${mdHead}）`);
  assert.ok(mdHead.includes('一句话理由：'), '结论要有一句话理由');
  assert.ok(mdHead.includes('侧睡枕项目'), '首页要有项目名');
  assert.ok(mdHead.includes('站点 US'), '首页要有市场');
  assert.ok(mdHead.includes('生成时间'), '首页要有生成时间');
  assert.ok(!mdHead.includes('## §1'), '结论块里不应混进 §1 正文');

  const htmlHead = html.slice(0, htmlSectionIndex(html, 1));
  assert.ok(htmlHead.includes('结论：'), 'HTML 首页必须有结论');
  assert.ok(htmlHead.includes('机会 2 ｜ 暂缓 1 ｜ 证据 3 条'), 'HTML 首页必须有计数');
  assert.ok(htmlHead.includes('一句话理由：'), 'HTML 结论要有一句话理由');
});

test('§1 研究目标：输入（品类/关键词/ASIN）+ 目标；缺的字段写"未提供"', () => {
  const md = buildOpportunityMarkdownReport(fullInput());
  const s1 = mdSection(md, 1);
  assert.ok(s1.includes('研究目标') && s1.includes('验证侧睡人群的高度可调需求'), '§1 要写研究目标');
  assert.ok(s1.includes('核心关键词（输入）') && s1.includes('side sleeper pillow'), '§1 要写关键词输入');
  assert.ok(s1.includes('种子 ASIN（输入）') && s1.includes('B0AAA'), '§1 要写 ASIN 输入');
  assert.ok(s1.includes('四看摘要（各看一句话）') && s1.includes('| 看用户 |'), '§1 保留四看摘要（收进目标章节，不再单开一章）');

  const bare = buildOpportunityMarkdownReport({
    project: { id: 'p1', name: '空项目', marketplace: 'US' } as unknown as ResearchProject,
    cards: [],
    conclusion: null,
    decision: summarizeProjectDecision({ cards: [] }),
    fourLook: { user: '', market: '', competitor: '', self: '', hardConstraint: '' },
  });
  const bareS1 = mdSection(bare, 1);
  assert.ok(bareS1.includes('未提供'), '没有 objective/品类/关键词 时必须写"未提供"');
  assert.ok(!/研究目标\s*\|\s*\|/.test(bareS1), '缺数据不能留空单元格');
});

test('§2 用户需求：搜索路径四层（词/占比/搜索量）+ 需求分类树（每条带证据）', () => {
  const html = buildOpportunityReportHtml(fullInput());
  const md = buildOpportunityMarkdownReport(fullInput());
  const s2 = mdSection(md, 2);

  for (const layer of ['认知层', '考虑层', '决策层', '场景层']) assert.ok(s2.includes(layer), `§2 缺搜索路径层：${layer}`);
  assert.ok(s2.includes('adjustable loft pillow') && s2.includes('占比 10%') && s2.includes('月搜索量 900'), '§2 要写词/占比/搜索量');
  assert.ok(s2.includes('搜索路径结论：大词 → 人群词 → 卖点词 → 场景词'), '§2 要写搜索路径结论');

  assert.ok(s2.includes('需求分类树（需求域 → 需求，每条带证据）'), '§2 要有需求分类树');
  assert.ok(s2.includes('体感需求') && s2.includes('需要可调高度的颈椎支撑'), '§2 要写需求域 → 需求');
  assert.ok(s2.includes('adjustable pillow'), '§2 需求要挂关键词证据');
  assert.ok(s2.includes('「too flat for side sleeping」'), '§2 需求要挂评论原文');
  assert.ok(s2.includes('B0XYZ、B0ABC'), '§2 需求要挂覆盖 ASIN');
  assert.ok(s2.includes('确定性证据分'), '§2 需求要挂证据强度');
  assert.ok(htmlSection(html, 2).includes('too flat for side sleeping'), 'HTML 的 §2 也要有评论原文');
});

test('§3 市场细分：方案（谁切的、切出几个）+ 评分排行 + 目标细分', () => {
  const md = buildOpportunityMarkdownReport(fullInput());
  const s3 = mdSection(md, 3);
  assert.ok(s3.includes('细分方案（谁切的、切出几个）'), '§3 要有方案');
  assert.ok(s3.includes('方案 A · 按需求域切（与看用户直接挂钩）'), '§3 要写方案名（谁切的）');
  assert.ok(s3.includes('需求域（看用户的需求分类'), '§3 要写切法依据');
  assert.ok(s3.includes('细分评分排行'), '§3 要有评分排行');
  assert.ok(s3.includes('细分名') && s3.includes('机会分') && s3.includes('趋势') && s3.includes('体量') && s3.includes('竞争'), '§3 排行要有评分维度');
  const bodyPos = s3.indexOf('| 体感需求 | 64 |');
  const pricePos = s3.indexOf('| 价格需求 | 51 |');
  assert.ok(bodyPos > 0 && pricePos > bodyPos, '§3 排行要按机会分降序（体感需求 64 在 价格需求 51 之前）');
  assert.ok(s3.includes('目标细分（用户选定）') && s3.includes('收入加权机会分 64'), '§3 要写用户选定的目标细分');
});

test('§4 竞品缺口：三列对比摘要（缺字段写"未抓取"）+ 每竞对三块分析（●◐○—）+ 赢的路径', () => {
  const html = buildOpportunityReportHtml(fullInput());
  const md = buildOpportunityMarkdownReport(fullInput());
  const s4 = mdSection(md, 4);
  const s4html = htmlSection(html, 4);

  assert.ok(s4.includes('三列对比摘要（角色与关键字段）'), '§4 要有三列对比摘要');
  assert.ok(s4.includes('B0XYZ') && s4.includes('头部') && s4.includes('跟随者') && s4.includes('新人'), '§4 要写三个 ASIN 的角色');
  assert.ok(s4.includes('为什么选它（确定性判定依据）'), '§4 角色要带判定依据');
  assert.ok(s4.includes('未抓取'), '§4 没抓到的字段必须写"未抓取"，不能留空');
  assert.ok(!/\|\s*\|\s*\|/.test(s4), '§4 不能出现空单元格');

  assert.ok(s4.includes('每竞对三块分析（画像 / 痛点未满足矩阵 / 需求满足矩阵）'), '§4 要有每竞对三块分析');
  assert.ok(s4.includes('① 用户画像') && s4.includes('side sleeper'), '§4 要写画像（带评论原文）');
  assert.ok(s4.includes('② 痛点未满足矩阵') && s4.includes('尺寸/适配') && s4.includes('62.5%'), '§4 要写痛点矩阵');
  assert.ok(s4.includes('③ 需求满足矩阵'), '§4 要写满足矩阵');
  assert.ok(s4.includes('○ 未满足') && s4.includes('● 满足'), '§4 满足矩阵要用 ●◐○— 标记（实际用到 ● 与 ○）');
  assert.ok(s4html.includes('●') && s4html.includes('◐') && s4html.includes('—'), '四种标记在 HTML 里同样渲染（不能被转义成实体）');
  assert.ok(s4.includes('— 未提及'), '§4 满足矩阵的图例要含 —（未提及）');
  assert.ok(s4.includes('◐部分满足'), '§4 满足矩阵的计数行要含 ◐');

  assert.ok(s4.includes('赢的路径（人无我有 / 人有我优 / 人优我廉 / 无赢面）'), '§4 要有赢的路径');
  assert.ok(s4.includes('人无我有') && s4.includes('人有我优') && s4.includes('人优我廉') && s4.includes('无赢面'), '§4 赢的路径要列全四条');
  assert.ok(s4.includes('判定：人无我有'), '§4 要给赢的路径结论');
  assert.ok(s4.includes('2 条需求三家都没满足，其中我们能接住 1 条'), '§4 赢的路径要给判定依据');
  assert.ok(s4.includes('成立') && s4.includes('不成立'), '§4 赢的路径要逐条写成立与否');
  assert.ok(s4.includes('卡点'), '§4 要把卡点写出来');
  assert.ok(s4.includes('不可以（存在无赢面卡点或硬约束否决，最高只能"验证后进入"）'), '§4 要写能不能直接进入');
});

test('§5 自身适配：适配度（分数 + 口径说明）+ 硬约束（不可直接进入）', () => {
  const md = buildOpportunityMarkdownReport(fullInput());
  const s5 = mdSection(md, 5);
  assert.ok(s5.includes('适配度（分数 + 口径说明）'), '§5 要有适配度');
  assert.ok(s5.includes('72/100'), '§5 要写适配度分数');
  assert.ok(s5.includes('相关题 6 道（排除待确认 2 道）均分 0.90 × 背景库完整度 80% = 适配度 72'), '§5 要写口径算式');
  assert.ok(s5.includes('背景库完整度') && s5.includes('80%'), '§5 要写背景库完整度');

  assert.ok(s5.includes('硬约束（触发的边界 → 不可直接进入）'), '§5 要有硬约束');
  assert.ok(s5.includes('已触发硬约束否决') && s5.includes('不可直接进入'), '§5 要写"不可直接进入"结论');
  assert.ok(s5.includes('决策边界「最低毛利」仅部分具备'), '§5 要写出触发的边界项');
});

test('§6 机会结论：机会卡决策包齐全 + Go/No-Go 汇总与下一步', () => {
  const md = buildOpportunityMarkdownReport(fullInput());
  const s6 = mdSection(md, 6);
  assert.ok(s6.includes('#O1 侧睡颈椎支撑枕') && s6.includes('#O2 低价位旅行枕'), '§6 要有全部机会卡');
  assert.ok(s6.includes('评分拆解（确定性公式，AI 不参与）') && s6.includes('| **综合分** |'), '§6 要有评分拆解五维');
  assert.ok(s6.includes('review:B0XYZ#34'), '§6 要有证据引用');
  assert.ok(s6.includes('执行路线图') && s6.includes('先做（0-30 天）'), '§6 要有路线图先做/后做');
  assert.ok(s6.includes('前置资源（含已知缺口）') && s6.includes('**[缺口]**'), '§6 前置资源要标缺口');
  assert.ok(s6.includes('控制点（三类：准入 / 过程 / 止损）') && s6.includes('（待确认）'), '§6 控制点要含三类与"待确认"');
  assert.ok(s6.includes('Go / No-Go 汇总与下一步'), '§6 要有 Go/No-Go 汇总与下一步');
  assert.ok(s6.includes('下一步：'), '§6 要有下一步');
  assert.ok(s6.includes('进入 / 验证后进入 / 暂缓 / 放弃 / 未拍板'), '§6 要有四类计数');
});

test('§7 是独立的证据索引章节：全部 Evidence 编号列出 + 评分权重口径 + "未提供"约定', () => {
  const html = buildOpportunityReportHtml(fullInput());
  const md = buildOpportunityMarkdownReport(fullInput());
  const s7 = mdSection(md, 7);

  assert.ok(s7.includes('证据索引（项目全部 Evidence，按来源编号）'), '§7 要有独立证据索引章节');
  assert.ok(s7.includes('| 序号 | 哪一看 | 类型 | sourceRef | 摘要 | 时间 |'), '§7 索引要有 序号/哪一看/类型/sourceRef/摘要/时间 六列');
  assert.ok(s7.includes('#1') && s7.includes('#2') && s7.includes('#3'), '§7 索引要逐条编号');
  assert.ok(s7.includes('kw:侧睡枕#1'), '§7 要渲染 sourceRef（关键词来源）');
  assert.ok(s7.includes('review:B0XYZ#34'), '§7 要渲染 sourceRef（评论来源）');
  assert.ok(s7.includes('chart:价格带@侧睡细分'), '§7 要渲染 sourceRef（图表来源）');
  assert.ok(s7.includes('看用户') && s7.includes('看竞对') && s7.includes('看市场'), '§7 要标出每条证据属于哪一看');
  assert.ok(s7.includes('关键词') && s7.includes('评论') && s7.includes('图表'), '§7 要标出证据类型');
  assert.ok(s7.includes('2026-09-01 02:00:00'), '§7 要写证据时间');
  assert.ok(s7.includes('合计 3 条'), '§7 要写证据总量');

  assert.ok(
    s7.includes('需求强度 25 / 市场机会 25 / 竞品缺口 25 / 自身适配 15 / 证据可信度 10'),
    '§7 要写清评分公式权重'
  );
  assert.ok(s7.includes('AI 只解释、不改分'), '§7 要写"AI 只解释不改分"');
  assert.ok(s7.includes('缺数据的字段一律写"未提供"'), '§7 要写"未提供"约定');
  assert.ok(s7.includes('未抓取'), '§7 要写"未抓取"约定');
  assert.ok(s7.includes('数据覆盖度独立展示，不进 100 分'), '§7 要写覆盖度口径');
  assert.ok(htmlSection(html, 7).includes('需求强度 25 / 市场机会 25 / 竞品缺口 25 / 自身适配 15 / 证据可信度 10'), 'HTML §7 也要写权重');
});

test('§7 标明哪些结论是 AI 判断、哪些经人工确认（status=confirmed 且 decision≠undecided）', () => {
  const md = buildOpportunityMarkdownReport(fullInput());
  const s7 = mdSection(md, 7);
  assert.ok(s7.includes('经人工确认的结论（1 张卡）'), '§7 要统计人工确认的结论');
  assert.ok(s7.includes('AI 判断、尚未人工确认的结论（1 张卡）'), '§7 要统计 AI 判断的结论');
  assert.ok(s7.includes('#O1 侧睡颈椎支撑枕 ｜ 状态：已确认 ｜ 决策：进入'), '人工确认：status=confirmed + 决策≠未拍板');
  assert.ok(s7.includes('#O2 低价位旅行枕 ｜ 状态：AI 候选（待确认） ｜ 决策：暂缓'), 'AI 判断：未确认的卡要单列');
  assert.ok(s7.includes("status='confirmed' 且 decision≠'undecided'"), '§7 要写清判定口径');

  // 已确认但未拍板 → 仍算 AI 判断（人工确认必须是"确认 + 拍板"两件事都做到）
  const confirmedButUndecided = card({ id: 'oC', title: '已确认但未拍板', status: 'confirmed', decision: 'undecided' });
  const md2 = buildOpportunityMarkdownReport(
    fullInput({ cards: [confirmedButUndecided], decision: summarizeProjectDecision({ cards: [confirmedButUndecided] }) })
  );
  const s7b = mdSection(md2, 7);
  assert.ok(s7b.includes('经人工确认的结论（0 张卡）'), '已确认但未拍板不算人工确认');
  assert.ok(s7b.includes('AI 判断、尚未人工确认的结论（1 张卡）'), '已确认但未拍板要落在 AI 判断里');
});

test('缺四看数据时：§2-§5 每节都写"未提供"，不留空单元格、不编造', () => {
  const input: OpportunityReportInput = {
    project,
    cards: [card({ title: '只有卡、没有四看明细' })],
    conclusion: null,
    decision: summarizeProjectDecision({ cards: [card({ decision: 'validate_first' })] }),
    fourLook: { user: '', market: '', competitor: '', self: '', hardConstraint: '' },
  };
  const html = buildOpportunityReportHtml(input);
  const md = buildOpportunityMarkdownReport(input);

  for (const n of [2, 3, 4, 5]) {
    assert.ok(mdSection(md, n).includes('未提供'), `§${n} 缺数据必须写"未提供"`);
  }
  const s7 = mdSection(md, 7);
  assert.ok(s7.includes('未提供（项目里还没有 Evidence 记录'), '没有 Evidence 时 §7 要写"未提供"');
  assert.ok(s7.includes('经人工确认的结论（0 张卡）') && s7.includes('AI 判断、尚未人工确认的结论（1 张卡）'), '§7 仍要给出 AI/人工口径');
  assert.ok(!/\|\s*\|\s*\|/.test(md), 'MD 不应出现空单元格');
  assert.ok(!/\|\s*\|\s*\|/.test(html), 'HTML 不应出现空单元格');
  assert.ok(md.includes('赢的路径') && md.includes('未提供'), '没有竞对数据时赢的路径要显式写"未提供"（而不是假装"无赢面"）');

  // 七节仍然齐全（缺数据不能让结构塌掉）
  SECTION_TITLES.forEach((title, i) => {
    assert.ok(md.includes(`## §${i + 1} ${title}`), `缺数据时 MD 仍要有 §${i + 1} ${title}`);
  });
});

test('四看明细里的用户/AI 内容同样要转义（§2-§7 都要过 escapeHtml）', () => {
  const injected = '<script>alert(2)</script>';
  const input = fullInput({
    userLook: {
      projectId: 'p1',
      targetUser: injected,
      scenario: '',
      jobToBeDone: '',
      satisfiedNeeds: [],
      unmetNeedCandidates: [
        {
          id: 'n9',
          category: injected,
          targetUser: injected,
          scenario: '',
          jobToBeDone: '',
          needStatement: injected,
          currentAlternative: '',
          evidenceStrength: 'low',
          evidence: { keywords: [{ word: injected }], reviewQuotes: [{ quote: injected, asin: 'B0ZZZ' }], asins: ['B0ZZZ'] },
        },
      ],
      evidence: null,
      updatedAt: '2026-09-01T00:00:00.000Z',
    } as unknown as OpportunityReportInput['userLook'],
    evidence: [
      { id: 'ev9', projectId: 'p1', look: 'user', type: 'keyword', sourceRef: injected, summary: injected, createdAt: '2026-09-04T00:00:00.000Z' },
    ],
  });
  const html = buildOpportunityReportHtml(input);
  assert.ok(!html.includes(injected), '四看明细里的脚本也必须转义');
  assert.ok(html.includes('&lt;script&gt;alert(2)&lt;/script&gt;'), '转义后应能在报告里安全展示原文');
  assert.ok(htmlSection(html, 2).includes('&lt;script&gt;'), '§2 的转义不能漏');
  assert.ok(htmlSection(html, 7).includes('&lt;script&gt;'), '§7 的转义不能漏');
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
