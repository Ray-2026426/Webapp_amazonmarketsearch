// 确定性函数的自动化测试（PRD 18 要求）。用 node:assert + tsx 运行：npm test
import assert from 'node:assert/strict';

import { computeSelfProgress } from '../src/utils/selfAssessment';
import { computeMarketProgress, defaultMarketLook } from '../src/utils/marketLook';
import { computeUserProgress } from '../src/utils/userLook';
import { computeCompetitorProgress, defaultCompetitorLook } from '../src/utils/competitorLook';
import { computeOpportunityProgress, scoreOpportunity } from '../src/utils/opportunityStore';
import { applyLookProgressUpdate, migrateProject } from '../src/utils/projectStore';
import { reportReuseKey, reuseKeyOf, decideReportSave, type ProjectReport } from '../src/utils/reportStore';
import { escapeHtml } from '../src/utils/opportunityHtmlReport';
import { loadPrompts } from '../src/components/AiPromptManager';
import type { FiveLookProgress, ResearchProject } from '../src/types/researchProject';

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

function makeProgress(status: FiveLookProgress['status'], pct: number): FiveLookProgress {
  return { look: 'market', status, completionPercent: pct, completedEvidenceIds: [], missingRequirements: [], staleReasons: [] };
}

function makeProject(overrides: Partial<Record<'market' | 'user' | 'competitor' | 'self' | 'opportunity', FiveLookProgress>> = {}): ResearchProject {
  const fiveLookProgress = {
    market: overrides.market ?? makeProgress('not_started', 0),
    user: overrides.user ?? makeProgress('not_started', 0),
    competitor: overrides.competitor ?? makeProgress('not_started', 0),
    self: overrides.self ?? makeProgress('not_started', 0),
    opportunity: overrides.opportunity ?? makeProgress('not_started', 0),
  } as ResearchProject['fiveLookProgress'];
  return {
    id: 'p1', workspaceId: 'w', name: 't', marketplace: 'US', objective: 'new', ownerId: 'u', memberIds: [],
    status: 'draft', activeLook: 'market', fiveLookProgress, createdAt: '', updatedAt: '', version: 1,
  };
}

console.log('progress functions');

test('computeSelfProgress: 全部待确认 -> 未开始 0%', () => {
  const items = [
    { id: '1', category: 'objective' as const, label: 'a', status: 'unknown' as const },
    { id: '2', category: 'capability' as const, label: 'b', status: 'unknown' as const },
  ];
  const r = computeSelfProgress({ projectId: 'p', items, updatedAt: '' });
  assert.equal(r.status, 'not_started');
  assert.equal(r.completionPercent, 0);
});

test('computeSelfProgress: 全部已评 -> 完成 100%', () => {
  const items = [
    { id: '1', category: 'objective' as const, label: 'a', status: 'have' as const },
    { id: '2', category: 'capability' as const, label: 'b', status: 'lack' as const },
  ];
  const r = computeSelfProgress({ projectId: 'p', items, updatedAt: '' });
  assert.equal(r.status, 'completed');
  assert.equal(r.completionPercent, 100);
});

test('computeMarketProgress: 空 -> 未开始', () => {
  const r = computeMarketProgress({ projectId: 'p', attractiveness: '', keyEvidences: [], risks: [], openQuestions: [], evidence: null, updatedAt: '' });
  assert.equal(r.status, 'not_started');
  assert.equal(r.completionPercent, 0);
});

test('computeMarketProgress: 判断+3证据+1风险 -> 完成 100%', () => {
  const r = computeMarketProgress({ projectId: 'p', selectedNeedId: 'n1', selectedOpportunitySegment: '侧睡支撑', attractiveness: '值得进入', keyEvidences: ['a', 'b', 'c'], risks: ['r'], openQuestions: [], evidence: null, updatedAt: '' });
  assert.equal(r.status, 'completed');
  assert.equal(r.completionPercent, 100);
});

test('defaultMarketLook: 目标细分市场默认为空，兼容旧项目', () => {
  const d = defaultMarketLook('p');
  assert.equal(d.selectedOpportunitySegment, '');
  const r = computeMarketProgress({ ...d, selectedNeedId: 'n1', selectedOpportunitySegment: '高端侧睡', attractiveness: '值得进入', keyEvidences: ['a', 'b', 'c'], risks: ['r'] });
  assert.equal(r.status, 'completed');
  assert.equal(r.completionPercent, 100);
});

