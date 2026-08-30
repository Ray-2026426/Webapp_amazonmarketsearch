// 报告资产与版本（PRD FR-09 / 14.2）。
import { get, set, del } from 'idb-keyval';

export type ReportType = 'market' | 'user' | 'competitor' | 'self' | 'opportunity' | 'asin' | 'profit';

export interface ProjectReport {
  id: string;
  projectId: string;
  reportType: ReportType;
  subjectId: string;
  title: string;
  markdown: string;
  /** 大型报告正文入云后的 Storage 路径；存在时 markdown 可为空（按需下载回填）。 */
  storagePath?: string;
  dataFingerprint: string;
  promptVersion: string;
  modelName: string;
  version: number;
  isFinalized: boolean;
  createdAt: string;
  updatedAt: string;
}

const KEY_PREFIX = 'amzdev_reports:';
function storageKey(userId: string, projectId: string): string {
  return `${KEY_PREFIX}${userId}:${projectId}`;
}

export function createReportId(): string {
  return `rep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function reportReuseKey(
  projectId: string,
  reportType: ReportType,
  subjectId: string,
  dataFingerprint: string,
  promptVersion: string,
  modelName: string
): string {
  return [projectId, reportType, subjectId, dataFingerprint, promptVersion, modelName].join('|');
}

export function reuseKeyOf(r: ProjectReport): string {
  return reportReuseKey(r.projectId, r.reportType, r.subjectId, r.dataFingerprint, r.promptVersion, r.modelName);
}

export type ReportSaveDecision =
  | { action: 'update'; target: ProjectReport }
  | { action: 'new'; nextVersion: number }
  | { action: 'skip'; target: ProjectReport };

export function decideReportSave(existing: ProjectReport[], key: string, sameScope: ProjectReport[]): ReportSaveDecision {
  const byKey = existing.find((r) => reuseKeyOf(r) === key);
  if (byKey) {
    return byKey.isFinalized ? { action: 'skip', target: byKey } : { action: 'update', target: byKey };
  }
  const latestVersion = sameScope.reduce((m, r) => Math.max(m, r.version), 0);
  return { action: 'new', nextVersion: latestVersion + 1 };
}

export async function loadReports(userId: string, projectId: string): Promise<ProjectReport[]> {
  try {
    const raw = await get<ProjectReport[]>(storageKey(userId, projectId));
    if (Array.isArray(raw)) return raw;
  } catch {
    /* ignore */
  }
  return [];
}

export interface SaveReportInput {
  reportType: ReportType;
  subjectId?: string;
  title: string;
  markdown: string;
  dataFingerprint: string;
  promptVersion: string;
  modelName: string;
}

export async function saveReport(
  userId: string,
  projectId: string,
  input: SaveReportInput
): Promise<{ report: ProjectReport; created: boolean } | { skipped: true; report: ProjectReport }> {
  const list = await loadReports(userId, projectId);
  const key = reportReuseKey(projectId, input.reportType, input.subjectId ?? '', input.dataFingerprint, input.promptVersion, input.modelName);
  const sameScope = list.filter((r) => r.reportType === input.reportType && r.subjectId === (input.subjectId ?? ''));
  const decision = decideReportSave(list, key, sameScope);

  if (decision.action === 'update') {
    const updated: ProjectReport = { ...decision.target, title: input.title, markdown: input.markdown, updatedAt: new Date().toISOString() };
    const next = list.map((r) => (r.id === updated.id ? updated : r));
    await set(storageKey(userId, projectId), next);
    return { report: updated, created: false };
  }
  if (decision.action === 'skip') {
    return { skipped: true, report: decision.target };
  }
  const now = new Date().toISOString();
  const report: ProjectReport = {
    id: createReportId(),
    projectId,
    reportType: input.reportType,
    subjectId: input.subjectId ?? '',
    title: input.title,
    markdown: input.markdown,
    dataFingerprint: input.dataFingerprint,
    promptVersion: input.promptVersion,
    modelName: input.modelName,
    version: decision.nextVersion,
    isFinalized: false,
    createdAt: now,
    updatedAt: now,
  };
  await set(storageKey(userId, projectId), [...list, report]);
  return { report, created: true };
}

export async function finalizeReport(userId: string, projectId: string, reportId: string): Promise<ProjectReport | null> {
  const list = await loadReports(userId, projectId);
  const idx = list.findIndex((r) => r.id === reportId);
  if (idx < 0) return null;
  const updated: ProjectReport = { ...list[idx], isFinalized: true, updatedAt: new Date().toISOString() };
  list[idx] = updated;
  await set(storageKey(userId, projectId), list);
  return updated;
}

export async function deleteReport(userId: string, projectId: string, reportId: string): Promise<void> {
  const list = await loadReports(userId, projectId);
  await set(storageKey(userId, projectId), list.filter((r) => r.id !== reportId));
}

export async function clearReportData(userId: string, projectId: string): Promise<void> {
  await del(storageKey(userId, projectId));
}
