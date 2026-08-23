import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
  Target,
  X,
  FolderPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from './ui/Card';
import { Card } from './ui/Card';
import { Select } from './ui/Select';
import { ProjectWorkspace } from './ProjectWorkspace';
import type { MarketContext } from '../utils/marketLook';
import type { UserContext } from '../utils/userLook';
import type { CompetitorContext } from '../utils/competitorLook';
import {
  archiveProject,
  createProject,
  deleteProject,
  duplicateProject,
  loadProjects,
  restoreProject,
} from '../utils/projectStore';
import {
  FIVE_LOOK_LABELS,
  FIVE_LOOKS,
  type FiveLookId,
  type LookStatus,
  type ResearchProject,
} from '../types/researchProject';

const MARKETPLACES: { code: string; label: string }[] = [
  { code: 'US', label: 'US · 美国' },
  { code: 'UK', label: 'UK · 英国' },
  { code: 'DE', label: 'DE · 德国' },
  { code: 'FR', label: 'FR · 法国' },
  { code: 'IT', label: 'IT · 意大利' },
  { code: 'ES', label: 'ES · 西班牙' },
  { code: 'CA', label: 'CA · 加拿大' },
  { code: 'JP', label: 'JP · 日本' },
  { code: 'AU', label: 'AU · 澳大利亚' },
  { code: 'MX', label: 'MX · 墨西哥' },
  { code: 'IN', label: 'IN · 印度' },
  { code: 'BR', label: 'BR · 巴西' },
  { code: 'SG', label: 'SG · 新加坡' },
  { code: 'AE', label: 'AE · 阿联酋' },
  { code: 'SA', label: 'SA · 沙特' },
];

const OBJECTIVES = ['新品开发', '市场进入', '存量优化', '产品迭代', '其他'];

const STATUS_LABELS: Record<ResearchProject['status'], string> = {
  draft: '草稿',
  researching: '研究中',
  ready_for_review: '待评审',
  approved: '已通过',
  rejected: '已驳回',
  archived: '已归档',
};

const LOOK_STATUS_COLOR: Record<LookStatus, string> = {
  not_started: 'bg-[#c7c7cc]',
  in_progress: 'bg-amber-500',
  completed: 'bg-emerald-500',
  stale: 'bg-rose-500',
};

const LOOK_STATUS_TEXT: Record<LookStatus, string> = {
  not_started: 'text-[#aeaeb2]',
  in_progress: 'text-amber-600',
  completed: 'text-emerald-600',
  stale: 'text-rose-600',
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
}