test('computeUserProgress: 需求结构齐全且选为细分标准 -> 完成 100%', () => {
  const r = computeUserProgress({
    projectId: 'p', targetUser: '侧睡人群', scenario: '睡前', jobToBeDone: '保持颈椎中立',
    satisfiedNeeds: ['基础支撑'],
    unmetNeedCandidates: [{ id: 'n1', targetUser: 'u', scenario: 's', jobToBeDone: 'j', needStatement: 'n', currentAlternative: 'c', evidenceStrength: 'high', category: '侧睡支撑', selectedForSegmentation: true }],
    evidence: null, updatedAt: '',
  });
  assert.equal(r.status, 'completed');
  assert.equal(r.completionPercent, 100);
});

test('computeCompetitorProgress: 三类竞对、需求矩阵、如何赢齐全 -> 完成 100%', () => {
  const r = computeCompetitorProgress({ projectId: 'p', samplePool: ['头部款'], benchmarkAsins: ['B0X'], productPowerFindings: [], operationPowerFindings: [], barriers: '评论壁垒', needMatrix: '', gaps: ['缺侧睡设计'], needSatisfactionRows: [{ needId: 'n1', needLabel: '侧睡', scores: { B0X: 3 }, notes: {} }], winningStrategy: '聚焦侧睡缝隙', evidence: null, updatedAt: '' });
  assert.equal(r.status, 'completed');
  assert.equal(r.completionPercent, 100);
});

test('computeCompetitorProgress: 产品力/运营力拆解可替代旧壁垒字段', () => {
  const d = defaultCompetitorLook('p');
  const r = computeCompetitorProgress({
    ...d,
    samplePool: ['头部', '跟随者', '新品'],
    benchmarkAsins: ['B001', 'B002'],
    productPowerFindings: ['支撑性强但闷热'],
    operationPowerFindings: ['流量集中在品牌词'],
    gaps: ['缺少夏季透气方案'],
    needSatisfactionRows: [{ needId: 'n1', needLabel: '透气', scores: { B001: 2 }, notes: {} }],
    winningStrategy: '用供应链材料能力攻击透气缝隙',
  });
  assert.equal(r.status, 'completed');
  assert.equal(r.completionPercent, 100);
});

test('computeOpportunityProgress: 无卡 -> 未开始', () => {
  const r = computeOpportunityProgress([], makeProject());
  assert.equal(r.status, 'not_started');
  assert.equal(r.completionPercent, 0);
});

test('computeOpportunityProgress: 有卡+已决策+四看完成 -> 完成 100%', () => {
  const done = makeProgress('completed', 100);
  const project = makeProject({ market: done, user: done, competitor: done, self: done });
  const card = { id: 'o1', projectId: 'p1', unmetNeedId: 'n1', decision: 'enter' as const, reviewStatus: 'confirmed' as const };
  const r = computeOpportunityProgress([card] as any, project);
  assert.equal(r.status, 'completed');
  assert.equal(r.completionPercent, 100);
});

test('scoreOpportunity: 四看绑定到该机会的证据齐全 -> 100 分', () => {
  const done = makeProgress('completed', 100);
  const project = makeProject({ market: done, user: done, competitor: done, self: done });
  const userLook = {
    projectId: 'p1', targetUser: 'u', scenario: 's', jobToBeDone: 'j', satisfiedNeeds: [],
    unmetNeedCandidates: [{ id: 'n1', targetUser: 'u', scenario: 's', jobToBeDone: 'j', needStatement: 'n', currentAlternative: 'c', evidenceStrength: 'high' as const }],
    evidence: null, updatedAt: '',
  };
  const self = { projectId: 'p1', items: Array.from({ length: 6 }, (_, index) => ({ id: `s${index}`, category: 'capability' as const, label: `能力${index}`, status: 'have' as const })), guidingQuestions: [{ id: 'q1', question: 'MOQ?', type: 'number' as const, reason: '', impactDimension: 'fit' as const, answer: '500' }, { id: 'q2', question: '预算?', type: 'number' as const, reason: '', impactDimension: 'fit' as const, answer: '10万' }], updatedAt: '' };
  const evidenceRefs = [
    { id: 'user:n1', look: 'user', sourceType: 'analysis', label: '需求', excerpt: '重复抱怨', sourceId: 'n1' },
    ...[0, 1, 2, 3].map((index) => ({ id: `market:${index}`, look: 'market', sourceType: 'segment', label: '市场', excerpt: '增长' })),
    ...[0, 1, 2].map((index) => ({ id: `competitor:gap:${index}`, look: 'competitor', sourceType: 'analysis', label: '缺口', excerpt: '未满足' })),
    { id: 'self:q1', look: 'self', sourceType: 'analysis', label: '能力', excerpt: '可承接' },
  ];
  const card = { id: 'o1', projectId: 'p1', unmetNeedId: 'n1', needStatement: 'n', scenario: 's', decision: 'enter' as const, opportunityType: 'competitor_gap', marketEvidenceIds: ['market:0', 'market:1', 'market:2', 'market:3'], competitorEvidenceIds: ['competitor:gap:0', 'competitor:gap:1', 'competitor:gap:2'], selfAssessmentId: 'q1', evidenceRefs };
  const market = { ...defaultMarketLook('p1'), selectedOpportunitySegment: 's', selectedNeedId: 'n1', keyEvidences: ['a'] };
  const competitor = { ...defaultCompetitorLook('p1'), gaps: ['n 未满足'] };
  const r = scoreOpportunity(card as any, project, userLook, self, market, competitor);
  assert.equal(r.score, 100);
  assert.equal(r.coverage, 1);
});

