import { useEffect, useState } from 'react';
import { Globe, Target, User, Clock, Sparkles, ArrowRight, Database, Download } from 'lucide-react';
import { listLegacyData, buildLegacyBackup, type LegacyDataSummary } from '../utils/legacyData';
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

export function ProjectOverviewContent({
  project,
  username,
  userId,
  onNavigateLook,
}: {
  project: ResearchProject;
  username: string;
  userId: string;
  onNavigateLook: (look: FiveLookId) => void;
}) {
  const next = recommendNextLook(project);

  return (
    <div className="space-y-5">
      {/* 项目头元信息 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#86868b]">
        <span className="inline-flex items-center gap-1"><Globe className="w-3.5 h-3.5" /> {project.marketplace}</span>
        <span className="inline-flex items-center gap-1"><Target className="w-3.5 h-3.5" /> {project.objective || '未设置目标'}</span>
        <span className="inline-flex items-center gap-1"><User className="w-3.5 h-3.5" /> {username}</span>
        <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> 更新于 {formatDate(project.updatedAt)}</span>
      </div>

      {/* 五看进度 */}
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
                  {p.missingRequirements.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {p.missingRequirements.slice(0, 2).map((m, i) => (
                        <li key={i} className="text-[11px] text-[#86868b] leading-snug">· {m}</li>
                      ))}
                    </ul>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* 推荐下一步 */}
      {next && (
        <button
          type="button"
          onClick={() => onNavigateLook(next.look)}
          className="w-full rounded-[20px] border border-indigo-100 bg-gradient-to-r from-indigo-50/60 to-violet-50/60 p-5 flex items-center gap-3 text-left hover:from-indigo-50 hover:to-violet-50 transition-all"
        >
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
        </button>
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
      <LegacyMigrationCard userId={userId} />
    </div>
  );
}

function LegacyMigrationCard({ userId }: { userId: string }) {
  const [summary, setSummary] = useState<LegacyDataSummary | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listLegacyData(userId).then((s) => { if (!cancelled) setSummary(s); });
    return () => { cancelled = true; };
  }, [userId]);

  const doExport = async () => {
    setExporting(true);
    try {
      const json = await buildLegacyBackup(userId);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'amzdev-legacy-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  if (!summary) return null;

  return (
    <Card>
      <div className="p-5">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-indigo-600" />
            <p className="text-sm font-semibold text-[#1d1d1f]">旧数据迁移</p>
          </div>
          <button type="button" onClick={doExport} disabled={exporting} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-black/8 bg-white text-xs font-semibold text-[#424245] hover:bg-[#f5f5f7] transition-all disabled:opacity-40">
            <Download className="w-3.5 h-3.5" /> {exporting ? '导出中…' : '备份导出'}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip label={'市场快照 ' + summary.marketSnapshots} active={summary.marketSnapshots > 0} />
          <Chip label={'竞品快照 ' + summary.competitorSnapshots} active={summary.competitorSnapshots > 0} />
          <Chip label="关键词洞察" active={summary.keywordInsight} />
          <Chip label="用户洞察" active={summary.userInsights} />
          <Chip label="市场报告缓存" active={summary.marketReportCache} />
        </div>
        <p className="text-xs text-[#aeaeb2] mt-2 leading-relaxed">
          旧数据保留可读、不会被删除；「挂到项目 / 待关联研究」将在后续「数据与证据」页面提供。
        </p>
      </div>
    </Card>
  );
}

function Chip({ label, active }: { label: string; active: boolean }) {
  return (
    <span className={cn('rounded-full border px-2.5 py-0.5 text-[11px] font-medium', active ? 'bg-indigo-50 border-indigo-100 text-indigo-700' : 'bg-[#f5f5f7] border-black/5 text-[#aeaeb2]')}>
      {label}
    </span>
  );
}
