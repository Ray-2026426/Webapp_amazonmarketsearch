// M4 · Go/No-Go 汇总 + HTML 审核报告 + AI 生成合并规则测试。
import assert from 'node:assert/strict';

import { summarizeProjectDecision, PROJECT_DECISION_LABELS } from '../src/utils/projectDecision';
import { buildOpportunityReportHtml, buildOpportunityMarkdownReport, escapeHtml } from '../src/utils/opportunityHtmlReport';
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

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
