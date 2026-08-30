import type { FiveLookId, ResearchProject } from '../types/researchProject';
import { loadUserLook } from './userLook';
import { loadMarketLook } from './marketLook';
import { loadCompetitorLook } from './competitorLook';
import { loadSelfAssessment } from './selfAssessment';
import { loadOpportunities, loadOpportunityConclusion } from './opportunityStore';

export interface ProjectDecisionSummary {
  judgement: string;
  nextAction: string;
  nextLook: FiveLookId;
  stageLabel: string;
  completedLooks: number;
  confirmedOpportunities: number;
  candidateOpportunities: number;
  selectedNeeds: string[];
  selectedSegment: string;
  largestGap: string;
}

export async function loadProjectDecisionSummary(userId: string, project: ResearchProject): Promise<ProjectDecisionSummary> {
  const [user, market, competitor, self, opportunities, conclusion] = await Promise.all([
    loadUserLook(userId, project.id),
    loadMarketLook(userId, project.id),
    loadCompetitorLook(userId, project.id),
    loadSelfAssessment(userId, project.id),
    loadOpportunities(userId, project.id),
    loadOpportunityConclusion(userId, project.id),
  ]);
  const selectedNeeds = user.unmetNeedCandidates
    .filter((need) => need.selectedForSegmentation)
    .map((need) => need.category || need.needStatement)
    .filter(Boolean);
  const confirmed = opportunities.filter((card) => card.reviewStatus === 'confirmed');
  const candidates = opportunities.filter((card) => card.reviewStatus !== 'confirmed');
  const completedLooks = Object.values(project.fiveLookProgress).filter((progress) => progress.status === 'completed').length;

  let nextLook: FiveLookId = 'user';
  let nextAction = '开始看用户，形成需求分类';
  let largestGap = project.fiveLookProgress.user.missingRequirements[0] || '尚未形成需求分类';
  if (user.unmetNeedCandidates.length > 0 && selectedNeeds.length === 0) {
    nextAction = '确认要用于市场细分的需求分类';
    largestGap = '需求候选尚未确认为细分标准';
  } else if (selectedNeeds.length > 0 && !market.selectedOpportunitySegment?.trim()) {
    nextLook = 'market';
    nextAction = '比较并选择目标细分市场';
    largestGap = '尚未选择目标细分市场';
  } else if (!competitor.samplePool.length || !competitor.gaps.length) {
    nextLook = 'competitor';
    nextAction = '分析头部、跟随者和新进入者';
    largestGap = !competitor.samplePool.length ? '缺少代表竞对样本' : '尚未形成可攻击缝隙';
  } else if (!(self.guidingQuestions ?? []).some((question) => question.answer.trim()) && !self.aiSummary?.trim()) {
    nextLook = 'self';
    nextAction = '回答品类专属的自身适配问题';
    largestGap = '尚未确认团队能否承接机会';
  } else if (opportunities.length === 0 && conclusion?.resultStatus !== 'no_opportunity') {
    nextLook = 'opportunity';
    nextAction = '综合五看判断 0–N 个机会';
    largestGap = '尚未运行综合机会判断';
  } else if (candidates.length > 0) {
    nextLook = 'opportunity';
    nextAction = '复核并确认 AI 候选机会';
    largestGap = `${candidates.length} 个候选机会等待人工确认`;
  } else {
    nextLook = 'opportunity';
    nextAction = '查看最终机会结论并导出报告';
    largestGap = confirmed.length ? '结论已形成，可进入审核' : '当前未确认机会';
  }

  let judgement = '尚未形成需求分类，当前不能判断品类机会。';
  if (conclusion?.resultStatus === 'no_opportunity' && conclusion.reviewed) {
    judgement = `已确认当前品类没有达到立项标准的机会。${conclusion.reasons[0] ? `主要原因：${conclusion.reasons[0]}` : ''}`;
    nextLook = 'opportunity';
    nextAction = '查看无机会结论并导出报告';
    largestGap = '结论已形成，可交给同事审核';
  } else if (conclusion?.resultStatus === 'insufficient_evidence') {
    judgement = `当前证据不足，暂不能判断是否存在机会。${conclusion.reasons[0] ? `主要缺口：${conclusion.reasons[0]}` : ''}`;
  } else if (confirmed.length > 0) {
    const top = [...confirmed].sort((a, b) => b.score - a.score)[0];
    judgement = `已确认 ${confirmed.length} 个机会，当前最高优先级为“${top.title}”（${top.score} 分）。`;
  } else if (candidates.length > 0) {
    judgement = `AI 已识别 ${candidates.length} 个候选机会，尚待人工复核。`;
  } else if (market.selectedOpportunitySegment?.trim()) {
    judgement = `已选择“${market.selectedOpportunitySegment}”细分市场，仍需补齐竞对、自身或综合机会判断。`;
  } else if (selectedNeeds.length > 0) {
    judgement = `已确认 ${selectedNeeds.length} 类需求作为市场细分标准，等待比较细分机会。`;
  } else if (user.unmetNeedCandidates.length > 0) {
    judgement = `已识别 ${user.unmetNeedCandidates.length} 个需求候选，等待人工确认分类。`;
  }

  const stageLabel = nextLook === 'user' ? '看用户'
    : nextLook === 'market' ? '看市场'
      : nextLook === 'competitor' ? '看竞对'
        : nextLook === 'self' ? '看自己'
          : '看机会';
  return {
    judgement,
    nextAction,
    nextLook,
    stageLabel,
    completedLooks,
    confirmedOpportunities: confirmed.length,
    candidateOpportunities: candidates.length,
    selectedNeeds,
    selectedSegment: market.selectedOpportunitySegment?.trim() || '',
    largestGap,
  };
}
