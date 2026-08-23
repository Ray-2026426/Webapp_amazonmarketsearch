import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, AlertTriangle, ClipboardList } from 'lucide-react';
import { cn } from './ui/Card';
import { Card } from './ui/Card';
import {
  loadSelfAssessment,
  saveSelfAssessment,
  computeSelfProgress,
  SELF_CATEGORY_LABELS,
  SELF_CATEGORY_ORDER,
  SELF_STATUS_LABELS,
  type SelfAssessment,
  type SelfStatus,
} from '../utils/selfAssessment';
import { updateLookProgress } from '../utils/projectStore';
import type { ResearchProject } from '../types/researchProject';

const STATUS_ORDER: SelfStatus[] = ['have', 'partial', 'lack', 'unknown'];

const STATUS_PILL: Record<SelfStatus, string> = {
  have: 'bg-emerald-600 text-white border-emerald-600',
  partial: 'bg-amber-500 text-white border-amber-500',
  lack: 'bg-rose-500 text-white border-rose-500',
  unknown: 'bg-white text-[#86868b] border-black/8',
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function SelfAssessmentView({
  userId,
  project,
  onProjectChange,
}: {
  userId: string;
  project: ResearchProject;
  onProjectChange: (updated: ResearchProject) => void;
}) {
  const [assessment, setAssessment] = useState<SelfAssessment | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadSelfAssessment(userId, project.id).then((a) => {
      if (!cancelled) setAssessment(a);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, project.id]);

  const persist = useCallback(
    async (a: SelfAssessment) => {
      setSaveState('saving');
      try {
        await saveSelfAssessment(userId, project.id, a);
        const progress = computeSelfProgress(a);
        const updated = await updateLookProgress(userId, project.id, 'self', {
          ...project.fiveLookProgress.self,
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
    (next: SelfAssessment) => {
      setAssessment(next);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void persist(next);
      }, 500);
    },
    [persist]
  );

  const setItem = (itemId: string, patch: { status?: SelfStatus; note?: string }) => {
    if (!assessment) return;
    const items = assessment.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it));
    scheduleSave({ ...assessment, items });
  };

  if (!assessment) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-[#aeaeb2]">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> 正在加载自评…
      </div>
    );
  }

  const answered = assessment.items.filter((i) => i.status !== 'unknown').length;

  return (
    <div className="space-y-4">
      {/* 头部说明 + 保存状态 */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center shrink-0">
            <ClipboardList className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[#1d1d1f]">看自己 · 结构化自评</h3>
            <p className="text-sm text-[#86868b] mt-0.5 max-w-xl">
              判断团队是否具备解决未满足需求的目标、能力与资源；结果将用于机会卡的「自身适配度」。
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-[#86868b]">已评 {answered}/{assessment.items.length}</span>
          <SaveBadge state={saveState} />
        </div>
      </div>

      {SELF_CATEGORY_ORDER.map((cat) => {
        const items = assessment.items.filter((i) => i.category === cat);
        const done = items.filter((i) => i.status !== 'unknown').length;
        return (
          <Card key={cat}>
            <div className="p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-[#1d1d1f]">{SELF_CATEGORY_LABELS[cat]}</p>
                <span className="text-[11px] text-[#aeaeb2]">{done}/{items.length}</span>
              </div>
              <div className="divide-y divide-black/5">
                {items.map((item) => (
                  <div key={item.id} className="py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-[#424245] min-w-0">{item.label}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        {STATUS_ORDER.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setItem(item.id, { status: s })}
                            className={cn(
                              'px-2 py-1 rounded-lg text-[11px] font-semibold border transition-all active:scale-[0.96]',
                              item.status === s
                                ? STATUS_PILL[s]
                                : 'bg-white text-[#aeaeb2] border-black/5 hover:text-[#424245] hover:border-black/10'
                            )}
                          >
                            {SELF_STATUS_LABELS[s]}
                          </button>
                        ))}
                      </div>
                    </div>
                    {item.status !== 'unknown' && (
                      <input
                        value={item.note ?? ''}
                        onChange={(e) => setItem(item.id, { note: e.target.value })}
                        placeholder="备注 / 证据（选填）"
                        className="mt-2 w-full px-3 py-2 rounded-xl border border-black/8 bg-gradient-to-b from-white to-[#f8f9fb] text-xs text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300 transition-all"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
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
