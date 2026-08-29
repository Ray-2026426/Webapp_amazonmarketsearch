import { Globe, Target, User, Clock } from 'lucide-react';
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
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ProjectOverviewContent({
  project,
  username,
  onNavigateLook,
}: {
  project: ResearchProject;
  username: string;
  userId: string;
  onNavigateLook: (look: FiveLookId) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#86868b]">
        <span className="inline-flex items-center gap-1"><Globe className="w-3.5 h-3.5" /> {project.marketplace || '未设置站点'}</span>
        <span className="inline-flex items-center gap-1"><Target className="w-3.5 h-3.5" /> {project.objective || '未设置目标'}</span>
        <span className="inline-flex items-center gap-1"><User className="w-3.5 h-3.5" /> {username}</span>
        <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> 更新于 {formatDate(project.updatedAt)}</span>
      </div>

      <Card>
        <div className="p-5">
          <p className="text-sm font-semibold text-[#1d1d1f] mb-4">五看进度</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {FIVE_LOOKS.map((look) => {
              const p = project.fiveLookProgress[look];
              return (
                <button
                  key={look}
                  type="button"
                  onClick={() => onNavigateLook(look)}
                  className="rounded-2xl border border-black/5 bg-[#fafafa] p-4 text-left hover:border-indigo-200 hover:bg-indigo-50/40 transition-all"
                >
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
                </button>
              );
            })}
          </div>
        </div>
      </Card>

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
    </div>
  );
}
