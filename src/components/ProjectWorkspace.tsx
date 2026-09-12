import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Loader2,
  Wrench,
  Target,
  Users,
  Crosshair,
  UserCog,
  Sparkles,
  Pencil,
  FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from './ui/Card';
import { Card } from './ui/Card';
import { ProjectOverviewContent } from './ProjectOverview';
import { LookWizardPanel } from './LookWizardPanel';
import { SelfAssessmentView } from './SelfAssessmentView';
import { MarketLookView } from './MarketLookView';
import { UserLookView } from './UserLookView';
import { CompetitorLookView } from './CompetitorLookView';
import { OpportunityLookView } from './OpportunityLookView';
import { EditProjectModal } from './EditProjectModal';
import { ProjectMembersModal } from './ProjectMembersModal';
import { ReportsView } from './ReportsView';
import { setActiveLook } from '../utils/projectStore';
import { syncUserProjectsToCloud } from '../utils/projectCloudAutosync';
import type { MarketContext } from '../utils/marketLook';
import type { UserContext } from '../utils/userLook';
import type { CompetitorContext } from '../utils/competitorLook';
import {
  FIVE_LOOK_LABELS,
  FIVE_LOOKS,
  LOOK_STATUS_LABELS,
  type FiveLookId,
  type LookStatus,
  type ResearchProject,
} from '../types/researchProject';

type Tab = 'overview' | FiveLookId | 'reports';

const LOOK_ICONS: Record<FiveLookId, typeof Target> = {
  market: Target,
  user: Users,
  competitor: Crosshair,
  self: UserCog,
  opportunity: Sparkles,
};

const LOOK_STATUS_BADGE: Record<LookStatus, string> = {
  not_started: 'bg-[#f5f5f7] text-[#86868b] border-black/5',
  in_progress: 'bg-amber-50 text-amber-700 border-amber-100',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  stale: 'bg-rose-50 text-rose-700 border-rose-100',
};

const LOOK_STATUS_DOT: Record<LookStatus, string> = {
  not_started: 'bg-[#c7c7cc]',
  in_progress: 'bg-amber-500',
  completed: 'bg-emerald-500',
  stale: 'bg-rose-500',
};


type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const SAVE_HINT: Record<SaveState, { text: string; cls: string; icon: typeof Circle }> = {
  idle: { text: '已保存', cls: 'text-[#aeaeb2]', icon: CheckCircle2 },
  saving: { text: '保存中…', cls: 'text-amber-600', icon: Loader2 },
  saved: { text: '已保存', cls: 'text-emerald-600', icon: CheckCircle2 },
  error: { text: '保存失败，点击重试', cls: 'text-rose-600', icon: AlertTriangle },
};

