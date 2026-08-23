import { ArrowLeft, Globe, Target, User, Clock, Sparkles, ArrowRight, FileText } from 'lucide-react';
import { cn } from './ui/Card';
import { Card } from './ui/Card';
import {
  FIVE_LOOK_LABELS,
  FIVE_LOOKS,
  LOOK_STATUS_LABELS,
  type FiveLookId,
  type LookStatus,
  type ResearchProject,
} from '../types/researchProject';

const STATUS_LABELS: Record<ResearchProject['status'], string> = {
  draft: '草稿',
  researching: '研究中',
  ready_for_review: '待评审',
  approved: '已通过',
  rejected: '已驳回',
  archived: '已归档',
};

const LOOK_STATUS_BADGE: Record<LookStatus, string> = {
  not_started: 'bg-[#f5f5f7] text-[#86868b] border-black/5',
  in_progress: 'bg-amber-50 text-amber-700 border-amber-100',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  stale: 'bg-rose-50 text-rose-700 border-rose-100',
};

const LOOK_BAR_COLOR: Record<LookStatus, string> = {
  not_started: 'bg-[#c7c7cc]',
  in_progress: 'bg-amber-500',
  completed: 'bg-emerald-500',
  stale: 'bg-rose-500',
};

function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function recommendNextLook(project: ResearchProject): { look: FiveLookId; reason: string } | null {
  for (const look of FIVE_LOOKS) {
    if (look === 'opportunity') continue;
    const p = project.fiveLookProgress[look];
    if (p.status !== 'completed') {
      const reason =
        p.status === 'not_started'
          ? `${FIVE_LOOK_LABELS[look]}尚未开始，是最接近闭环的第一步`
          : `${FIVE_LOOK_LABELS[look]}已进行中，优先补全以形成结论`;
      return { look, reason };
    }
  }
  if (project.fiveLookProgress.opportunity.status !== 'completed') {
    return { look: 'opportunity', reason: '前四看已完成，可进入看/找机会生成机会卡' };
  }
  return null;
}

export function ProjectOverview({
  project,
  username,
  onBack,
}: {
  project: ResearchProject;
  username: string;
  onBack: () => void;
}) {
  const next = recommendNextLook(project);

  return (
    <div className="max-w-6xl mx-auto w-full">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-[#86868b] hover:text-indigo-600 transition-colors mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> 返回项目中心
      </button>

      {/* 项目头 */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-[#1d1d1f]">{project.name}</h2>
            <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold border bg-indigo-50 text-indigo-700 border-indigo-100">
              {STATUS_LABELS[project.status]}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm text-[#86868b]">
            <span className="inline-flex items-center gap-1"><Globe className="w-3.5 h-3.5" /> {project.marketplace}</span>
            <span className="inline-flex items-center gap-1"><Target className="w-3.5 h-3.5" /> {project.objective || '未设置目标'}</span>
            <span className="inline-flex items-center gap-1"><User className="w-3.5 h-3.5" /> {username}</span>
            <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> 更新于 {formatDate(project.updatedAt)}</span>
          </div>
        </div>
      </div>

      {/* 五看进度 */}
      <Card className="mb-5">
        <div className="p-5">
          <p className="text-sm font-semibold text-[#1d1d1f] mb-4">五看进度</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {FIVE_LOOKS.map((look) => {
              const p = project.fiveLookProgress[look];
              return (
                <div key={look} className="rounded-2xl border border-black/5 bg-[#fafafa] p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-[#1d1d1f]">{FIVE_LOOK_LABELS[look]}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold border', LOOK_STATUS_BADGE[p.status])}>
                      {LOOK_STATUS_LABELS[p.status]}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#ececf0] overflow-hidden mb-2">
                    <div className={cn('h-full rounded-full transition-all', LOOK_BAR_COLOR[p.status])} style={{ width: `${p.completionPercent}%` }} />
                  </div>
                  <p className="text-[11px] text-[#aeaeb2]">完成度 {p.completionPercent}%</p>
                  {p.missingRequirements.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {p.missingRequirements.slice(0, 2).map((m, i) => (
                        <li key={i} className="text-[11px] text-[#86868b] leading-snug">· {m}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* 推荐下一步 */}
      {next && (
        <Card className="mb-5 border-indigo-100 bg-gradient-to-r from-indigo-50/60 to-violet-50/60">
          <div className="p-5 flex items-center gap-3">
            <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center border border-indigo-100 shrink-0">
              <Sparkles className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#1d1d1f]">推荐下一步：{FIVE_LOOK_LABELS[next.look]}</p>
              <p className="text-xs text-[#86868b] mt-0.5">{next.reason}</p>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 shrink-0">
              进入 <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </div>
        </Card>
      )}

      {/* 项目说明 / 种子信息 */}
      {(project.description || (project.coreKeywords?.length ?? 0) > 0 || (project.seedAsins?.length ?? 0) > 0) && (
        <Card>
          <div className="p-5 space-y-3">
            {project.description && (
              <div>
                <p className="text-xs font-semibold text-[#424245] mb-1">项目说明</p>
                <p className="text-sm text-[#86868b] leading-relaxed whitespace-pre-wrap">{project.description}</p>
              </div>
            )}
            {(project.coreKeywords?.length ?? 0) > 0 && (
              <div>
                <p className="text-xs font-semibold text-[#424245] mb-1.5">核心关键词</p>
                <div className="flex flex-wrap gap-1.5">
                  {project.coreKeywords!.map((k, i) => (
                    <span key={i} className="rounded-full bg-[#f5f5f7] border border-black/5 px-2.5 py-1 text-xs text-[#424245]">{k}</span>
                  ))}
                </div>
              </div>
            )}
            {(project.seedAsins?.length ?? 0) > 0 && (
              <div>
                <p className="text-xs font-semibold text-[#424245] mb-1.5">种子 ASIN</p>
                <div className="flex flex-wrap gap-1.5">
                  {project.seedAsins!.map((a, i) => (
                    <span key={i} className="rounded-full bg-white border border-black/8 px-2.5 py-1 text-xs font-mono text-[#424245]">{a}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* 工作台占位（M2 接入） */}
      <Card className="mt-5 border-dashed">
        <div className="p-6 text-center">
          <FileText className="w-5 h-5 text-[#c7c7cc] mx-auto mb-2" />
          <p className="text-sm text-[#86868b]">五看工作台骨架（非线性进入各视角）将在 Phase 1 M2 接入，当前先以项目概览呈现进度。</p>
        </div>
      </Card>
    </div>
  );
}
