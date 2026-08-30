import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Plus,
  Search,
  Archive,
  ArchiveRestore,
  Copy,
  Trash2,
  FolderOpen,
  Clock,
  User,
  Globe,
  X,
  FolderPlus,
  RefreshCw,
  Cloud,
  CloudOff,
  CheckCircle2,
  AlertTriangle,
  SlidersHorizontal,
  ArrowRight,
  MoreHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from './ui/Card';
import { Card } from './ui/Card';
import { Select } from './ui/Select';
import { loadPendingCloudDeletions, recordPendingCloudDeletion } from '../utils/cloudDeletionStore';
import { dropPendingDeletions } from '../utils/cloudSync';
import { purgeProjectAssets } from '../utils/projectAssets';
import { getAuthToken } from '../utils/auth';
import { syncUserProjectsToCloud, type ProjectCloudSyncResult } from '../utils/projectCloudAutosync';
import type { MarketContext } from '../utils/marketLook';
import type { UserContext } from '../utils/userLook';
import type { CompetitorContext } from '../utils/competitorLook';
import {
  archiveProject,
  createProject,
  deleteProject,
  duplicateProject,
  loadProjects,
  persistProjects,
  restoreProject,
  setActiveLook,
} from '../utils/projectStore';
import { type ResearchProject } from '../types/researchProject';
import { loadProjectDecisionSummary, type ProjectDecisionSummary } from '../utils/projectDecision';

const MARKETPLACES: { code: string; label: string }[] = [
  { code: 'US', label: 'US · 美国' },
  { code: 'CA', label: 'CA · 加拿大' },
  { code: 'MX', label: 'MX · 墨西哥' },
  { code: 'BR', label: 'BR · 巴西' },
  { code: 'UK', label: 'UK · 英国' },
  { code: 'DE', label: 'DE · 德国' },
  { code: 'FR', label: 'FR · 法国' },
  { code: 'IT', label: 'IT · 意大利' },
  { code: 'ES', label: 'ES · 西班牙' },
  { code: 'NL', label: 'NL · 荷兰' },
  { code: 'SE', label: 'SE · 瑞典' },
  { code: 'PL', label: 'PL · 波兰' },
  { code: 'TR', label: 'TR · 土耳其' },
  { code: 'JP', label: 'JP · 日本' },
  { code: 'AU', label: 'AU · 澳大利亚' },
  { code: 'SG', label: 'SG · 新加坡' },
  { code: 'IN', label: 'IN · 印度' },
  { code: 'AE', label: 'AE · 阿联酋' },
  { code: 'SA', label: 'SA · 沙特' },
];

const OBJECTIVES = ['新品开发', '市场进入', '存量优化', '产品迭代', '竞品突破', '利润验证'];

const STATUS_LABELS: Record<ResearchProject['status'], string> = {
  draft: '草稿',
  researching: '研究中',
  ready_for_review: '待评审',
  approved: '已通过',
  rejected: '已驳回',
  archived: '已归档',
};

function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function marketplaceLabel(code: string): string {
  return MARKETPLACES.find((m) => m.code === code)?.label ?? code;
}

interface ProjectCenterProps {
  userId: string;
  username: string;
  marketContext: MarketContext;
  userContext: UserContext;
  competitorContext: CompetitorContext;
  onOpenProject: (project: ResearchProject) => void;
}