export function ProjectWorkspace({
  userId,
  project,
  username,
  marketContext,
  userContext,
  competitorContext,
  onBack,
  onOpenTool,
  onProjectChange,
  focusLook,
  focusNonce,
  onLoadDemo,
  onOpenSettings,
}: {
  userId: string;
  project: ResearchProject;
  username: string;
  marketContext: MarketContext;
  userContext: UserContext;
  competitorContext: CompetitorContext;
  onBack: () => void;
  /** M1 · ToolRoute：带上"从哪一个看来"，供 App 在返回时精确回到该看 */
  onOpenTool: (view: 'market' | 'competitors' | 'insights' | 'keywords' | 'profit', fromLook: FiveLookId) => void;
  onProjectChange: (updated: ResearchProject) => void;
  /** 从工具返回时要求聚焦的看（配合 focusNonce 触发一次） */
  focusLook?: FiveLookId | null;
  focusNonce?: number;
  /** 缺失数据时的一键兜底：加载示例数据 */
  onLoadDemo?: () => void;
  /** 缺 AI Key 时的一键动作：打开设置面板 */
  onOpenSettings?: () => void;
}) {
  const [p, setP] = useState<ResearchProject>(project);
  const [tab, setTab] = useState<Tab>(project.activeLook);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [editOpen, setEditOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const initialSyncKey = useRef(`${project.id}:${project.version}:${project.updatedAt}`);
  const lastQueuedSyncKey = useRef(initialSyncKey.current);

  const queueCloudSync = () => {
    lastQueuedSyncKey.current = '';
    void syncUserProjectsToCloud(userId);
  };

  useEffect(() => {
    const syncKey = `${p.id}:${p.version}:${p.updatedAt}`;
    if (syncKey === initialSyncKey.current || syncKey === lastQueuedSyncKey.current) return;
    lastQueuedSyncKey.current = syncKey;
    const timer = window.setTimeout(() => {
      void syncUserProjectsToCloud(userId);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [p.id, p.version, p.updatedAt, userId]);

  const applyProjectUpdate = (updated: ResearchProject) => {
    setP(updated);
    onProjectChange(updated);
  };

  // M1 · ToolRoute：从工具返回时，精确回到当初打开工具的那一个看
  const focusNonceRef = useRef(0);
  useEffect(() => {
    if (!focusLook || !focusNonce) return;
    if (focusNonceRef.current === focusNonce) return;
    focusNonceRef.current = focusNonce;
    void switchToLook(focusLook);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusLook, focusNonce]);

  const switchToLook = async (look: FiveLookId) => {
    setTab(look);
    if (p.activeLook === look) return;
    setSaveState('saving');
    try {
      const updated = await setActiveLook(userId, p.id, look);
      if (updated) {
        applyProjectUpdate(updated);
        setSaveState('saved');
      } else {
        setSaveState('error');
        toast.error('保存工作位置失败');
      }
    } catch {
      setSaveState('error');
      toast.error('保存工作位置失败');
    }
  };

  const retrySave = async () => {
    setSaveState('saving');
    try {
      const updated = await setActiveLook(userId, p.id, tab as FiveLookId);
      if (updated) {
        applyProjectUpdate(updated);
        setSaveState('saved');
      } else {
        setSaveState('error');
      }
    } catch {
      setSaveState('error');
    }
  };

  /** 打开工具时记录"从哪一个看来"（概览/报告页则退回项目当前活跃的看） */
  const toolOriginLook: FiveLookId = tab === 'overview' || tab === 'reports' ? p.activeLook : tab;

  const toolButtons: { label: string; view: 'market' | 'competitors' | 'insights' | 'keywords' | 'profit' }[] =
    tab === 'market'
      ? [{ label: '打开市场大盘工具', view: 'market' }]
      : tab === 'user'
        ? [{ label: '打开关键词工具', view: 'keywords' }, { label: '打开评论 / VOC 工具', view: 'insights' }]
        : tab === 'competitor'
          ? [{ label: '打开竞品明细工具', view: 'competitors' }]
          : tab === 'self'
            ? [{ label: '打开利润计算器', view: 'profit' }]
            : [];
  const hint = SAVE_HINT[saveState];
  const HintIcon = hint.icon;

  return (
    <div className="max-w-6xl mx-auto w-full">
      {/* 顶部：返回 + 项目名 + 保存状态 */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="mt-1 shrink-0 w-8 h-8 rounded-xl border border-black/8 bg-white text-[#86868b] hover:text-indigo-600 hover:border-indigo-200 transition-all flex items-center justify-center"
            title="返回项目中心"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-[#1d1d1f] truncate">{p.name}</h2>
              <button type="button" onClick={() => setEditOpen(true)} title="编辑项目" className="shrink-0 w-7 h-7 rounded-lg hover:bg-[#f5f5f7] flex items-center justify-center text-[#aeaeb2] hover:text-indigo-600 transition-colors">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => setMembersOpen(true)} title="项目成员" className="shrink-0 w-7 h-7 rounded-lg hover:bg-[#f5f5f7] flex items-center justify-center text-[#aeaeb2] hover:text-indigo-600 transition-colors">
                <Users className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-sm text-[#86868b] mt-0.5">{p.marketplace} · {p.objective || '未设置目标'}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={saveState === 'error' ? retrySave : undefined}
          className={cn('inline-flex items-center gap-1.5 text-xs font-medium shrink-0 mt-1', hint.cls)}
        >
          <HintIcon className={cn('w-3.5 h-3.5', saveState === 'saving' && 'animate-spin')} />
          {hint.text}
        </button>
      </div>

      {/* 打开对应的分析工具（工具仍在全局工作区，通过项目入口进入） */}
      {toolButtons.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {toolButtons.map((b) => (
            <button
              key={b.view}
              type="button"
              onClick={() => onOpenTool(b.view, toolOriginLook)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-indigo-100 bg-indigo-50 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 hover:border-indigo-200 transition-all active:scale-[0.98]"
            >
              <Wrench className="w-3.5 h-3.5" />
              {b.label}
            </button>
          ))}
        </div>
      )}

      {/* 向导步骤条：五看带序号（非线性，可任意顺序进入） */}
      <div className="flex flex-wrap items-center gap-1.5 mb-5 border-b border-black/5 pb-3">
        <TabButton active={tab === 'overview'} onClick={() => setTab('overview')} label="概览" />
        {FIVE_LOOKS.map((look, idx) => {
          const Icon = LOOK_ICONS[look];
          const s = p.fiveLookProgress[look].status;
          return (
            <TabButton
              key={look}
              active={tab === look}
              onClick={() => void switchToLook(look)}
              label={`${idx + 1} ${FIVE_LOOK_LABELS[look]}`}
              icon={<Icon className="w-3.5 h-3.5" />}
              dot={<span className={cn('w-1.5 h-1.5 rounded-full', LOOK_STATUS_DOT[s])} />}
            />
          );
        })}
        <TabButton active={tab === 'reports'} onClick={() => setTab('reports')} label="报告" icon={<FileText className="w-3.5 h-3.5" />} />
      </div>

      {/* 内容区 */}
      {tab === 'overview' ? (
        <div className="space-y-5">
          <LookWizardPanel
            userId={userId}
            project={p}
            onProjectChange={applyProjectUpdate}
            onLoadDemo={onLoadDemo}
            onOpenTool={(view) => onOpenTool(view, toolOriginLook)}
            onOpenSettings={onOpenSettings}
          />
          <ProjectOverviewContent project={p} username={username} userId={userId} onNavigateLook={(look) => void switchToLook(look)} />
        </div>
      ) : tab === 'self' ? (
        <SelfAssessmentView userId={userId} project={p} onProjectChange={applyProjectUpdate} />
      ) : tab === 'market' ? (
        <MarketLookView userId={userId} project={p} marketContext={marketContext} onProjectChange={applyProjectUpdate} onOpenMarketTool={() => onOpenTool('market', 'market')} />
      ) : tab === 'user' ? (
        <UserLookView userId={userId} project={p} userContext={userContext} onProjectChange={applyProjectUpdate} />
      ) : tab === 'competitor' ? (
        <CompetitorLookView userId={userId} project={p} competitorContext={competitorContext} onProjectChange={applyProjectUpdate} onOpenCompetitorTool={() => onOpenTool('competitors', 'competitor')} />
      ) : tab === 'opportunity' ? (
        <OpportunityLookView userId={userId} project={p} onProjectChange={applyProjectUpdate} onNavigateLook={(look) => void switchToLook(look)} />
      ) : (
        <ReportsView userId={userId} project={p} onContentChange={queueCloudSync} />
      )}
      {editOpen && (
        <EditProjectModal
          userId={userId}
          project={p}
          onClose={() => setEditOpen(false)}
          onSaved={(updated) => {
            setEditOpen(false);
            applyProjectUpdate(updated);
          }}
        />
      )}
      {membersOpen && (
        <ProjectMembersModal
          projectId={p.id}
          currentUserId={userId}
          onClose={() => setMembersOpen(false)}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  icon,
  dot,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: ReactNode;
  dot?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium border transition-all',
        active
          ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-200'
          : 'bg-white text-[#86868b] border-black/8 hover:text-indigo-600 hover:border-indigo-200'
      )}
    >
      {icon}
      {label}
      {dot}
    </button>
  );
}

