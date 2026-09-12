// M4 · 机会卡评分（§8.1 五维换血）+ 决策包（§6.5）测试。
import assert from 'node:assert/strict';

import {
  scoreOpportunityV2,
  describeScoreV2,
  SCORE_WEIGHTS,
} from '../src/utils/opportunityScoreV2';
import {
  buildDecisionPackage,
  buildRoadmap,
  buildRequiredResources,
  buildControlPoints,
  rankOpportunities,
  profitMetrics,
} from '../src/utils/opportunityPlan';
import { setCapabilityEntry, defaultCapabilityLibrary } from '../src/utils/capabilityLibrary';
import type { UnmetNeedCandidate } from '../src/utils/userLook';
import type { Evidence } from '../src/utils/evidence';
import type { SatisfactionMatrix } from '../src/utils/competitorAnalysis';

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
function need(over: Partial<UnmetNeedCandidate> = {}): UnmetNeedCandidate {
  seq += 1;
  return {
    id: `n${seq}`,
    targetUser: '',
    scenario: '',
    jobToBeDone: '',
    needStatement: '侧睡需要可调高度的颈椎支撑',
    currentAlternative: '',
    evidenceStrength: 'medium',
    ...over,
  };
}

function evidence(over: Partial<Evidence> = {}): Evidence {
  seq += 1;
  return {
    id: `e${seq}`,
    projectId: 'p1',
    look: 'user',
    type: 'review',
    sourceRef: `review:B0TEST${seq} #${seq}`,
    summary: '摘要',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

function satisfaction(unmet: number, partial: number, met: number): SatisfactionMatrix {
  const cells = [
    ...Array.from({ length: unmet }, (_, i) => ({
      needId: `u${i}`,
      needStatement: `未满足${i}`,
      category: '功能需求',
      evidenceStrength: 'high' as const,
      status: 'unmet' as const,
      evidence: [{ where: 'review_negative' as const, quote: 'q', asin: 'B0A' }],
    })),
    ...Array.from({ length: partial }, (_, i) => ({
      needId: `p${i}`,
      needStatement: `部分${i}`,
      category: '功能需求',
      evidenceStrength: 'medium' as const,
      status: 'partial' as const,
      evidence: [{ where: 'title' as const, quote: 't', asin: 'B0A' }],
    })),
    ...Array.from({ length: met }, (_, i) => ({
      needId: `m${i}`,
      needStatement: `满足${i}`,
      category: '功能需求',
      evidenceStrength: 'low' as const,
      status: 'met' as const,
      evidence: [],
    })),
  ];
  return { asin: 'B0A', cells, met, partial, unmet, unmentioned: 0 };
}

console.log('opportunity score v2');

test('五维权重就是 PRD §8.1 的 25/25/25/15/10，且合计 100', () => {
  assert.deepEqual(SCORE_WEIGHTS, { demandStrength: 25, marketOpportunity: 25, competitorGap: 25, selfFit: 15, evidenceConfidence: 10 });
  assert.equal(Object.values(SCORE_WEIGHTS).reduce((s, v) => s + v, 0), 100);
});

test('全维度齐全时：按权重加权，且不依赖任何"完成度"输入', () => {
  const s = scoreOpportunityV2({
    need: need({ evidence: { keywords: [{ word: 'adjustable' }, { word: 'cervical' }], reviewQuotes: [{ quote: 'q1' }, { quote: 'q2' }], asins: ['B0A', 'B0B', 'B0C'] } }),
    segmentOpportunity: 82,
    hasTargetSegment: true,
    satisfaction: [satisfaction(3, 1, 1)],
    pain: [{ asin: 'B0A', negativeCount: 2, reviewCount: 10, negativeRate: 0.2, hits: [{ category: 'quality', label: '质量/做工', count: 2, share: 1, demandCategories: ['功能需求'], quotes: [] }], untouchedDemandCategories: [] }],
    fitScore: 60,
    fitAnswered: 3,
    evidence: Array.from({ length: 10 }, () => evidence()),
    now: '2026-09-02T00:00:00.000Z',
  });
  assert.equal(s.ratios.demandStrength, 0.85, '需求证据分 85 → 0.85');
  assert.equal(s.ratios.marketOpportunity, 0.82);
  assert.equal(s.ratios.selfFit, 0.6);
  assert.deepEqual(s.missing, []);
  assert.equal(s.coverage, 1);
  const expected = Math.round((0.85 * 25 + 0.82 * 25 + s.ratios.competitorGap * 25 + 0.6 * 15 + s.ratios.evidenceConfidence * 10));
  assert.equal(s.total, expected);
  assert.ok(s.notes.some((n) => n.includes('需求强度')));
  assert.ok(describeScoreV2(s).includes('评分'));
});

test('缺项从分母移除：只有需求+市场时不会因为缺项而虚低', () => {
  const s = scoreOpportunityV2({
    need: need({ evidence: { keywords: [{ word: 'a' }, { word: 'b' }, { word: 'c' }] } }),
    segmentOpportunity: 80,
    hasTargetSegment: true,
    evidence: [evidence()],
    now: '2026-09-02T00:00:00.000Z',
  });
  assert.deepEqual(s.missing.sort(), ['competitorGap', 'selfFit'].sort());
  assert.equal(s.coverage, 0.6, '(25+25+10)/100');
  // 分母只算可用维度：需求 36/100 × 25 + 市场 80 × 25 + 证据可信度
  const expected = Math.round((s.ratios.demandStrength * 25 + 0.8 * 25 + s.ratios.evidenceConfidence * 10) * (100 / 60));
  assert.equal(s.total, expected);
  assert.ok(s.notes.some((n) => n.includes('覆盖度 60%')));
});

test('未选目标细分 → 市场机会按全市场分 ×0.6（§8.1）', () => {
  const withSeg = scoreOpportunityV2({ need: need(), segmentOpportunity: 100, hasTargetSegment: true, evidence: [] });
  const noSeg = scoreOpportunityV2({ need: need(), segmentOpportunity: 100, hasTargetSegment: false, evidence: [] });
  assert.equal(withSeg.ratios.marketOpportunity, 1);
  assert.equal(noSeg.ratios.marketOpportunity, 0.6);
  assert.ok(noSeg.notes.some((n) => n.includes('× 0.6')));
});

test('竞品缺口：未满足占比越高分越高；没有矩阵时算缺项', () => {
  const high = scoreOpportunityV2({ need: need(), satisfaction: [satisfaction(4, 0, 0)], evidence: [] });
  const low = scoreOpportunityV2({ need: need(), satisfaction: [satisfaction(0, 0, 4)], evidence: [] });
  assert.ok(high.ratios.competitorGap > low.ratios.competitorGap);
  const none = scoreOpportunityV2({ need: need(), evidence: [] });
  assert.ok(none.missing.includes('competitorGap'));
});

test('自身适配：没有可计入的题（fitAnswered=0）就是缺项，不当作"能"', () => {
  const s = scoreOpportunityV2({ need: need(), fitScore: 100, fitAnswered: 0, evidence: [] });
  assert.ok(s.missing.includes('selfFit'));
  assert.equal(s.ratios.selfFit, undefined);
});

test('证据可信度：条数/来源多样性/时效三者决定，且全无证据时为 0', () => {
  const none = scoreOpportunityV2({ need: need(), evidence: [], now: '2026-09-02T00:00:00.000Z' });
  assert.equal(none.ratios.evidenceConfidence, 0);
  const rich = scoreOpportunityV2({
    need: need(),
    evidence: [
      evidence({ look: 'user' }),
      evidence({ look: 'market' }),
      evidence({ look: 'competitor' }),
      evidence({ look: 'self' }),
    ],
    now: '2026-09-02T00:00:00.000Z',
  });
  assert.ok(rich.ratios.evidenceConfidence > none.ratios.evidenceConfidence);
  assert.equal(rich.evidenceSources, 4);
});

test('评分与"页面完成度"无关：同样的证据，换个时间/换个项目结果一致', () => {
  const input = {
    need: need({ evidence: { keywords: [{ word: 'x' }] } }),
    segmentOpportunity: 70,
    hasTargetSegment: true,
    satisfaction: [satisfaction(2, 1, 1)],
    fitScore: 50,
    fitAnswered: 2,
    evidence: [evidence()],
    now: '2026-09-02T00:00:00.000Z',
  };
  assert.equal(scoreOpportunityV2(input).total, scoreOpportunityV2({ ...input }).total);
});

console.log('opportunity plan');

test('利润假设：毛利率/单位利润/保本 ACOS 是确定性推导，缺价格则返回 null', () => {
  const m = profitMetrics({ price: 45, cost: 12, cpc: 1.2 })!;
  assert.equal(m.unitProfit, 31.8);
  assert.equal(Math.round(m.margin * 100), 71);
  assert.equal(profitMetrics(null), null);
  assert.equal(profitMetrics({ price: 0, cost: 1, cpc: 1 }), null);
});

test('路线图：两段式（先做 0-30 天 / 后做 30-90 天），打样与测评排在最前', () => {
  const rm = buildRoadmap({ need: need() });
  const now = rm.filter((a) => a.phase === 'now');
  const next = rm.filter((a) => a.phase === 'next');
  assert.ok(now.length >= 3 && next.length >= 3);
  assert.ok(now[0].action.includes('打样'), `先做第一步应是打样，实际：${now[0].action}`);
  assert.ok(now.some((a) => a.action.includes('测评')));
  assert.ok(next.some((a) => a.action.includes('FBA')));
  assert.ok(next.some((a) => a.action.includes('Listing')));
  for (const a of rm) assert.ok(a.note && a.note.length > 5, `${a.action} 必须带说明`);
});

test('路线图：背景库有硬约束时，第一步先解决硬约束而不是往前冲', () => {
  let lib = defaultCapabilityLibrary();
  lib = setCapabilityEntry(lib, 'certification', 'lack');
  const rm = buildRoadmap({ need: need(), library: lib });
  assert.ok(rm[0].phase === 'now' && rm[0].action.includes('硬约束'), `第一步应为硬约束，实际：${rm[0].action}`);
  assert.ok(rm[0].note?.includes('不能直接进入'));
  // 已经有硬约束在前，就不该重复排"认证预沟通"
  assert.ok(!rm.some((a) => a.action.includes('认证预沟通')));
});

test('前置资源：对照背景库标出已知缺口（缺的不能假装有）', () => {
  let lib = defaultCapabilityLibrary();
  lib = setCapabilityEntry(lib, 'factory', 'lack');
  lib = setCapabilityEntry(lib, 'certification', 'partial');
  const res = buildRequiredResources({ need: need(), library: lib, evidenceCount: 0 });
  const factory = res.find((r) => r.category === 'supply')!;
  assert.equal(factory.knownGap, true);
  assert.ok(factory.note?.includes('工厂'));
  const cert = res.find((r) => r.category === 'compliance')!;
  assert.equal(cert.knownGap, true);
  const content = res.find((r) => r.category === 'content')!;
  assert.equal(content.knownGap, true, '没有任何 Evidence → 素材数据资源存在缺口');
  // 需求缺评论原文 → 数据资源标缺口
  const data = res.find((r) => r.category === 'data')!;
  assert.equal(data.knownGap, true);
});

test('控制点：三类齐全，阈值从利润假设推导，且一律待用户确认', () => {
  const cps = buildControlPoints({ profit: { price: 45, cost: 12, cpc: 1.2 } });
  assert.ok(cps.some((c) => c.kind === 'entry'));
  assert.ok(cps.some((c) => c.kind === 'process'));
  assert.ok(cps.some((c) => c.kind === 'stop'));
  for (const c of cps) {
    assert.equal(c.confirmed, false, '默认必须待确认（确认是拍板动作）');
    assert.ok(c.metric && c.threshold, `${c.label} 必须有度量与阈值`);
  }
  const stopAcos = cps.find((c) => c.metric === 'ACOS')!;
  assert.ok(stopAcos.threshold.includes('106'), `按保本 71% × 1.5 推导，实际：${stopAcos.threshold}`);
  assert.ok(stopAcos.note?.includes('保本 ACOS'));
});

test('控制点：没有利润假设时用经验值并说明；高风险项额外加过程控制点', () => {
  const cps = buildControlPoints({
    risks: [{ id: 'r1', category: 'demand', label: '侧睡人群占比存疑', description: '', severity: 'high', mitigation: '测评验证' }],
  });
  const acos = cps.find((c) => c.metric === 'ACOS')!;
  assert.equal(acos.threshold, '14 天 ACOS > 35%');
  assert.ok(acos.note?.includes('经验值'));
  assert.ok(cps.some((c) => c.label.includes('侧睡人群占比存疑')));
});

test('决策包组装：路线图 + 资源 + 控制点都在，且都能编辑（带稳定 id）', () => {
  const p = buildDecisionPackage({ need: need(), profit: { price: 45, cost: 12, cpc: 1.2 } });
  assert.ok(p.roadmap.length >= 6);
  assert.ok(p.resources.length >= 6);
  assert.ok(p.controlPoints.length >= 5);
  assert.equal(new Set(p.roadmap.map((r) => r.id)).size, p.roadmap.length, 'id 必须唯一（编辑要用）');
});

test('优先级排序：评分 → 覆盖度 → 资源缺口少者优先，并给排序理由与"你拍板"', () => {
  const ranked = rankOpportunities([
    { id: 'o2', title: 'B 机会', score: 70, coverage: 0.8, knownResourceGaps: 0 },
    { id: 'o1', title: 'A 机会', score: 70, coverage: 0.8, knownResourceGaps: 2 },
    { id: 'o3', title: 'C 机会', score: 80, coverage: 0.5, knownResourceGaps: 0 },
  ]);
  assert.deepEqual(ranked.map((r) => r.cardId), ['o3', 'o2', 'o1']);
  assert.ok(ranked[0].reason.includes('当前评分最高'));
  assert.ok(ranked[2].reason.includes('已知缺口'));
  for (const r of ranked) assert.ok(r.reason.includes('由你拍板'), '排序只是建议');
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