console.log('migration');

test('migrateProject: 非对象 -> null', () => {
  assert.equal(migrateProject(null), null);
  assert.equal(migrateProject('x'), null);
});

test('migrateProject: 最小对象补齐五看', () => {
  const p = migrateProject({ id: 'p1', name: '测试' });
  assert.ok(p);
  assert.equal(p!.name, '测试');
  assert.equal(p!.fiveLookProgress.market.status, 'not_started');
});


test('scoreOpportunity: 五看页面完成但机会未绑定证据，不得获得高分', () => {
  const done = makeProgress('completed', 100);
  const project = makeProject({ market: done, user: done, competitor: done, self: done });
  const userLook = {
    projectId: 'p1', targetUser: 'u', scenario: 's', jobToBeDone: 'j', satisfiedNeeds: [],
    unmetNeedCandidates: [{ id: 'n1', targetUser: 'u', scenario: 's', jobToBeDone: 'j', needStatement: 'n', currentAlternative: 'c', evidenceStrength: 'high' as const }],
    evidence: null, updatedAt: '',
  };
  const self = { projectId: 'p1', items: [], updatedAt: '' };
  const card = { id: 'o1', projectId: 'p1', unmetNeedId: 'n1', needStatement: 'n', scenario: 's', decision: 'undecided' as const, evidenceRefs: [], marketEvidenceIds: [], competitorEvidenceIds: [] };
  const r = scoreOpportunity(card as any, project, userLook, self);
  assert.equal(r.score, 27);
  assert.equal(r.coverage, 0.25);
});

test('scoreOpportunity: 低需求证据且无其它绑定证据 -> 仅 11 分', () => {
  const done = makeProgress('completed', 100);
  const project = makeProject({ market: done, user: done, competitor: done, self: done });
  const userLook = {
    projectId: 'p1', targetUser: 'u', scenario: 's', jobToBeDone: 'j', satisfiedNeeds: [],
    unmetNeedCandidates: [{ id: 'n1', targetUser: 'u', scenario: 's', jobToBeDone: 'j', needStatement: 'n', currentAlternative: 'c', evidenceStrength: 'low' as const }],
    evidence: null, updatedAt: '',
  };
  const self = { projectId: 'p1', items: [], updatedAt: '' };
  const card = { id: 'o1', projectId: 'p1', unmetNeedId: 'n1', needStatement: 'n', scenario: 's', decision: 'undecided' as const, evidenceRefs: [], marketEvidenceIds: [], competitorEvidenceIds: [] };
  const r = scoreOpportunity(card as any, project, userLook, self);
  assert.equal(r.score, 11);
});

test('computeOpportunityProgress: 有卡但未决策、四看完成 -> 进行中 67%', () => {
  const done = makeProgress('completed', 100);
  const project = makeProject({ market: done, user: done, competitor: done, self: done });
  const card = { id: 'o1', projectId: 'p1', unmetNeedId: 'n1', decision: 'undecided' as const };
  const r = computeOpportunityProgress([card] as any, project);
  assert.equal(r.status, 'in_progress');
  assert.equal(r.completionPercent, 67);
});

test('computeOpportunityProgress: 人工确认无机会也是合法完成结果', () => {
  const done = makeProgress('completed', 100);
  const project = makeProject({ market: done, user: done, competitor: done, self: done });
  const r = computeOpportunityProgress([], project, { resultStatus: 'no_opportunity', reasons: ['竞对已充分满足需求'], reviewed: true, updatedAt: '' });
  assert.equal(r.status, 'completed');
  assert.equal(r.completionPercent, 100);
});

test('HTML 报告转义用户输入，避免脚本注入', () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
});

test('Phase 0 四个 Prompt 预设存在且带版本标识', () => {
  const prompts = loadPrompts();
  const ids = ['self_category_questions', 'five_look_opportunity', 'opportunity_counter_review', 'opportunity_review_summary'];
  for (const id of ids) {
    const prompt = prompts.find((item) => item.id === id);
    assert.ok(prompt, `缺少 ${id}`);
    assert.equal(prompt?.version, 'phase0-v1');
  }
});

