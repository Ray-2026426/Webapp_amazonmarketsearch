import type { AiInsight } from '../components/KeywordAnalysis';

export interface UserJourneyRow {
  stage: string;
  who: string;
  where: string;
  when: string;
  what: string;
  why: string;
  how: string;
  quote: string;
  weakness: string;
  improvement: string;
}

export interface UserInsightsWorkspaceState {
  tagLib: {
    positive: string[];
    negative: string[];
    scenarios: string[];
    audience: string[];
  } | null;
  deepReport: string | null;
  deepInsight: AiInsight | null;
  journeyReportRaw: string | null;
  journeyRows: UserJourneyRow[];
  updatedAt: string;
  hasResult: boolean;
}

export function createEmptyUserInsightsWorkspace(): UserInsightsWorkspaceState {
  return {
    tagLib: null,
    deepReport: null,
    deepInsight: null,
    journeyReportRaw: null,
    journeyRows: [],
    updatedAt: '',
    hasResult: false,
  };
}

export function normalizeUserInsightsWorkspace(
  value: UserInsightsWorkspaceState | null | undefined
): UserInsightsWorkspaceState | null {
  if (!value || typeof value !== 'object') return null;
  return {
    tagLib: value.tagLib ?? null,
    deepReport: typeof value.deepReport === 'string' ? value.deepReport : null,
    deepInsight: value.deepInsight ?? null,
    journeyReportRaw: typeof value.journeyReportRaw === 'string' ? value.journeyReportRaw : null,
    journeyRows: Array.isArray(value.journeyRows) ? value.journeyRows : [],
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    hasResult: Boolean(value.hasResult || value.deepReport || value.journeyReportRaw || value.journeyRows?.length),
  };
}
