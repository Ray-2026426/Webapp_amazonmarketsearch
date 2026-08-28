import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, AlertTriangle, ClipboardList, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from './ui/Card';
import { Card } from './ui/Card';
import { FiveLookSummaryShell } from './five-look/FiveLookSummaryShell';
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
import { loadCompetitorLook, type CompetitorLookData } from '../utils/competitorLook';
import { updateLookProgress } from '../utils/projectStore';
import { runLookAnalysis, type SelfAnalysisOutput } from '../utils/lookAi';
import { LOOK_STATUS_LABELS, type ResearchProject } from '../types/researchProject';

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
  onNavigateOpportunity,
}: {
  userId: string;
  project: ResearchProject;
  onProjectChange: (updated: ResearchProject) => void;
  onNavigateOpportunity?: () => void;
}) {
  const [assessment, setAssessment] = useState<SelfAssessment | null>(null);
  const [competitorLook, setCompetitorLook] = useState<CompetitorLookData | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [aiRunning, setAiRunning] = useState(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadSelfAssessment(userId, project.id), loadCompetitorLook(userId, project.id)]).then(([a, c]) => {
      if (cancelled) return;
      setAssessment(a);
      setCompetitorLook(c);
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

  const runAi = async () => {
    if (!assessment) return;
    setAiRunning(true);
    try {
      const answers = Object.fromEntries(
        assessment.items
          .filter((item) => item.status !== 'unknown' || item.note?.trim())
          .map((item) => [item.label, `${SELF_STATUS_LABELS[item.status]}${item.note ? `；${item.note}` : ''}`])
      );
      const res = await runLookAnalysis('self', { answers });
      if (!res.ok || !res.data) {
        toast.error(res.error || 'AI 分析失败');
        return;
      }
      const out = res.data as SelfAnalysisOutput;
      const parts = [
        out.conclusion,
        out.fitAssessment,
        out.strengths?.length ? `优势：${out.strengths.join('；')}` : '',
        out.gaps?.length ? `缺口：${out.gaps.join('；')}` : '',
        out.hardConstraints?.length ? `边界：${out.hardConstraints.join('；')}` : '',
        out.summary,
      ].filter(Boolean);
      scheduleSave({ ...assessment, aiSummary: parts.join('\n') });
    } finally {
      setAiRunning(false);
    }
  };

  if (!assessment || !competitorLook) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-[#aeaeb2]">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> 正在加载自评…
      </div>
    );
  }

  const answered = assessment.items.filter((i) => i.status !== 'unknown').length;
  const strengths = assessment.items
    .filter((i) => i.status === 'have')
    .map((i) => formatSelfItem(i.label, i.note));
  const gaps = assessment.items
    .filter((i) => i.status === 'partial' || i.status === 'lack')
    .map((i) => `${SELF_STATUS_LABELS[i.status]}：${formatSelfItem(i.label, i.note)}`);
  const boundaries = assessment.items
    .filter((i) => (i.category === 'constraint' || i.category === 'boundary') && i.status !== 'unknown')
    .map((i) => `${i.label}${i.note ? `：${i.note}` : `（${SELF_STATUS_LABELS[i.status]}）`}`);
  const hardGapCount = assessment.items.filter((i) => i.status === 'lack').length;
  const hasCompetitorGap = competitorLook.gaps.some((g) => g.trim());
  const selfJudgement = answered === 0
    ? '还没有判断我方能不能抓住这个机会。'
    : hardGapCount > 0
      ? `已有 ${hardGapCount} 个明确缺口，需要先判断是否会阻断进入。`
      : hasCompetitorGap
        ? '已可对照竞品缝隙判断我方承接能力。'
        : '已有自身信息，但还缺少明确竞品缝隙作为承接对象。';

  return (
    <div className="space-y-4">
      <FiveLookSummaryShell
        eyebrow="Five Looks / Self"
        title="看自己 · 机会承接判断"
        judgement={selfJudgement}
        description="这里不只是自评表，而是判断我们是否适合抓住前面发现的缝隙：能否做出差异化、资源是否接得住、利润和风险边界是否成立。"
        statusBadge={
          <span className="rounded-full border border-black/5 bg-[#f5f5f7] px-2.5 py-1 text-[11px] font-semibold text-[#86868b]">
            {LOOK_STATUS_LABELS[project.fiveLookProgress.self.status]} · {project.fiveLookProgress.self.completionPercent}%
          </span>
        }
        metrics={[
          { label: '已评项目', value: `${answered}/${assessment.items.length}`, tone: answered ? 'brand' : 'neutral' },
          { label: '已具备', value: `${strengths.length}`, tone: strengths.length ? 'good' : 'neutral' },
          { label: '缺口/部分', value: `${gaps.length}`, tone: gaps.length ? 'warn' : 'neutral' },
          { label: '竞品缝隙', value: `${competitorLook.gaps.filter((g) => g.trim()).length}`, tone: hasCompetitorGap ? 'brand' : 'warn' },
        ]}
        sections={[
          {
            title: '可用优势',
            items: strengths,
            emptyText: '还没有明确可复用优势。优先确认供应链、研发、内容、广告或类目经验。',
            tone: strengths.length ? 'good' : 'neutral',
          },
          {
            title: '承接缺口',
            items: gaps,
            emptyText: '还没有识别能力缺口。没有缺口不等于能做，还需要确认硬边界和利润。',
            tone: gaps.length ? 'warn' : 'neutral',
          },
          {
            title: '硬约束 / 边界',
            items: boundaries,
            emptyText: '补充最低毛利、最高 CPC、最大验证成本、MOQ、交期和止损条件。',
            tone: boundaries.length ? 'warn' : 'neutral',
          },
        ]}
        nextAction={{
          label: answered > 0 ? '去生成机会结论' : '先完成自评',
          description: answered > 0
            ? '下一步把未满足需求、目标细分、竞品破绽和我方承接能力合并，生成机会卡或无机会结论。'
            : '先完成关键自评项，再判断我方能否做到“我有人无”或“人有我优”。',
          onClick: answered > 0 ? onNavigateOpportunity : undefined,
        }}
      />

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

      {assessment.aiSummary && (
        <Card className="border-indigo-100 bg-indigo-50/40">
          <div className="p-5">
            <p className="text-sm font-semibold text-[#1d1d1f] mb-2">AI 自评结论</p>
            <p className="whitespace-pre-line text-sm text-[#424245] leading-6">{assessment.aiSummary}</p>
          </div>
        </Card>
      )}

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

function formatSelfItem(label: string, note?: string): string {
  const clean = note?.trim();
  return clean ? `${label}：${clean}` : label;
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
