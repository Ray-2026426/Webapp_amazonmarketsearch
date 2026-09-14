// 旧数据识别与备份导出（PRD 14.3）。只读，不删除旧数据。
import { get } from 'idb-keyval';
import { listMarketHistoryMeta } from './marketHistory';
import { listCompetitorHistoryMeta } from './competitorHistory';

export interface LegacyDataSummary {
  marketSnapshots: number;
  competitorSnapshots: number;
  keywordInsight: boolean;
  userInsights: boolean;
  marketReportCache: boolean;
  hasAny: boolean;
}

export async function listLegacyData(userId: string): Promise<LegacyDataSummary> {
  const [market, competitor, keywordInsight, userInsights, marketReportCache] = await Promise.all([
    listMarketHistoryMeta(userId).catch(() => []),
    listCompetitorHistoryMeta(userId).catch(() => []),
    get('keywordInsight'),
    get('userInsightsWorkspace'),
    get('marketReportCache'),
  ]);
  const summary: LegacyDataSummary = {
    marketSnapshots: market.length,
    competitorSnapshots: competitor.length,
    keywordInsight: Boolean(keywordInsight),
    userInsights: Boolean(userInsights),
    marketReportCache: Boolean(marketReportCache),
    hasAny: false,
  };
  summary.hasAny = summary.marketSnapshots > 0 || summary.competitorSnapshots > 0 || summary.keywordInsight || summary.userInsights || summary.marketReportCache;
  return summary;
}

/** 导出旧数据备份（JSON），供用户下载留存；不删除原数据。 */
export async function buildLegacyBackup(userId: string): Promise<string> {
  const [market, competitor, keywordInsight, userInsights, marketReportCache] = await Promise.all([
    listMarketHistoryMeta(userId).catch(() => []),
    listCompetitorHistoryMeta(userId).catch(() => []),
    get('keywordInsight'),
    get('userInsightsWorkspace'),
    get('marketReportCache'),
  ]);
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      kind: 'amzdev-legacy-backup',
      marketSnapshots: market,
      competitorSnapshots: competitor,
      keywordInsight,
      userInsightsWorkspace: userInsights,
      marketReportCache,
    },
    null,
    2
  );
}
