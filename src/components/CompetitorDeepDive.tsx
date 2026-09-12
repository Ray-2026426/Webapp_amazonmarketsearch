import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, CloudDownload, Crosshair, Loader2, Swords, Users } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from './ui/Card';
import { Card } from './ui/Card';
import { loadSnapshot } from '../utils/projectSnapshot';
import { fetchListingDetails } from '../utils/listingFetchExecutor';
import { getAuthToken } from '../utils/auth';
import { loadUserLook, type UnmetNeedCandidate } from '../utils/userLook';
import { loadMarketLook } from '../utils/marketLook';
import { synthesizeSegmentSchemes } from '../utils/segmentSynthesis';
import { loadCompetitorLook, saveCompetitorLook, type CompetitorLookData } from '../utils/competitorLook';
import { loadSelfAssessment } from '../utils/selfAssessment';
import { buildOurCapability } from '../utils/ourCapability';
import {
  LISTING_FIELDS,
  buildComparisonTable,
  describeCoverage,
  GROUP_LABELS,
  GROUP_ORDER,
  SOURCE_LABELS,
  type CoverageReport,
  type FieldGroup,
} from '../utils/listingFields';
import {
  buildPainMatrix,
  buildCompetitorPersona,
  buildSatisfactionMatrix,
  decideWinningPath,
  describeCompetitorAnalysisForPrompt,
  SATISFACTION_MARKS,
  WINNING_PATH_LABELS,
  type CompetitorPersona,
  type PainMatrix,
  type SatisfactionMatrix,
  type WinningPath,
  type WinningPathDecision,
} from '../utils/competitorAnalysis';
import { pickCompetitorsDetailed, listReplacementCandidates, ROLE_LABELS, type CompetitorRole, type PickedCompetitor } from '../utils/competitorPicker';
import type { ResearchProject } from '../types/researchProject';
import type { HistoryRecord, Product, Review } from '../utils/parser';
import type { SelfStatus } from '../utils/selfAssessment';

/**
 * M3 · 看竞对深度分析（PRD §6.3）。
 *
 * 顺序严格按用户要求：先把「产品 / Listing / 流量」全字段三列对比摊开（缺的显式标未抓取），
 * 再看**每个竞对**的三块分析（用户画像 / 痛点未满足矩阵 / 需求满足矩阵），
 * 最后才出结论：未满足需求交叉清单 ∩ 我们能满足的部分 → 赢的路径三选一（或"无赢面"）。
 *
 * AI 不在这一层做任何判定：分数、状态、路径全部确定性算出（见 competitorAnalysis.ts）。
 */

type Loaded = {
  columns: string[];
  roles: PickedCompetitor[];
  notes: string[];
  roleOf: Record<string, string>;
  /** M3①：位置 → 角色（换人时按角色规则重挑候选） */
  roleById: Record<string, CompetitorRole>;
  /** 目标细分候选池（换人从这里选） */
  pool: Product[];
  products: Product[];
  reviews: Review[];
  needs: UnmetNeedCandidate[];
  pain: PainMatrix[];
  satisfaction: SatisfactionMatrix[];
  personas: CompetitorPersona[];
  decision: WinningPathDecision;
  coverage: CoverageReport;
  rows: ReturnType<typeof buildComparisonTable>['rows'];
  capabilityNotes: string[];
  hardBlocked: boolean;
  hardNotes: string[];
  promptText: string;
};

const STATUS_OPTIONS: { value: SelfStatus; label: string }[] = [
  { value: 'have', label: '已具备' },
  { value: 'partial', label: '部分具备' },
  { value: 'lack', label: '不具备' },
  { value: 'unknown', label: '待确认' },
];

