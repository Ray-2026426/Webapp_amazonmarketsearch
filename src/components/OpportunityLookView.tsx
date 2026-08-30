import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, Download, Loader2, Merge, Plus, RefreshCw, SearchCheck, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, cn } from './ui/Card';
import { FiveLookSummaryShell } from './five-look/FiveLookSummaryShell';
import {
  computeOpportunityProgress,
  createOpportunityFromUnmetNeed,
  loadOpportunities,
  loadOpportunityConclusion,
  saveOpportunities,
  saveOpportunityConclusion,
  scoreOpportunity,
  type OpportunityConclusion,
} from '../utils/opportunityStore';
import { loadUserLook, type UserLookData } from '../utils/userLook';
import { loadMarketLook, type MarketLookData } from '../utils/marketLook';
import { loadCompetitorLook, type CompetitorLookData } from '../utils/competitorLook';
import { loadSelfAssessment, type SelfAssessment } from '../utils/selfAssessment';
import { generateOpportunityCandidates, reviewOpportunityCounterEvidence } from '../utils/opportunityAi';
import { buildOpportunityHtmlReport, downloadHtmlReport } from '../utils/opportunityHtmlReport';
import { updateLookProgress } from '../utils/projectStore';
import {
  LOOK_STATUS_LABELS,
  type FiveLookId,
  type OpportunityCard,
  type OpportunityDecision,
  type ResearchProject,
} from '../types/researchProject';

const DECISION_LABELS: Record<OpportunityDecision, string> = {
  enter: '建议进入',
  validate_first: '待补证',
  hold: '暂缓',
  reject: '放弃',
  undecided: '待决定',
};

