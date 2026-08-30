import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, HelpCircle, Loader2, ShieldAlert, Sparkles, Target, Wrench } from 'lucide-react';
import { toast } from 'sonner';
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
import { loadMarketLook, type MarketLookData } from '../utils/marketLook';
import { loadUserLook, type UserLookData } from '../utils/userLook';
import { buildUserBackgroundSystemPrompt, loadUserBackground } from '../utils/userBackground';
import { generateSelfGuidingQuestions } from '../utils/opportunityAi';
import { updateLookProgress } from '../utils/projectStore';
import { LOOK_STATUS_LABELS, type ResearchProject } from '../types/researchProject';

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
  const [marketLook, setMarketLook] = useState<MarketLookData | null>(null);
  const [userLook, setUserLook] = useState<UserLookData | null>(null);
  const [generating, setGenerating] = useState(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      loadSelfAssessment(userId, project.id),
      loadCompetitorLook(userId, project.id),
      loadMarketLook(userId, project.id),
      loadUserLook(userId, project.id),
    ]).then(([a, c, m, u]) => {
      if (cancelled) return;
      const snapshot = a.accountBackgroundSnapshot?.trim()
        ? a.accountBackgroundSnapshot
        : buildUserBackgroundSystemPrompt(loadUserBackground());
      const hydrated = { ...a, accountBackgroundSnapshot: snapshot };
      setAssessment(hydrated);
      setCompetitorLook(c);
      setMarketLook(m);
      setUserLook(u);
      if (!a.accountBackgroundSnapshot?.trim() && snapshot) void saveSelfAssessment(userId, project.id, hydrated);
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

  const updateQuestion = (id: string, answer: string) => {
    if (!assessment) return;
    const next = {
      ...assessment,
      guidingQuestions: (assessment.guidingQuestions ?? []).map((question) => question.id === id ? { ...question, answer } : question),
    };
    setAssessment(next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void persist(next);
    }, 500);
  };

  const generateQuestions = async () => {
    if (!assessment || !competitorLook || !marketLook || !userLook) return;
    setGenerating(true);
    try {
      const questions = await generateSelfGuidingQuestions({ project, user: userLook, market: marketLook, competitor: competitorLook });
      if (questions.length < 3) throw new Error('AI 没有生成足够的有效问题，请重试。');
      await persist({ ...assessment, guidingQuestions: questions });
      toast.success(`已生成 ${questions.length} 个针对该品类的问题`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生成问题失败');
    } finally {
      setGenerating(false);
    }
  };

  if (!assessment || !competitorLook || !marketLook || !userLook) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-[#aeaeb2]">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> 正在加载看自己结论...
      </div>
    );
  }

  const progress = project.fiveLookProgress.self;
  const answered = (assessment.guidingQuestions ?? []).filter((question) => question.answer.trim()).length;
  const answeredQuestions = (assessment.guidingQuestions ?? []).filter((question) => question.answer.trim());
  const strengths = [
    ...assessment.items
    .filter((i) => i.status === 'have')
    .map((i) => i.note?.trim() ? `${i.label}：${i.note}` : i.label),
    ...answeredQuestions.filter((question) => question.impactDimension === 'strength').map((question) => `${question.question}：${question.answer}`),
  ];
  const gaps = [
    ...assessment.items
    .filter((i) => i.status === 'partial' || i.status === 'lack')
    .map((i) => `${SELF_STATUS_LABELS[i.status]}：${i.note?.trim() ? `${i.label}：${i.note}` : i.label}`),
    ...answeredQuestions.filter((question) => question.impactDimension === 'gap').map((question) => `${question.question}：${question.answer}`),
  ];
  const boundaries = [
    ...assessment.items
    .filter((i) => (i.category === 'constraint' || i.category === 'boundary') && i.status !== 'unknown')
    .map((i) => i.note?.trim() ? `${i.label}：${i.note}` : `${i.label}（${SELF_STATUS_LABELS[i.status]}）`),
    ...answeredQuestions.filter((question) => question.impactDimension === 'boundary').map((question) => `${question.question}：${question.answer}`),
  ];
  const fitAnswers = answeredQuestions.filter((question) => question.impactDimension === 'fit').map((question) => `${question.question}：${question.answer}`);
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
          { label: '账号背景', value: assessment.accountBackgroundSnapshot?.trim() ? '已同步' : '待设置', tone: assessment.accountBackgroundSnapshot?.trim() ? 'brand' : 'warn' },
          { label: '品类问题', value: `${answered}/${assessment.guidingQuestions?.length ?? 0}`, tone: answered ? 'good' : 'warn' },
          { label: '可用优势', value: `${strengths.length}`, tone: strengths.length ? 'good' : 'neutral' },
          { label: '能力缺口', value: `${gaps.length}`, tone: gaps.length ? 'warn' : 'neutral' },
        ]}
        sections={[]}
      />

      <Card>
        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[#1d1d1f] mb-1">账号背景（自动读取）</p>
              <p className="text-xs text-[#86868b]">来自设置中的个人/团队背景，项目内只读，避免每研究一个品类重复填写。</p>
            </div>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">自动同步</span>
          </div>
          <div className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl border border-black/5 bg-[#fafafa] px-4 py-3 text-xs leading-5 text-[#424245]">
            {assessment.accountBackgroundSnapshot || '尚未在设置中填写账号背景。'}
          </div>
        </div>
      </Card>

      <Card>
        <div className="p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[#1d1d1f]">针对当前品类的引导问题</p>
              <p className="text-xs text-[#86868b] mt-1">AI 结合目标需求、细分市场和竞对缺口只问 3–7 个真正影响“我们能不能抓”的问题。</p>
            </div>
            <button type="button" onClick={() => void generateQuestions()} disabled={generating} className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {assessment.guidingQuestions?.length ? '重新生成' : 'AI 生成问题'}
            </button>
          </div>
          {(assessment.guidingQuestions ?? []).length ? (
            <div className="space-y-3">
              {(assessment.guidingQuestions ?? []).map((question, index) => (
                <label key={question.id} className="block rounded-xl border border-black/8 bg-[#fafafa] p-4">
                  <span className="block text-sm font-semibold text-[#1d1d1f]">{index + 1}. {question.question}</span>
                  <span className="block text-xs text-[#86868b] mt-1">为什么问：{question.reason || '该答案会影响机会与自身能力的匹配判断。'}</span>
                  {question.type === 'choice' && (question.options?.length ?? 0) > 0 ? (
                    <select value={question.answer} onChange={(event) => updateQuestion(question.id, event.target.value)} className="mt-3 w-full rounded-xl border border-black/8 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                      <option value="">请选择</option>
                      {question.options?.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  ) : (
                    <input type={question.type === 'number' ? 'number' : 'text'} value={question.answer} onChange={(event) => updateQuestion(question.id, event.target.value)} placeholder="填写答案" className="mt-3 w-full rounded-xl border border-black/8 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
                  )}
                </label>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-black/10 bg-[#fafafa] px-4 py-7 text-center text-sm text-[#86868b]">生成后回答少量关键问题，无需再填 50 项通用自评表。</div>
          )}
          {onNavigateOpportunity && answered > 0 && (
            <div className="flex justify-end border-t border-black/5 pt-4">
              <button type="button" onClick={onNavigateOpportunity} className="inline-flex items-center gap-1.5 rounded-xl bg-[#1d1d1f] px-3 py-2 text-xs font-semibold text-white">结合四看生成机会 <ArrowRight className="w-3.5 h-3.5" /></button>
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <QuestionCard icon={<Target className="w-5 h-5" />} title="我们能赢在哪里？" items={strengths} emptyText="还没有明确差异化优势。" />
        <QuestionCard icon={<Wrench className="w-5 h-5" />} title="哪些地方接不住？" items={gaps} emptyText="还没有明确能力或资源缺口。" />
        <QuestionCard icon={<ShieldAlert className="w-5 h-5" />} title="哪些边界不能突破？" items={boundaries} emptyText="还没有填写利润、MOQ、合规、止损等边界。" />
        <QuestionCard icon={<CheckCircle2 className="w-5 h-5" />} title="能否对准竞对缝隙？" items={[...fitAnswers, ...competitorGaps]} emptyText="还没有从看竞对沉淀可攻击缝隙。" />
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