export function ProjectCenter({ userId, username, marketContext, userContext, competitorContext }: ProjectCenterProps) {
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [marketplace, setMarketplace] = useState('');
  const [status, setStatus] = useState('active');
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ResearchProject | null>(null);
  const [opened, setOpened] = useState<ResearchProject | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await loadProjects(userId);
      setProjects(list);
    } catch {
      toast.error('项目列表读取失败');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    return searchProjectsSync(projects, { keyword, marketplace, status });
  }, [projects, keyword, marketplace, status]);

  const incompleteLooks = useMemo(() => {
    const active = projects.filter((p) => p.status !== 'archived');
    const counts: Record<FiveLookId, number> = { market: 0, user: 0, competitor: 0, self: 0, opportunity: 0 };
    for (const p of active) {
      for (const look of FIVE_LOOKS) {
        if (p.fiveLookProgress[look].status !== 'completed') counts[look] += 1;
      }
    }
    return counts;
  }, [projects]);

  if (opened) {
    return (
      <ProjectWorkspace
        userId={userId}
        project={opened}
        username={username}
        marketContext={marketContext}
        userContext={userContext}
        competitorContext={competitorContext}
        onBack={() => {
          setOpened(null);
          void refresh();
        }}
        onProjectChange={(updated) => {
          setOpened(updated);
          setProjects((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
        }}
      />
    );
  }

  return (
    <div className="max-w-6xl mx-auto w-full">
      {/* 顶部：标题 + 新建 */}
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-[#1d1d1f]">项目中心</h2>
          <p className="text-sm text-[#86868b] mt-1">
            用一次市调项目承载「看市场 → 看用户 → 看竞品 → 看自己 → 看/找机会」全流程
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-sm font-semibold shadow-lg shadow-indigo-200 hover:from-indigo-600 hover:to-violet-600 transition-all active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          新建项目
        </button>
      </div>

      {/* 搜索与筛选 */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#aeaeb2]" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索项目名、站点、类目、关键词、ASIN…"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-black/8 bg-white text-sm text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300 transition-all"
          />
        </div>
        <Select
          value={marketplace}
          onChange={setMarketplace}
          options={[{ value: '', label: '全部站点' }, ...MARKETPLACES.map((m) => ({ value: m.code, label: m.label }))]}
          placeholder="全部站点"
        />
        <Select
          value={status}
          onChange={setStatus}
          options={[
            { value: 'active', label: '活跃项目' },
            { value: 'archived', label: '已归档' },
            { value: 'all', label: '全部' },
          ]}
          placeholder="状态"
        />
      </div>

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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              username={username}
              onOpen={() => setOpened(p)}
              onDuplicate={() => handleDuplicate(p)}
              onArchive={() => handleArchive(p)}
              onDelete={() => setDeleteTarget(p)}
            />
          ))}
        </div>
      )}

      {/* 底部：未完成统计（工作型信息，非营销 Hero） */}
      {!loading && projects.filter((p) => p.status !== 'archived').length > 0 && (
        <Card className="mt-6 p-5">
          <p className="text-sm font-semibold text-[#1d1d1f] mb-3">五看完成度总览（活跃项目）</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {FIVE_LOOKS.map((look) => (
              <div key={look} className="rounded-2xl border border-black/5 bg-[#fafafa] px-4 py-3">
                <p className="text-xs text-[#86868b]">{FIVE_LOOK_LABELS[look]}</p>
                <p className="text-xl font-bold text-[#1d1d1f] mt-1">{incompleteLooks[look]}</p>
                <p className="text-[11px] text-[#aeaeb2]">未完成</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {createOpen && (
        <CreateProjectModal
          userId={userId}
          username={username}
          onClose={() => setCreateOpen(false)}
          onCreated={async (p) => {
            setCreateOpen(false);
            await refresh();
            setOpened(p);
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
              toast.success('项目已删除');
              await refresh();
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
        p.objective,
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
  project,
  username,
  onOpen,
  onDuplicate,
  onArchive,
  onDelete,
}: {
  project: ResearchProject;
  username: string;
  onOpen: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const isArchived = project.status === 'archived';
  const ownerLabel = project.ownerId ? username : '—';

  return (
    <Card className="flex flex-col">
      <div className="p-5 pb-4">
        <div className="flex items-start justify-between gap-2">
          <button type="button" onClick={onOpen} className="text-left group flex-1 min-w-0">
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
            {STATUS_LABELS[project.status]}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-[#86868b]">
          <span className="inline-flex items-center gap-1">
            <Globe className="w-3.5 h-3.5" /> {marketplaceLabel(project.marketplace)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Target className="w-3.5 h-3.5" /> {project.objective || '未设置目标'}
          </span>
          <span className="inline-flex items-center gap-1">
            <User className="w-3.5 h-3.5" /> {ownerLabel}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> {formatDate(project.updatedAt)}
          </span>
        </div>
      </div>

      {/* 五看状态：5 段状态，不用线性步骤编号 */}
      <div className="px-5 pb-4 border-t border-black/5 pt-3">
        <div className="flex items-center justify-between">
          {FIVE_LOOKS.map((look) => {
            const s = project.fiveLookProgress[look].status;
            return (
              <div key={look} className="flex flex-col items-center gap-1 flex-1">
                <span className={cn('w-2 h-2 rounded-full', LOOK_STATUS_COLOR[s])} />
                <span className={cn('text-[10px] font-medium', LOOK_STATUS_TEXT[s])}>
                  {FIVE_LOOK_LABELS[look]}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 操作区 */}
      <div className="px-5 pb-5 mt-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={onOpen}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-all active:scale-[0.98]"
        >
          <FolderOpen className="w-3.5 h-3.5" /> 打开项目
        </button>
        <IconButton title="复制" onClick={onDuplicate}>
          <Copy className="w-3.5 h-3.5" />
        </IconButton>
        <IconButton title={isArchived ? '恢复' : '归档'} onClick={onArchive}>
          {isArchived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
        </IconButton>
        <IconButton title="删除" danger onClick={onDelete}>
          <Trash2 className="w-3.5 h-3.5" />
        </IconButton>
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
  const [marketplace, setMarketplace] = useState('US');
  const [objective, setObjective] = useState('新品开发');
  const [owner, setOwner] = useState(username);
  const [description, setDescription] = useState('');
  const [coreKeywords, setCoreKeywords] = useState('');
  const [seedAsins, setSeedAsins] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const canSave = name.trim().length > 0 && marketplace.length > 0 && objective.length > 0 && owner.trim().length > 0;

  const submit = async () => {
    if (!canSave) {
      setError('请填写项目名称、站点、研究目标和负责人');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const p = await createProject(userId, {
        name: name.trim(),
        marketplace,
        objective,
        ownerId: userId,
        description: description.trim() || undefined,
        coreKeywords: splitList(coreKeywords),
        seedAsins: splitList(seedAsins),
      });
      toast.success('项目已创建');
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
            <p className="text-sm text-[#86868b] mt-0.5">先定边界和责任人，再从任意一看开始</p>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full hover:bg-[#f5f5f7] flex items-center justify-center text-[#86868b]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-7 py-5 space-y-4">
          <Field label="项目名称" required>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：美国站 薄枕头 新品机会调研"
              className={inputCls}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="站点" required>
              <Select
                value={marketplace}
                onChange={setMarketplace}
                options={MARKETPLACES.map((m) => ({ value: m.code, label: m.label }))}
                size="md"
                className="w-full"
              />
            </Field>
            <Field label="研究目标" required>
              <Select
                value={objective}
                onChange={setObjective}
                options={OBJECTIVES.map((o) => ({ value: o, label: o }))}
                size="md"
                className="w-full"
              />
            </Field>
          </div>

          <Field label="负责人" required>
            <input value={owner} onChange={(e) => setOwner(e.target.value)} className={inputCls} />
          </Field>

          <Field label="核心关键词（逗号分隔，选填）">
            <input
              value={coreKeywords}
              onChange={(e) => setCoreKeywords(e.target.value)}
              placeholder="例如：thin pillow, side sleeper"
              className={inputCls}
            />
          </Field>

          <Field label="种子 ASIN（逗号分隔，选填）">
            <input
              value={seedAsins}
              onChange={(e) => setSeedAsins(e.target.value)}
              placeholder="例如：B0XXXXXXX, B0YYYYYYY"
              className={inputCls}
            />
          </Field>

          <Field label="项目说明（选填）">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="研究边界、目标用户、期望结论等"
              className={cn(inputCls, 'resize-none')}
            />
          </Field>

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
            {saving ? '创建中…' : '创建并进入'}
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

const inputCls =
  'w-full px-3 py-2.5 rounded-xl border border-black/8 bg-gradient-to-b from-white to-[#f8f9fb] text-sm text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300 transition-all';

function splitList(s: string): string[] | undefined {
  const list = s
    .split(/[,，\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
  return list.length ? list : undefined;
}
