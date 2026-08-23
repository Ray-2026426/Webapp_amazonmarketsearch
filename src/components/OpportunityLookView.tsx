import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  Plus,
  X,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  ClipboardCheck,
  ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from './ui/Card';
import { Card } from './ui/Card';
import { Select } from './ui/Select';
import {
  loadOpportunities,
  saveOpportunities,
  createOpportunityFromUnmetNeed,
  createOpportunityId,
  scoreOpportunity,
} from '../utils/opportunityStore';
import { loadUserLook, type UserLookData, type UnmetNeedCandidate } from '../utils/userLook';
import { loadSelfAssessment, type SelfAssessment } from '../utils/selfAssessment';
import { updateLookProgress } from '../utils/projectStore';
import {
  FIVE_LOOK_LABELS,
  LOOK_STATUS_LABELS,
  type OpportunityCard,
  type OpportunityDecision,
  type ResearchProject,
} from '../types/researchProject';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const DECISIONS: { value: OpportunityDecision; label: string }[] = [
  { value: 'enter', label: '进入' },
  { value: 'validate_first', label: '验证后进入' },
  { value: 'hold', label: '暂缓' },
  { value: 'reject', label: '放弃' },
  { value: 'undecided', label: '未决定' },
];

function computeOpportunityProgress(cards: OpportunityCard[], project: ResearchProject) {
  const fourLooksComplete = ['market', 'user', 'competitor', 'self'].every(
    (l) => project.fiveLookProgress[l as keyof ResearchProject['fiveLookProgress']].status === 'completed'
  );
  const hasCards = cards.length > 0;
  const hasDecided = cards.some((c) => c.decision !== 'undecided');
  const filled = (hasCards ? 1 : 0) + (hasDecided ? 1 : 0) + (fourLooksComplete ? 1 : 0);
  const completionPercent = Math.round((filled / 3) * 100);
  let status: 'not_started' | 'in_progress' | 'completed' | 'stale' = 'not_started';
  if (filled > 0 && filled < 3) status = 'in_progress';
  else if (filled === 3) status = 'completed';
  const missing: string[] = [];
  if (!hasCards) missing.push('缺少「机会卡」');
  if (!hasDecided) missing.push('机会卡尚未给出决策');
  if (!fourLooksComplete) missing.push('前四看尚未全部完成');
  return { status, completionPercent, missingRequirements: missing };
}