export function CompetitorDeepDive({
  userId,
  project,
  onOpenCompetitorTool,
  onSendToComparison,
}: {
  userId: string;
  project: ResearchProject;
  onOpenCompetitorTool?: () => void;
  /** M3⑥ 断链 #4：把这几个竞对送进「竞品明细」对比池（主图逐张/A+/流量词） */
  onSendToComparison?: (asins: string[]) => void;
}) {
  const [data, setData] = useState<CompetitorLookData | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(true);
  const [showMissing, setShowMissing] = useState(false);
  const [expandedAsin, setExpandedAsin] = useState<string | null>(null);
  /** M3①：正在换人的那一列（null = 没在换） */
  const [swapFor, setSwapFor] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const [snap, market, look, userLook, self] = await Promise.all([
        loadSnapshot(userId, project.id),
        loadMarketLook(userId, project.id),
        loadCompetitorLook(userId, project.id),
        loadUserLook(userId, project.id),
        loadSelfAssessment(userId, project.id),
      ]);
      setData(look);

      const products: Product[] = snap?.products ?? [];
      const reviews: Review[] = snap?.reviews ?? [];
      const history: HistoryRecord[] = snap?.history ?? [];
      const needs = (userLook.unmetNeedCandidates ?? []).filter((n) => (n.needStatement || '').trim().length > 0);

      if (products.length === 0) {
        setLoaded(null);
        return;
      }

      // 1) 目标细分池：优先用户在看市场选定的细分，其次全部样本
      let pool = products;
      const chosenSchemeId = market.segmentSchemeId;
      const chosenSegmentIds = market.chosenSegmentIds ?? [];
      if (chosenSchemeId && chosenSegmentIds.length > 0) {
        const schemes = synthesizeSegmentSchemes({ products, history, needs });
        const scheme = schemes.find((s) => s.id === chosenSchemeId);
        const targets = scheme?.segments.filter((s) => chosenSegmentIds.includes(s.id)) ?? [];
        const asinSet = new Set(targets.flatMap((t) => t.asins));
        const sub = products.filter((p) => asinSet.has(p.asin));
        if (sub.length > 0) pool = sub;
      }

      // 2) 列 = 竞品样本池里的 ASIN；空则按规则自动挑 3 个
      const detail = pickCompetitorsDetailed(pool);
      const poolAsins = (look.samplePool ?? []).map((s) => s.trim()).filter(Boolean);
      const columns = poolAsins.length > 0 ? poolAsins : detail.picked.map((p) => p.asin);
      const roleOf: Record<string, string> = {};
      const roleById: Record<string, CompetitorRole> = {};
      for (const p of detail.picked) {
        if (columns.includes(p.asin)) {
          roleOf[p.asin] = ROLE_LABELS[p.role];
          roleById[p.asin] = p.role;
        }
      }

      // 3) 三列对比 + 覆盖率
      const table = buildComparisonTable({ asins: columns, products, history, listing: look.listingDetails, traffic: look.trafficDetails });

      // 4) 每竞对三块分析
      const pain = columns.map((a) => buildPainMatrix(a, reviews, needs));
      const satisfaction = columns.map((a) => buildSatisfactionMatrix(a, products.find((p) => p.asin === a), reviews, needs, look.listingDetails?.[a]));
      const personas = columns.map((a) => buildCompetitorPersona(a, reviews, needs));

      // 5) 我们的能力（看自己自评 + 人工/品类题覆盖）
      const capability = buildOurCapability({
        items: self.items,
        byNeedId: look.ourCapabilityByNeedId ?? {},
        financials: look.ourCapabilityFinancials,
      });

      // 6) 赢的路径（确定性；用户可覆盖）
      const decision = decideWinningPath({
        needs,
        competitors: columns.map((a) => ({ asin: a, price: products.find((p) => p.asin === a)?.price })),
        matrices: satisfaction,
        ours: capability,
        priceReference: {
          lowestCompetitorPrice: Math.min(
            ...columns.map((a) => Number(products.find((p) => p.asin === a)?.price) || Number.POSITIVE_INFINITY)
          ),
        },
      });

      setLoaded({
        columns,
        roles: detail.picked,
        notes: detail.notes,
        roleOf,
        roleById,
        pool,
        products,
        reviews,
        needs,
        pain,
        satisfaction,
        personas,
        decision,
        coverage: table.coverage,
        rows: table.rows,
        capabilityNotes: capability.notes,
        hardBlocked: capability.hardConstraintBlocked,
        hardNotes: capability.hardConstraintNotes ?? [],
        promptText: describeCompetitorAnalysisForPrompt({
          roles: detail.picked.map((p) => ({ asin: p.asin, role: p.role, reason: p.reason })),
          painMatrices: pain,
          satisfactionMatrices: satisfaction,
          personas,
          decision,
        }),
      });
    } finally {
      setBusy(false);
    }
  }, [userId, project.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * M5：一键走**服务端数据池**抓全字段（前端不接触密钥），抓完写回看竞对数据并刷新覆盖率。
   * 已有值的字段不再重复花钱（把"已抓到的字段"传给计划器跳过）。
   */
  const [fetching, setFetching] = useState(false);
  const [fetchNote, setFetchNote] = useState('');
  const runFullFetch = async () => {
    if (!loaded || loaded.columns.length === 0) return;
    setFetching(true);
    setFetchNote('正在按计划抓取（先 Listing/详情，再流量与历史）…');
    try {
      const alreadyHave: Record<string, string[]> = {};
      for (const asin of loaded.columns) {
        const missing = new Set(loaded.coverage.missingFields.filter((m) => m.asins.includes(asin)).map((m) => m.key));
        alreadyHave[asin] = LISTING_FIELDS.map((f) => f.key).filter((k) => !missing.has(k));
      }
      const result = await fetchListingDetails({
        asins: loaded.columns,
        marketplace: project.marketplace || 'US',
        depth: 'deep',
        alreadyHave,
        token: getAuthToken(),
        projectId: project.id,
        onProgress: (done, total, step) => setFetchNote(`抓取中 ${done}/${total}：${step.label}`),
      });
      if (!result.usedGateway) {
        setFetchNote(result.note);
        toast.warning(result.note);
        return;
      }
      await saveCompetitorLook(userId, project.id, {
        ...(data ?? ({} as CompetitorLookData)),
        listingDetails: { ...(data?.listingDetails ?? {}), ...result.listing },
        trafficDetails: { ...(data?.trafficDetails ?? {}), ...result.traffic },
      });
      setFetchNote(
        `${result.note}；字段抓取率 ${(result.evaluation.coverage * 100).toFixed(0)}%（计划 ${result.evaluation.planned} 项 / 命中 ${result.evaluation.filled} 项）` +
          (result.evaluation.failures > 0 ? `；${result.evaluation.failures} 步失败可重试` : '')
      );
      toast.success(`抓取完成：字段抓取率 ${(result.evaluation.coverage * 100).toFixed(0)}%`);
      await reload();
    } catch (e) {
      setFetchNote(`抓取失败：${e instanceof Error ? e.message : String(e)}`);
      toast.error('抓取失败');
    } finally {
      setFetching(false);
    }
  };

  /** M3① 换人：把某一列换成候选池里的另一个 ASIN（按该角色规则列候选，用户拍板） */
  const swapCompetitor = useCallback(
    async (fromAsin: string, toAsin: string) => {
      if (!data || fromAsin === toAsin) return;
      const current = (data.samplePool ?? []).map((s) => s.trim()).filter(Boolean);
      const base = current.length > 0 ? current : (loaded?.columns ?? []);
      const next = base.map((a) => (a === fromAsin ? toAsin : a));
      if (!next.includes(toAsin)) next.push(toAsin);
      setSwapFor(null);
      await saveCompetitorLook(userId, project.id, { ...data, samplePool: [...new Set(next)] });
      await reload();
    },
    [data, loaded, userId, project.id, reload]
  );

  const persist = useCallback(
    async (patch: Partial<CompetitorLookData>) => {
      if (!data) return;
      const next = { ...data, ...patch };
      setData(next);
      await saveCompetitorLook(userId, project.id, next);
    },
    [data, userId, project.id]
  );

  const effectivePath: WinningPath = data?.winningPathOverride ?? loaded?.decision.path ?? 'none';
  const overridden = !!data?.winningPathOverride && data.winningPathOverride !== loaded?.decision.path;

  const rowsByGroup = useMemo(() => {
    if (!loaded) return [] as { group: FieldGroup; rows: Loaded['rows'] }[];
    return GROUP_ORDER.map((group) => ({
      group,
      rows: loaded.rows.filter((r) => r.field.group === group && (showMissing || r.captured > 0)),
    })).filter((g) => g.rows.length > 0);
  }, [loaded, showMissing]);

  if (busy && !loaded) {
    return (
      <Card>
        <div className="p-5 flex items-center justify-center text-sm text-[#aeaeb2]">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> 正在做三列对比与三块分析…
        </div>
      </Card>
    );
  }

  if (!loaded) {
    return (
      <Card>
        <div className="p-5">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-700">还没有可对比的商品数据</p>
              <p className="text-xs text-amber-700/80 mt-1 leading-relaxed">
                三列对比需要「项目数据快照」里的商品（标题/价格/月收入/评论）。先在概览页捕获快照或加载示例数据。
              </p>
              {onOpenCompetitorTool && (
                <button
                  type="button"
                  onClick={onOpenCompetitorTool}
                  className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700"
                >
                  去加载竞品数据
                </button>
              )}
            </div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ① 全字段三列对比 */}
      <Card>
        <div className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2">
              <Crosshair className="w-4 h-4 text-indigo-600" />
              <p className="text-sm font-semibold text-[#1d1d1f]">全量 Listing 三列对比</p>
              <span className="text-[11px] text-[#aeaeb2]">产品 / Listing / 流量 · 每格标来源</span>
            </div>
            <button
              type="button"
              onClick={() => setShowMissing((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-black/8 bg-white text-xs font-medium text-[#86868b] hover:text-indigo-600 hover:border-indigo-200"
            >
              {showMissing ? '只看已抓到' : '显示未抓取字段'}
            </button>
            {onSendToComparison && loaded.columns.length > 0 && (
              <button
                type="button"
                onClick={() => onSendToComparison(loaded.columns)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-indigo-200 bg-white text-xs font-semibold text-indigo-700 hover:border-indigo-400"
              >
                送进竞品明细（主图逐张 / A+ / 流量词）
              </button>
            )}
            {loaded.columns.length > 0 && (
              <button
                type="button"
                onClick={() => void runFullFetch()}
                disabled={fetching}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-60"
              >
                {fetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudDownload className="w-3.5 h-3.5" />}
                抓取全字段（走服务端数据池）
              </button>
            )}
          </div>

          <div
            className={cn(
              'rounded-xl px-3 py-2 mb-3 text-[11px] leading-relaxed',
              loaded.coverage.overall >= 0.9 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
            )}
          >
            {describeCoverage(loaded.coverage)}
            {loaded.coverage.missingFields.length > 0 && (
              <span>
                ；还差 {loaded.coverage.missingFields.length} 个字段（
                {loaded.coverage.missingFields.slice(0, 3).map((m) => m.label).join('、')}
                {loaded.coverage.missingFields.length > 3 ? '…' : ''}）
              </span>
            )}
          </div>

          {loaded.notes.length > 0 && (
            <ul className="mb-3 space-y-1">
              {loaded.notes.map((n, i) => (
                <li key={i} className="text-[11px] text-amber-700">
                  · {n}
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-4">
            {rowsByGroup.map(({ group, rows }) => (
              <div key={group}>
                <p className="text-xs font-bold text-[#1d1d1f] mb-1.5">{GROUP_LABELS[group]}</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-black/8">
                        <th className="py-1.5 pr-3 text-[11px] font-semibold text-[#86868b] w-48">字段</th>
                        {loaded.columns.map((a) => (
                          <th key={a} className="py-1.5 pr-3 text-[11px] font-semibold text-[#1d1d1f]">
                            <span className="font-mono">{a}</span>
                            {loaded.roleOf[a] && <span className="ml-1.5 text-[10px] text-indigo-600">{loaded.roleOf[a]}</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.field.key} className="border-b border-black/5 last:border-0">
                          <td className="py-1.5 pr-3 align-top">
                            <span className="text-[11px] text-[#424245]">{r.field.label}</span>
                            <span className="ml-1.5 text-[10px] text-[#aeaeb2]">{SOURCE_LABELS[r.field.source]}</span>
                          </td>
                          {r.cells.map((c) => (
                            <td key={c.asin} className="py-1.5 pr-3 align-top">
                              {c.missing ? (
                                <span className="text-[10px] text-amber-600" title={c.hint}>
                                  未抓取
                                </span>
                              ) : (
                                <span className="text-[11px] text-[#1d1d1f]">{c.value}</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* ② 每竞对三块分析 */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-indigo-600" />
          <p className="text-sm font-semibold text-[#1d1d1f]">每个竞对的三块分析</p>
          <span className="text-[11px] text-[#aeaeb2]">用户画像 · 痛点未满足矩阵 · 需求满足矩阵（做完全部对比才出结论）</span>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          {loaded.columns.map((asin) => {
            const pain = loaded.pain.find((m) => m.asin === asin)!;
            const sat = loaded.satisfaction.find((m) => m.asin === asin)!;
            const persona = loaded.personas.find((m) => m.asin === asin)!;
            const product = loaded.products.find((p) => p.asin === asin);
            const open = expandedAsin === asin;
            return (
              <Card key={asin}>
                <div className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[13px] font-bold text-[#1d1d1f]">
                        <span className="font-mono">{asin}</span>
                        {loaded.roleOf[asin] && <span className="ml-1.5 text-[10px] text-indigo-600">{loaded.roleOf[asin]}</span>}
                      </p>
                      <p className="text-[11px] text-[#86868b] line-clamp-2">{product?.title || '（无标题）'}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSwapFor(swapFor === asin ? null : asin)}
                      className="shrink-0 rounded-lg border border-black/10 bg-white px-2 py-1 text-[10px] font-semibold text-[#86868b] hover:border-indigo-300 hover:text-indigo-700"
                    >
                      {swapFor === asin ? '取消换人' : '换人'}
                    </button>
                  </div>

                  {/* M3① 换人：从目标细分候选池里按角色规则挑（每人一句"为什么它也行"） */}
                  {swapFor === asin && (
                    <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-2.5 space-y-1.5">
                      <p className="text-[10px] font-semibold text-indigo-800">
                        换成谁？（按「{loaded.roleOf[asin] || '该角色'}」的规则排序，你拍板）
                      </p>
                      {listReplacementCandidates(loaded.pool, loaded.roleById[asin] ?? 'follower', loaded.columns)
                        .slice(0, 5)
                        .map((c) => (
                          <button
                            key={c.asin}
                            type="button"
                            onClick={() => void swapCompetitor(asin, c.asin)}
                            className="w-full text-left rounded-lg border border-black/8 bg-white px-2 py-1.5 hover:border-indigo-400"
                          >
                            <span className="text-[11px] font-mono text-[#1d1d1f]">{c.asin}</span>
                            <span className="ml-1.5 text-[10px] text-[#86868b]">{c.brand}</span>
                            <span className="block text-[10px] text-[#86868b] leading-relaxed">{c.why}</span>
                          </button>
                        ))}
                      {listReplacementCandidates(loaded.pool, loaded.roleById[asin] ?? 'follower', loaded.columns).length === 0 && (
                        <p className="text-[10px] text-[#86868b]">候选池里没有其他商品可换（先扩大细分样本或加载更多数据）</p>
                      )}
                    </div>
                  )}

                  {/* 画像 */}
                  <div>
                    <p className="text-[11px] font-semibold text-[#424245] mb-1">用户画像</p>
                    <p className="text-[10px] text-[#86868b] leading-relaxed">
                      人群：{persona.audience.map((a) => a.keyword).join('、') || '—'}
                    </p>
                    <p className="text-[10px] text-[#86868b] leading-relaxed">
                      场景：{persona.scenarios.map((s) => s.keyword).join('、') || '—'}
                    </p>
                    {persona.audience[0] && (
                      <p className="text-[10px] text-[#aeaeb2] mt-1 leading-relaxed line-clamp-2">
                        引用："{persona.audience[0].evidence.quote}"（{persona.audience[0].evidence.rating}★）
                      </p>
                    )}
                    {persona.gaps.length > 0 && open && (
                      <ul className="mt-1 space-y-0.5">
                        {persona.gaps.map((g, i) => (
                          <li key={i} className="text-[10px] text-amber-600">
                            · {g}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* 痛点矩阵 */}
                  <div>
                    <p className="text-[11px] font-semibold text-[#424245] mb-1">
                      痛点未满足矩阵
                      <span className="ml-1 font-normal text-[#aeaeb2]">
                        （评论 {pain.reviewCount} · 差评 {pain.negativeCount}，{(pain.negativeRate * 100).toFixed(0)}%）
                      </span>
                    </p>
                    {pain.note ? (
                      <p className="text-[10px] text-amber-600 leading-relaxed">{pain.note}</p>
                    ) : (
                      <div className="space-y-1">
                        {pain.hits.slice(0, open ? 99 : 3).map((h) => (
                          <div key={h.category} className="text-[10px] text-[#424245]">
                            <span className="font-semibold">{h.label}</span> {h.count} 条（{(h.share * 100).toFixed(0)}%）
                            {h.demandCategories.length > 0 && (
                              <span className="text-[#86868b]"> · 命中需求域 {h.demandCategories.join('、')}</span>
                            )}
                            {open && h.quotes[0] && (
                              <p className="text-[#aeaeb2] line-clamp-2">"{h.quotes[0].quote}"（{h.quotes[0].rating}★）</p>
                            )}
                          </div>
                        ))}
                        {pain.untouchedDemandCategories.length > 0 && open && (
                          <p className="text-[10px] text-[#86868b]">
                            差评未触及的需求域：{pain.untouchedDemandCategories.join('、')}（≠ 已满足，只是没暴露问题）
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 满足矩阵 */}
                  <div>
                    <p className="text-[11px] font-semibold text-[#424245] mb-1">
                      需求满足矩阵
                      <span className="ml-1 font-normal text-[#aeaeb2]">
                        ●{sat.met} ◐{sat.partial} ○{sat.unmet} —{sat.unmentioned}
                      </span>
                    </p>
                    <div className="space-y-0.5">
                      {sat.cells.slice(0, open ? 99 : 5).map((c) => (
                        <p key={c.needId} className="text-[10px] text-[#424245] leading-relaxed">
                          <span className="font-mono">{SATISFACTION_MARKS[c.status]}</span> {c.needStatement}
                          <span className="text-[#aeaeb2]"> · {c.category}</span>
                          {open && c.evidence[0] && (
                            <span className="block text-[#aeaeb2] line-clamp-2">
                              证据（{c.evidence[0].where}）："{c.evidence[0].quote}"
                            </span>
                          )}
                        </p>
                      ))}
                      {sat.cells.length === 0 && <p className="text-[10px] text-amber-600">还没有需求（先跑看用户）</p>}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setExpandedAsin(open ? null : asin)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-700"
                  >
                    {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    {open ? '收起证据' : '展开全部证据'}
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* ③ 结论 */}
      <Card>
        <div className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Swords className="w-4 h-4 text-indigo-600" />
            <p className="text-sm font-semibold text-[#1d1d1f]">对比完成后的结论</p>
          </div>

          {loaded.hardBlocked && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
              <b>硬约束警示</b>：{loaded.hardNotes.join('；') || '看自己里存在不满足的决策边界'} → 不能推荐"直接进入"，最高"验证后进入"。
            </div>
          )}

          <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-3.5 py-3">
            <p className="text-sm font-bold text-indigo-800">
              赢的路径：{WINNING_PATH_LABELS[effectivePath]}
              {overridden && <span className="ml-2 text-[10px] font-normal text-indigo-600">（你已覆盖系统判定）</span>}
            </p>
            <p className="text-[11px] text-indigo-800/80 mt-1 leading-relaxed">{loaded.decision.conclusion}</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {(['unique', 'better', 'cheaper', 'none'] as WinningPath[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => void persist({ winningPathOverride: p })}
                  className={cn(
                    'rounded-lg border px-2 py-1 text-[10px] font-semibold transition-colors',
                    effectivePath === p
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'bg-white border-black/10 text-[#86868b] hover:border-indigo-300 hover:text-indigo-700'
                  )}
                >
                  {WINNING_PATH_LABELS[p]}
                </button>
              ))}
              {data?.winningPathOverride && (
                <button
                  type="button"
                  onClick={() => void persist({ winningPathOverride: undefined })}
                  className="rounded-lg border border-black/10 bg-white px-2 py-1 text-[10px] font-semibold text-[#86868b] hover:text-indigo-700"
                >
                  恢复系统判定
                </button>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            {loaded.decision.checks.map((c) => (
              <p key={c.path} className="text-[11px] leading-relaxed">
                <span className={c.holds ? 'text-emerald-700 font-semibold' : 'text-[#86868b] font-semibold'}>
                  {c.holds ? <CheckCircle2 className="inline w-3 h-3 mr-1" /> : null}
                  {c.label}：{c.holds ? '成立' : '不成立'}
                </span>
                <span className="text-[#424245]"> — {c.detail}</span>
              </p>
            ))}
          </div>

          {/* AI 只解释：前置条件与风险（判定结果不会被它改动） */}
          {(data?.winningPathExplain ?? '').trim() && (
            <div className="rounded-xl bg-[#f8f9fb] px-3 py-2">
              <p className="text-[10px] text-[#86868b] mb-0.5">AI 解释（不改判定）</p>
              <p className="text-[11px] text-[#424245] leading-relaxed whitespace-pre-wrap">{data?.winningPathExplain}</p>
            </div>
          )}

          {/* 交叉清单：未被满足的需求 ∩ 我们能满足的部分 */}
          <div>
            <p className="text-[11px] font-semibold text-[#424245] mb-1.5">
              未被满足的需求 × 我们能不能接住（改这里会影响上面的判定）
            </p>
            <div className="space-y-1.5">
              {loaded.decision.crossList.map((row) => (
                <div key={row.needId} className="rounded-xl border border-black/8 bg-[#f8f9fb] px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold text-[#1d1d1f]">
                      {row.needStatement}
                      <span className="ml-1.5 font-normal text-[#86868b]">
                        {row.category} · 证据分 {row.evidenceScore}/100
                      </span>
                    </p>
                    <div className="flex items-center gap-1">
                      {STATUS_OPTIONS.map((o) => (
                        <button
                          key={o.value}
                          type="button"
                          onClick={() =>
                            void persist({ ourCapabilityByNeedId: { ...(data?.ourCapabilityByNeedId ?? {}), [row.needId]: o.value } })
                          }
                          className={cn(
                            'rounded-lg border px-2 py-0.5 text-[10px] font-semibold',
                            row.ourStatus === o.value
                              ? 'bg-indigo-600 border-indigo-600 text-white'
                              : 'bg-white border-black/10 text-[#86868b] hover:border-indigo-300 hover:text-indigo-700'
                          )}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="text-[10px] text-[#86868b] mt-1">
                    未满足方：{row.unmetBy.join('、') || '无'}
                    {row.claimedBy.length > 0 && ` · 仅自称满足：${row.claimedBy.join('、')}`}
                  </p>
                </div>
              ))}
              {loaded.decision.crossList.length === 0 && (
                <p className="text-[11px] text-amber-600">还没有需求可交叉（先跑「看用户」）</p>
              )}
            </div>
          </div>

          {loaded.capabilityNotes.length > 0 && (
            <div className="rounded-xl bg-[#f8f9fb] px-3 py-2">
              {loaded.capabilityNotes.map((n, i) => (
                <p key={i} className="text-[10px] text-[#86868b] leading-relaxed">
                  · {n}
                </p>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
