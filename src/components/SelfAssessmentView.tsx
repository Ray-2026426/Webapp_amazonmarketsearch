import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, AlertTriangle, ClipboardList } from 'lucide-react';
import { cn } from './ui/Card';
import { Card } from './ui/Card';
import {
  loadSelfAssessment,
  saveSelfAssessment,
  computeSelfProgress,
  SELF_CATEGORY_LABELS,
  SELF_DECISION_QUESTION_COUNT,
  SELF_STATUS_LABELS,
  type SelfAssessment,
} from '../utils/selfAssessment';
import { updateLookProgress } from '../utils/projectStore';
import type { ResearchProject } from '../types/researchProject';
import { LookAiBar } from './LookAiBar';
import { mergeSelfAi, buildSelfAnswers } from '../utils/lookAiApply';
import { addEvidence } from '../utils/evidence';
import { SelfReadinessPanel } from './SelfReadinessPanel';
import { loadCapabilityLibrary } from '../utils/capabilityLibrary';
import { deriveCapabilitiesForPrompt, resolveCapabilities } from '../utils/capabilityDerivation';
import { loadUserBackgroundById } from '../utils/userBackground';
import type { L3Id } from '../utils/l3Pages';
import type { L3BodyRender } from './L3Sheet';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * M3⑤ · 看自己 V3（PRD §6.4）。
 *
 * **42 项四态网格已删除**：能力/资源/经验/约束由「设置 → 背景信息」确定性推导（可逐条覆盖，见
 * SelfReadinessPanel 的 ⑪ 区块），用户在这里只需要回答 **3 个拍板问题**（最低毛利率 / 止损条件 /
 * 必须满足的进入条件），再加上适配度与硬约束结论。
 *
 * 保留的东西（不许破坏）：AI 只起草不评分的 LookAiBar、SaveBadge 落盘状态、五看进度回写、
 * 「看自己」侧的二级页⑪⑫（仍是同一份实现，variant='sheet'）。
 */
