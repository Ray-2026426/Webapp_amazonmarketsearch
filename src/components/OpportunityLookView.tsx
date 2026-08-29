import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { Card, cn } from './ui/Card';
import { FiveLookSummaryShell } from './five-look/FiveLookSummaryShell';
import { loadOpportunities } from '../utils/opportunityStore';
import { loadUserLook, type UnmetNeedCandidate, type UserLookData } from '../utils/userLook';
import { loadMarketLook, type MarketLookData } from '../utils/marketLook';
import {
  LOOK_STATUS_LABELS,
  type FiveLookId,
  type OpportunityCard,
  type OpportunityDecision,
  type ResearchProject,
} from '../types/researchProject';

const DECISION_LABELS: Record<OpportunityDecision, string> = {
  enter: '进入',
  validate_first: '先验证',
  hold: '暂缓',
  reject: '放弃',
  undecided: '未决策',
};

type DisplayOpportunity =
  | { kind: 'card'; id: string; title: string; card: OpportunityCard }
  | { kind: 'candidate'; id: string; title: string; candidate: UnmetNeedCandidate };

export function OpportunityLookView({
  userId,
  project,
}: {
  userId: string;
  project: ResearchProject;
  onProjectChange: (updated: ResearchProject) => void;
  onNavigateLook: (look: FiveLookId) => void;
}) {
  const [cards, setCards] = useState<OpportunityCard[] | null>(null);
  const [userLook, setUserLook] = useState<UserLookData | null>(null);
  const [marketLook, setMarketLook] = useState<MarketLookData | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadOpportunities(userId, project.id), loadUserLook(userId, project.id), loadMarketLook(userId, project.id)]).then(
      ([opps, user, market]) => {
        if (cancelled) return;
        setCards(opps);
        setUserLook(user);
        setMarketLook(market);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [userId, project.id]);

  const opportunities = useMemo<DisplayOpportunity[]>(() => {
    const official = (cards ?? [])
      .slice()
      .sort((a, b) => b.score - a.score)
      .map((card) => ({ kind: 'card' as const, id: card.id, title: card.title, card }));
    if (official.length) return official;
    return (userLook?.unmetNeedCandidates ?? []).map((candidate) => ({
      kind: 'candidate' as const,
      id: candidate.id,
      title: candidate.needStatement || candidate.jobToBeDone || '未命名机会',
      candidate,
    }));
  }, [cards, userLook]);

  useEffect(() => {
    if (!selectedId && opportunities.length) setSelectedId(opportunities[0].id);
  }, [opportunities, selectedId]);

  if (!cards || !userLook || !marketLook) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-[#aeaeb2]">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> 正在加载看机会结论...
      </div>
    );
  }

  const selected = opportunities.find((item) => item.id === selectedId) ?? opportunities[0];
  const noOpportunityReasons = buildNoOpportunityReasons(project, userLook, marketLook, cards);
  const selectedSegment = marketLook.selectedOpportunitySegment?.trim() || '';
  const officialCards = opportunities.filter((item) => item.kind === 'card').length;
  const enterableCards = cards.filter((card) => card.decision === 'enter' || card.decision === 'validate_first').length;
  const judgement = officialCards
    ? `当前有 ${officialCards} 个机会，${enterableCards} 个处于进入或先验证状态。`
    : noOpportunityReasons.length
      ? `当前结论：无机会。主要原因是${noOpportunityReasons[0]}。`
      : '当前只有未满足需求候选，还没有形成正式机会卡。';

  return (
    <div className="space-y-4">
      <FiveLookSummaryShell
        eyebrow="Five Looks / Opportunity"
        title="看机会 · 机会结论"
        judgement={judgement}
        description="这里只用卡片展示机会或无机会原因。点击机会卡后，再看该机会的具体描述、成立依据、风险和验证方式。"
        statusBadge={
          <span className="rounded-full border border-black/5 bg-[#f5f5f7] px-2.5 py-1 text-[11px] font-semibold text-[#86868b]">
            {LOOK_STATUS_LABELS[project.fiveLookProgress.opportunity.status]} · {project.fiveLookProgress.opportunity.completionPercent}%
          </span>
        }
        metrics={[
          { label: '目标细分', value: selectedSegment || '未选择', tone: selectedSegment ? 'brand' : 'warn' },
          { label: '机会卡', value: `${cards.length}`, tone: cards.length ? 'good' : 'neutral' },
          { label: '候选需求', value: `${userLook.unmetNeedCandidates.length}`, tone: userLook.unmetNeedCandidates.length ? 'brand' : 'warn' },
          { label: '无机会原因', value: `${noOpportunityReasons.length}`, tone: noOpportunityReasons.length ? 'warn' : 'neutral' },
        ]}
        sections={[]}
      />

      {opportunities.length ? (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {opportunities.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={cn(
                  'text-left rounded-2xl border bg-white p-4 transition-all',
                  selected?.id === item.id
                    ? 'border-indigo-300 ring-2 ring-indigo-500/20 bg-indigo-50/30'
                    : 'border-black/8 hover:border-indigo-200 hover:shadow-sm'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#1d1d1f] line-clamp-2">{item.title}</p>
                    <p className="text-xs text-[#86868b] mt-1">
                      {item.kind === 'card' ? DECISION_LABELS[item.card.decision] : '候选机会'}
                    </p>
                  </div>
                  {item.kind === 'card' ? (
                    <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700">
                      {item.card.score} 分
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">
                      待验证
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#424245] leading-5 mt-3 line-clamp-3">
                  {item.kind === 'card'
                    ? item.card.needStatement
                    : item.candidate.needStatement || item.candidate.currentAlternative || '尚未补充机会描述。'}
                </p>
              </button>
            ))}
          </div>
          <OpportunityDetail item={selected} selectedSegment={selectedSegment} noOpportunityReasons={noOpportunityReasons} />
        </div>
      ) : (
        <Card>
          <div className="p-10 text-center">
            <AlertTriangle className="w-7 h-7 text-amber-500 mx-auto mb-3" />
            <p className="text-sm font-semibold text-[#1d1d1f]">暂无机会</p>
            <div className="mt-3 max-w-xl mx-auto space-y-1">
              {noOpportunityReasons.length ? (
                noOpportunityReasons.map((reason) => (
                  <p key={reason} className="text-sm text-[#86868b] leading-6">
                    {reason}
                  </p>
                ))
              ) : (
                <p className="text-sm text-[#86868b] leading-6">还没有足够的用户、市场、竞品和自身结论来判断机会。</p>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function OpportunityDetail({
  item,
  selectedSegment,
  noOpportunityReasons,
}: {
  item?: DisplayOpportunity;
  selectedSegment: string;
  noOpportunityReasons: string[];
}) {
  if (!item) return null;

  if (item.kind === 'candidate') {
    const c = item.candidate;
    return (
      <Card>
        <div className="p-5 space-y-4">
          <DetailHeader title={item.title} badge="候选机会" />
          <DetailSection title="机会描述" items={[c.needStatement || '暂无未满足需求描述。']} />
          <DetailSection title="目标用户 / 场景 / 任务" items={[c.targetUser, c.scenario, c.jobToBeDone].filter(Boolean)} emptyText="暂无用户路径信息。" />
          <DetailSection title="当前替代方案" items={[c.currentAlternative].filter(Boolean)} emptyText="暂无替代方案信息。" />
          <DetailSection title="为什么还不是正式机会" items={noOpportunityReasons.length ? noOpportunityReasons : ['需要补齐市场、竞品、自己和利润证据。']} tone="warn" />
        </div>
      </Card>
    );
  }

  const card = item.card;
  return (
    <Card>
      <div className="p-5 space-y-4">
        <DetailHeader title={card.title} badge={`${DECISION_LABELS[card.decision]} · ${card.score} 分`} />
        <DetailSection title="机会描述" items={[card.needStatement]} />
        <DetailSection title="目标细分" items={[selectedSegment || card.scenario].filter(Boolean)} emptyText="暂无目标细分。" />
        <DetailSection title="产品假设" items={[card.solutionHypothesis].filter(Boolean)} emptyText="暂无产品假设。" tone="good" />
        <DetailSection title="当前替代方案" items={[card.currentAlternative, card.currentAlternativeCost].filter(Boolean)} emptyText="暂无替代方案。" />
        <DetailSection title="主要风险" items={card.risks.map((risk) => risk.label || risk.description).filter(Boolean)} emptyText="暂无风险。" tone="warn" />
        <DetailSection title="验证动作" items={card.validationActions.map((action) => action.action || action.successCriteria).filter(Boolean)} emptyText="暂无验证动作。" />
      </div>
    </Card>
  );
}

function DetailHeader({ title, badge }: { title: string; badge: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-indigo-600">机会详情</p>
        <h3 className="text-lg font-bold text-[#1d1d1f] mt-1 leading-6">{title}</h3>
      </div>
      <span className="shrink-0 inline-flex items-center gap-1 rounded-full border border-black/5 bg-[#f5f5f7] px-2.5 py-1 text-[11px] font-semibold text-[#424245]">
        <Sparkles className="w-3.5 h-3.5" /> {badge}
      </span>
    </div>
  );
}

function DetailSection({
  title,
  items,
  emptyText = '暂无数据。',
  tone = 'neutral',
}: {
  title: string;
  items: string[];
  emptyText?: string;
  tone?: 'neutral' | 'good' | 'warn';
}) {
  const toneCls = {
    neutral: 'bg-[#fafafa] border-black/5',
    good: 'bg-emerald-50/70 border-emerald-100',
    warn: 'bg-amber-50/70 border-amber-100',
  }[tone];
  return (
    <div className={cn('rounded-xl border p-3', toneCls)}>
      <p className="text-xs font-semibold text-[#424245] mb-1.5">{title}</p>
      {items.length ? (
        items.map((item, index) => (
          <p key={`${item}-${index}`} className="text-sm text-[#424245] leading-6">
            {item}
          </p>
        ))
      ) : (
        <p className="text-sm text-[#86868b] leading-6">{emptyText}</p>
      )}
    </div>
  );
}

function buildNoOpportunityReasons(
  project: ResearchProject,
  userLook: UserLookData,
  marketLook: MarketLookData,
  cards: OpportunityCard[]
): string[] {
  const reasons: string[] = [];
  if (userLook.unmetNeedCandidates.length === 0) reasons.push('缺少未满足需求，无法判断用户到底要什么');
  if (!marketLook.selectedOpportunitySegment?.trim()) reasons.push('缺少目标细分市场，无法判断水涨船高或供小于求');
  if (project.fiveLookProgress.competitor.status === 'not_started') reasons.push('缺少三类竞品对比，无法判断对手破绽');
  if (project.fiveLookProgress.self.status === 'not_started') reasons.push('缺少自身承接判断，无法确认我们是否适合抓这个机会');
  if (cards.length > 0 && cards.every((card) => card.decision === 'reject')) reasons.push('所有机会卡都已被放弃');
  if (cards.length > 0 && cards.every((card) => card.score < 50)) reasons.push('现有机会卡评分偏低，暂不建议进入');
  return reasons;
}