test('migrateProject: 缺失部分五看自动补齐', () => {
  const p = migrateProject({ id: 'p1', fiveLookProgress: { market: { status: 'completed', completionPercent: 100 } } });
  assert.ok(p);
  assert.equal(p!.fiveLookProgress.market.status, 'completed');
  assert.equal(p!.fiveLookProgress.user.status, 'not_started');
});

test('applyLookProgressUpdate: 来源数据更新后机会变为需复核', () => {
  const done = makeProgress('completed', 100);
  const project = makeProject({ market: done, opportunity: done });
  const result = applyLookProgressUpdate(project, 'market', {
    ...done,
    look: 'market',
    staleReasons: ['旧原因应从当前视角清除'],
  });
  assert.equal(result.fiveLookProgress.market.status, 'completed');
  assert.deepEqual(result.fiveLookProgress.market.staleReasons, []);
  assert.equal(result.fiveLookProgress.opportunity.status, 'stale');
  assert.equal(result.fiveLookProgress.opportunity.staleReasons.length, 1);
});

test('applyLookProgressUpdate: 看用户更新会链式使已开始的下游结论过期', () => {
  const done = makeProgress('completed', 100);
  const project = makeProject({ user: done, market: done, competitor: done, self: done, opportunity: done });
  const result = applyLookProgressUpdate(project, 'user', { ...done, look: 'user' });
  assert.equal(result.fiveLookProgress.market.status, 'stale');
  assert.equal(result.fiveLookProgress.competitor.status, 'stale');
  assert.equal(result.fiveLookProgress.self.status, 'stale');
  assert.equal(result.fiveLookProgress.opportunity.status, 'stale');
});

test('applyLookProgressUpdate: 上游更新不应把尚未开始的下游伪装成需复核', () => {
  const done = makeProgress('completed', 100);
  const project = makeProject({ user: done });
  const result = applyLookProgressUpdate(project, 'user', { ...done, look: 'user' });
  assert.equal(result.fiveLookProgress.market.status, 'not_started');
  assert.equal(result.fiveLookProgress.opportunity.status, 'not_started');
});

test('applyLookProgressUpdate: 待评审项目在来源变化后退回研究中', () => {
  const done = makeProgress('completed', 100);
  const project = makeProject({ user: done, opportunity: done });
  project.status = 'ready_for_review';
  const result = applyLookProgressUpdate(project, 'user', { ...done, look: 'user' });
  assert.equal(result.status, 'researching');
  assert.equal(result.fiveLookProgress.opportunity.status, 'stale');
});

test('applyLookProgressUpdate: 未开始的机会不会被无意义标记为需复核', () => {
  const project = makeProject();
  const result = applyLookProgressUpdate(project, 'self', {
    ...makeProgress('in_progress', 50),
    look: 'self',
  });
  assert.equal(result.fiveLookProgress.opportunity.status, 'not_started');
  assert.deepEqual(result.fiveLookProgress.opportunity.staleReasons, []);
});


function makeReport(over: Partial<ProjectReport> = {}): ProjectReport {
  return {
    id: 'r1', projectId: 'p1', reportType: 'market', subjectId: '', title: 't', markdown: 'm',
    dataFingerprint: 'fp1', promptVersion: 'v1', modelName: 'gpt', version: 1, isFinalized: false,
    createdAt: '', updatedAt: '', ...over,
  };
}

console.log('report store');

test('reportReuseKey: 同参数一致，prompt 版本不同则不同', () => {
  const a = reportReuseKey('p1', 'market', '', 'fp1', 'v1', 'gpt');
  const b = reportReuseKey('p1', 'market', '', 'fp1', 'v1', 'gpt');
  const c2 = reportReuseKey('p1', 'market', '', 'fp1', 'v2', 'gpt');
  assert.equal(a, b);
  assert.notEqual(a, c2);
});

test('decideReportSave: 同键未定稿 -> update', () => {
  const r = makeReport();
  const d = decideReportSave([r], reuseKeyOf(r), [r]);
  assert.equal(d.action, 'update');
});

test('decideReportSave: 同键已定稿 -> skip', () => {
  const r = makeReport({ isFinalized: true });
  const d = decideReportSave([r], reuseKeyOf(r), [r]);
  assert.equal(d.action, 'skip');
});

test('decideReportSave: 不同键 -> new + 版本递增', () => {
  const existing = [makeReport({ version: 2 }), makeReport({ id: 'r2', dataFingerprint: 'fp2', version: 1 })];
  const d = decideReportSave(existing, reportReuseKey('p1', 'market', '', 'fp3', 'v1', 'gpt'), existing);
  assert.equal(d.action, 'new');
  if (d.action === 'new') assert.equal(d.nextVersion, 3);
});

console.log('');
console.log('result: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
