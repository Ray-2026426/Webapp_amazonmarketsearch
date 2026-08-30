import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { ArrowLeft, ArrowRight, Loader2, MessageSquareText, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from './ui/Card';
import { FiveLookSummaryShell } from './five-look/FiveLookSummaryShell';
import { KeywordAnalysis, type AiInsight } from './KeywordAnalysis';
import { UserInsights } from './UserInsights';
import {
  computeUserProgress,
  emptyUnmetNeedCandidate,
  loadUserLook,
  saveUserLook,
  type UnmetNeedCandidate,
  type UserContext,
  type UserLookData,
} from '../utils/userLook';
import { updateLookProgress } from '../utils/projectStore';
import { runLookAnalysis } from '../utils/lookAi';
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
  onProjectChange,
  onNavigateMarket,
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
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadUserLook(userId, project.id).then((d) => {
      if (!cancelled) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, project.id]);

  const persist = async (next: UserLookData) => {
    setSaving(true);
    const stamped = { ...next, updatedAt: new Date().toISOString() };
    setData(stamped);
    await saveUserLook(userId, project.id, stamped);
    const progress = computeUserProgress(stamped);
    const updated = await updateLookProgress(userId, project.id, 'user', {
      ...project.fiveLookProgress.user,
      ...progress,
      updatedAt: stamped.updatedAt,
    });
    if (updated) onProjectChange(updated);
    setSaving(false);
  };

  const updateCandidate = (id: string, patch: Partial<UnmetNeedCandidate>) => {
    if (!data) return;
    const next = {
      ...data,
      unmetNeedCandidates: data.unmetNeedCandidates.map((candidate) =>
        candidate.id === id ? { ...candidate, ...patch } : candidate
      ),
    };
    setData(next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void persist(next), 450);
  };

  const generateNeeds = async () => {
    if (!data) return;
    setGenerating(true);
    try {
      const result = await runLookAnalysis('user');
      if (!result.ok || !result.data) throw new Error(result.error || 'AI 未返回有效需求分类');
      const raw = Array.isArray(result.data.unmetNeedCandidates) ? result.data.unmetNeedCandidates : [];
      const candidates = raw.map((item) => {
        const value = item && typeof item === 'object' ? item as Record<string, unknown> : {};
        const strength = value.evidenceStrength === 'high' || value.evidenceStrength === 'low' ? value.evidenceStrength : 'medium';
        return {
          ...emptyUnmetNeedCandidate(),
          category: String(value.category || ''),
          targetUser: String(value.targetUser || ''),
          scenario: String(value.scenario || ''),
          jobToBeDone: String(value.jobToBeDone || ''),
          decisionPath: String(value.decisionPath || ''),
          needStatement: String(value.needStatement || value.unmetPart || ''),
          currentAlternative: String(value.currentAlternative || ''),
          satisfiedPart: String(value.satisfiedPart || ''),
          unmetPart: String(value.unmetPart || value.needStatement || ''),
          evidenceNotes: Array.isArray(value.evidenceNotes) ? value.evidenceNotes.map(String).filter(Boolean) : [],
          evidenceStrength: strength,
        } satisfies UnmetNeedCandidate;
      }).filter((candidate) => candidate.needStatement || candidate.category);
      if (!candidates.length) throw new Error('AI 没有形成可用需求分类，请检查关键词或 VOC 数据。');
      await persist({
        ...data,
        targetUser: String(result.data.targetUser || ''),
        scenario: String(result.data.scenario || ''),
        jobToBeDone: String(result.data.jobToBeDone || ''),
        satisfiedNeeds: Array.isArray(result.data.satisfiedNeeds) ? result.data.satisfiedNeeds.map(String).filter(Boolean) : [],
        unmetNeedCandidates: candidates,
      });
      toast.success(`已生成 ${candidates.length} 类需求，请人工确认并选择细分标准`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生成需求分类失败');
    } finally {
      setGenerating(false);
    }
  };

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

      <Card>
        <div className="p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-[#1d1d1f]">需求分类 · 后续分析主线</p>
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />}
              </div>
              <p className="text-xs text-[#86868b] mt-1 leading-5">
                每一行都描述“谁在什么场景下，要完成什么任务，哪里仍未被满足”。勾选后，它会成为看市场的细分标准、看竞对的满足矩阵行和看机会的证据起点。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void generateNeeds()} disabled={generating} className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}AI 生成需求分类
              </button>
              <button
                type="button"
                onClick={() => void persist({ ...data, unmetNeedCandidates: [...data.unmetNeedCandidates, emptyUnmetNeedCandidate()] })}
                className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
              >
                <Plus className="w-3.5 h-3.5" /> 添加需求
              </button>
            </div>
          </div>

          {data.unmetNeedCandidates.length ? (
            <div className="space-y-3">
              {data.unmetNeedCandidates.map((candidate, index) => (
                <div key={candidate.id} className="rounded-2xl border border-black/8 bg-[#fafafa] p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#424245]">
                      <input
                        type="checkbox"
                        checked={Boolean(candidate.selectedForSegmentation)}
                        onChange={(event) => updateCandidate(candidate.id, { selectedForSegmentation: event.target.checked })}
                        className="accent-indigo-600"
                      />
                      作为细分标准
                    </label>
                    <div className="flex items-center gap-1">
                      {index > 0 && <button type="button" onClick={() => {
                        const previous = data.unmetNeedCandidates[index - 1];
                        const merged: UnmetNeedCandidate = {
                          ...previous,
                          category: previous.category || candidate.category,
                          targetUser: [previous.targetUser, candidate.targetUser].filter(Boolean).join('；'),
                          scenario: [previous.scenario, candidate.scenario].filter(Boolean).join('；'),
                          jobToBeDone: [previous.jobToBeDone, candidate.jobToBeDone].filter(Boolean).join('；'),
                          needStatement: [previous.needStatement, candidate.needStatement].filter(Boolean).join('；'),
                          unmetPart: [previous.unmetPart, candidate.unmetPart].filter(Boolean).join('；'),
                          evidenceNotes: [...new Set([...(previous.evidenceNotes ?? []), ...(candidate.evidenceNotes ?? [])])],
                          selectedForSegmentation: Boolean(previous.selectedForSegmentation || candidate.selectedForSegmentation),
                        };
                        void persist({ ...data, unmetNeedCandidates: data.unmetNeedCandidates.map((item) => item.id === previous.id ? merged : item).filter((item) => item.id !== candidate.id) });
                      }} className="rounded-lg px-2 py-1.5 text-[11px] font-semibold text-[#86868b] hover:text-indigo-600 hover:bg-indigo-50">合并到上一类</button>}
                      <button type="button" onClick={() => {
                        const copy = { ...candidate, id: emptyUnmetNeedCandidate().id, category: `${candidate.category || '需求'}（拆分）`, selectedForSegmentation: false };
                        const next = [...data.unmetNeedCandidates];
                        next.splice(index + 1, 0, copy);
                        void persist({ ...data, unmetNeedCandidates: next });
                      }} className="rounded-lg px-2 py-1.5 text-[11px] font-semibold text-[#86868b] hover:text-indigo-600 hover:bg-indigo-50">拆分副本</button>
                      <button
                        type="button"
                        title="删除需求"
                        onClick={() => void persist({ ...data, unmetNeedCandidates: data.unmetNeedCandidates.filter((item) => item.id !== candidate.id) })}
                        className="w-8 h-8 rounded-lg text-[#aeaeb2] hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <NeedField label="需求分类" value={candidate.category ?? ''} placeholder={`例如：便携收纳 ${index + 1}`} onChange={(value) => updateCandidate(candidate.id, { category: value })} />
                    <NeedField label="需求强度" value={candidate.evidenceStrength} type="select" onChange={(value) => updateCandidate(candidate.id, { evidenceStrength: value as UnmetNeedCandidate['evidenceStrength'] })} />
                    <NeedField label="用户画像" value={candidate.targetUser} placeholder="谁最强烈需要它？" onChange={(value) => updateCandidate(candidate.id, { targetUser: value })} />
                    <NeedField label="使用场景" value={candidate.scenario} placeholder="在什么情境下发生？" onChange={(value) => updateCandidate(candidate.id, { scenario: value })} />
                    <NeedField label="JTBD" value={candidate.jobToBeDone} placeholder="用户想完成什么任务？" onChange={(value) => updateCandidate(candidate.id, { jobToBeDone: value })} />
                    <NeedField label="决策路径" value={candidate.decisionPath ?? ''} placeholder="如何发现、比较、购买？" onChange={(value) => updateCandidate(candidate.id, { decisionPath: value })} />
                    <NeedField label="当前替代方案" value={candidate.currentAlternative} placeholder="现在用什么解决？" onChange={(value) => updateCandidate(candidate.id, { currentAlternative: value })} />
                    <NeedField label="已经满足" value={candidate.satisfiedPart ?? ''} placeholder="竞品已经做好了什么？" onChange={(value) => updateCandidate(candidate.id, { satisfiedPart: value })} />
                    <div className="md:col-span-2">
                      <NeedField label="未满足需求（必须具体）" value={candidate.unmetPart || candidate.needStatement} placeholder="谁，在什么场景下，因为什么不足而无法完成什么任务？" onChange={(value) => updateCandidate(candidate.id, { unmetPart: value, needStatement: value })} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-black/10 bg-[#fafafa] px-4 py-8 text-center text-sm text-[#86868b]">
              暂无结构化需求。可从关键词/VOC 结论整理，或手动添加第一条。
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/5 pt-4">
            <p className="text-xs text-[#86868b]">
              已选 {data.unmetNeedCandidates.filter((item) => item.selectedForSegmentation).length} 条作为细分标准
            </p>
            {onNavigateMarket && (
              <button
                type="button"
                disabled={!data.unmetNeedCandidates.some((item) => item.selectedForSegmentation)}
                onClick={onNavigateMarket}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
              >
                用这些需求看市场 <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

function NeedField({
  label,
  value,
  placeholder,
  type = 'text',
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  type?: 'text' | 'select';
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold text-[#86868b] mb-1">{label}</span>
      {type === 'select' ? (
        <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-black/8 bg-white px-3 py-2 text-sm text-[#424245] focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
          <option value="high">高：多源重复出现</option>
          <option value="medium">中：有明确证据</option>
          <option value="low">低：仍需补证</option>
        </select>
      ) : (
        <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-black/8 bg-white px-3 py-2 text-sm text-[#424245] placeholder:text-[#c7c7cc] focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
      )}
    </label>
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
