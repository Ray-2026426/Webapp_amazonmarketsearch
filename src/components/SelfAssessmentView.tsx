import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, HelpCircle, Loader2, ShieldAlert, Target, Wrench } from 'lucide-react';
import { Card } from './ui/Card';
import { FiveLookSummaryShell } from './five-look/FiveLookSummaryShell';
import {
  computeSelfProgress,
  loadSelfAssessment,
  saveSelfAssessment,
  SELF_STATUS_LABELS,
  type SelfAssessment,
} from '../utils/selfAssessment';
import { loadCompetitorLook, type CompetitorLookData } from '../utils/competitorLook';
import { updateLookProgress } from '../utils/projectStore';
import { LOOK_STATUS_LABELS, type ResearchProject } from '../types/researchProject';

export function SelfAssessmentView({
  userId,
  project,
  onProjectChange,
}: {
  userId: string;
  project: ResearchProject;
  onProjectChange: (updated: ResearchProject) => void;
  onNavigateOpportunity?: () => void;
}) {
  const [assessment, setAssessment] = useState<SelfAssessment | null>(null);
  const [competitorLook, setCompetitorLook] = useState<CompetitorLookData | null>(null);
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
    async (next: SelfAssessment) => {
      await saveSelfAssessment(userId, project.id, next);
      const progress = computeSelfProgress(next);
      const updated = await updateLookProgress(userId, project.id, 'self', {
        ...project.fiveLookProgress.self,
        status: progress.status,
        completionPercent: progress.completionPercent,
        missingRequirements: progress.missingRequirements,
        updatedAt: new Date().toISOString(),
      });
      if (updated) onProjectChange(updated);
    },
    [userId, project.id, project.fiveLookProgress.self, onProjectChange]
  );

  const updateBackground = (value: string) => {
    if (!assessment) return;
    const next = { ...assessment, aiSummary: value };
    setAssessment(next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void persist(next);
    }, 500);
  };

  if (!assessment || !competitorLook) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-[#aeaeb2]">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> 正在加载看自己结论...
      </div>
    );
  }

  const progress = project.fiveLookProgress.self;
  const answered = assessment.items.filter((i) => i.status !== 'unknown').length;
  const strengths = assessment.items
    .filter((i) => i.status === 'have')
    .map((i) => i.note?.trim() ? `${i.label}：${i.note}` : i.label);
  const gaps = assessment.items
    .filter((i) => i.status === 'partial' || i.status === 'lack')
    .map((i) => `${SELF_STATUS_LABELS[i.status]}：${i.note?.trim() ? `${i.label}：${i.note}` : i.label}`);
  const boundaries = assessment.items
    .filter((i) => (i.category === 'constraint' || i.category === 'boundary') && i.status !== 'unknown')
    .map((i) => i.note?.trim() ? `${i.label}：${i.note}` : `${i.label}（${SELF_STATUS_LABELS[i.status]}）`);
  const competitorGaps = competitorLook.gaps.filter(Boolean);
  const judgement = answered === 0
    ? '还没有判断我们是否接得住机会。'
    : gaps.length
      ? `已有 ${gaps.length} 个能力或资源缺口，需要判断是否阻断进入。`
      : competitorGaps.length
        ? '已有自身背景，可对照竞品缝隙判断能否做出差异化。'
        : '已有自身背景，但还缺少清晰的竞品缝隙作为承接对象。';

  return (
    <div className="space-y-4">
      <FiveLookSummaryShell
        eyebrow="Five Looks / Self"
        title="看自己 · 承接结论"
        judgement={judgement}
        description="这里不再做大而全的自评表，只用背景信息和关键引导问题判断：这个机会我们能不能抓、适不适合抓、接不接得住。"
        statusBadge={
          <span className="rounded-full border border-black/5 bg-[#f5f5f7] px-2.5 py-1 text-[11px] font-semibold text-[#86868b]">
            {LOOK_STATUS_LABELS[progress.status]} · {progress.completionPercent}%
          </span>
        }
        metrics={[
          { label: '背景信息', value: assessment.aiSummary?.trim() ? '已填写' : '待填写', tone: assessment.aiSummary?.trim() ? 'brand' : 'warn' },
          { label: '可用优势', value: `${strengths.length}`, tone: strengths.length ? 'good' : 'neutral' },
          { label: '能力缺口', value: `${gaps.length}`, tone: gaps.length ? 'warn' : 'neutral' },
          { label: '硬边界', value: `${boundaries.length}`, tone: boundaries.length ? 'warn' : 'neutral' },
        ]}
        sections={[]}
      />

      <Card>
        <div className="p-5">
          <p className="text-sm font-semibold text-[#1d1d1f] mb-1">背景信息</p>
          <p className="text-xs text-[#86868b] mb-3">用一段话说明团队资源、供应链、预算、类目经验、利润边界和不能碰的风险。</p>
          <textarea
            value={assessment.aiSummary ?? ''}
            onChange={(e) => updateBackground(e.target.value)}
            rows={5}
            placeholder="例如：我们已有某类目供应链和内容团队，首单预算约为...，最低毛利要求...，验证周期...，不能接受的风险是..."
            className="w-full px-3 py-2.5 rounded-xl border border-black/8 bg-gradient-to-b from-white to-[#f8f9fb] text-sm text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300 transition-all resize-none"
          />
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <QuestionCard icon={<Target className="w-5 h-5" />} title="我们能赢在哪里？" items={strengths} emptyText="还没有明确差异化优势。" />
        <QuestionCard icon={<Wrench className="w-5 h-5" />} title="哪些地方接不住？" items={gaps} emptyText="还没有明确能力或资源缺口。" />
        <QuestionCard icon={<ShieldAlert className="w-5 h-5" />} title="哪些边界不能突破？" items={boundaries} emptyText="还没有填写利润、MOQ、合规、止损等边界。" />
        <QuestionCard icon={<CheckCircle2 className="w-5 h-5" />} title="能否对准竞品缝隙？" items={competitorGaps} emptyText="还没有从看竞品沉淀可攻击缝隙。" />
      </div>
    </div>
  );
}

function QuestionCard({
  icon,
  title,
  items,
  emptyText,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
  emptyText: string;
}) {
  return (
    <Card>
      <div className="p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            {icon || <HelpCircle className="w-5 h-5" />}
          </div>
          <p className="text-sm font-semibold text-[#1d1d1f]">{title}</p>
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
          <p className="rounded-xl border border-dashed border-black/10 bg-[#fafafa] px-4 py-5 text-sm text-[#86868b] leading-6">
            {emptyText}
          </p>
        )}
      </div>
    </Card>
  );
}
