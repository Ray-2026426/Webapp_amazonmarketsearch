import { useEffect, useState } from 'react';
import { Loader2, MessageSquareText, Search } from 'lucide-react';
import { Card } from './ui/Card';
import { FiveLookSummaryShell } from './five-look/FiveLookSummaryShell';
import { loadUserLook, type UserContext, type UserLookData } from '../utils/userLook';
import { LOOK_STATUS_LABELS, type ResearchProject } from '../types/researchProject';

export function UserLookView({
  userId,
  project,
  userContext,
  onOpenKeywordTool,
  onOpenVocTool,
}: {
  userId: string;
  project: ResearchProject;
  userContext: UserContext;
  onProjectChange: (updated: ResearchProject) => void;
  onOpenKeywordTool?: () => void;
  onOpenVocTool?: () => void;
  onNavigateMarket?: () => void;
}) {
  const [data, setData] = useState<UserLookData | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadUserLook(userId, project.id).then((d) => {
      if (!cancelled) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, project.id]);

  if (!data) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-[#aeaeb2]">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> 正在加载看用户结论...
      </div>
    );
  }

  const progress = project.fiveLookProgress.user;
  const keywordCount = userContext.keywordsCount || data.evidence?.keywordsCount || 0;
  const reviewCount = userContext.reviewsCount || data.evidence?.reviewsCount || 0;
  const unmetNeeds = data.unmetNeedCandidates
    .map((c) => c.needStatement || c.jobToBeDone || c.scenario)
    .filter(Boolean);
  const highEvidenceCount = data.unmetNeedCandidates.filter((c) => c.evidenceStrength === 'high').length;
  const judgement = unmetNeeds.length
    ? `已识别 ${unmetNeeds.length} 个未满足需求，其中 ${highEvidenceCount} 个证据强度较高。`
    : '当前还没有沉淀出明确的未满足需求，需要先从关键词和 VOC 明细中补证据。';

  const keywordSignals = [
    data.targetUser ? `目标用户：${data.targetUser}` : '',
    data.scenario ? `使用场景：${data.scenario}` : '',
    data.jobToBeDone ? `用户任务：${data.jobToBeDone}` : '',
  ].filter(Boolean);
  const vocSignals = [
    ...data.satisfiedNeeds.map((s) => `已满足：${s}`),
    ...data.unmetNeedCandidates.map((c) => `未满足：${c.needStatement || c.jobToBeDone || '未命名需求'}`),
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <FiveLookSummaryShell
        eyebrow="Five Looks / User"
        title="看用户 · 需求结论"
        judgement={judgement}
        description="这里只呈现用户需求的核心结论：他们怎么搜、怎么决策、现有产品满足了什么、还有哪些需求没有被充分满足。"
        statusBadge={
          <span className="rounded-full border border-black/5 bg-[#f5f5f7] px-2.5 py-1 text-[11px] font-semibold text-[#86868b]">
            {LOOK_STATUS_LABELS[progress.status]} · {progress.completionPercent}%
          </span>
        }
        metrics={[
          { label: '关键词样本', value: `${keywordCount}`, tone: keywordCount ? 'brand' : 'neutral' },
          { label: 'VOC 样本', value: `${reviewCount}`, tone: reviewCount ? 'brand' : 'neutral' },
          { label: '未满足需求', value: `${unmetNeeds.length}`, tone: unmetNeeds.length ? 'warn' : 'neutral' },
          { label: '高强度证据', value: `${highEvidenceCount}`, tone: highEvidenceCount ? 'good' : 'neutral' },
        ]}
        sections={[]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <InsightPanel
          icon={<Search className="w-5 h-5" />}
          title="关键词分析"
          subtitle="用户如何搜索、比较和表达需求"
          actionLabel="打开关键词工具"
          onAction={onOpenKeywordTool}
          items={keywordSignals}
          emptyText="还没有形成搜索路径结论。请先在关键词工具中补充关键词样本、意图和场景。"
        />
        <InsightPanel
          icon={<MessageSquareText className="w-5 h-5" />}
          title="VOC 分析"
          subtitle="评论里反复出现的满意点、抱怨点和期待落差"
          actionLabel="打开评论 / VOC 工具"
          onAction={onOpenVocTool}
          items={vocSignals}
          emptyText="还没有形成 VOC 结论。请先在评论工具中补充评论样本和痛点归纳。"
        />
      </div>
    </div>
  );
}

function InsightPanel({
  icon,
  title,
  subtitle,
  actionLabel,
  onAction,
  items,
  emptyText,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  actionLabel: string;
  onAction?: () => void;
  items: string[];
  emptyText: string;
}) {
  return (
    <Card>
      <div className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              {icon}
            </div>
            <div>
              <p className="text-sm font-semibold text-[#1d1d1f]">{title}</p>
              <p className="text-xs text-[#86868b] mt-0.5">{subtitle}</p>
            </div>
          </div>
          {onAction && (
            <button
              type="button"
              onClick={onAction}
              className="shrink-0 px-3 py-1.5 rounded-xl border border-black/8 bg-white text-xs font-semibold text-[#424245] hover:text-indigo-600 hover:border-indigo-200 transition-all"
            >
              {actionLabel}
            </button>
          )}
        </div>
        {items.length ? (
          <div className="space-y-2">
            {items.map((item, index) => (
              <div key={`${item}-${index}`} className="rounded-xl border border-black/5 bg-[#fafafa] px-3 py-2 text-sm text-[#424245] leading-6">
                {item}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-black/10 bg-[#fafafa] px-4 py-6 text-sm text-[#86868b] leading-6">
            {emptyText}
          </div>
        )}
      </div>
    </Card>
  );
}
