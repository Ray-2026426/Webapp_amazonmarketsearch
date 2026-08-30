import type { ResearchProject } from '../types/researchProject';
import { loadMarketLook, saveMarketLook } from './marketLook';
import { loadUserLook, saveUserLook } from './userLook';
import { loadCompetitorLook, saveCompetitorLook } from './competitorLook';
import { loadSelfAssessment, saveSelfAssessment } from './selfAssessment';
import { loadOpportunities, saveOpportunities } from './opportunityStore';
import { loadReports, type ProjectReport } from './reportStore';
import {
  REPORT_STORAGE_THRESHOLD,
  reportStoragePath,
  uploadProjectAssetText,
  downloadProjectAssetText,
} from './projectAssets';
import { set } from 'idb-keyval';

type ProjectCloudData = NonNullable<ResearchProject['cloudData']>;

function reportsKey(userId: string, projectId: string): string {
  return `amzdev_reports:${userId}:${projectId}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasMeaningfulCloudData(data: ProjectCloudData | undefined): boolean {
  if (!data) return false;
  return Boolean(
    data.marketLook ||
      data.userLook ||
      data.competitorLook ||
      data.selfAssessment ||
      data.opportunities ||
      data.reports
  );
}

/** 把超阈值报告正文上传 Storage，返回「云载荷报告列表」；上传失败保留内联正文（降级）。 */
async function externalizeReports(projectId: string, reports: ProjectReport[]): Promise<ProjectReport[]> {
  const out: ProjectReport[] = [];
  for (const report of reports) {
    const markdown = String(report.markdown || '');
    if (markdown.length > REPORT_STORAGE_THRESHOLD) {
      const storagePath = reportStoragePath(projectId, report.id);
      const uploaded = await uploadProjectAssetText(projectId, `reports/${report.id}.md`, markdown);
      if (uploaded) {
        out.push({ ...report, storagePath: uploaded, markdown: '' });
        continue;
      }
      out.push(report); // 上传失败：保持内联，避免数据丢失
    } else {
      out.push(report);
    }
  }
  return out;
}

/** 恢复时回填：storagePath 存在且正文为空时，从 Storage 下载。 */
async function hydrateReportBodies(projectId: string, reports: ProjectReport[]): Promise<ProjectReport[]> {
  const out: ProjectReport[] = [];
  for (const report of reports) {
    if (report.storagePath && !report.markdown) {
      const text = await downloadProjectAssetText(report.storagePath);
      if (text !== null) {
        out.push({ ...report, markdown: text });
        continue;
      }
      out.push({ ...report, markdown: '（报告正文暂不可用，云同步后自动恢复）' });
      continue;
    }
    out.push(report);
  }
  return out;
}

export async function hydrateProjectsForCloud(
  userId: string,
  projects: ResearchProject[]
): Promise<ResearchProject[]> {
  return Promise.all(
    projects.map(async (project) => {
      const [marketLook, userLook, competitorLook, selfAssessment, opportunities, reports] = await Promise.all([
        loadMarketLook(userId, project.id),
        loadUserLook(userId, project.id),
        loadCompetitorLook(userId, project.id),
        loadSelfAssessment(userId, project.id),
        loadOpportunities(userId, project.id),
        loadReports(userId, project.id),
      ]);
      const externalReports = await externalizeReports(project.id, reports);
      return {
        ...project,
        cloudData: {
          marketLook,
          userLook,
          competitorLook,
          selfAssessment,
          opportunities,
          reports: externalReports,
          updatedAt: new Date().toISOString(),
        },
      };
    })
  );
}

export async function restoreCloudDataToLocal(
  userId: string,
  projects: ResearchProject[]
): Promise<number> {
  let restored = 0;
  for (const project of projects) {
    const data = project.cloudData;
    if (!hasMeaningfulCloudData(data)) continue;
    if (isObject(data.marketLook)) {
      await saveMarketLook(userId, project.id, data.marketLook as unknown as Awaited<ReturnType<typeof loadMarketLook>>);
      restored += 1;
    }
    if (isObject(data.userLook)) {
      await saveUserLook(userId, project.id, data.userLook as unknown as Awaited<ReturnType<typeof loadUserLook>>);
      restored += 1;
    }
    if (isObject(data.competitorLook)) {
      await saveCompetitorLook(userId, project.id, data.competitorLook as unknown as Awaited<ReturnType<typeof loadCompetitorLook>>);
      restored += 1;
    }
    if (isObject(data.selfAssessment)) {
      await saveSelfAssessment(userId, project.id, data.selfAssessment as unknown as Awaited<ReturnType<typeof loadSelfAssessment>>);
      restored += 1;
    }
    if (Array.isArray(data.opportunities)) {
      await saveOpportunities(userId, project.id, data.opportunities as Awaited<ReturnType<typeof loadOpportunities>>);
      restored += 1;
    }
    if (Array.isArray(data.reports)) {
      const hydrated = await hydrateReportBodies(project.id, data.reports as ProjectReport[]);
      await set(reportsKey(userId, project.id), hydrated);
      restored += 1;
    }
  }
  return restored;
}
