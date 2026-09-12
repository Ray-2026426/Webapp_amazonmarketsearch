// M4 · 零机会结论（§6.5）+ AI 输出归一化测试。
// 核心红线：**不允许在数据支持机会时伪造零机会结论**。
import assert from 'node:assert/strict';

import { suggestConclusion, describeConclusion } from '../src/utils/opportunityConclusion';
import { normalizeOpportunityCard } from '../src/utils/opportunityStore';
import { SCORE_WEIGHTS } from '../src/utils/opportunityScoreV2';
import type { UnmetNeedCandidate } from '../src/utils/userLook';
import type { SatisfactionMatrix, SatisfactionStatus } from '../src/utils/competitorAnalysis';

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
function need(): UnmetNeedCandidate {
  seq += 1;
  return {
    id: `n${seq}`,
    targetUser: '',
    scenario: '',
    jobToBeDone: '',
    needStatement: `需求${seq}`,
    currentAlternative: '',
    evidenceStrength: 'medium',
  };
}

function matrix(statuses: SatisfactionStatus[]): SatisfactionMatrix {
  const cells = statuses.map((status, i) => ({
    needId: `n${i}`,
    needStatement: `需求${i}`,
    category: '功能需求',
    evidenceStrength: 'medium' as const,
    status,
    evidence: [],
  }));
  return {
    asin: 'B0A',
    cells,
    met: statuses.filter((s) => s === 'met').length,
    partial: statuses.filter((s) => s === 'partial').length,
    unmet: statuses.filter((s) => s === 'unmet').length,
    unmentioned: statuses.filter((s) => s === 'unmentioned').length,
  };
}

/** 数据齐全的基线（无卡点） */
function completeInput(over: Record<string, unknown> = {}) {
  return {
    needs: [need()],
    satisfaction: [matrix(['unmet', 'met'])],
    segmentOpportunity: 75,
    hasTargetSegment: true,
    fitScore: 60,
    fitAnswered: 3,
    hardConstraint: { blocked: false, notes: [] },
    profit: { price: 45, cost: 12, cpc: 1.2 },
    competitorCount: 3,
    evidenceCount: 8,
    now: '2026-09-12T00:00:00.000Z',
    ...over,
  };
}

console.log('opportunity conclusion');

test('数据不足 → insufficient_evidence，并逐条说明缺什么、怎么补', () => {
  const s = suggestConclusion({ needs: [], now: '2026-09-12T00:00:00.000Z' });
  assert.equal(s.conclusion?.kind, 'insufficient_evidence');
  assert.equal(s.conclusion?.confirmed, false, '零机会结论也要人工确认');
  assert.ok((s.conclusion?.missingData ?? []).length >= 4);
  assert.ok(s.conclusion?.missingData?.some((m) => m.includes('看用户')));
  assert.ok(s.conclusion?.missingData?.some((m) => m.includes('看竞对')));
  assert.ok(s.conclusion?.missingData?.some((m) => m.includes('看自己')));
  assert.ok(describeConclusion(s.conclusion).includes('证据不足'));
});

test('数据齐全且没有卡点 → 不产出零机会结论（禁止伪造"无机会"）', () => {
  const s = suggestConclusion(completeInput());
  assert.equal(s.conclusion, null, '有未满足 + 有缝隙 + 接得住 + 有利润 → 不能写成零机会');
  assert.ok(s.rationale.includes('不应该写成零机会'));
  assert.ok(describeConclusion(null).includes('数据支持生成机会卡'));
});

test('卡点①：需求已被满足 → judged_none / need_satisfied', () => {
  const s = suggestConclusion(completeInput({ satisfaction: [matrix(['met', 'met'])] }));
  assert.equal(s.conclusion?.kind, 'judged_none');
  assert.ok(s.conclusion?.reason.includes('需求已被满足'));
  assert.ok(s.conclusion?.reason.includes('明确满足'));
});

test('卡点②：所有格子都是"未提及" → no_gap（没有可对标落点）', () => {
  const s = suggestConclusion(completeInput({ satisfaction: [matrix(['unmentioned', 'unmentioned'])] }));
  assert.ok(s.conclusion?.reason.includes('竞争没有缝隙'));
});

test('卡点③：硬约束否决 → cannot_deliver，且理由里带具体边界', () => {
  const s = suggestConclusion(
    completeInput({ hardConstraint: { blocked: true, notes: ['财务「净利率红线」不具备（做不到 25%）'] } })
  );
  assert.ok(s.conclusion?.reason.includes('自身接不住'));
  assert.ok(s.conclusion?.reason.includes('净利率红线'));
});