export function ProjectCenter({ userId, username, marketContext, userContext, competitorContext, onOpenProject }: ProjectCenterProps) {
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [marketplace, setMarketplace] = useState('');
  const [status, setStatus] = useState('active');
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ResearchProject | null>(null);
  const [hasAutoSynced, setHasAutoSynced] = useState(false);
  const syncInFlight = useRef(false);
  const [syncState, setSyncState] = useState<ProjectCloudSyncResult | null>(null);
  const [syncTouched, setSyncTouched] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [createdProjectId, setCreatedProjectId] = useState('');

  const queueCloudSync = async () => {
    if (!getAuthToken()) return;
    if (syncInFlight.current) return;
    syncInFlight.current = true;
    try {
      const res = await syncUserProjectsToCloud(userId);
      setSyncState(res);
      setSyncTouched(true);
      if (res.ok) {
        await refresh();
      }
    } finally {
      syncInFlight.current = false;
    }
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, pendingDeletionIds] = await Promise.all([
        loadProjects(userId),
        loadPendingCloudDeletions(userId),
      ]);
      const visible = dropPendingDeletions(list, pendingDeletionIds);
      if (visible.length !== list.length) await persistProjects(userId, visible);
      setProjects(visible);
    } catch {
      toast.error('项目列表读取失败');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const handleSync = useCallback(async () => {
    if (!getAuthToken()) {
      return;
    }
    if (syncInFlight.current) return;
    syncInFlight.current = true;
    try {
      const res = await syncUserProjectsToCloud(userId);
      setSyncState(res);
      setSyncTouched(true);
      if (res.ok) {
        await refresh();
      }
    } finally {
      syncInFlight.current = false;
    }
  }, [refresh, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (loading || hasAutoSynced || !getAuthToken()) return;
    setHasAutoSynced(true);
    void handleSync();
  }, [loading, hasAutoSynced, handleSync]);

  useEffect(() => {
    if (!getAuthToken()) return;
    const syncIfVisible = () => {
      if (document.visibilityState === 'visible') void handleSync();
    };
    const onFocus = () => void handleSync();
    const timer = window.setInterval(syncIfVisible, 30000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', syncIfVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', syncIfVisible);
    };
  }, [handleSync]);

  const filtered = useMemo(() => {
    return searchProjectsSync(projects, { keyword, marketplace, status });
  }, [projects, keyword, marketplace, status]);

  return (
    <div className="max-w-6xl mx-auto w-full">
      {/* 顶部：标题 + 新建 */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-5">
        <div>
          <p className="text-base font-semibold text-[#1d1d1f]">最近研究</p>
          <p className="text-sm text-[#86868b] mt-1">从用户需求出发，继续完成品类机会判断。</p>
        </div>
        <div className="flex items-center gap-2">
          {getAuthToken() && (
            <button
              type="button"
              onClick={() => void handleSync()}
              title={syncState?.ok ? '云同步正常，点击刷新' : syncState?.error || '检查云同步'}
              aria-label={syncState?.ok ? '云同步正常' : '检查云同步'}
              className={cn(
                'w-10 h-10 rounded-xl border flex items-center justify-center transition-all',
                syncState?.ok ? 'border-emerald-100 bg-emerald-50 text-emerald-600' : syncState ? 'border-amber-100 bg-amber-50 text-amber-600' : 'border-black/8 bg-white text-[#86868b]'
              )}
            >
              {syncState?.ok ? <Cloud className="w-4 h-4" /> : <CloudOff className="w-4 h-4" />}
            </button>
          )}
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-sm font-semibold shadow-lg shadow-indigo-200 hover:from-indigo-600 hover:to-violet-600 transition-all active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" />
            新建项目
          </button>
        </div>
      </div>

      {/* 云同步仅在失败或未启用时展开；成功状态收进顶部图标。 */}
      {syncState && !syncState.ok && (
        <div className="mb-4">
          <CloudSyncStatusBanner state={syncState} onRetry={() => void handleSync()} />
        </div>
      )}

      {/* 搜索与筛选 */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#aeaeb2]" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索项目名、站点、类目、关键词、ASIN…"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-black/8 bg-white text-sm text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300 transition-all"
          />
        </div>
        <button type="button" onClick={() => setFiltersOpen((open) => !open)} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-black/8 bg-white text-sm font-medium text-[#86868b] hover:text-indigo-600 hover:border-indigo-200">
          <SlidersHorizontal className="w-4 h-4" /> 筛选
        </button>
      </div>
      {filtersOpen && (
        <div className="flex flex-wrap items-center gap-2 mb-5 rounded-2xl border border-black/5 bg-[#fafafa] p-3">
          <Select value={marketplace} onChange={setMarketplace} options={[{ value: '', label: '全部站点' }, ...MARKETPLACES.map((m) => ({ value: m.code, label: m.label }))]} placeholder="全部站点" />
          <Select value={status} onChange={setStatus} options={[{ value: 'active', label: '活跃项目' }, { value: 'archived', label: '已归档' }, { value: 'all', label: '全部' }]} placeholder="状态" />
        </div>
      )}

      {/* 列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-sm text-[#aeaeb2]">
          <span className="animate-spin w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full mr-2" />
          正在加载项目…
        </div>
      ) : filtered.length === 0 ? (
        <Card className="py-16 text-center">
          <div className="mx-auto w-14 h-14 bg-indigo-50 rounded-full flex items-center justify-center mb-4">
            <FolderPlus className="w-6 h-6 text-indigo-500" />
          </div>
          <p className="text-[#1d1d1f] font-semibold">还没有项目</p>
          <p className="text-sm text-[#86868b] mt-1 mb-5">新建一个市调项目，从任意「一看」开始推进研究</p>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-all"
          >
            <Plus className="w-4 h-4" /> 新建第一个项目
          </button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {filtered.map((p) => (
            <ProjectCard
              key={p.id}
              userId={userId}
              project={p}
              username={username}
              highlighted={p.id === createdProjectId}
              onOpen={(override) => onOpenProject(override ?? p)}
              onDuplicate={() => handleDuplicate(p)}
              onArchive={() => handleArchive(p)}
              onDelete={() => setDeleteTarget(p)}
            />
          ))}
        </div>
      )}

      {createOpen && (
        <CreateProjectModal
          userId={userId}
          username={username}
          onClose={() => setCreateOpen(false)}
          onCreated={async (project) => {
            setCreateOpen(false);
            setCreatedProjectId(project.id);
            await refresh();
            await queueCloudSync();
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmDeleteModal
          project={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async () => {
            const ok = await deleteProject(userId, deleteTarget.id);
            setDeleteTarget(null);
            if (ok) {
              void purgeProjectAssets(deleteTarget.id);
              await recordPendingCloudDeletion(userId, deleteTarget.id);
              // 立即从内存列表移除，避免等待同步期间「复活」（30s 定时同步竞态）
              setProjects((prev) => {
                const id = deleteTarget.id;
                return prev.filter((p) => p.id !== id && !p.id.startsWith(`${id}_conflict_`));
              });
              toast.success('项目已删除');
              await refresh();
              await queueCloudSync();
            } else {
              toast.error('删除失败，项目不存在');
            }
          }}
        />
      )}

    </div>
  );

  async function handleDuplicate(p: ResearchProject) {
    const copy = await duplicateProject(userId, p.id);
    if (copy) {
      toast.success('已复制项目');
      await refresh();
      await queueCloudSync();
    } else {
      toast.error('复制失败');
    }
  }

  async function handleArchive(p: ResearchProject) {
    const archived = p.status === 'archived';
    const next = archived ? await restoreProject(userId, p.id) : await archiveProject(userId, p.id);
    if (next) {
      toast.success(archived ? '已恢复为活跃项目' : '已归档');
      await refresh();
      await queueCloudSync();
    } else {
      toast.error('操作失败');
    }
  }
}

/** 纯内存搜索，保持列表交互即时；IndexedDB 在 loadProjects 时已完成过滤排序 */
function searchProjectsSync(
  projects: ResearchProject[],
  q: { keyword: string; marketplace: string; status: string }
): ResearchProject[] {
  const kw = q.keyword.trim().toLowerCase();
  return projects.filter((p) => {
    if (q.marketplace && p.marketplace !== q.marketplace) return false;
    if (q.status === 'active' && p.status === 'archived') return false;
    if (q.status === 'archived' && p.status !== 'archived') return false;
    if (kw) {
      const haystack = [
        p.name,
        p.marketplace,
        ...(p.categories ?? []),
        ...(p.coreKeywords ?? []),
        ...(p.seedAsins ?? []),
        p.description ?? '',
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(kw)) return false;
    }
    return true;
  });
}

function ProjectCard({
  userId,
  project,
  username,
  highlighted,
  onOpen,
  onDuplicate,
  onArchive,
  onDelete,
}: {
  userId: string;
  project: ResearchProject;
  username: string;
  highlighted?: boolean;
  onOpen: (override?: ResearchProject) => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const isArchived = project.status === 'archived';
  const ownerLabel = project.ownerId ? username : '—';
  const [summary, setSummary] = useState<ProjectDecisionSummary | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void loadProjectDecisionSummary(userId, project).then((value) => { if (!cancelled) setSummary(value); });
    return () => { cancelled = true; };
  }, [userId, project]);

  return (
    <Card className={cn('flex flex-col transition-all', highlighted && 'ring-2 ring-indigo-400/40 border-indigo-200 bg-indigo-50/20')}>
      <div className="p-5 pb-4">
        <div className="flex items-start justify-between gap-2">
          <button type="button" onClick={() => onOpen()} className="text-left group flex-1 min-w-0">
            <h3 className="font-semibold text-[#1d1d1f] truncate group-hover:text-indigo-600 transition-colors">
              {project.name}
            </h3>
          </button>
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold border',
              isArchived
                ? 'bg-[#f5f5f7] text-[#86868b] border-black/5'
                : project.status === 'ready_for_review'
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-100'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-100'
            )}
          >
            {summary?.stageLabel || STATUS_LABELS[project.status]}
          </span>
        </div>

        <p className="text-sm text-[#424245] leading-6 mt-3">研究目标：{project.objective || '尚未设置'}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-[#86868b]">
          <span className="inline-flex items-center gap-1">
            <Globe className="w-3.5 h-3.5" /> {marketplaceLabel(project.marketplace)}
          </span>
          <span className="inline-flex items-center gap-1">
            <User className="w-3.5 h-3.5" /> {ownerLabel}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> {formatDate(project.updatedAt)}
          </span>
        </div>
      </div>

      <div className="mx-5 mb-4 rounded-2xl border border-black/5 bg-[#fafafa] p-4">
        <p className="text-sm font-semibold text-[#1d1d1f] leading-6">{summary?.judgement || '正在读取最近业务结论…'}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#86868b]">
          <span>进度：{summary?.completedLooks ?? 0}/5 个视角已有完整结论</span>
          {summary?.selectedSegment && <span>目标细分：{summary.selectedSegment}</span>}
          {!!summary?.confirmedOpportunities && <span className="text-emerald-700">已确认机会：{summary.confirmedOpportunities}</span>}
        </div>
        <p className="mt-2 text-xs text-amber-700">当前缺口：{summary?.largestGap || '正在判断…'}</p>
      </div>

      {/* 操作区 */}
      <div className="px-5 pb-5 mt-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={async () => {
            const nextLook = summary?.nextLook ?? (highlighted ? 'user' : project.activeLook);
            const updated = await setActiveLook(userId, project.id, nextLook);
            onOpen(updated ?? project);
          }}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-all active:scale-[0.98]"
        >
          {highlighted ? '开始看用户' : summary?.nextAction || '继续研究'} <ArrowRight className="w-3.5 h-3.5" />
        </button>
        <div className="relative">
          <IconButton title="更多项目操作" onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal className="w-3.5 h-3.5" /></IconButton>
          {menuOpen && (
            <div className="absolute right-0 bottom-10 z-20 w-36 rounded-xl border border-black/8 bg-white p-1 shadow-xl">
              <button type="button" onClick={() => { setMenuOpen(false); onDuplicate(); }} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-[#424245] hover:bg-[#f5f5f7]"><Copy className="w-3.5 h-3.5" />复制项目</button>
              <button type="button" onClick={() => { setMenuOpen(false); onArchive(); }} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-[#424245] hover:bg-[#f5f5f7]">{isArchived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}{isArchived ? '恢复项目' : '归档项目'}</button>
              <button type="button" onClick={() => { setMenuOpen(false); onDelete(); }} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-rose-600 hover:bg-rose-50"><Trash2 className="w-3.5 h-3.5" />删除项目</button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function IconButton({
  title,
  danger,
  onClick,
  children,
}: {
  title: string;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center w-8 h-8 rounded-xl border border-black/8 bg-white text-[#86868b] transition-all active:scale-[0.96]',
        danger ? 'hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50' : 'hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50'
      )}
    >
      {children}
    </button>
  );
}

function CreateProjectModal({
  userId,
  username,
  onClose,
  onCreated,
}: {
  userId: string;
  username: string;
  onClose: () => void;
  onCreated: (p: ResearchProject) => void;
}) {
  const [name, setName] = useState('');
  const [marketplace, setMarketplace] = useState('');
  const [objective, setObjective] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [objectiveOpen, setObjectiveOpen] = useState(false);

  const owner = username.trim() || '当前用户';
  const canSave = marketplace.trim().length > 0 && objective.trim().length > 0;

  const submit = async () => {
    if (!canSave) {
      setError('请选择站点并填写研究目标');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const p = await createProject(userId, {
        name: name.trim() || `${marketplace.trim()} · ${objective.trim()}机会研究`,
        marketplace: marketplace.trim(),
        objective: objective.trim(),
        ownerId: userId,
      });
      onCreated(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-[32px] shadow-[0_12px_40px_rgba(15,23,42,0.14)] border border-black/8 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between px-7 pt-6">
          <div>
            <h3 className="text-xl font-bold text-[#1d1d1f]">新建项目</h3>
            <p className="text-sm text-[#86868b] mt-0.5">只需研究目标和站点，创建后从“看用户”开始</p>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full hover:bg-[#f5f5f7] flex items-center justify-center text-[#86868b]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-7 py-5 space-y-4">
          <Field label="项目名称（选填）">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="留空将根据站点和研究目标自动生成"
              className={inputCls}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="站点" required>
              <PresetDropdownInput
                value={marketplace}
                placeholder="选择或输入站点"
                open={marketplaceOpen}
                onOpenChange={setMarketplaceOpen}
                onChange={setMarketplace}
                items={MARKETPLACES.map((m) => ({ value: m.code, label: m.label }))}
              />
            </Field>
            <Field label="研究目标" required>
              <PresetDropdownInput
                value={objective}
                placeholder="选择或输入研究目标"
                open={objectiveOpen}
                onOpenChange={setObjectiveOpen}
                onChange={setObjective}
                items={OBJECTIVES.map((item) => ({ value: item, label: item }))}
              />
            </Field>
          </div>

          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm text-indigo-800 leading-6">
            创建后可在项目内补充关键词、ASIN 和研究说明。系统会先引导你形成需求分类，再进入市场、竞对和机会判断。
          </div>

          {error && <p className="text-xs text-rose-600">{error}</p>}
        </div>

        <div className="px-7 pb-7 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl border border-black/8 text-sm font-medium text-[#424245] hover:bg-[#f5f5f7] transition-all">
            取消
          </button>
          <button
            type="button"
            disabled={!canSave || saving}
            onClick={submit}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-sm font-semibold hover:from-indigo-600 hover:to-violet-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
          >
            {saving ? '创建中…' : '创建项目'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDeleteModal({
  project,
  onCancel,
  onConfirm,
}: {
  project: ResearchProject;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm bg-white rounded-[32px] shadow-[0_12px_40px_rgba(15,23,42,0.14)] border border-black/8 p-7">
        <div className="w-12 h-12 bg-rose-50 rounded-full flex items-center justify-center mb-4">
          <Trash2 className="w-5 h-5 text-rose-500" />
        </div>
        <h3 className="text-lg font-bold text-[#1d1d1f]">删除项目？</h3>
        <p className="text-sm text-[#86868b] mt-1.5 leading-relaxed">
          「{project.name}」及其五看数据、机会卡和报告将一并删除，此操作不可撤销。
        </p>
        <div className="flex items-center justify-end gap-2 mt-6">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-xl border border-black/8 text-sm font-medium text-[#424245] hover:bg-[#f5f5f7] transition-all">
            取消
          </button>
          <button type="button" onClick={onConfirm} className="px-4 py-2 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 transition-all active:scale-[0.98]">
            确认删除
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-[#424245] mb-1.5">
        {label}
        {required && <span className="text-rose-500 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}

function PresetDropdownInput({
  items,
  value,
  placeholder,
  open,
  onOpenChange,
  onChange,
}: {
  items: { value: string; label: string }[];
  value: string;
  placeholder: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
}) {
  const visibleItems = items.filter((item) => {
    const kw = value.trim().toLowerCase();
    if (!kw) return true;
    return item.value.toLowerCase().includes(kw) || item.label.toLowerCase().includes(kw);
  });
  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          onOpenChange(true);
        }}
        onFocus={() => onOpenChange(true)}
        onBlur={() => window.setTimeout(() => onOpenChange(false), 120)}
        className={inputCls}
        placeholder={placeholder}
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-xl border border-black/8 bg-white shadow-xl p-1">
          {visibleItems.length ? (
            visibleItems.map((item) => (
              <button
                key={item.value}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(item.value);
                  onOpenChange(false);
                }}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-lg text-sm transition-all',
                  value === item.value ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-[#424245] hover:bg-[#f5f5f7]'
                )}
              >
                {item.label}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-xs text-[#86868b]">按当前输入作为自定义值保存</div>
          )}
        </div>
      )}
    </div>
  );
}

const inputCls =
  'w-full px-3 py-2.5 rounded-xl border border-black/8 bg-gradient-to-b from-white to-[#f8f9fb] text-sm text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300 transition-all';

function splitList(s: string): string[] | undefined {
  const list = s
    .split(/[,，\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
  return list.length ? list : undefined;
}

/** 云同步状态横幅：暴露真实同步结果，便于定位跨设备不同步问题。 */
function CloudSyncStatusBanner({
  state,
  onRetry,
}: {
  state: ProjectCloudSyncResult;
  onRetry: () => void;
}) {
  const result = state.result;
  if (!state.ok) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-rose-100 bg-rose-50/60 px-4 py-3">
        <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-rose-700">云同步失败</p>
          <p className="text-xs text-rose-600 mt-0.5 break-all">{state.error || '未知错误'}</p>
        </div>
        <button type="button" onClick={onRetry} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-200 bg-white text-xs font-semibold text-rose-700 hover:bg-rose-50 transition-all">
          <RefreshCw className="w-3.5 h-3.5" /> 重试
        </button>
      </div>
    );
  }
  if (result?.cloudDisabled) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3">
        <CloudOff className="w-4 h-4 text-amber-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-700">云同步未启用（云端后端未连接）</p>
          <p className="text-xs text-amber-700/80 mt-0.5">
            当前各设备只在本机保存，无法跨设备同步。需要部署环境配置 Supabase 环境变量（SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 等）。
          </p>
        </div>
        <button type="button" onClick={onRetry} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-amber-200 bg-white text-xs font-semibold text-amber-700 hover:bg-amber-50 transition-all">
          <RefreshCw className="w-3.5 h-3.5" /> 重试
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/60 px-4 py-3">
      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-emerald-700">云同步正常</p>
        <p className="text-xs text-emerald-700/80 mt-0.5">
          拉取 {result?.pulled ?? 0} 条 · 推送 {result?.pushed ?? 0} 条 · 删除 {result?.deleted ?? 0} 条 · 冲突 {result?.conflicts ?? 0} 条
          {result && result.conflicts > 0 ? '（同版本分叉已生成冲突副本）' : ''}
        </p>
      </div>
      <button type="button" onClick={onRetry} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-200 bg-white text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-all">
        <RefreshCw className="w-3.5 h-3.5" /> 刷新
      </button>
    </div>
  );
}
