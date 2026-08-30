import { generateText, loadAiSettings } from './aiConfig';
import { getPrompt } from '../components/AiPromptManager';
import { buildUserBackgroundSystemPrompt, loadUserBackground } from './userBackground';
import { loadUserLook, type UserLookData } from './userLook';
import { loadMarketLook, type MarketLookData } from './marketLook';
import { loadCompetitorLook, type CompetitorLookData } from './competitorLook';
import { loadSelfAssessment, type SelfAssessment, type SelfGuidingQuestion } from './selfAssessment';
import { createOpportunityId, normalizeOpportunityCard } from './opportunityStore';
import { tryParseJson } from './lookAi';
import type {
  OpportunityCard,
  OpportunityConfidence,
  OpportunityEvidenceRef,
  OpportunityReasoningStep,
  OpportunityScoreBreakdown,
  OpportunityType,
  ResearchProject,
} from '../types/researchProject';

export interface OpportunityAiResult {
  resultStatus: 'opportunities' | 'no_opportunity' | 'insufficient_evidence';
  reasons: string[];
  cards: OpportunityCard[];
}

interface RawOpportunity {
  title?: string;
  opportunityType?: OpportunityType;
  targetUser?: string;
  scenario?: string;
  jobToBeDone?: string;
  needStatement?: string;
  currentAlternative?: string;
  solutionHypothesis?: string;
  unmetNeedId?: string;
  marketEvidenceIds?: string[];
  userEvidenceIds?: string[];
  competitorEvidenceIds?: string[];
  selfAssessmentId?: string;
  scoreBreakdown?: Partial<OpportunityScoreBreakdown>;
  coverage?: number;
  confidence?: OpportunityConfidence;
  risks?: string[];
  counterEvidence?: string[];
  missingEvidence?: string[];
  reasoning?: OpportunityReasoningStep[];
}

const safeStrings = (value: unknown): string[] => Array.isArray(value)
  ? value.map((item) => String(item || '').trim()).filter(Boolean)
  : [];

const clamp = (value: unknown, min: number, max: number): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, Math.round(numeric))) : min;
};

function evidenceCatalog(
  user: UserLookData,
  market: MarketLookData,
  competitor: CompetitorLookData,
  self: SelfAssessment
): OpportunityEvidenceRef[] {
  const refs: OpportunityEvidenceRef[] = [];
  for (const need of user.unmetNeedCandidates) {
    refs.push({
      id: `user:${need.id}`,
      look: 'user',
      sourceType: 'analysis',
      label: need.category || need.needStatement || '未满足需求',
      excerpt: [need.targetUser, need.scenario, need.jobToBeDone, need.unmetPart || need.needStatement, need.currentAlternative]
        .filter(Boolean)
        .join('｜'),
      sourceId: need.id,
    });
    for (const [index, note] of (need.evidenceNotes ?? []).entries()) {
      refs.push({ id: `user:${need.id}:${index}`, look: 'user', sourceType: 'analysis', label: `${need.category || '需求'}证据`, excerpt: note, sourceId: need.id });
    }
  }
  for (const [index, excerpt] of market.keyEvidences.entries()) {
    refs.push({ id: `market:${index}`, look: 'market', sourceType: 'segment', label: market.selectedOpportunitySegment || '市场证据', excerpt });
  }
  for (const [index, excerpt] of competitor.productPowerFindings.entries()) {
    refs.push({ id: `competitor:product:${index}`, look: 'competitor', sourceType: 'asin', label: '竞对产品力', excerpt });
  }
  for (const [index, excerpt] of competitor.operationPowerFindings.entries()) {
    refs.push({ id: `competitor:operation:${index}`, look: 'competitor', sourceType: 'asin', label: '竞对运营力', excerpt });
  }
  for (const [index, excerpt] of competitor.gaps.entries()) {
    refs.push({ id: `competitor:gap:${index}`, look: 'competitor', sourceType: 'analysis', label: '竞对未满足缺口', excerpt });
  }
  if (self.accountBackgroundSnapshot?.trim()) {
    refs.push({ id: 'self:profile', look: 'self', sourceType: 'profile', label: '账号背景', excerpt: self.accountBackgroundSnapshot.trim() });
  }
  for (const question of self.guidingQuestions ?? []) {
    if (!question.answer.trim()) continue;
    refs.push({ id: `self:${question.id}`, look: 'self', sourceType: 'analysis', label: question.question, excerpt: question.answer, sourceId: question.id });
  }
  return refs;
}

