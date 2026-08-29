import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { ArrowLeft, Loader2, MessageSquareText, Search } from 'lucide-react';
import { Card } from './ui/Card';
import { FiveLookSummaryShell } from './five-look/FiveLookSummaryShell';
import { KeywordAnalysis, type AiInsight } from './KeywordAnalysis';
import { UserInsights } from './UserInsights';
import { loadUserLook, type UserContext, type UserLookData } from '../utils/userLook';
import type { UserInsightsWorkspaceState } from '../utils/userInsightsHistory';
import type { Keyword, Product, Review } from '../utils/parser';
import { LOOK_STATUS_LABELS, type ResearchProject } from '../types/researchProject';

type UserDetailPage = 'summary' | 'keywords' | 'voc';
type Persona = { people: string; scenarios: string; needs: string };

export function UserLookView({
  userId,
  project,
  userContext,
  products = [],
  reviews,
  setReviews,
  persona,
  setPersona,
  keywords,
  setKeywords,
  marketplaceCode,
  suggestAsins = [],
  keywordInitialInsight = null,
  keywordPersistedInsight = null,
  keywordInsightRestoreKey = 0,
  onKeywordInsightSync,
  vocInitialDeepReport = null,
  userInsightsWorkspace = null,
  userInsightsRestoreKey = 0,
  userInsightsRestorePayload = null,
  onUserInsightsWorkspaceSync,
  onOpenKeywordTool,
  onOpenVocTool,
}: {
  userId: string;
  project: ResearchProject;
  userContext: UserContext;
  onProjectChange: (updated: ResearchProject) => void;
  products?: Product[];
  reviews?: Review[];
  setReviews?: Dispatch<SetStateAction<Review[]>>;
  persona?: Persona | null;
  setPersona?: Dispatch<SetStateAction<Persona | null>>;
  keywords?: Keyword[];
  setKeywords?: Dispatch<SetStateAction<Keyword[]>>;
  marketplaceCode?: string;
  suggestAsins?: string[];
  keywordInitialInsight?: AiInsight | null;
  keywordPersistedInsight?: AiInsight | null;
  keywordInsightRestoreKey?: number;
  onKeywordInsightSync?: (state: AiInsight | null) => void;
  vocInitialDeepReport?: string | null;
  userInsightsWorkspace?: UserInsightsWorkspaceState | null;
  userInsightsRestoreKey?: number;
  userInsightsRestorePayload?: UserInsightsWorkspaceState | null;
  onUserInsightsWorkspaceSync?: (state: UserInsightsWorkspaceState) => void;
  onOpenKeywordTool?: () => void;
  onOpenVocTool?: () => void;
  onNavigateMarket?: () => void;
}) {
  const [data, setData] = useState<UserLookData | null>(null);
  const [detailPage, setDetailPage] = useState<UserDetailPage>('summary');

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

  if (detailPage === 'keywords') {
    return (
      <UserDetailShell
        title="关键词分析"
        subtitle="完整复用关键词详情里的搜索意图、JTBD、场景、人群、痛点和 AI 结论。"
        onBack={() => setDetailPage('summary')}
        externalLabel="打开全局关键词工具"
        onExternal={onOpenKeywordTool}
      >
        {keywords && setKeywords ? (
          <KeywordAnalysis
            keywords={keywords}
            setKeywords={setKeywords}
            marketplaceCode={marketplaceCode}
            suggestAsins={suggestAsins}
            initialInsight={keywordInitialInsight}
            persistedInsight={keywordPersistedInsight}
            insightRestoreKey={keywordInsightRestoreKey}
            onInsightSync={onKeywordInsightSync}
          />
        ) : (
          <DetailEmptyState text="当前项目还没有可用于关键词详情页的数据。" />
        )}
      </UserDetailShell>
    );
  }

  if (detailPage === 'voc') {
    return (
      <UserDetailShell
        title="VOC 分析"
        subtitle="完整复用评论 / VOC 详情里的情绪、痛点、需求旅程和 AI 深度报告。"
        onBack={() => setDetailPage('summary')}
        externalLabel="打开全局 VOC 工具"
        onExternal={onOpenVocTool}
      >
        {reviews && setReviews && setPersona ? (
          <UserInsights
            products={products}
            reviews={reviews}
            setReviews={setReviews}
            persona={persona ?? null}
            setPersona={setPersona}
            insightsUiActive
            marketplaceCode={marketplaceCode}
            initialDeepReport={vocInitialDeepReport}
            workspaceFromParent={userInsightsWorkspace}
            workspaceRestoreKey={userInsightsRestoreKey}
            restorePayload={userInsightsRestorePayload}
            onWorkspaceSync={onUserInsightsWorkspaceSync}
          />
        ) : (
          <DetailEmptyState text="当前项目还没有可用于 VOC 详情页的数据。" />
        )}
      </UserDetailShell>
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
        description="这里呈现用户需求的核心结论：他们怎么搜索、怎么决策、现有产品满足了什么、还有哪些需求没有被充分满足。"
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
          onOpenDetail={() => setDetailPage('keywords')}
          items={keywordSignals}
          emptyText="还没有形成搜索路径结论。请先在关键词工具中补充关键词样本、意图和场景。"
        />
        <InsightPanel
          icon={<MessageSquareText className="w-5 h-5" />}
          title="VOC 分析"
          subtitle="评论里反复出现的满意点、抱怨点和期待落差"
          actionLabel="打开评论 / VOC 工具"
          onAction={onOpenVocTool}
          onOpenDetail={() => setDetailPage('voc')}
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
  onOpenDetail,
  items,
  emptyText,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  actionLabel: string;
  onAction?: () => void;
  onOpenDetail?: () => void;
  items: string[];
  emptyText: string;
}) {
  return (
    <Card>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpenDetail}
        onKeyDown={(event) => {
          if (!onOpenDetail) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpenDetail();
          }
        }}
        className="p-5 space-y-4 cursor-pointer rounded-[inherit] transition-colors hover:bg-[#fafafa]"
      >
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
              onClick={(event) => {
                event.stopPropagation();
                onAction();
              }}
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

function UserDetailShell({
  title,
  subtitle,
  externalLabel,
  onBack,
  onExternal,
  children,
}: {
  title: string;
  subtitle: string;
  externalLabel: string;
  onBack: () => void;
  onExternal?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="mt-1 shrink-0 w-9 h-9 rounded-xl border border-black/8 bg-white text-[#86868b] hover:text-indigo-600 hover:border-indigo-200 transition-all flex items-center justify-center"
            title="返回看用户"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <h3 className="text-xl font-bold text-[#1d1d1f]">{title}</h3>
            <p className="text-sm text-[#86868b] mt-1 leading-6">{subtitle}</p>
          </div>
        </div>
        {onExternal && (
          <button
            type="button"
            onClick={onExternal}
            className="shrink-0 px-3 py-2 rounded-xl border border-indigo-100 bg-indigo-50 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 hover:border-indigo-200 transition-all"
          >
            {externalLabel}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function DetailEmptyState({ text }: { text: string }) {
  return (
    <Card>
      <div className="px-4 py-8 text-center text-sm text-[#86868b]">{text}</div>
    </Card>
  );
}
