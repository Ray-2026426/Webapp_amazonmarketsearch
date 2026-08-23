// 项目持久化层（本地版，IndexedDB via idb-keyval）
// - 数据按登录用户分区，避免多人共用浏览器时项目串号。
// - 项目是 Phase 1 的一等公民：五看、机会卡、报告都挂在 projectId 下。
// - 旧数据迁移在本文件内以 normalize + migrate 形式集中处理，不散落在业务页面。

import { get, set, del } from 'idb-keyval';
import {
  FIVE_LOOKS,
  type CreateProjectInput,
  type FiveLookId,
  type FiveLookProgress,
  type LookStatus,
  type ResearchProject,
} from '../types/researchProject';

const PROJECTS_KEY_PREFIX = 'amzdev_projects:';

function projectsKey(userId: string): string {
  return `${PROJECTS_KEY_PREFIX}${userId}`;
}

export function createProjectId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `p_${crypto.randomUUID()}`;
    }
  } catch {
    /* ignore */
  }
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createRiskId(): string {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** 五看初始进度：全部未开始，0 分。 */
export function emptyFiveLookProgress(): Record<FiveLookId, FiveLookProgress> {
  const out = {} as Record<FiveLookId, FiveLookProgress>;
  for (const look of FIVE_LOOKS) {
    out[look] = {
      look,
      status: 'not_started',
      completionPercent: 0,
      completedEvidenceIds: [],
      missingRequirements: [],
      staleReasons: [],
      updatedAt: nowIso(),
    };
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** 迁移 / 校验：保证老数据或缺字段的项目也能安全读取。 */
export function migrateProject(raw: unknown): ResearchProject | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  const fiveLookProgress =
    isRecord(raw.fiveLookProgress)
      ? (raw.fiveLookProgress as Record<FiveLookId, FiveLookProgress>)
      : emptyFiveLookProgress();

  for (const look of FIVE_LOOKS) {
    const cur = fiveLookProgress[look];
    if (!isRecord(cur)) {
      fiveLookProgress[look] = {
        look,
        status: 'not_started',
        completionPercent: 0,
        completedEvidenceIds: [],
        missingRequirements: [],
        staleReasons: [],
        updatedAt: nowIso(),
      };
    } else {
      fiveLookProgress[look] = {
        look,
        status: (cur.status as LookStatus) ?? 'not_started',
        completionPercent: typeof cur.completionPercent === 'number' ? cur.completionPercent : 0,
        completedEvidenceIds: Array.isArray(cur.completedEvidenceIds) ? cur.completedEvidenceIds : [],
        missingRequirements: Array.isArray(cur.missingRequirements) ? cur.missingRequirements : [],
        staleReasons: Array.isArray(cur.staleReasons) ? cur.staleReasons : [],
        updatedAt: typeof cur.updatedAt === 'string' ? cur.updatedAt : nowIso(),
      };
    }
  }

  return {
    id: raw.id as string,
    workspaceId: typeof raw.workspaceId === 'string' ? raw.workspaceId : 'default',
    name: typeof raw.name === 'string' ? raw.name : '未命名项目',
    marketplace: typeof raw.marketplace === 'string' ? raw.marketplace : '',
    objective: typeof raw.objective === 'string' ? raw.objective : '',
    ownerId: typeof raw.ownerId === 'string' ? raw.ownerId : '',
    memberIds: Array.isArray(raw.memberIds) ? (raw.memberIds as string[]) : [],
    status: (raw.status as ResearchProject['status']) ?? 'draft',
    activeLook: (raw.activeLook as FiveLookId) ?? 'market',
    fiveLookProgress,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : nowIso(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso(),
    version: typeof raw.version === 'number' ? raw.version : 1,
    categories: Array.isArray(raw.categories) ? (raw.categories as string[]) : undefined,
    coreKeywords: Array.isArray(raw.coreKeywords) ? (raw.coreKeywords as string[]) : undefined,
    seedAsins: Array.isArray(raw.seedAsins) ? (raw.seedAsins as string[]) : undefined,
    targetUsers: typeof raw.targetUsers === 'string' ? raw.targetUsers : undefined,
    targetPriceRange: isRecord(raw.targetPriceRange)
      ? {
          min: typeof raw.targetPriceRange.min === 'number' ? raw.targetPriceRange.min : 0,
          max: typeof raw.targetPriceRange.max === 'number' ? raw.targetPriceRange.max : 0,
        }
      : undefined,
    targetGrossMargin:
      typeof raw.targetGrossMargin === 'number' ? raw.targetGrossMargin : undefined,
    plannedLaunchDate:
      typeof raw.plannedLaunchDate === 'string' ? raw.plannedLaunchDate : undefined,
    description: typeof raw.description === 'string' ? raw.description : undefined,
  };
}

export async function loadProjects(userId: string): Promise<ResearchProject[]> {
  try {
    const raw = await get<unknown>(projectsKey(userId));
    if (!Array.isArray(raw)) return [];
    const out: ResearchProject[] = [];
    for (const item of raw) {
      const p = migrateProject(item);
      if (p) out.push(p);
    }
    return out.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  } catch {
    return [];
  }
}

export async function persistProjects(userId: string, projects: ResearchProject[]): Promise<void> {
  await set(projectsKey(userId), projects);
}

export async function getProject(userId: string, projectId: string): Promise<ResearchProject | null> {
  const list = await loadProjects(userId);
  return list.find((p) => p.id === projectId) ?? null;
}

export async function createProject(
  userId: string,
  input: CreateProjectInput
): Promise<ResearchProject> {
  const list = await loadProjects(userId);
  const now = nowIso();
  const project: ResearchProject = {
    id: createProjectId(),
    workspaceId: 'default',
    name: input.name.trim(),
    marketplace: input.marketplace,
    objective: input.objective,
    ownerId: input.ownerId,
    memberIds: [],
    status: 'draft',
    activeLook: 'market',
    fiveLookProgress: emptyFiveLookProgress(),
    createdAt: now,
    updatedAt: now,
    version: 1,
    categories: input.categories,
    coreKeywords: input.coreKeywords,
    seedAsins: input.seedAsins,
    targetUsers: input.targetUsers,
    targetPriceRange: input.targetPriceRange,
    targetGrossMargin: input.targetGrossMargin,
    plannedLaunchDate: input.plannedLaunchDate,
    description: input.description,
  };
  list.unshift(project);
  await persistProjects(userId, list);
  return project;
}

export interface UpdateProjectPatch {
  name?: string;
  marketplace?: string;
  objective?: string;
  ownerId?: string;
  status?: ResearchProject['status'];
  activeLook?: FiveLookId;
  fiveLookProgress?: Record<FiveLookId, FiveLookProgress>;
  categories?: string[];
  coreKeywords?: string[];
  seedAsins?: string[];
  targetUsers?: string;
  targetPriceRange?: ResearchProject['targetPriceRange'];
  targetGrossMargin?: number;
  plannedLaunchDate?: string;
  description?: string;
}

export async function updateProject(
  userId: string,
  projectId: string,
  patch: UpdateProjectPatch
): Promise<ResearchProject | null> {
  const list = await loadProjects(userId);
  const idx = list.findIndex((p) => p.id === projectId);
  if (idx < 0) return null;
  const prev = list[idx];
  const next: ResearchProject = {
    ...prev,
    ...patch,
    id: prev.id,
    createdAt: prev.createdAt,
    updatedAt: nowIso(),
    version: prev.version + 1,
  };
  list[idx] = next;
  await persistProjects(userId, list);
  return next;
}

export async function setProjectStatus(
  userId: string,
  projectId: string,
  status: ResearchProject['status']
): Promise<ResearchProject | null> {
  return updateProject(userId, projectId, { status });
}

export async function setActiveLook(
  userId: string,
  projectId: string,
  activeLook: FiveLookId
): Promise<ResearchProject | null> {
  return updateProject(userId, projectId, { activeLook });
}

/** 原子更新单个视角进度，避免用陈旧五看快照覆盖其它视角。 */
export async function updateLookProgress(
  userId: string,
  projectId: string,
  look: FiveLookId,
  progress: FiveLookProgress
): Promise<ResearchProject | null> {
  const list = await loadProjects(userId);
  const idx = list.findIndex((p) => p.id === projectId);
  if (idx < 0) return null;
  const prev = list[idx];
  const next: ResearchProject = {
    ...prev,
    fiveLookProgress: { ...prev.fiveLookProgress, [look]: progress },
    updatedAt: nowIso(),
    version: prev.version + 1,
  };
  list[idx] = next;
  await persistProjects(userId, list);
  return next;
}

export async function archiveProject(
  userId: string,
  projectId: string
): Promise<ResearchProject | null> {
  return updateProject(userId, projectId, { status: 'archived' });
}

export async function restoreProject(
  userId: string,
  projectId: string
): Promise<ResearchProject | null> {
  return updateProject(userId, projectId, { status: 'draft' });
}

export async function duplicateProject(
  userId: string,
  projectId: string
): Promise<ResearchProject | null> {
  const list = await loadProjects(userId);
  const src = list.find((p) => p.id === projectId);
  if (!src) return null;
  const now = nowIso();
  const copy: ResearchProject = {
    ...src,
    id: createProjectId(),
    name: `${src.name}（副本）`,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    version: 1,
    fiveLookProgress: emptyFiveLookProgress(),
  };
  list.unshift(copy);
  await persistProjects(userId, list);
  return copy;
}

const LOOK_DATA_KEY_PREFIXES = [
  'amzdev_self:',
  'amzdev_market:',
  'amzdev_user:',
  'amzdev_competitor:',
];

async function clearLookData(userId: string, projectId: string): Promise<void> {
  await Promise.all(LOOK_DATA_KEY_PREFIXES.map((prefix) => del(`${prefix}${userId}:${projectId}`)));
}

export async function deleteProject(userId: string, projectId: string): Promise<boolean> {
  const list = await loadProjects(userId);
  const next = list.filter((p) => p.id !== projectId);
  if (next.length === list.length) return false;
  await persistProjects(userId, next);
  await clearLookData(userId, projectId);
  return true;
}

export interface ProjectSearchQuery {
  keyword?: string;
  marketplace?: string;
  status?: ResearchProject['status'] | 'active' | 'archived';
  ownerId?: string;
}

export async function searchProjects(
  userId: string,
  query: ProjectSearchQuery = {}
): Promise<ResearchProject[]> {
  const all = await loadProjects(userId);
  const kw = (query.keyword ?? '').trim().toLowerCase();
  return all.filter((p) => {
    if (query.marketplace && p.marketplace !== query.marketplace) return false;
    if (query.ownerId && p.ownerId !== query.ownerId) return false;
    if (query.status) {
      if (query.status === 'active' && p.status === 'archived') return false;
      if (query.status === 'archived' && p.status !== 'archived') return false;
      if (
        query.status !== 'active' &&
        query.status !== 'archived' &&
        p.status !== query.status
      ) {
        return false;
      }
    }
    if (kw) {
      const haystack = [
        p.name,
        p.marketplace,
        p.objective,
        p.ownerId,
        ...(p.categories ?? []),
        ...(p.coreKeywords ?? []),
        ...(p.seedAsins ?? []),
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(kw)) return false;
    }
    return true;
  });
}