function normalizeBreakdown(value?: Partial<OpportunityScoreBreakdown>): OpportunityScoreBreakdown {
  return {
    demandStrength: clamp(value?.demandStrength, 0, 25),
    marketOpportunity: clamp(value?.marketOpportunity, 0, 25),
    competitorGap: clamp(value?.competitorGap, 0, 25),
    selfFit: clamp(value?.selfFit, 0, 15),
    evidenceConfidence: clamp(value?.evidenceConfidence, 0, 10),
  };
}

function cardFromRaw(project: ResearchProject, raw: RawOpportunity, refs: OpportunityEvidenceRef[]): OpportunityCard {
  const now = new Date().toISOString();
  const breakdown = normalizeBreakdown(raw.scoreBreakdown);
  const wantedIds = new Set([
    ...safeStrings(raw.userEvidenceIds),
    ...safeStrings(raw.marketEvidenceIds),
    ...safeStrings(raw.competitorEvidenceIds),
    ...(raw.selfAssessmentId ? [String(raw.selfAssessmentId)] : []),
  ]);
  const boundRefs = refs.filter((ref) => wantedIds.has(ref.id) || wantedIds.has(ref.sourceId || ''));
  const inferredNeedId = raw.unmetNeedId
    || boundRefs.find((ref) => ref.look === 'user')?.sourceId
    || '';
  const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  return normalizeOpportunityCard({
    id: createOpportunityId(),
    projectId: project.id,
    unmetNeedId: inferredNeedId,
    title: String(raw.title || raw.needStatement || '未命名候选机会').trim(),
    targetUser: String(raw.targetUser || '').trim(),
    scenario: String(raw.scenario || '').trim(),
    jobToBeDone: String(raw.jobToBeDone || '').trim(),
    needStatement: String(raw.needStatement || '').trim(),
    currentAlternative: String(raw.currentAlternative || '').trim(),
    currentAlternativeCost: '',
    solutionHypothesis: String(raw.solutionHypothesis || '').trim(),
    marketEvidenceIds: safeStrings(raw.marketEvidenceIds),
    userEvidenceIds: safeStrings(raw.userEvidenceIds),
    competitorEvidenceIds: safeStrings(raw.competitorEvidenceIds),
    selfAssessmentId: String(raw.selfAssessmentId || '').trim(),
    profitScenarioIds: [],
    risks: safeStrings(raw.risks).map((label, index) => ({ id: `ai-risk-${index}`, category: 'product', label, description: label, severity: 'medium' })),
    validationActions: [],
    opportunityType: raw.opportunityType === 'market_growth' ? 'market_growth' : 'competitor_gap',
    reviewStatus: 'ai_candidate',
    confidence: raw.confidence === 'high' || raw.confidence === 'medium' ? raw.confidence : 'low',
    scoreBreakdown: breakdown,
    evidenceRefs: boundRefs,
    reasoning: Array.isArray(raw.reasoning) ? raw.reasoning.map((step) => ({
      evidenceIds: safeStrings(step?.evidenceIds),
      judgement: String(step?.judgement || '').trim(),
      conclusion: String(step?.conclusion || '').trim(),
    })).filter((step) => step.judgement || step.conclusion) : [],
    counterEvidence: safeStrings(raw.counterEvidence),
    missingEvidence: safeStrings(raw.missingEvidence),
    aiOriginalSnapshot: JSON.stringify(raw),
    humanEdits: [],
    score,
    coverage: Math.max(0, Math.min(1, Number(raw.coverage) || boundRefs.length / Math.max(1, refs.length))),
    decision: 'undecided',
    createdAt: now,
    updatedAt: now,
  }, project.id);
}

function systemPrompt(): string {
  const background = buildUserBackgroundSystemPrompt(loadUserBackground());
  return `你只基于输入证据工作，不得虚构数据。所有结论必须引用 evidenceCatalog 中存在的 ID。允许输出零个机会。只返回可被 JSON.parse 解析的 JSON。${background ? `\n\n${background}` : ''}`;
}