export function OpportunityLookView({
  userId,
  project,
  onProjectChange,
}: {
  userId: string;
  project: ResearchProject;
  onProjectChange: (updated: ResearchProject) => void;
}) {
  const [cards, setCards] = useState<OpportunityCard[] | null>(null);
  const [userLook, setUserLook] = useState<UserLookData | null>(null);
  const [self, setSelf] = useState<SelfAssessment | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadOpportunities(userId, project.id), loadUserLook(userId, project.id), loadSelfAssessment(userId, project.id)]).then(
      ([opps, u, s]) => {
        if (cancelled) return;
        setCards(opps);
        setUserLook(u);
        setSelf(s);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [userId, project.id]);

  const persist = useCallback(
    async (nextCards: OpportunityCard[]) => {
      setSaveState('saving');
      try {
        const scored = nextCards.map((c) => {
          const { score, coverage } = scoreOpportunity(c, project, userLook, self);
          return { ...c, score, coverage, updatedAt: new Date().toISOString() };
        });
        await saveOpportunities(userId, project.id, scored);
        setCards(scored);
        const progress = computeOpportunityProgress(scored, project);
        const updated = await updateLookProgress(userId, project.id, 'opportunity', {
          ...project.fiveLookProgress.opportunity,
          status: progress.status,
          completionPercent: progress.completionPercent,
          missingRequirements: progress.missingRequirements,
          updatedAt: new Date().toISOString(),
        });
        if (updated) onProjectChange(updated);
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    },
    [userId, project.id, project.fiveLookProgress.opportunity, project.fiveLookProgress, userLook, self, onProjectChange]
  );

  const scheduleSave = useCallback(
    (nextCards: OpportunityCard[]) => {
      setCards(nextCards);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void persist(nextCards);
      }, 500);
    },
    [persist]
  );

  if (!cards || !userLook) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-[#aeaeb2]">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> 正在加载…
      </div>
    );
  }

  const updateCard = (id: string, patch: Partial<OpportunityCard>) => {
    scheduleSave(cards.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };
  const removeCard = (id: string) => scheduleSave(cards.filter((c) => c.id !== id));

  const addRisk = (cardId: string) => {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    updateCard(cardId, { risks: [...card.risks, { id: `r_${Date.now()}`, category: 'demand', label: '', severity: 'medium', description: '' }] });
  };
  const updateRisk = (cardId: string, riskId: string, label: string) => {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    updateCard(cardId, { risks: card.risks.map((r) => (r.id === riskId ? { ...r, label } : r)) });
  };
  const removeRisk = (cardId: string, riskId: string) => {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    updateCard(cardId, { risks: card.risks.filter((r) => r.id !== riskId) });
  };
  const addAction = (cardId: string) => {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    updateCard(cardId, { validationActions: [...card.validationActions, { id: `v_${Date.now()}`, action: '', owner: '', successCriteria: '' }] });
  };
  const updateAction = (cardId: string, actionId: string, action: string) => {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    updateCard(cardId, { validationActions: card.validationActions.map((a) => (a.id === actionId ? { ...a, action } : a)) });
  };
  const removeAction = (cardId: string, actionId: string) => {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    updateCard(cardId, { validationActions: card.validationActions.filter((a) => a.id !== actionId) });
  };
  const updateProfit = (cardId: string, patch: Partial<{ price: number; cost: number; cpc: number }>) => {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    const cur = card.profitAssumption ?? { price: 0, cost: 0, cpc: 0 };
    updateCard(cardId, { profitAssumption: { ...cur, ...patch } });
  };

  const generateFromCandidate = (candidate: UnmetNeedCandidate) => {
    const card = createOpportunityFromUnmetNeed(project.id, candidate);
    const next = [...cards, card];
    scheduleSave(next);
    toast.success('已生成机会卡');
  };

  const usedNeedIds = new Set(cards.map((c) => c.unmetNeedId));
  const candidates = (userLook.unmetNeedCandidates ?? []).filter((c) => !usedNeedIds.has(c.id));
  const sortedCards = [...cards].sort((a, b) => b.score - a.score);

  return (
    <div className="space-y-4">
      {/* 头部 + 提交评审 */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[#1d1d1f]">看/找机会 · 机会卡</h3>
            <p className="text-sm text-[#86868b] mt-0.5 max-w-xl">
              把未满足需求转化为可比较、可验证、可决策的机会；评分只辅助排序，不替代负责人决策。
            </p>
          </div>
        </div>
        <SubmitReview project={project} />
      </div>

      {/* 从未满足需求生成 */}
      <Card>
        <div className="p-5">
          <p className="text-sm font-semibold text-[#1d1d1f] mb-1">从未满足需求生成机会卡</p>
          <p className="text-xs text-[#aeaeb2] mb-3">来源：看用户里已录入的未满足需求候选</p>
          {candidates.length === 0 ? (
            <p className="text-xs text-[#aeaeb2]">
              {cards.length > 0 ? '所有未满足需求都已生成机会卡。' : '暂无未满足需求候选，请先到「看用户」录入。'}
            </p>
          ) : (
            <div className="space-y-2">
              {candidates.map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-3 rounded-xl border border-black/5 bg-[#fafafa] p-3">
                  <div className="min-w-0">
                    <p className="text-sm text-[#1d1d1f] font-medium">{c.needStatement || '（未命名需求）'}</p>
                    <p className="text-xs text-[#86868b] mt-0.5">
                      {c.targetUser || '未定用户'} · {c.jobToBeDone || '未定任务'} · 证据强度 {c.evidenceStrength === 'high' ? '高' : c.evidenceStrength === 'medium' ? '中' : '低'}
                    </p>
                  </div>
                  <button type="button" onClick={() => generateFromCandidate(c)} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-all active:scale-[0.98]">
                    <Plus className="w-3.5 h-3.5" /> 生成机会卡
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <DecisionSummary cards={sortedCards} />
      <PriorityMatrix cards={sortedCards} />

      {/* 机会卡列表 */}
      {sortedCards.length === 0 ? (
        <Card className="py-12 text-center">
          <Sparkles className="w-6 h-6 text-[#c7c7cc] mx-auto mb-2" />
          <p className="text-sm text-[#aeaeb2]">还没有机会卡</p>
        </Card>
      ) : (
        sortedCards.map((card) => (
          <OpportunityCardEditor
            key={card.id}
            card={card}
            onChange={(patch) => updateCard(card.id, patch)}
            onRemove={() => removeCard(card.id)}
            onAddRisk={() => addRisk(card.id)}
            onUpdateRisk={(rid, v) => updateRisk(card.id, rid, v)}
            onRemoveRisk={(rid) => removeRisk(card.id, rid)}
            onAddAction={() => addAction(card.id)}
            onUpdateAction={(aid, v) => updateAction(card.id, aid, v)}
            onRemoveAction={(aid) => removeAction(card.id, aid)}
            profitAssumption={card.profitAssumption}
            onProfitChange={(patch) => updateProfit(card.id, patch)}
          />
        ))
      )}

      <SaveBadge state={saveState} />
    </div>
  );
}

function SubmitReview({ project }: { project: ResearchProject }) {
  const fourLooks = ['market', 'user', 'competitor', 'self'] as const;
  const allDone = fourLooks.every((l) => project.fiveLookProgress[l].status === 'completed');
  const doneCount = fourLooks.filter((l) => project.fiveLookProgress[l].status === 'completed').length;
  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <button
        type="button"
        disabled={!allDone}
        onClick={() => toast.info('已具备提交条件（评审与决策流将在 Phase 2 完善）')}
        className={cn(
          'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all',
          allDone
            ? 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white border-transparent hover:from-indigo-600 hover:to-violet-600 active:scale-[0.98]'
            : 'bg-white text-[#aeaeb2] border-black/8 cursor-not-allowed'
        )}
      >
        <ClipboardCheck className="w-3.5 h-3.5" />
        提交评审
      </button>
      <span className="text-[11px] text-[#aeaeb2]">前四看完成 {doneCount}/4</span>
    </div>
  );
}

function OpportunityCardEditor({
  card,
  onChange,
  onRemove,
  onAddRisk,
  onUpdateRisk,
  onRemoveRisk,
  onAddAction,
  onUpdateAction,
  onRemoveAction,
  profitAssumption,
  onProfitChange,
}: {
  card: OpportunityCard;
  onChange: (patch: Partial<OpportunityCard>) => void;
  onRemove: () => void;
  onAddRisk: () => void;
  onUpdateRisk: (id: string, label: string) => void;
  onRemoveRisk: (id: string) => void;
  onAddAction: () => void;
  onUpdateAction: (id: string, action: string) => void;
  onRemoveAction: (id: string) => void;
  profitAssumption?: { price: number; cost: number; cpc: number };
  onProfitChange: (patch: Partial<{ price: number; cost: number; cpc: number }>) => void;
}) {
  return (
    <Card>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <input
              value={card.title}
              onChange={(e) => onChange({ title: e.target.value })}
              placeholder="机会名称（以需求或任务命名）"
              className="w-full text-base font-semibold text-[#1d1d1f] bg-transparent border-b border-transparent focus:border-indigo-300 focus:outline-none pb-1"
            />
            <p className="text-xs text-[#86868b] mt-1 truncate">{card.needStatement}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="rounded-full bg-indigo-50 text-indigo-700 px-2 py-0.5 text-[11px] font-semibold">评分 {card.score}</span>
            <span className="rounded-full bg-[#f5f5f7] text-[#86868b] px-2 py-0.5 text-[11px] font-semibold">覆盖 {Math.round(card.coverage * 100)}%</span>
            <button type="button" onClick={onRemove} className="w-8 h-8 rounded-lg hover:bg-rose-50 flex items-center justify-center text-[#aeaeb2] hover:text-rose-500 transition-colors"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div>
            <p className="text-xs font-semibold text-[#424245] mb-1.5">决策</p>
            <Select value={card.decision} onChange={(v) => onChange({ decision: v as OpportunityCard['decision'] })} options={DECISIONS} className="w-full" />
          </div>
          <div>
            <p className="text-xs font-semibold text-[#424245] mb-1.5">产品假设（如何更好地满足需求）</p>
            <textarea value={card.solutionHypothesis} onChange={(e) => onChange({ solutionHypothesis: e.target.value })} rows={2} placeholder="准备如何更好满足这个需求…" className={inputCls} />
          </div>
        </div>

        <div className="rounded-xl border border-black/5 bg-[#fafafa] p-3 mb-3">
          <p className="text-xs font-semibold text-[#424245] mb-2">商业可行性 · 利润假设</p>
          <div className="grid grid-cols-3 gap-3 mb-2">
            <ProfitField label="售价" value={profitAssumption?.price} onChange={(v) => onProfitChange({ price: v })} />
            <ProfitField label="采购成本" value={profitAssumption?.cost} onChange={(v) => onProfitChange({ cost: v })} />
            <ProfitField label="CPC" value={profitAssumption?.cpc} onChange={(v) => onProfitChange({ cpc: v })} />
          </div>
          <ProfitHint price={profitAssumption?.price} cost={profitAssumption?.cost} cpc={profitAssumption?.cpc} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-semibold text-[#424245]">主要风险</p>
              <button type="button" onClick={onAddRisk} className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"><Plus className="w-3.5 h-3.5" /> 添加</button>
            </div>
            <div className="space-y-1.5">
              {card.risks.length === 0 && <p className="text-xs text-[#c7c7cc]">无</p>}
              {card.risks.map((r) => (
                <div key={r.id} className="flex items-center gap-1.5">
                  <input value={r.label} onChange={(e) => onUpdateRisk(r.id, e.target.value)} placeholder="风险描述" className={inputCls} />
                  <button type="button" onClick={() => onRemoveRisk(r.id)} className="shrink-0 w-7 h-7 rounded-lg hover:bg-rose-50 flex items-center justify-center text-[#aeaeb2] hover:text-rose-500"><X className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-semibold text-[#424245]">验证动作</p>
              <button type="button" onClick={onAddAction} className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"><Plus className="w-3.5 h-3.5" /> 添加</button>
            </div>
            <div className="space-y-1.5">
              {card.validationActions.length === 0 && <p className="text-xs text-[#c7c7cc]">无</p>}
              {card.validationActions.map((a) => (
                <div key={a.id} className="flex items-center gap-1.5">
                  <input value={a.action} onChange={(e) => onUpdateAction(a.id, e.target.value)} placeholder="最小验证方式" className={inputCls} />
                  <button type="button" onClick={() => onRemoveAction(a.id)} className="shrink-0 w-7 h-7 rounded-lg hover:bg-rose-50 flex items-center justify-center text-[#aeaeb2] hover:text-rose-500"><X className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  const map: Record<SaveState, { icon: typeof CheckCircle2; text: string; cls: string }> = {
    idle: { icon: CheckCircle2, text: '', cls: '' },
    saving: { icon: Loader2, text: '保存中…', cls: 'text-amber-600' },
    saved: { icon: CheckCircle2, text: '已保存', cls: 'text-emerald-600' },
    error: { icon: AlertTriangle, text: '保存失败', cls: 'text-rose-600' },
  };
  const m = map[state];
  const Icon = m.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', m.cls)}>
      <Icon className={cn('w-3.5 h-3.5', state === 'saving' && 'animate-spin')} />
      {m.text}
    </span>
  );
}

function ProfitField({ label, value, onChange }: { label: string; value?: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-[#86868b] mb-1">{label}</span>
      <input
        type="number"
        value={value === undefined || value === 0 ? '' : value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        placeholder="0"
        className="w-full px-2.5 py-1.5 rounded-lg border border-black/8 bg-white text-sm text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300 transition-all"
      />
    </label>
  );
}

function ProfitHint({ price, cost, cpc }: { price?: number; cost?: number; cpc?: number }) {
  const p = Number(price) || 0;
  const cst = Number(cost) || 0;
  const cp = Number(cpc) || 0;
  const profit = p - cst - cp;
  const margin = p > 0 ? profit / p : 0;
  if (p <= 0) return <p className="text-[11px] text-[#c7c7cc]">填写售价后可计算毛利</p>;
  return (
    <p className={cn('text-[11px] font-medium', margin >= 0.2 ? 'text-emerald-600' : margin >= 0.1 ? 'text-amber-600' : 'text-rose-600')}>
      预估单件利润 {profit.toFixed(2)} · 毛利率 {Math.round(margin * 100)}%
    </p>
  );
}

function DecisionSummary({ cards }: { cards: OpportunityCard[] }) {
  if (cards.length === 0) return null;
  const decided = cards.filter((c) => c.decision !== 'undecided');
  const avgScore = Math.round(cards.reduce((s, c) => s + c.score, 0) / cards.length);
  const avgCov = Math.round((cards.reduce((s, c) => s + c.coverage, 0) / cards.length) * 100);
  const top = cards[0];
  return (
    <Card className="border-indigo-100 bg-gradient-to-r from-indigo-50/50 to-violet-50/50">
      <div className="p-5">
        <p className="text-sm font-semibold text-[#1d1d1f] mb-2">决策摘要</p>
        <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-xs text-[#424245]">
          <span>机会 {cards.length}</span>
          <span>已决策 {decided.length}</span>
          <span>平均评分 {avgScore}</span>
          <span>平均覆盖 {avgCov}%</span>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {DECISIONS.filter((d) => d.value !== 'undecided').map((d) => {
            const n = cards.filter((c) => c.decision === d.value).length;
            return n > 0 ? (
              <span key={d.value} className="rounded-full bg-white border border-black/8 px-2 py-0.5 text-[11px] text-[#424245]">
                {d.label} {n}
              </span>
            ) : null;
          })}
        </div>
        {top && <p className="text-xs text-[#86868b] mt-2">最高分：{top.title}（{top.score} 分）</p>}
      </div>
    </Card>
  );
}

function PriorityMatrix({ cards }: { cards: OpportunityCard[] }) {
  if (cards.length === 0) return null;
  const buckets: Record<'hh' | 'hl' | 'lh' | 'll', OpportunityCard[]> = { hh: [], hl: [], lh: [], ll: [] };
  for (const c of cards) {
    const highValue = c.score >= 50;
    const highCover = c.coverage >= 0.5;
    const k = highValue ? (highCover ? 'hh' : 'hl') : highCover ? 'lh' : 'll';
    buckets[k].push(c);
  }
  const cells: { k: 'hh' | 'hl' | 'lh' | 'll'; label: string; cls: string }[] = [
    { k: 'hh', label: '高价值 · 高覆盖（优先）', cls: 'bg-emerald-50 border-emerald-200' },
    { k: 'hl', label: '高价值 · 低覆盖（需补证据）', cls: 'bg-amber-50 border-amber-200' },
    { k: 'lh', label: '低价值 · 高覆盖（谨慎）', cls: 'bg-sky-50 border-sky-200' },
    { k: 'll', label: '低价值 · 低覆盖（待完善）', cls: 'bg-[#f5f5f7] border-black/10' },
  ];
  return (
    <Card>
      <div className="p-5">
        <p className="text-sm font-semibold text-[#1d1d1f] mb-3">机会优先级矩阵</p>
        <div className="grid grid-cols-2 gap-2">
          {cells.map((cell) => (
            <div key={cell.k} className={cn('rounded-2xl border p-3', cell.cls)}>
              <p className="text-[11px] font-semibold text-[#424245] mb-1.5">{cell.label}</p>
              {buckets[cell.k].length === 0 ? (
                <p className="text-xs text-[#c7c7cc]">无</p>
              ) : (
                buckets[cell.k].map((c) => (
                  <p key={c.id} className="text-xs text-[#424245] truncate">{c.title}（{c.score}）</p>
                ))
              )}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

const inputCls =
  'w-full px-3 py-2.5 rounded-xl border border-black/8 bg-gradient-to-b from-white to-[#f8f9fb] text-sm text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300 transition-all';
