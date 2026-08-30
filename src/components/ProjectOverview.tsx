import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, CircleAlert, Eye, Loader2, Route, Sparkles, Target } from 'lucide-react';
import { cn, Card } from './ui/Card';
import {
  FIVE_LOOK_LABELS,
  FIVE_LOOKS,
  LOOK_STATUS_LABELS,
  type FiveLookId,
  type ResearchProject,
} from '../types/researchProject';
import { loadProjectDecisionSummary, type ProjectDecisionSummary } from '../utils/projectDecision';
import { loadUserLook, type UnmetNeedCandidate } from '../utils/userLook';
import { loadOpportunities } from '../utils/opportunityStore';

const LOOK_QUESTION: Record<FiveLookId, string> = {
  user: '谁的什么需求仍未被满足？',
  market: '需求细分有没有体量、趋势和进入窗口？',
  competitor: '代表竞对靠什么赢，哪里仍没满足？',
  self: '我们能否承接这条需求和竞对缝隙？',
  opportunity: '最终有几个可信机会，为什么？',
};

function lookConclusion(look: FiveLookId, project: ResearchProject, summary: ProjectDecisionSummary, needs: UnmetNeedCandidate[]): string {
  const progress = project.fiveLookProgress[look];
  if (look === 'user') {
    return summary.selectedNeeds.length
      ? `已确认 ${summary.selectedNeeds.length} 类需求作为市场细分标准。`
      : needs.length ? `已识别 ${needs.length} 个需求候选，等待确认分类。` : '尚未形成需求分类。';
  }
  if (look === 'market') return summary.selectedSegment ? `已选择“${summary.selectedSegment}”作为目标细分。` : '尚未选择目标细分市场。';
  if (look === 'competitor') return progress.status === 'completed' ? '已形成竞对核心竞争力和可攻击缝隙。' : progress.missingRequirements[0] || '尚未分析代表竞对。';
  if (look === 'self') return progress.status === 'completed' ? '已完成当前品类的自身适配判断。' : progress.missingRequirements[0] || '尚未确认自身能力边界。';
  if (summary.confirmedOpportunities) return `已确认 ${summary.confirmedOpportunities} 个正式机会。`;
  if (summary.candidateOpportunities) return `${summary.candidateOpportunities} 个 AI 候选机会等待复核。`;
  return '尚未运行综合机会判断。';
}

