import type { ResearchProject } from '../types/researchProject';
import { loadMarketLook, saveMarketLook } from './marketLook';
import { loadUserLook, saveUserLook } from './userLook';
import { loadCompetitorLook, saveCompetitorLook } from './competitorLook';
import { loadSelfAssessment, saveSelfAssessment } from './selfAssessment';
import { loadOpportunities, saveOpportunities } from './opportunityStore';
import { loadReports, type ProjectReport } from './reportStore';
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
      return {
        ...project,
        cloudData: {
          marketLook,
          userLook,
          competitorLook,
          selfAssessment,
          opportunities,
          reports,
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
      await set(reportsKey(userId, project.id), data.reports as ProjectReport[]);
      restored += 1;
    }
  }
  return restored;
}