test('卡点③变体：适配度过低（<30）也算接不住', () => {
  const s = suggestConclusion(completeInput({ fitScore: 20, fitAnswered: 3 }));
  assert.ok(s.conclusion?.reason.includes('自身接不住'));
  assert.ok(s.conclusion?.reason.includes('20/100'));
});

test('卡点④：利润为负 → no_profit，并写出算式', () => {
  const s = suggestConclusion(completeInput({ profit: { price: 20, cost: 18, cpc: 4 } }));
  assert.ok(s.conclusion?.reason.includes('利润不成立'));
  assert.ok(s.conclusion?.reason.includes('-2.00'), `应写出单位利润，实际：${s.conclusion?.reason}`);
});

test('竞对不足 3 个 → 算证据不足（口径是 3 个）', () => {
  const s = suggestConclusion(completeInput({ competitorCount: 2 }));
  assert.equal(s.conclusion?.kind, 'insufficient_evidence');
  assert.ok(s.conclusion?.missingData?.some((m) => m.includes('只有 2 个')));
});

console.log('normalize AI opportunity card');

test('归一化：AI 给的评分与确认状态一律不采信（评分归零、控制点未确认）', () => {
  const card = normalizeOpportunityCard(
    {
      title: 'AI 候选机会',
      needStatement: '侧睡需要可调高度',
      score: 99,
      coverage: 1,
      decision: 'enter',
      status: 'confirmed',
      scoreBreakdown: { demandStrength: 100, marketOpportunity: 100, competitorGap: 100, selfFit: 100, evidenceConfidence: 100, total: 100 },
      decisionPackage: {
        roadmap: [{ phase: 'now', action: '打样', cost: 1500 }],
        resources: [{ label: '打样费', category: 'funding' }],
        controlPoints: [{ kind: 'stop', label: '止损', metric: 'ACOS', threshold: '>35%', confirmed: true }],
      },
    },
    'p1'
  )!;
  assert.ok(card, '有标题的卡应保留');
  assert.equal(card.score, 0, 'AI 给的 99 分不能采信');
  assert.equal(card.coverage, 0, '覆盖度由确定性公式算');
  assert.equal(card.status, 'ai_candidate', 'AI 不能自称已确认');
  assert.equal(card.decision, 'undecided', 'AI 不能替用户拍板（决策回到 undecided）');
  assert.equal(card.scoreBreakdown?.total, 0);
  assert.deepEqual(card.scoreBreakdown?.weights, SCORE_WEIGHTS, '权重固定为 25/25/25/15/10');
  assert.equal(card.decisionPackage?.controlPoints[0].confirmed, false, '控制点必须由用户确认');
  assert.equal(card.decisionPackage?.roadmap[0].phase, 'now');
});

test('归一化：脏数据被清洗（非法枚举退回安全默认、空动作/空标签丢弃）', () => {
  const card = normalizeOpportunityCard(
    {
      title: 'X',
      decision: 'bogus',
      status: 'bogus',
      kind: 'bogus',
      confidence: 'bogus',
      evidenceRefs: [{ evidenceId: 'e1', look: 'user', sourceRef: 'review:B0 #1', summary: 's' }, { summary: '' }],
      decisionPackage: {
        roadmap: [{ phase: 'nowhere', action: '' }, { phase: 'next', action: '备货' }],
        resources: [{ label: '' }],
        controlPoints: [{ kind: 'bogus', label: '阈值', metric: 'm', threshold: 't' }],
      },
    },
    'p1'
  )!;
  assert.equal(card.decision, 'undecided');
  assert.equal(card.status, 'ai_candidate');
  assert.equal(card.kind, 'new_product');
  assert.equal(card.confidence, 'low');
  assert.equal(card.evidenceRefs?.length, 1, '空引用被丢弃');
  assert.equal(card.decisionPackage?.roadmap.length, 1, '空动作被丢弃');
  assert.equal(card.decisionPackage?.roadmap[0].phase, 'next');
  assert.equal(card.decisionPackage?.resources.length ?? 0, 0, '空标签丢弃后 resources 为空数组（类型一致，不留半成品）');
  assert.equal(card.decisionPackage?.controlPoints?.length ?? 0, 1, '有标签的控制点保留');
  assert.equal(card.decisionPackage?.controlPoints?.[0].kind, 'process', '非法 kind 退回安全默认 process');
  assert.equal(card.decisionPackage?.controlPoints?.[0].confirmed, false, '保留的控制点也必须未确认');
});

test('归一化：连标题都没有的卡片直接丢弃（不产生空机会）', () => {
  assert.equal(normalizeOpportunityCard({ score: 90 }, 'p1'), null);
  assert.equal(normalizeOpportunityCard(null, 'p1'), null);
  assert.equal(normalizeOpportunityCard('text', 'p1'), null);
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