export async function generateOpportunityCandidates(userId: string, project: ResearchProject): Promise<OpportunityAiResult> {
  const settings = loadAiSettings();
  if (!settings?.apiKey) throw new Error('尚未配置 AI 模型 Key，请先到“设置 → API 与模型”填写。');
  const [user, market, competitor, self] = await Promise.all([
    loadUserLook(userId, project.id),
    loadMarketLook(userId, project.id),
    loadCompetitorLook(userId, project.id),
    loadSelfAssessment(userId, project.id),
  ]);
  const refs = evidenceCatalog(user, market, competitor, self);
  const context = {
    project: { id: project.id, objective: project.objective, marketplace: project.marketplace },
    user,
    market,
    competitor,
    self: {
      accountBackgroundSnapshot: self.accountBackgroundSnapshot,
      answers: (self.guidingQuestions ?? []).filter((question) => question.answer.trim()),
      aiSummary: self.aiSummary,
    },
    evidenceCatalog: refs,
  };
  const raw = await generateText(`${getPrompt('five_look_opportunity')}\n\n输入数据：\n${JSON.stringify(context)}`, settings, { jsonMode: true, systemPrompt: systemPrompt() });
  const parsed = tryParseJson<{ resultStatus?: string; reasons?: unknown; opportunities?: RawOpportunity[] }>(raw);
  if (!parsed) throw new Error('AI 返回格式无法解析，请重试。');
  const status = parsed.resultStatus === 'no_opportunity'
    ? 'no_opportunity'
    : parsed.resultStatus === 'insufficient_evidence'
      ? 'insufficient_evidence'
      : 'opportunities';
  const cards = Array.isArray(parsed.opportunities) ? parsed.opportunities.map((item) => cardFromRaw(project, item, refs)) : [];
  return {
    resultStatus: cards.length ? 'opportunities' : status === 'opportunities' ? 'insufficient_evidence' : status,
    reasons: safeStrings(parsed.reasons),
    cards,
  };
}

export async function generateSelfGuidingQuestions(input: {
  project: ResearchProject;
  user: UserLookData;
  market: MarketLookData;
  competitor: CompetitorLookData;
}): Promise<SelfGuidingQuestion[]> {
  const settings = loadAiSettings();
  if (!settings?.apiKey) throw new Error('尚未配置 AI 模型 Key，请先到“设置 → API 与模型”填写。');
  const profile = loadUserBackground();
  const context = {
    accountBackground: profile,
    researchGoal: input.project.objective,
    marketplace: input.project.marketplace,
    needs: input.user.unmetNeedCandidates.filter((need) => need.selectedForSegmentation),
    targetSegment: input.market.selectedOpportunitySegment,
    competitorGaps: input.competitor.gaps,
  };
  const raw = await generateText(`${getPrompt('self_category_questions')}\n\n输入数据：\n${JSON.stringify(context)}`, settings, { jsonMode: true, systemPrompt: systemPrompt() });
  const parsed = tryParseJson<{ questions?: Partial<SelfGuidingQuestion>[] }>(raw);
  const questions = Array.isArray(parsed?.questions) ? parsed!.questions.slice(0, 7) : [];
  return questions.map<SelfGuidingQuestion>((question, index) => ({
    id: `q_${Date.now().toString(36)}_${index}`,
    question: String(question.question || '').trim(),
    type: question.type === 'choice' || question.type === 'number' ? question.type : 'text',
    options: safeStrings(question.options),
    reason: String(question.reason || '').trim(),
    impactDimension: question.impactDimension === 'strength' || question.impactDimension === 'gap' || question.impactDimension === 'boundary'
      ? question.impactDimension
      : 'fit',
    answer: '',
  })).filter((question) => question.question).slice(0, 7);
}

export async function reviewOpportunityCounterEvidence(card: OpportunityCard): Promise<Pick<OpportunityCard, 'counterEvidence' | 'missingEvidence'>> {
  const settings = loadAiSettings();
  if (!settings?.apiKey) throw new Error('尚未配置 AI 模型 Key，请先到“设置 → API 与模型”填写。');
  const raw = await generateText(`${getPrompt('opportunity_counter_review')}\n\n机会与证据：\n${JSON.stringify(card)}`, settings, { jsonMode: true, systemPrompt: systemPrompt() });
  const parsed = tryParseJson<{ counterEvidence?: unknown; missingEvidence?: unknown; conflicts?: unknown; reviewSummary?: string }>(raw);
  if (!parsed) throw new Error('AI 反证审查返回格式无法解析。');
  return {
    counterEvidence: [...safeStrings(parsed.counterEvidence), ...safeStrings(parsed.conflicts), ...(parsed.reviewSummary ? [parsed.reviewSummary] : [])],
    missingEvidence: safeStrings(parsed.missingEvidence),
  };
}