export function SelfAssessmentView({
  userId,
  project,
  onProjectChange,
  onOpenL3,
  onRegisterL3Bodies,
}: {
  userId: string;
  project: ResearchProject;
  onProjectChange: (updated: ResearchProject) => void;
  /** 线框图 ⏳3：二级页⑪⑫ 的入口与正文注册（透传给 SelfReadinessPanel） */
  onOpenL3?: (id: L3Id) => void;
  onRegisterL3Bodies?: (render: L3BodyRender | null) => void;
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

  /**
   * 面板（SelfReadinessPanel）是「看自己」数据的写方：它写回后同步到本视图，
   * 头部"已答 x/3"、AI 输入与五看进度都跟着更新。用 useCallback 稳定身份，避免面板反复重订阅。
   */
  const handleAssessmentSaved = useCallback(
    (next: SelfAssessment) => {
      setAssessment(next);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void persist(next);
      }, 500);
    },
    [persist]
  );

  /** M1：AI 起草回填 —— 只填 aiDraft，绝不改动决策边界项与能力结论（逻辑与一键向导共用） */
  const applyAi = (out: Record<string, unknown>) => {
    const { next, filled, skipped } = mergeSelfAi(assessment!, out);
    scheduleSave(next);
    void addEvidence(userId, project.id, {
      look: 'self',
      type: 'assessment',
      sourceRef: `self:${new Date().toISOString().slice(0, 10)}`,
      summary: `拍板问题已答 ${assessment!.items.filter((i) => i.status !== 'unknown').length}/${
        assessment!.items.length || SELF_DECISION_QUESTION_COUNT
      } 项 + AI 适配度结论`,
    });
    return { filled, skipped };
  };

  if (!assessment) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-[#aeaeb2]">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> 正在加载看自己…
      </div>
    );
  }

  const answered = assessment.items.filter((i) => i.status !== 'unknown').length;
  const total = assessment.items.length || SELF_DECISION_QUESTION_COUNT;
  // 给 AI 的自身能力口径：3 个拍板问题的答案 + 背景信息推导（确定性）结论
  const derived = resolveCapabilities(loadUserBackgroundById(userId), loadCapabilityLibrary(userId));

  return (
    <div className="space-y-4">
      {/* 头部说明 + 保存状态 */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center shrink-0">
            <ClipboardList className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[#1d1d1f]">看自己 · 背景信息 + 3 个拍板问题</h3>
            <p className="text-sm text-[#86868b] mt-0.5 max-w-xl">
              能力/资源/经验/约束由「设置 → 背景信息」自动推导（可逐条覆盖）；这里只回答背景信息答不了、但决定拍板的 3 个问题。
              结论用于机会卡的「自身适配度」与硬约束判定。
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-[#86868b]">
            已答 {answered}/{total}
          </span>
          <SaveBadge state={saveState} />
        </div>
      </div>

      {/* 背景信息摘要 + 能力推导 + 3 个拍板问题 + 适配度与硬约束
          ⏳3：⑪⑫ 的二级页入口与正文注册由面板自己处理 */}
      <SelfReadinessPanel
        userId={userId}
        project={project}
        onOpenL3={onOpenL3}
        onRegisterL3Bodies={onRegisterL3Bodies}
        onAssessmentSaved={handleAssessmentSaved}
      />

      <LookAiBar
        look="self"
        userId={userId}
        projectId={project.id}
        extra={{
          // 3 个拍板问题的答案 + 背景信息推导出的能力结论（同一份确定性口径，AI 只解释不改）
          answers: {
            ...buildSelfAnswers(assessment, SELF_CATEGORY_LABELS, SELF_STATUS_LABELS),
            自身能力: deriveCapabilitiesForPrompt(derived).replace(/\n+/g, '；'),
          },
        }}
        disabled={false}
        onApply={applyAi}
        hint={
          answered === 0
            ? `还没回答拍板问题：AI 会先按背景信息推导出的能力结论起草判断；回答 ${SELF_DECISION_QUESTION_COUNT} 个问题后，硬约束与适配度才算完整。`
            : `AI 会结合 ${answered} 项拍板答案、背景信息推导出的能力结论与账号背景，生成适配度判断、优势、缺口与硬约束（只填空，不改你答过的项与推导结论）。`
        }
      />

      {assessment.aiDraft && (
        <Card className="border-indigo-100 bg-indigo-50/40">
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-[#1d1d1f]">AI 起草 · 自身适配结论</p>
              <span className="text-[11px] text-[#86868b]">仅起草，不修改你的答案与推导结论</span>
            </div>
            {assessment.aiDraft.conclusion && (
              <p className="text-sm text-[#424245] leading-relaxed">{assessment.aiDraft.conclusion}</p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(
                [
                  ['自身优势', assessment.aiDraft.strengths, 'text-emerald-700'],
                  ['能力缺口', assessment.aiDraft.gaps, 'text-amber-700'],
                  ['硬约束 / 止损边界', assessment.aiDraft.hardConstraints, 'text-rose-700'],
                ] as const
              ).map(([label, list, cls]) => (
                <div key={label} className="rounded-xl border border-black/5 bg-white p-3">
                  <p className={`text-xs font-semibold ${cls} mb-1.5`}>{label}</p>
                  {list && list.length > 0 ? (
                    <ul className="space-y-1">
                      {list.map((t, i) => (
                        <li key={i} className="text-[11px] text-[#424245] leading-relaxed">· {t}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[11px] text-[#aeaeb2]">暂无</p>
                  )}
                </div>
              ))}
            </div>
            {assessment.aiDraft.fitAssessment && (
              <p className="text-xs text-[#424245]">对机会卡的适配度：{assessment.aiDraft.fitAssessment}</p>
            )}
          </div>
        </Card>
      )}
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
