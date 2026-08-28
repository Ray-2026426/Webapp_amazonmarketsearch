import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Users,
  Sparkles,
  Plus,
  X,
  CheckCircle2,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { cn } from './ui/Card';
import { Card } from './ui/Card';
import { toast } from 'sonner';
import {
  loadUserLook,
  saveUserLook,
  computeUserProgress,
  emptyUnmetNeedCandidate,
  EVIDENCE_STRENGTH_LABELS,
  type UserContext,
  type UserLookData,
  type UnmetNeedCandidate,
  type EvidenceStrength,
} from '../utils/userLook';
import { updateLookProgress } from '../utils/projectStore';
import { runLookAnalysis, type UserAnalysisOutput } from '../utils/lookAi';
import type { ResearchProject } from '../types/researchProject';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const STRENGTHS: EvidenceStrength[] = ['high', 'medium', 'low'];

export function UserLookView({
  userId,
  project,
  userContext,
  onProjectChange,
}: {
  userId: string;
  project: ResearchProject;
  userContext: UserContext;
  onProjectChange: (updated: ResearchProject) => void;
}) {
  const [data, setData] = useState<UserLookData | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [aiRunning, setAiRunning] = useState(false);
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

  const persist = useCallback(
    async (d: UserLookData) => {
      setSaveState('saving');
      try {
        await saveUserLook(userId, project.id, d);
        const progress = computeUserProgress(d);
        const updated = await updateLookProgress(userId, project.id, 'user', {
          ...project.fiveLookProgress.user,
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
    [userId, project.id, project.fiveLookProgress, onProjectChange]
  );

  const scheduleSave = useCallback(
    (next: UserLookData) => {
      setData(next);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void persist(next);
      }, 500);
    },
    [persist]
  );

  if (!data) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-[#aeaeb2]">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> 正在加载…
      </div>
    );
  }

  const update = (patch: Partial<UserLookData>) => scheduleSave({ ...data, ...patch });

  const runAi = async () => {
    setAiRunning(true);
    try {
      const res = await runLookAnalysis('user');
      if (!res.ok || !res.data) {
        toast.error(res.error || 'AI 分析失败');
        return;
      }
      const out = res.data as UserAnalysisOutput;
      update({
        targetUser: out.targetUser ?? data.targetUser,
        scenario: out.scenario ?? data.scenario,
        jobToBeDone: out.jobToBeDone ?? data.jobToBeDone,
        satisfiedNeeds: Array.isArray(out.satisfiedNeeds) ? out.satisfiedNeeds : data.satisfiedNeeds,
        unmetNeedCandidates: Array.isArray(out.unmetNeedCandidates)
          ? out.unmetNeedCandidates.map((c) => ({
              ...emptyUnmetNeedCandidate(),
              ...c,
              evidenceStrength: c.evidenceStrength === 'high' || c.evidenceStrength === 'low' ? c.evidenceStrength : 'medium',
            }))
          : data.unmetNeedCandidates,
      });
    } finally {
      setAiRunning(false);
    }
  };

  const updateCandidate = (id: string, patch: Partial<UnmetNeedCandidate>) => {
    update({ unmetNeedCandidates: data.unmetNeedCandidates.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  };

  const addCandidate = () => update({ unmetNeedCandidates: [...data.unmetNeedCandidates, emptyUnmetNeedCandidate()] });
  const removeCandidate = (id: string) => update({ unmetNeedCandidates: data.unmetNeedCandidates.filter((c) => c.id !== id) });

  const updateList = (key: 'satisfiedNeeds', index: number, value: string) => {
    const next = [...data[key]];
    next[index] = value;
    update({ [key]: next } as Partial<UserLookData>);
  };
  const addList = (key: 'satisfiedNeeds') => update({ [key]: [...data[key], ''] } as Partial<UserLookData>);
  const removeList = (key: 'satisfiedNeeds', index: number) => update({ [key]: data[key].filter((_, i) => i !== index) } as Partial<UserLookData>);

  return (
    <div className="space-y-4">
      {/* 头部 */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center shrink-0">
            <Users className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[#1d1d1f]">看用户 · 需求地图</h3>
            <p className="text-sm text-[#86868b] mt-0.5 max-w-xl">
              把关键词与评论 VOC 合并为「谁在什么场景完成什么任务」，识别未被充分满足的需求。
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={aiRunning}
            onClick={() => void runAi()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-all active:scale-[0.98]"
          >
            {aiRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            AI 生成结论
          </button>
          <SaveBadge state={saveState} />
        </div>
      </div>

      {/* 用户需求地图：目标用户 / 场景 / JTBD */}
      <Card>
        <div className="p-5 space-y-4">
          <p className="text-sm font-semibold text-[#1d1d1f]">用户需求地图</p>
          <Field label="目标用户">
            <input value={data.targetUser} onChange={(e) => update({ targetUser: e.target.value })} placeholder="例如：美国站侧睡人群、颈椎不适的上班族" className={inputCls} />
          </Field>
          <Field label="使用场景">
            <input value={data.scenario} onChange={(e) => update({ scenario: e.target.value })} placeholder="例如：睡前、久坐办公、旅行途中" className={inputCls} />
          </Field>
          <Field label="用户任务 / JTBD">
            <textarea value={data.jobToBeDone} onChange={(e) => update({ jobToBeDone: e.target.value })} rows={2} placeholder="用户希望完成什么任务？例如：侧睡时保持颈椎中立、不闷热" className={inputCls} />
          </Field>
        </div>
      </Card>

      {/* 已满足需求 */}
      <StringListCard title="已满足需求" hint="现有产品已经较好满足的需求，用于对照" value={data.satisfiedNeeds} onAdd={() => addList('satisfiedNeeds')} onChange={(i, v) => updateList('satisfiedNeeds', i, v)} onRemove={(i) => removeList('satisfiedNeeds', i)} />

      {/* 未满足需求候选 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f]">未满足需求候选</p>
            <p className="text-xs text-[#aeaeb2] mt-0.5">每个候选都要能说明：目标用户 + 场景 + 任务 + 当前替代方案 + 证据强度</p>
          </div>
          <button type="button" onClick={addCandidate} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-all active:scale-[0.98]">
            <Plus className="w-3.5 h-3.5" /> 添加未满足需求
          </button>
        </div>
        {data.unmetNeedCandidates.length === 0 ? (
          <Card className="py-10 text-center">
            <p className="text-sm text-[#aeaeb2]">尚未添加未满足需求候选</p>
          </Card>
        ) : (
          data.unmetNeedCandidates.map((c, i) => (
            <UnmetNeedCard key={c.id} index={i} candidate={c} onChange={(patch) => updateCandidate(c.id, patch)} onRemove={() => removeCandidate(c.id)} />
          ))
        )}
      </div>
    </div>
  );
}

function UnmetNeedCard({
  index,
  candidate,
  onChange,
  onRemove,
}: {
  index: number;
  candidate: UnmetNeedCandidate;
  onChange: (patch: Partial<UnmetNeedCandidate>) => void;
  onRemove: () => void;
}) {
  return (
    <Card>
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-[#86868b]">未满足需求 #{index + 1}</span>
          <button type="button" onClick={onRemove} className="w-8 h-8 rounded-lg hover:bg-rose-50 flex items-center justify-center text-[#aeaeb2] hover:text-rose-500 transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <Field label="未满足需求">
          <textarea value={candidate.needStatement} onChange={(e) => onChange({ needStatement: e.target.value })} rows={2} placeholder="当前产品没有充分满足什么？" className={inputCls} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <Field label="目标用户">
            <input value={candidate.targetUser} onChange={(e) => onChange({ targetUser: e.target.value })} placeholder="谁存在这个需求" className={inputCls} />
          </Field>
          <Field label="使用场景">
            <input value={candidate.scenario} onChange={(e) => onChange({ scenario: e.target.value })} placeholder="在什么情况下" className={inputCls} />
          </Field>
          <Field label="用户任务 / JTBD">
            <input value={candidate.jobToBeDone} onChange={(e) => onChange({ jobToBeDone: e.target.value })} placeholder="需要完成什么任务" className={inputCls} />
          </Field>
          <Field label="当前替代方案">
            <input value={candidate.currentAlternative} onChange={(e) => onChange({ currentAlternative: e.target.value })} placeholder="用户现在怎么解决，代价是什么" className={inputCls} />
          </Field>
        </div>
        <div className="mt-3">
          <p className="text-xs font-semibold text-[#424245] mb-1.5">证据强度</p>
          <div className="flex items-center gap-1.5">
            {STRENGTHS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onChange({ evidenceStrength: s })}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all active:scale-[0.96]',
                  candidate.evidenceStrength === s
                    ? s === 'high' ? 'bg-emerald-600 text-white border-emerald-600' : s === 'medium' ? 'bg-amber-500 text-white border-amber-500' : 'bg-rose-500 text-white border-rose-500'
                    : 'bg-white text-[#aeaeb2] border-black/5 hover:text-[#424245] hover:border-black/10'
                )}
              >
                {EVIDENCE_STRENGTH_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function StringListCard({
  title,
  hint,
  value,
  onAdd,
  onChange,
  onRemove,
}: {
  title: string;
  hint: string;
  value: string[];
  onAdd: () => void;
  onChange: (index: number, value: string) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <Card>
      <div className="p-5">
        <p className="text-sm font-semibold text-[#1d1d1f] mb-1">{title}</p>
        <p className="text-xs text-[#aeaeb2] mb-3">{hint}</p>
        <div className="space-y-2">
          {value.map((v, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={v} onChange={(e) => onChange(i, e.target.value)} placeholder={`第 ${i + 1} 条`} className={inputCls} />
              <button type="button" onClick={() => onRemove(i)} className="shrink-0 w-8 h-8 rounded-lg hover:bg-[#f5f5f7] flex items-center justify-center text-[#aeaeb2] hover:text-rose-500 transition-colors"><X className="w-4 h-4" /></button>
            </div>
          ))}
          <button type="button" onClick={onAdd} className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 transition-colors">
            <Plus className="w-3.5 h-3.5" /> 添加
          </button>
        </div>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-[#424245] mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  if (state === 'idle' || state === 'saved') return null;
  const map: Record<SaveState, { icon: typeof CheckCircle2; text: string; cls: string }> = {
    idle: { icon: CheckCircle2, text: '', cls: '' },
    saving: { icon: Loader2, text: '保存中…', cls: 'text-amber-600' },
    saved: { icon: CheckCircle2, text: '', cls: '' },
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

const inputCls =
  'w-full px-3 py-2.5 rounded-xl border border-black/8 bg-gradient-to-b from-white to-[#f8f9fb] text-sm text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300 transition-all';