export function ProjectOverviewContent({
  project,
  userId,
  onNavigateLook,
}: {
  project: ResearchProject;
  username: string;
  userId: string;
  onNavigateLook: (look: FiveLookId) => void;
}) {
  const [summary, setSummary] = useState<ProjectDecisionSummary | null>(null);
  const [needs, setNeeds] = useState<UnmetNeedCandidate[]>([]);
  const [opportunityScores, setOpportunityScores] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      loadProjectDecisionSummary(userId, project),
      loadUserLook(userId, project.id),
      loadOpportunities(userId, project.id),
    ]).then(([decision, user, cards]) => {
      if (cancelled) return;
      setSummary(decision);
      setNeeds(user.unmetNeedCandidates);
      setOpportunityScores(cards.map((card) => card.score));
    });
    return () => { cancelled = true; };
  }, [userId, project]);

  const topNeeds = useMemo(() => needs
    .filter((need) => need.selectedForSegmentation)
    .slice(0, 4), [needs]);

  if (!summary) {
    return <div className="flex items-center justify-center py-20 text-sm text-[#86868b]"><Loader2 className="w-4 h-4 animate-spin mr-2" />正在汇总项目结论…</div>;
  }

  const funnel = [
    { label: '需求候选', value: needs.length },
    { label: '已确认分类', value: summary.selectedNeeds.length },
    { label: 'AI 候选机会', value: summary.candidateOpportunities },
    { label: '正式机会', value: summary.confirmedOpportunities },
  ];

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden border-indigo-100 bg-gradient-to-br from-white via-white to-indigo-50/70">
        <div className="p-5 sm:p-6 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-indigo-600"><Target className="w-4 h-4" />当前判断</div>
            <h3 className="mt-2 text-xl sm:text-2xl font-bold text-[#1d1d1f] leading-tight">{summary.judgement}</h3>
            <p className="mt-3 text-sm text-[#86868b] leading-6">研究目标：{project.objective || '尚未设置'} · {project.marketplace}</p>
            {opportunityScores.length > 0 && <p className="mt-1 text-sm text-[#86868b]">当前最高机会分：{Math.max(...opportunityScores)} 分；分数与证据覆盖度需同时审核。</p>}
          </div>
          <div className="rounded-2xl border border-indigo-100 bg-white/90 p-4">
            <p className="text-xs font-semibold text-indigo-600">下一最佳动作</p>
            <p className="mt-2 text-base font-semibold text-[#1d1d1f] leading-6">{summary.nextAction}</p>
            <p className="mt-1 text-sm text-amber-700 leading-6">原因：{summary.largestGap}</p>
            <button type="button" onClick={() => onNavigateLook(summary.nextLook)} className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">继续{summary.stageLabel}<ArrowRight className="w-4 h-4" /></button>
          </div>
        </div>
      </Card>

      <Card>
        <div className="p-5">
          <div className="flex items-center gap-2"><Route className="w-4 h-4 text-indigo-600" /><p className="text-sm font-semibold text-[#1d1d1f]">机会漏斗</p></div>
          <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
            {funnel.map((item, index) => (
              <div key={item.label} className="relative rounded-2xl border border-black/5 bg-[#fafafa] px-4 py-3">
                <p className="text-sm text-[#86868b]">{item.label}</p>
                <p className="mt-1 text-2xl font-bold text-[#1d1d1f]">{item.value}</p>
                {index < funnel.length - 1 && <ArrowRight className="hidden lg:block absolute -right-5 top-1/2 -translate-y-1/2 z-10 w-4 h-4 text-[#c7c7cc]" />}
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <div className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-sm font-semibold text-[#1d1d1f]">需求主线</p><p className="mt-1 text-sm text-[#86868b]">后续市场、竞对、自身与机会判断都必须回到这些需求。</p></div>
            <button type="button" onClick={() => onNavigateLook('user')} className="text-sm font-semibold text-indigo-600 hover:text-indigo-700">查看看用户</button>
          </div>
          {topNeeds.length ? (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              {topNeeds.map((need) => (
                <div key={need.id} className="rounded-2xl border border-black/5 bg-[#fafafa] p-4">
                  <div className="flex items-start justify-between gap-3"><p className="font-semibold text-[#1d1d1f]">{need.category || need.needStatement}</p><span className="shrink-0 rounded-full bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">证据{need.evidenceStrength === 'high' ? '高' : need.evidenceStrength === 'medium' ? '中' : '低'}</span></div>
                  <p className="mt-2 text-sm text-[#424245] leading-6">{need.targetUser || '目标用户待补充'} · {need.scenario || '场景待补充'}</p>
                  <p className="mt-1 text-sm text-[#86868b] leading-6">JTBD：{need.jobToBeDone || '待补充'}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-black/10 bg-[#fafafa] p-5 text-sm text-[#86868b] leading-6">尚未确认需求分类。先在“看用户”中确认哪些需求可作为后续细分标准。</div>
          )}
        </div>
      </Card>

      <div>
        <div className="flex items-center gap-2 mb-3"><Eye className="w-4 h-4 text-indigo-600" /><p className="text-sm font-semibold text-[#1d1d1f]">五看结论链</p></div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {FIVE_LOOKS.map((look) => {
            const progress = project.fiveLookProgress[look];
            return (
              <button key={look} type="button" onClick={() => onNavigateLook(look)} className="rounded-2xl border border-black/5 bg-white p-4 text-left hover:border-indigo-200 hover:shadow-sm transition-all">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-semibold text-[#1d1d1f]">{FIVE_LOOK_LABELS[look]}</p><p className="mt-1 text-sm text-[#86868b]">{LOOK_QUESTION[look]}</p></div>
                  <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold', progress.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : progress.status === 'stale' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700')}>
                    {progress.status === 'completed' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <CircleAlert className="w-3.5 h-3.5" />}{LOOK_STATUS_LABELS[progress.status]}
                  </span>
                </div>
                <p className="mt-3 text-sm font-medium text-[#424245] leading-6">{lookConclusion(look, project, summary, needs)}</p>
                <div className="mt-3 flex items-center justify-between text-xs"><span className="text-[#86868b]">{progress.missingRequirements[0] || '关键产物已具备'}</span><span className="inline-flex items-center gap-1 font-semibold text-indigo-600">查看详情<ArrowRight className="w-3.5 h-3.5" /></span></div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 flex items-start gap-3 text-sm text-indigo-800 leading-6"><Sparkles className="w-4 h-4 mt-1 shrink-0" />系统不会为了给出答案而强行生成机会。证据不足时，最终结论可以是 0 个机会，并明确说明缺失证据。</div>
    </div>
  );
}