export function OpportunityLookView({
  userId,
  project,
  onProjectChange,
  onNavigateLook,
}: {
  userId: string;
  project: ResearchProject;
  onProjectChange: (updated: ResearchProject) => void;
  onNavigateLook: (look: FiveLookId) => void;
}) {
  const [cards, setCards] = useState<OpportunityCard[] | null>(null);
  const [userLook, setUserLook] = useState<UserLookData | null>(null);
  const [marketLook, setMarketLook] = useState<MarketLookData | null>(null);
  const [competitorLook, setCompetitorLook] = useState<CompetitorLookData | null>(null);
  const [self, setSelf] = useState<SelfAssessment | null>(null);
  const [conclusion, setConclusion] = useState<OpportunityConclusion | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedForMerge, setSelectedForMerge] = useState<string[]>([]);
  const [busy, setBusy] = useState<'generate' | 'review' | 'export' | ''>('');

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      loadOpportunities(userId, project.id),
      loadUserLook(userId, project.id),
      loadMarketLook(userId, project.id),
      loadCompetitorLook(userId, project.id),
      loadSelfAssessment(userId, project.id),
      loadOpportunityConclusion(userId, project.id),
    ]).then(([opportunities, user, market, competitor, selfAssessment, savedConclusion]) => {
      if (cancelled) return;
      setCards(opportunities);
      setUserLook(user);
      setMarketLook(market);
      setCompetitorLook(competitor);
      setSelf(selfAssessment);
      setConclusion(savedConclusion);
      setSelectedId(opportunities[0]?.id ?? '');
    });
    return () => { cancelled = true; };
  }, [userId, project.id]);

  const persist = async (nextCards: OpportunityCard[], nextConclusion = conclusion) => {
    setCards(nextCards);
    await saveOpportunities(userId, project.id, nextCards);
    if (nextConclusion) await saveOpportunityConclusion(userId, project.id, nextConclusion);
    const progress = computeOpportunityProgress(nextCards, project, nextConclusion);
    const updated = await updateLookProgress(userId, project.id, 'opportunity', {
      ...project.fiveLookProgress.opportunity,
      ...progress,
      updatedAt: new Date().toISOString(),
    });
    if (updated) onProjectChange(updated);
  };

  const generate = async () => {
    if (!cards) return;
    setBusy('generate');
    try {
      const result = await generateOpportunityCandidates(userId, project);
      const retained = cards.filter((card) => card.reviewStatus === 'confirmed');
      const scoredCandidates = result.cards.map((card) => ({
        ...card,
        ...scoreOpportunity(card, project, userLook, self, marketLook, competitorLook),
      }));
      const nextCards = [...retained, ...scoredCandidates];
      const nextConclusion: OpportunityConclusion = {
        resultStatus: nextCards.length ? 'opportunities' : result.resultStatus,
        reasons: retained.length && result.resultStatus !== 'opportunities'
          ? [...result.reasons, 'AI 本次未识别到新机会；已保留此前人工确认的机会，请人工决定是否撤销。']
          : result.reasons,
        reviewed: false,
        updatedAt: new Date().toISOString(),
      };
      setConclusion(nextConclusion);
      await persist(nextCards, nextConclusion);
      setSelectedId(scoredCandidates[0]?.id ?? retained[0]?.id ?? '');
      toast.success(result.resultStatus === 'opportunities' ? `生成 ${scoredCandidates.length} 个候选机会` : 'AI 已返回明确结论');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '机会生成失败');
    } finally {
      setBusy('');
    }
  };

  const addFromNeed = async (needId: string) => {
    if (!cards || !userLook) return;
    const need = userLook.unmetNeedCandidates.find((item) => item.id === needId);
    if (!need) return;
    let card = createOpportunityFromUnmetNeed(project.id, need);
    const scored = scoreOpportunity(card, project, userLook, self, marketLook, competitorLook);
    card = { ...card, ...scored, updatedAt: new Date().toISOString() };
    const next = [...cards, card];
    await persist(next, { resultStatus: 'opportunities', reasons: [], reviewed: false, updatedAt: new Date().toISOString() });
    setConclusion({ resultStatus: 'opportunities', reasons: [], reviewed: false, updatedAt: new Date().toISOString() });
    setSelectedId(card.id);
    setDetailOpen(true);
  };

  const updateCard = async (id: string, patch: Partial<OpportunityCard>, record?: string) => {
    if (!cards) return;
    const now = new Date().toISOString();
    const next = cards.map((card) => card.id === id ? {
      ...card,
      ...patch,
      humanEdits: record ? [...(card.humanEdits ?? []), { at: now, summary: `人工修改 ${record}` }] : card.humanEdits,
      updatedAt: now,
    } : card);
    await persist(next);
  };

  const mergeCards = async () => {
    if (!cards || selectedForMerge.length < 2) return;
    const picked = cards.filter((card) => selectedForMerge.includes(card.id));
    const base = picked.slice().sort((a, b) => b.score - a.score)[0];
    const merged: OpportunityCard = {
      ...base,
      id: `o_merge_${Date.now().toString(36)}`,
      title: picked.map((card) => card.title).join(' + '),
      needStatement: [...new Set(picked.map((card) => card.needStatement).filter(Boolean))].join('；'),
      evidenceRefs: [...new Map(picked.flatMap((card) => card.evidenceRefs ?? []).map((ref) => [ref.id, ref])).values()],
      reasoning: picked.flatMap((card) => card.reasoning ?? []),
      counterEvidence: [...new Set(picked.flatMap((card) => card.counterEvidence ?? []))],
      missingEvidence: [...new Set(picked.flatMap((card) => card.missingEvidence ?? []))],
      reviewStatus: 'ai_candidate',
      decision: 'undecided',
      humanEdits: [...(base.humanEdits ?? []), { at: new Date().toISOString(), summary: `合并机会：${selectedForMerge.join(', ')}` }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const next = [...cards.filter((card) => !selectedForMerge.includes(card.id)), merged];
    await persist(next);
    setSelectedForMerge([]);
    setSelectedId(merged.id);
    toast.success('已合并为一个新的待审核机会');
  };

  const selected = cards?.find((card) => card.id === selectedId);
  const confirmedCount = cards?.filter((card) => card.reviewStatus === 'confirmed').length ?? 0;
  const candidates = cards?.filter((card) => card.reviewStatus !== 'confirmed').length ?? 0;
  const unlinkedNeeds = userLook?.unmetNeedCandidates.filter((need) => !cards?.some((card) => card.unmetNeedId === need.id)) ?? [];
  const outcomeText = conclusion?.resultStatus === 'no_opportunity'
    ? '当前证据表明：没有达到立项标准的机会。'
    : conclusion?.resultStatus === 'insufficient_evidence'
      ? '当前是证据不足，不等同于没有机会。'
      : confirmedCount
        ? `已人工确认 ${confirmedCount} 个机会。`
        : candidates
          ? `AI 已生成 ${candidates} 个候选，等待人工审核。`
          : '尚未结合五看生成机会结论。';

  if (!cards || !userLook || !marketLook || !competitorLook || !self) {
    return <div className="flex items-center justify-center py-20 text-sm text-[#aeaeb2]"><Loader2 className="w-4 h-4 animate-spin mr-2" /> 正在加载机会结论...</div>;
  }

  if (detailOpen && selected) {
    return (
      <OpportunityDetail
        card={selected}
        busy={busy}
        onBack={() => setDetailOpen(false)}
        onUpdate={(patch, field) => void updateCard(selected.id, patch, field)}
        onReview={async () => {
          setBusy('review');
          try {
            const review = await reviewOpportunityCounterEvidence(selected);
            await updateCard(selected.id, review);
            toast.success('反证审查完成');
          } catch (error) {
            toast.error(error instanceof Error ? error.message : '反证审查失败');
          } finally { setBusy(''); }
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <FiveLookSummaryShell
        eyebrow="Five Looks / Opportunity"
        title="看机会 · 0–N 个可信结论"
        judgement={outcomeText}
        description="AI 负责综合四看并提出候选，人负责确认、调整或否决。没有机会是有效结果；证据不足必须单独标记。"
        statusBadge={<span className="rounded-full border border-black/5 bg-[#f5f5f7] px-2.5 py-1 text-[11px] font-semibold text-[#86868b]">{LOOK_STATUS_LABELS[project.fiveLookProgress.opportunity.status]} · {project.fiveLookProgress.opportunity.completionPercent}%</span>}
        metrics={[
          { label: 'AI 候选', value: `${candidates}`, tone: candidates ? 'brand' : 'neutral' },
          { label: '人工确认', value: `${confirmedCount}`, tone: confirmedCount ? 'good' : 'neutral' },
          { label: '目标细分', value: marketLook.selectedOpportunitySegment || '未选择', tone: marketLook.selectedOpportunitySegment ? 'brand' : 'warn' },
          { label: '结论类型', value: conclusion?.resultStatus === 'no_opportunity' ? '无机会' : conclusion?.resultStatus === 'insufficient_evidence' ? '证据不足' : '机会判断', tone: conclusion?.resultStatus === 'insufficient_evidence' ? 'warn' : 'neutral' },
        ]}
        sections={[]}
      />

      <Card className={cn(conclusion?.resultStatus === 'no_opportunity' && 'border-emerald-200 bg-emerald-50/30', conclusion?.resultStatus === 'insufficient_evidence' && 'border-amber-200 bg-amber-50/30')}>
        <div className="p-5 flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold text-[#1d1d1f]">AI 综合判断</p>
            <p className="text-sm text-[#424245] mt-1 leading-6">{outcomeText}</p>
            {(conclusion?.reasons ?? []).map((reason) => <p key={reason} className="text-xs text-[#86868b] mt-1">· {reason}</p>)}
          </div>
          <div className="flex flex-wrap gap-2">
            {conclusion?.resultStatus === 'no_opportunity' && !conclusion.reviewed && (
              <button type="button" onClick={async () => { const next = { ...conclusion, reviewed: true }; setConclusion(next); await persist(cards, next); }} className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700"><Check className="w-3.5 h-3.5" />确认“无机会”</button>
            )}
            <button type="button" onClick={() => void generate()} disabled={busy === 'generate'} className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
              {busy === 'generate' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}{conclusion ? '重新生成候选' : 'AI 生成机会'}
            </button>
            <button type="button" onClick={async () => { setBusy('export'); try { downloadHtmlReport(await buildOpportunityHtmlReport(userId, project), `${project.name}-机会洞察报告.html`); } finally { setBusy(''); } }} className="inline-flex items-center gap-1.5 rounded-xl border border-black/8 bg-white px-3 py-2 text-xs font-semibold text-[#424245]"><Download className="w-3.5 h-3.5" />导出 HTML</button>
          </div>
        </div>
      </Card>

      {unlinkedNeeds.length > 0 && (
        <Card>
          <div className="p-4">
            <p className="text-xs font-semibold text-[#424245] mb-2">未转为机会的需求（可人工添加，不必等待 AI）</p>
            <div className="flex flex-wrap gap-2">{unlinkedNeeds.map((need) => <button key={need.id} type="button" onClick={() => void addFromNeed(need.id)} className="inline-flex items-center gap-1 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700"><Plus className="w-3 h-3" />{need.category || need.needStatement || '未命名需求'}</button>)}</div>
          </div>
        </Card>
      )}

      {selectedForMerge.length >= 2 && <div className="sticky top-3 z-10 flex justify-end"><button type="button" onClick={() => void mergeCards()} className="inline-flex items-center gap-1.5 rounded-xl bg-[#1d1d1f] px-4 py-2 text-xs font-semibold text-white shadow-lg"><Merge className="w-3.5 h-3.5" />合并 {selectedForMerge.length} 个机会</button></div>}

      {cards.length ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {cards.slice().sort((a, b) => b.score - a.score).map((card) => (
            <Card key={card.id} className={card.reviewStatus === 'confirmed' ? 'border-emerald-200' : ''}>
              <div className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2 min-w-0">
                    <input type="checkbox" checked={selectedForMerge.includes(card.id)} onChange={(event) => setSelectedForMerge((current) => event.target.checked ? [...current, card.id] : current.filter((id) => id !== card.id))} className="mt-1 accent-indigo-600" title="选择合并" />
                    <div><p className="text-sm font-semibold text-[#1d1d1f]">{card.title}</p><p className="text-xs text-[#86868b] mt-1">{card.opportunityType === 'market_growth' ? '市场增长 / 供需机会' : '竞对未满足需求'} · {card.reviewStatus === 'confirmed' ? '已确认' : 'AI 候选'}</p></div>
                  </div>
                  <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">{card.score} 分</span>
                </div>
                <p className="text-sm text-[#424245] leading-6 line-clamp-3">{card.needStatement || '尚未补充具体未满足需求。'}</p>
                <div className="grid grid-cols-5 gap-1 text-center">{Object.entries(card.scoreBreakdown ?? {}).map(([key, value]) => <div key={key} className="rounded-lg bg-[#fafafa] px-1 py-2"><p className="text-[10px] text-[#86868b]">{{ demandStrength: '需求', marketOpportunity: '市场', competitorGap: '竞对', selfFit: '自身', evidenceConfidence: '证据' }[key] ?? key}</p><p className="text-xs font-semibold text-[#424245]">{value}</p></div>)}</div>
                <div className="flex flex-wrap items-center gap-2 border-t border-black/5 pt-3">
                  <select value={card.decision} onChange={(event) => void updateCard(card.id, { decision: event.target.value as OpportunityDecision }, 'decision')} className="rounded-xl border border-black/8 bg-white px-2.5 py-2 text-xs font-semibold"><option value="undecided">待决定</option><option value="enter">建议进入</option><option value="validate_first">待补证</option><option value="hold">暂缓</option><option value="reject">放弃</option></select>
                  {card.reviewStatus !== 'confirmed' && <button type="button" onClick={() => void updateCard(card.id, { reviewStatus: 'confirmed', decision: card.decision === 'undecided' ? 'hold' : card.decision }, 'reviewStatus')} className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700"><Check className="w-3.5 h-3.5" />确认</button>}
                  <button type="button" onClick={() => { setSelectedId(card.id); setDetailOpen(true); }} className="inline-flex items-center gap-1 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700"><SearchCheck className="w-3.5 h-3.5" />证据与推理</button>
                  <button type="button" onClick={() => void persist(cards.filter((item) => item.id !== card.id))} title="删除" className="ml-auto w-8 h-8 rounded-lg text-[#aeaeb2] hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card><div className="p-10 text-center"><AlertTriangle className="w-7 h-7 text-amber-500 mx-auto mb-3" /><p className="text-sm font-semibold text-[#1d1d1f]">当前没有机会卡</p><p className="text-sm text-[#86868b] mt-2">可以运行 AI 综合判断；AI 允许输出 0 个机会，也可以从用户需求手动添加。</p></div></Card>
      )}

      {project.fiveLookProgress.opportunity.status === 'stale' && <Card className="border-rose-100 bg-rose-50/50"><div className="p-4 text-sm text-rose-700">上游结论已变化，当前机会结论需要重新生成或人工复核。<button type="button" onClick={() => onNavigateLook('user')} className="ml-2 underline">回看需求主线</button></div></Card>}
    </div>
  );
}

function OpportunityDetail({
  card,
  busy,
  onBack,
  onUpdate,
  onReview,
}: {
  card: OpportunityCard;
  busy: string;
  onBack: () => void;
  onUpdate: (patch: Partial<OpportunityCard>, field?: string) => void;
  onReview: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3"><button type="button" onClick={onBack} className="w-9 h-9 rounded-xl border border-black/8 bg-white text-[#86868b] hover:text-indigo-600 flex items-center justify-center"><ArrowLeft className="w-4 h-4" /></button><div><p className="text-xs font-semibold text-indigo-600">机会详情 / 原始证据与推理</p><h3 className="text-xl font-bold text-[#1d1d1f] mt-1">{card.title}</h3></div></div>
      <Card><div className="p-5 space-y-3"><Editable label="机会标题" value={card.title} onChange={(value) => onUpdate({ title: value }, 'title')} /><Editable label="未满足需求" value={card.needStatement} multiline onChange={(value) => onUpdate({ needStatement: value }, 'needStatement')} /><Editable label="解决假设" value={card.solutionHypothesis} multiline onChange={(value) => onUpdate({ solutionHypothesis: value }, 'solutionHypothesis')} /></div></Card>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <EvidenceSection title="原始证据" items={(card.evidenceRefs ?? []).map((ref) => `[${ref.look}] ${ref.label}：${ref.excerpt}`)} />
        <EvidenceSection title="推理过程" items={(card.reasoning ?? []).map((step) => `${step.judgement} → ${step.conclusion}（证据：${step.evidenceIds.join(', ') || '未标注'}）`)} />
        <EvidenceSection title="反证 / 冲突证据" items={card.counterEvidence ?? []} tone="warn" />
        <EvidenceSection title="缺失证据" items={card.missingEvidence ?? []} tone="warn" />
        <EvidenceSection title="人工修改记录" items={(card.humanEdits ?? []).map((edit) => `${new Date(edit.at).toLocaleString('zh-CN')} · ${edit.summary}`)} />
      </div>
      <div className="flex justify-end"><button type="button" disabled={busy === 'review'} onClick={onReview} className="inline-flex items-center gap-1.5 rounded-xl bg-[#1d1d1f] px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{busy === 'review' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}AI 反证审查</button></div>
    </div>
  );
}

function Editable({ label, value, multiline, onChange }: { label: string; value: string; multiline?: boolean; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => { if (draft !== value) onChange(draft); };
  return <label className="block"><span className="block text-xs font-semibold text-[#86868b] mb-1">{label}</span>{multiline ? <textarea rows={4} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} className="w-full rounded-xl border border-black/8 bg-[#fafafa] px-3 py-2 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none" /> : <input value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} className="w-full rounded-xl border border-black/8 bg-[#fafafa] px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />}</label>;
}

function EvidenceSection({ title, items, tone = 'neutral' }: { title: string; items: string[]; tone?: 'neutral' | 'warn' }) {
  return <Card className={tone === 'warn' ? 'border-amber-100 bg-amber-50/30' : ''}><div className="p-5"><p className="text-sm font-semibold text-[#1d1d1f] mb-3">{title}</p>{items.length ? <div className="space-y-2">{items.map((item, index) => <p key={`${item}-${index}`} className="rounded-xl border border-black/5 bg-white px-3 py-2 text-sm text-[#424245] leading-6">{item}</p>)}</div> : <p className="rounded-xl border border-dashed border-black/10 p-5 text-sm text-[#86868b]">暂无记录。这不代表不存在，请补证或运行反证审查。</p>}</div></Card>;
}
