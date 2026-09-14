// 确定性函数的自动化测试（PRD 18 要求）。用 node:assert + tsx 运行：npm test
import assert from 'node:assert/strict';

import { computeSelfProgress } from '../src/utils/selfAssessment';
import { computeMarketProgress } from '../src/utils/marketLook';
import { computeUserProgress } from '../src/utils/userLook';
import { computeCompetitorProgress } from '../src/utils/competitorLook';
import { computeOpportunityProgress, scoreOpportunity } from '../src/utils/opportunityStore';
import { applyLookProgressUpdate, migrateProject } from '../src/utils/projectStore';
import { reportReuseKey, reuseKeyOf, decideReportSave, type ProjectReport } from '../src/utils/reportStore';
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
  const r = computeMarketProgress({ projectId: 'p', attractiveness: '值得进入', keyEvidences: ['a', 'b', 'c'], risks: ['r'], openQuestions: [], evidence: null, updatedAt: '' });
  assert.equal(r.status, 'completed');
  assert.equal(r.completionPercent, 100);
});

test('computeUserProgress: 5 项齐全 -> 完成 100%', () => {
  const r = computeUserProgress({
    projectId: 'p', targetUser: '侧睡人群', scenario: '睡前', jobToBeDone: '保持颈椎中立',
    satisfiedNeeds: ['基础支撑'],
    unmetNeedCandidates: [{ id: 'n1', targetUser: 'u', scenario: 's', jobToBeDone: 'j', needStatement: 'n', currentAlternative: 'c', evidenceStrength: 'high' }],
    evidence: null, updatedAt: '',
  });
  assert.equal(r.status, 'completed');
  assert.equal(r.completionPercent, 100);
});

test('computeCompetitorProgress: 4 项齐全 -> 完成 100%', () => {
  const r = computeCompetitorProgress({ projectId: 'p', samplePool: ['头部款'], benchmarkAsins: ['B0X'], barriers: '评论壁垒', needMatrix: '', gaps: ['缺侧睡设计'], evidence: null, updatedAt: '' });
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
  const card = { id: 'o1', projectId: 'p1', unmetNeedId: 'n1', decision: 'enter' as const };
  const r = computeOpportunityProgress([card] as any, project);
  assert.equal(r.status, 'completed');
  assert.equal(r.completionPercent, 100);
});

test('scoreOpportunity: 高证据+全完成 -> 100 分', () => {
  const done = makeProgress('completed', 100);
  const project = makeProject({ market: done, user: done, competitor: done, self: done });
  const userLook = {
    projectId: 'p1', targetUser: 'u', scenario: 's', jobToBeDone: 'j', satisfiedNeeds: [],
    unmetNeedCandidates: [{ id: 'n1', targetUser: 'u', scenario: 's', jobToBeDone: 'j', needStatement: 'n', currentAlternative: 'c', evidenceStrength: 'high' as const }],
    evidence: null, updatedAt: '',
  };
  const self = { projectId: 'p1', items: [{ id: 'b1', category: 'boundary' as const, label: '最低毛利', status: 'have' as const }], updatedAt: '' };
  const card = { id: 'o1', projectId: 'p1', unmetNeedId: 'n1', decision: 'enter' as const, profitAssumption: { price: 30, cost: 10, cpc: 2 } };
  const r = scoreOpportunity(card as any, project, userLook, self);
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


test('scoreOpportunity: 利润假设低毛利 -> 商业分低', () => {
  const done = makeProgress('completed', 100);
  const project = makeProject({ market: done, user: done, competitor: done, self: done });
  const userLook = {
    projectId: 'p1', targetUser: 'u', scenario: 's', jobToBeDone: 'j', satisfiedNeeds: [],
    unmetNeedCandidates: [{ id: 'n1', targetUser: 'u', scenario: 's', jobToBeDone: 'j', needStatement: 'n', currentAlternative: 'c', evidenceStrength: 'high' as const }],
    evidence: null, updatedAt: '',
  };
  const self = { projectId: 'p1', items: [], updatedAt: '' };
  const card = { id: 'o1', projectId: 'p1', unmetNeedId: 'n1', decision: 'undecided' as const, profitAssumption: { price: 30, cost: 28, cpc: 1 } };
  const r = scoreOpportunity(card as any, project, userLook, self);
  // 需求30 + 市场20 + 竞品20 + 自身15 + 商业5 = 90
  assert.equal(r.score, 90);
});

test('scoreOpportunity: 无利润假设、无边界 -> 商业分 0', () => {
  const done = makeProgress('completed', 100);
  const project = makeProject({ market: done, user: done, competitor: done, self: done });
  const userLook = {
    projectId: 'p1', targetUser: 'u', scenario: 's', jobToBeDone: 'j', satisfiedNeeds: [],
    unmetNeedCandidates: [{ id: 'n1', targetUser: 'u', scenario: 's', jobToBeDone: 'j', needStatement: 'n', currentAlternative: 'c', evidenceStrength: 'low' as const }],
    evidence: null, updatedAt: '',
  };
  const self = { projectId: 'p1', items: [], updatedAt: '' };
  const card = { id: 'o1', projectId: 'p1', unmetNeedId: 'n1', decision: 'undecided' as const };
  const r = scoreOpportunity(card as any, project, userLook, self);
  // 需求10 + 市场20 + 竞品20 + 自身15 + 商业0 = 65
  assert.equal(r.score, 65);
});

test('computeOpportunityProgress: 有卡但未决策、四看完成 -> 进行中 67%', () => {
  const done = makeProgress('completed', 100);
  const project = makeProject({ market: done, user: done, competitor: done, self: done });
  const card = { id: 'o1', projectId: 'p1', unmetNeedId: 'n1', decision: 'undecided' as const };
  const r = computeOpportunityProgress([card] as any, project);
  assert.equal(r.status, 'in_progress');
  assert.equal(r.completionPercent, 67);
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
