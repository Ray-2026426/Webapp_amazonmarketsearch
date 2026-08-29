import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, BarChart3, ChevronLeft, ChevronRight, ImageIcon, Layers, Loader2, Sparkles, Star, Upload } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { Card } from './ui/Card';
import { FiveLookSummaryShell } from './five-look/FiveLookSummaryShell';
import { CompetitorPickerPanel } from './CompetitorPickerPanel';
import {
  computeCompetitorProgress,
  loadCompetitorLook,
  saveCompetitorLook,
  type CompetitorContext,
  type CompetitorLookData,
} from '../utils/competitorLook';
import { loadMarketLook, type MarketLookData } from '../utils/marketLook';
import { updateLookProgress } from '../utils/projectStore';
import { parseSingleCompetitorZip } from '../utils/competitorArchiveParser';
import {
  fetchAsinDetailFromMcp,
  fetchParentMatrixFromMcp,
  fetchTrafficKeywordsDetailedFromMcp,
  fetchTrafficStatFromMcp,
  type AsinDetailSnapshot,
  type AsinSalesTrendSnapshot,
  type ParentMatrixSnapshot,
  type TrafficKeywordDetail,
  type TrafficStatSnapshot,
} from '../utils/sellerspriteApi';
import { LOOK_STATUS_LABELS, type ResearchProject } from '../types/researchProject';
import type { HistoryRecord, Product } from '../utils/parser';
import { generateText, loadAiSettings } from '../utils/aiConfig';
import { getPrompt } from './AiPromptManager';

const COMPETITOR_ROLES = ['细分头部', '强力跟随者', '新品机会'] as const;

interface AssetPack {
  zipName: string;
  secondaryPreviewUrls: string[];
  aplusPreviewUrls: string[];
  bulletPoints: string;
}

type AnalysisState = 'idle' | 'running';

interface CompetitorAiFindings {
  productPowerFindings: string[];
  operationPowerFindings: string[];
  gaps: string[];
}

export function CompetitorLookView({
  userId,
  project,
  competitorContext,
  products = [],
  history = [],
  onProjectChange,
  onOpenCompetitorTool,
}: {
  userId: string;
  project: ResearchProject;
  competitorContext: CompetitorContext;
  products?: Product[];
  history?: HistoryRecord[];
  onProjectChange: (updated: ResearchProject) => void;
  onOpenCompetitorTool?: () => void;
  onNavigateSelf?: () => void;
}) {
  const [data, setData] = useState<CompetitorLookData | null>(null);
  const [marketLook, setMarketLook] = useState<MarketLookData | null>(null);
  const [details, setDetails] = useState<Record<string, AsinDetailSnapshot>>({});
  const [trafficStats, setTrafficStats] = useState<Record<string, TrafficStatSnapshot>>({});
  const [topKeywords, setTopKeywords] = useState<Record<string, TrafficKeywordDetail[]>>({});
  const [matrices, setMatrices] = useState<Record<string, ParentMatrixSnapshot>>({});
  const [packs, setPacks] = useState<Record<string, AssetPack>>({});
  const [analysisState, setAnalysisState] = useState<AnalysisState>('idle');
  const [progressText, setProgressText] = useState('');
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadCompetitorLook(userId, project.id), loadMarketLook(userId, project.id)]).then(([d, m]) => {
      if (cancelled) return;
      setData(d);
      setMarketLook(m);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, project.id]);

  const productByAsin = useMemo(() => {
    const map = new Map<string, Product>();
    for (const product of products) map.set(product.asin.toUpperCase(), product);
    return map;
  }, [products]);

  const persist = useCallback(
    async (next: CompetitorLookData) => {
      await saveCompetitorLook(userId, project.id, next);
      const progress = computeCompetitorProgress(next);
      const updated = await updateLookProgress(userId, project.id, 'competitor', {
        ...project.fiveLookProgress.competitor,
        status: progress.status,
        completionPercent: progress.completionPercent,
        missingRequirements: progress.missingRequirements,
        updatedAt: new Date().toISOString(),
      });
      if (updated) onProjectChange(updated);
    },
    [userId, project.id, project.fiveLookProgress.competitor, onProjectChange]
  );

  const updateData = useCallback(
    (next: CompetitorLookData) => {
      setData(next);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void persist(next);
      }, 500);
    },
    [persist]
  );

  if (!data || !marketLook) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-[#aeaeb2]">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> 正在加载看竞品...
      </div>
    );
  }

  const slots = normalizeSlots(data);
  const filledSlots = slots.filter(Boolean).length;
  const selectedSegment = marketLook.selectedOpportunitySegment?.trim() || '';
  const progress = project.fiveLookProgress.competitor;
  const marketplace = competitorContext.marketplace || project.marketplace || 'US';
  const judgement = filledSlots === 3
    ? '竞品样本已就绪，可以继续补充 Listing、流量、产品矩阵和结论。'
    : selectedSegment
      ? `已选择「${selectedSegment}」，请补齐头部、跟随者、新品三类竞品 ASIN。`
      : '还没有从看市场带入目标细分市场，竞品对比缺少聚焦对象。';

  const setSlot = (index: number, value: string) => {
    const nextSlots = [...slots];
    nextSlots[index] = value.trim().toUpperCase();
    updateData({
      ...data,
      samplePool: nextSlots.filter(Boolean),
      benchmarkAsins: nextSlots.slice(0, 2).filter(Boolean),
    });
  };

  const applyPicked = (asins: string[]) => {
    const nextSlots = [asins[0] || slots[0], asins[1] || slots[1], asins[2] || slots[2]].map((asin) => asin.trim().toUpperCase());
    updateData({
      ...data,
      samplePool: nextSlots.filter(Boolean),
      benchmarkAsins: nextSlots.slice(0, 2).filter(Boolean),
    });
  };

  const runOneClickAnalysis = async () => {
    const asins = normalizeSlots(data).filter(Boolean);
    if (!asins.length) {
      toast.error('请先选择至少 1 个竞品 ASIN');
      return;
    }
    setAnalysisState('running');
    setProgressText('开始补充竞品数据...');
    const nextDetails = { ...details };
    const nextTraffic = { ...trafficStats };
    const nextKeywords = { ...topKeywords };
    const nextMatrices = { ...matrices };

    for (let i = 0; i < asins.length; i += 1) {
      const asin = asins[i];
      setProgressText(`(${i + 1}/${asins.length}) 补充 ${asin} Listing 与主图...`);
      try {
        nextDetails[asin] = await fetchAsinDetailFromMcp(asin, marketplace);
        setDetails({ ...nextDetails });
      } catch (error) {
        toast.warning(`${asin} Listing 拉取失败：${error instanceof Error ? error.message : ''}`);
      }

      setProgressText(`(${i + 1}/${asins.length}) 补充 ${asin} 流量结构...`);
      try {
        nextTraffic[asin] = await fetchTrafficStatFromMcp(asin, marketplace);
        setTrafficStats({ ...nextTraffic });
      } catch (error) {
        toast.warning(`${asin} 流量结构拉取失败：${error instanceof Error ? error.message : ''}`);
      }

      setProgressText(`(${i + 1}/${asins.length}) 补充 ${asin} 核心流量词...`);
      try {
        nextKeywords[asin] = (await fetchTrafficKeywordsDetailedFromMcp({ asin, marketplace, pageSize: 50, maxPages: 2 })).slice(0, 12);
        setTopKeywords({ ...nextKeywords });
      } catch {
        nextKeywords[asin] = [];
        setTopKeywords({ ...nextKeywords });
      }

      setProgressText(`(${i + 1}/${asins.length}) 补充 ${asin} 产品矩阵...`);
      try {
        nextMatrices[asin] = await fetchParentMatrixFromMcp(asin, marketplace, (msg) => setProgressText(`(${i + 1}/${asins.length}) ${msg}`));
        setMatrices({ ...nextMatrices });
      } catch (error) {
        toast.warning(`${asin} 产品矩阵拉取失败：${error instanceof Error ? error.message : ''}`);
      }
    }

    setProgressText('正在让 AI 基于 Listing、流量、矩阵和历史趋势生成判断...');
    let aiFindings: CompetitorAiFindings | null = null;
    try {
      aiFindings = await generateCompetitorAiFindings({
        asins,
        marketplace,
        selectedSegment,
        details: nextDetails,
        trafficStats: nextTraffic,
        topKeywords: nextKeywords,
        matrices: nextMatrices,
        history,
        productByAsin,
      });
    } catch (error) {
      toast.warning(`AI 判断未生成：${error instanceof Error ? error.message : '请检查 AI 设置'}`);
    }

    updateData({
      ...data,
      productPowerFindings: aiFindings?.productPowerFindings ?? [],
      operationPowerFindings: aiFindings?.operationPowerFindings ?? [],
      gaps: aiFindings?.gaps ?? [],
    });
    setProgressText(aiFindings ? '竞品分析已完成' : '基础数据已补齐，AI 判断未生成');
    setAnalysisState('idle');
    toast.success('竞品一键分析完成');
  };

  const handleZipUpload = async (asin: string, file: File) => {
    const normalized = asin.trim().toUpperCase();
    if (!normalized) {
      toast.error('请先填写 ASIN');
      return;
    }
    try {
      const { competitor, warnings } = await parseSingleCompetitorZip(file, normalized);
      const secondary = await blobsToPreviewUrls([...competitor.secondaryImages, ...competitor.mainImages].map((img) => img.blob), 18);
      const aplus = await blobsToPreviewUrls(competitor.aplusImages.map((img) => img.blob), 18);
      setPacks((prev) => ({
        ...prev,
        [normalized]: {
          zipName: file.name,
          secondaryPreviewUrls: secondary,
          aplusPreviewUrls: aplus,
          bulletPoints: competitor.bulletPoints,
        },
      }));
      toast.success(`${normalized} 图包已导入：附图 ${secondary.length} · A+ ${aplus.length}`);
      if (warnings[0]) toast.warning(warnings[0], { duration: 4000 });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '图包解析失败');
    }
  };

  return (
    <div className="space-y-4">
      <FiveLookSummaryShell
        eyebrow="Five Looks / Competitor"
        title="看竞品"
        judgement={judgement}
        description="填入 ASIN 后会自动读取上传表格中的历史月数据展示销量趋势；一键分析用于补充 Listing、流量、矩阵和判断结论。"
        statusBadge={
          <span className="rounded-full border border-black/5 bg-[#f5f5f7] px-2.5 py-1 text-[11px] font-semibold text-[#86868b]">
            {LOOK_STATUS_LABELS[progress.status]} · {progress.completionPercent}%
          </span>
        }
        metrics={[
          { label: '目标细分', value: selectedSegment || '未选择', tone: selectedSegment ? 'brand' : 'warn' },
          { label: '竞品列', value: `${filledSlots}/3`, tone: filledSlots === 3 ? 'good' : 'warn' },
          { label: '流量数据', value: `${Object.keys(trafficStats).length}`, tone: Object.keys(trafficStats).length ? 'brand' : 'neutral' },
          { label: '产品矩阵', value: `${Object.keys(matrices).length}`, tone: Object.keys(matrices).length ? 'brand' : 'neutral' },
        ]}
        sections={[]}
      />

      <CompetitorPickerPanel
        onOpenCompetitorTool={onOpenCompetitorTool ?? (() => {})}
        preferredSegment={marketLook.selectedOpportunitySegment}
        onPicked={(asins) => applyPicked(asins)}
      />

      {onOpenCompetitorTool && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onOpenCompetitorTool}
            className="inline-flex items-center gap-1.5 rounded-xl border border-black/8 bg-white px-3 py-2 text-xs font-semibold text-[#424245] hover:text-indigo-600"
          >
            返回竞品分析细节 <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <Card>
        <div className="p-4 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-end gap-3">
            {COMPETITOR_ROLES.map((role, index) => (
              <label key={role} className="flex-1 min-w-0">
                <span className="block text-xs font-semibold text-[#424245] mb-1.5">{role} ASIN</span>
                <input
                  value={slots[index]}
                  onChange={(event) => setSlot(index, event.target.value)}
                  placeholder="输入或由上方自动填充"
                  className="w-full px-3 py-2.5 rounded-xl border border-black/8 bg-gradient-to-b from-white to-[#f8f9fb] text-sm text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300 transition-all"
                />
              </label>
            ))}
            <button
              type="button"
              disabled={analysisState === 'running' || filledSlots === 0}
              onClick={() => void runOneClickAnalysis()}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
            >
              {analysisState === 'running' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              一键分析
            </button>
          </div>
          {progressText && <p className="text-xs text-[#86868b]">{progressText}</p>}
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {slots.map((asin, index) => (
          <CompetitorColumn
            key={`${COMPETITOR_ROLES[index]}-${asin || index}`}
            role={COMPETITOR_ROLES[index]}
            asin={asin}
            marketplace={marketplace}
            product={asin ? productByAsin.get(asin) : undefined}
            detail={asin ? details[asin] : undefined}
            trend={asin ? buildTrendFromHistory(asin, history, details[asin]) : undefined}
            traffic={asin ? trafficStats[asin] : undefined}
            keywords={asin ? topKeywords[asin] ?? [] : []}
            matrix={asin ? matrices[asin] : undefined}
            pack={asin ? packs[asin] : undefined}
            productFindings={data.productPowerFindings.filter(Boolean)}
            operationFindings={data.operationPowerFindings.filter(Boolean)}
            gaps={data.gaps.filter(Boolean)}
            fallbackIndex={index}
            onZipUpload={(file) => void handleZipUpload(asin, file)}
          />
        ))}
      </div>
    </div>
  );
}

function normalizeSlots(data: CompetitorLookData): string[] {
  return [
    data.benchmarkAsins[0] || data.samplePool[0] || '',
    data.benchmarkAsins[1] || data.samplePool[1] || '',
    data.samplePool[2] || data.benchmarkAsins[2] || '',
  ].map((asin) => asin.trim().toUpperCase());
}

async function blobsToPreviewUrls(blobs: Blob[], limit: number): Promise<string[]> {
  return blobs.slice(0, limit).map((blob) => URL.createObjectURL(blob));
}

function buildTrendFromHistory(asin: string, history: HistoryRecord[], detail?: AsinDetailSnapshot): AsinSalesTrendSnapshot {
  const record = history.find((h) => h.asin.toUpperCase() === asin.toUpperCase());
  const points = record
    ? Object.entries(record.history)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, row]) => ({
        month,
        price: row.price || 0,
        averagePrice: row.price || 0,
        parentUnitSales: row.sales || 0,
        childUnitSales: row.sales || 0,
        parentSalesRevenue: row.revenue || 0,
        childSalesRevenue: row.revenue || 0,
      }))
    : [];
  return { asin: detail ?? null, points, raw: { source: 'uploaded-history' } };
}

async function generateCompetitorAiFindings({
  asins,
  marketplace,
  selectedSegment,
  details,
  trafficStats,
  topKeywords,
  matrices,
  history,
  productByAsin,
}: {
  asins: string[];
  marketplace: string;
  selectedSegment: string;
  details: Record<string, AsinDetailSnapshot>;
  trafficStats: Record<string, TrafficStatSnapshot>;
  topKeywords: Record<string, TrafficKeywordDetail[]>;
  matrices: Record<string, ParentMatrixSnapshot>;
  history: HistoryRecord[];
  productByAsin: Map<string, Product>;
}): Promise<CompetitorAiFindings> {
  const settings = loadAiSettings();
  if (!settings?.apiKey) throw new Error('请先在设置中配置 AI API Key');
  const basePrompt = getPrompt('competitor_report') || '你是一位资深亚马逊竞品分析专家，请严格基于给定数据输出判断。';
  const evidence = asins.map((asin) => {
    const product = productByAsin.get(asin);
    const detail = details[asin];
    const traffic = trafficStats[asin];
    const trend = buildTrendFromHistory(asin, history, detail).points.slice(-12);
    const matrix = matrices[asin];
    return {
      roleAsin: asin,
      listing: {
        title: detail?.title || product?.title || '',
        brand: detail?.brand || product?.brand || '',
        price: detail?.price || product?.price || 0,
        rating: detail?.rating || product?.rating || 0,
        ratings: detail?.ratings || product?.reviewCount || 0,
        fulfillment: detail?.fulfillment || '',
        sellerName: detail?.sellerName || '',
        sellers: detail?.sellers || product?.sellerCount || 0,
        categoryPath: detail?.categoryPath || product?.subCategory || '',
        lqs: detail?.lqs || 0,
        parentAsin: detail?.parentAsin || '',
        variationCount: detail?.variationCount || 0,
        skuList: detail?.skuList || [],
        dimensions: detail?.dimensions || '',
        weight: detail?.weight || '',
        bsrRank: detail?.bsrRank || product?.subBsr || 0,
        bsrLabel: detail?.bsrLabel || product?.subCategory || '',
        badge: detail?.badge || {},
        features: detail?.features || [],
      },
      importedMarketData: {
        monthlySales: product?.monthlySales || 0,
        monthlyRevenue: product?.monthlyRevenue || 0,
        fbaFee: product?.fbaFee || 0,
        launchDate: product?.launchDate || '',
        daysSinceLaunch: product?.daysSinceLaunch || 0,
        buyBoxType: product?.buyBoxType || '',
      },
      traffic: traffic
        ? {
            keywords: traffic.keywords,
            organicKeywords: traffic.ranks,
            adKeywords: traffic.ads,
            badgeCount: traffic.badgeCount,
            topKeywords: (topKeywords[asin] || []).slice(0, 12).map((kw) => ({
              keyword: kw.keyword,
              translation: kw.translation,
              trafficPercentage: kw.trafficPercentage,
              abaRank: kw.abaRank,
              monthlySearches: kw.monthlySearches,
              organicPosition: kw.organicPosition,
              adPosition: kw.adPosition,
              naturalRatio: kw.naturalRatio,
              adRatio: kw.adRatio,
              cpcBid: kw.cpcBid,
              badges: kw.badges,
            })),
          }
        : null,
      matrix: matrix
        ? {
            parentAsin: matrix.parentAsin,
            variationCount: matrix.variationCount,
            anchorSku: matrix.anchorSku,
            children: matrix.children.slice(0, 12),
          }
        : null,
      historyTrend: trend.map((point) => ({
        month: point.month,
        sales: point.childUnitSales ?? point.parentUnitSales ?? 0,
        revenue: point.childSalesRevenue ?? point.parentSalesRevenue ?? 0,
        price: point.price,
      })),
    };
  });
  const prompt = `${basePrompt}

请只使用下面 JSON 证据，不要补充未给出的事实。输出必须是合法 JSON，格式如下：
{
  "productPowerFindings": ["每个 ASIN 一条，按输入 ASIN 顺序"],
  "operationPowerFindings": ["每个 ASIN 一条，按输入 ASIN 顺序"],
  "gaps": ["每个 ASIN 一条，按输入 ASIN 顺序"]
}

要求：
- 产品力判断关注功能、材质/规格、五点卖点、价格带、评分评论、变体矩阵和差异化。
- 运营力判断关注 Listing 完整度、LQS、配送/卖家、自然/广告流量结构、关键词排名、价格和历史销量/销售额趋势。
- 缺口判断必须写成可验证的机会或风险，无法判断时写“数据不足，需要补充 XXX”。
- 每条结论 80 字以内，中文。

上下文：
${JSON.stringify({ marketplace, selectedSegment, evidence }, null, 2)}`;
  const raw = await generateText(prompt, settings);
  const parsed = parseAiJson(raw);
  return {
    productPowerFindings: normalizeAiList(parsed.productPowerFindings, asins.length),
    operationPowerFindings: normalizeAiList(parsed.operationPowerFindings, asins.length),
    gaps: normalizeAiList(parsed.gaps, asins.length),
  };
}

function parseAiJson(raw: string): Partial<CompetitorAiFindings> {
  const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(cleaned) as Partial<CompetitorAiFindings>;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as Partial<CompetitorAiFindings>;
    }
    throw new Error('AI 返回不是合法 JSON');
  }
}

function normalizeAiList(value: unknown, size: number): string[] {
  const list = Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];
  return Array.from({ length: size }, (_, index) => list[index] || '');
}

function amazonUrl(asin: string, marketplace: string): string {
  const domains: Record<string, string> = {
    US: 'amazon.com',
    UK: 'amazon.co.uk',
    DE: 'amazon.de',
    FR: 'amazon.fr',
    IT: 'amazon.it',
    ES: 'amazon.es',
    CA: 'amazon.ca',
    JP: 'amazon.co.jp',
    AU: 'amazon.com.au',
  };
  const domain = domains[marketplace.toUpperCase()] || (marketplace.includes('.') ? marketplace : 'amazon.com');
  return `https://www.${domain}/dp/${encodeURIComponent(asin)}`;
}

function MediaCarousel({
  asin,
  title,
  mainImage,
  pack,
  onZipUpload,
}: {
  asin: string;
  title: string;
  mainImage: string;
  pack?: AssetPack;
  onZipUpload: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [index, setIndex] = useState(0);
  const media = useMemo(
    () => [
      ...(mainImage ? [{ url: mainImage, label: '主图' }] : []),
      ...(pack?.secondaryPreviewUrls ?? []).map((url, i) => ({ url, label: `附图 ${i + 1}` })),
      ...(pack?.aplusPreviewUrls ?? []).map((url, i) => ({ url, label: `A+ ${i + 1}` })),
    ],
    [mainImage, pack?.aplusPreviewUrls, pack?.secondaryPreviewUrls]
  );
  const current = media[index];

  useEffect(() => {
    if (index >= media.length) setIndex(0);
  }, [index, media.length]);

  const move = (delta: number) => {
    if (media.length <= 1) return;
    setIndex((prev) => (prev + delta + media.length) % media.length);
  };

  return (
    <div className="relative aspect-[4/3] rounded-xl border border-black/5 bg-[#f5f5f7] overflow-hidden flex items-center justify-center group">
      {current ? (
        <img src={current.url} alt={`${title || asin} ${current.label}`} className="w-full h-full object-contain bg-white" referrerPolicy="no-referrer" />
      ) : (
        <div className="flex flex-col items-center gap-2 text-[#aeaeb2]">
          <ImageIcon className="w-9 h-9 text-[#c7c7cc]" />
          <span className="text-xs">暂无图片</span>
        </div>
      )}
      <div className="absolute left-2 right-2 top-2 flex items-center justify-between gap-2">
        <span className="px-2 py-1 rounded-lg bg-white/90 border border-black/5 text-[11px] font-semibold text-[#424245] shadow-sm">
          {current ? `${current.label} ${index + 1}/${media.length}` : '主图 / 图包'}
        </span>
        <button
          type="button"
          disabled={!asin}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/90 border border-black/5 text-[11px] font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50 disabled:opacity-50"
        >
          <Upload className="w-3 h-3" />
          上传图包
        </button>
      </div>
      {media.length > 1 && (
        <>
          <button type="button" title="上一张" aria-label="上一张" onClick={() => move(-1)} className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 border border-black/5 text-[#424245] shadow-sm flex items-center justify-center hover:bg-white">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button type="button" title="下一张" aria-label="下一张" onClick={() => move(1)} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 border border-black/5 text-[#424245] shadow-sm flex items-center justify-center hover:bg-white">
            <ChevronRight className="w-4 h-4" />
          </button>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onZipUpload(file);
        }}
      />
    </div>
  );
}

function CompetitorColumn({
  role,
  asin,
  marketplace,
  product,
  detail,
  trend,
  traffic,
  keywords,
  matrix,
  pack,
  productFindings,
  operationFindings,
  gaps,
  fallbackIndex,
  onZipUpload,
}: {
  role: string;
  asin: string;
  marketplace: string;
  product?: Product;
  detail?: AsinDetailSnapshot;
  trend?: AsinSalesTrendSnapshot;
  traffic?: TrafficStatSnapshot;
  keywords: TrafficKeywordDetail[];
  matrix?: ParentMatrixSnapshot;
  pack?: AssetPack;
  productFindings: string[];
  operationFindings: string[];
  gaps: string[];
  fallbackIndex: number;
  onZipUpload: (file: File) => void;
}) {
  const productJudgement = productFindings[fallbackIndex] || (asin ? '等待一键分析后由 AI 基于证据生成产品力判断。' : '暂无产品力判断。');
  const operationJudgement = operationFindings[fallbackIndex] || (asin ? '等待一键分析后由 AI 基于证据生成运营力判断。' : '暂无运营力判断。');
  const gapJudgement = gaps[fallbackIndex] || (asin ? '等待一键分析后由 AI 基于证据生成可攻击缺口。' : '暂无明确可攻击缺口。');
  const title = detail?.title || product?.title || '暂无 Listing 标题';
  const image = detail?.zoomImageUrl || detail?.imageUrl || product?.image || '';
  const price = detail?.price || product?.price || 0;
  const rating = detail?.rating || product?.rating || 0;
  const reviewCount = detail?.ratings || product?.reviewCount || 0;
  const sales = product?.monthlySales || latestTrendSales(trend);
  const revenue = product?.monthlyRevenue || latestTrendRevenue(trend);

  return (
    <Card>
      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-indigo-600">{role}</p>
            {asin ? (
              <a href={amazonUrl(asin, marketplace)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-[#1d1d1f] mt-0.5 hover:text-indigo-600">
                {asin}<ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            ) : (
              <p className="text-sm font-semibold text-[#1d1d1f] mt-0.5">待选择 ASIN</p>
            )}
          </div>
          {rating ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
              <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" /> {rating.toFixed(1)}
            </span>
          ) : null}
        </div>

        <MediaCarousel asin={asin} title={title} mainImage={image} pack={pack} onZipUpload={onZipUpload} />

        <div>
          <p className="text-sm font-semibold text-[#1d1d1f] leading-5">{title}</p>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <Metric label="价格" value={price ? `$${price.toFixed(2)}` : '-'} />
            <Metric label="月销量" value={sales ? Math.round(sales).toLocaleString() : '-'} />
            <Metric label="月销售额" value={revenue ? `$${Math.round(revenue).toLocaleString()}` : '-'} />
            <Metric label="评论数" value={reviewCount ? reviewCount.toLocaleString() : '-'} />
            <Metric label="FBA 费用" value={product?.fbaFee ? `$${product.fbaFee.toFixed(2)}` : '-'} />
            <Metric label="LQS" value={detail?.lqs ? `${detail.lqs}` : '-'} />
          </div>
        </div>

        <TrendMiniChart trend={trend} />
        <TrafficBlock traffic={traffic} keywords={keywords} />
        <MatrixBlock matrix={matrix} />

        <Section title="Listing 信息" items={[
          title ? `标题：${title}` : '',
          detail?.brand || product?.brand ? `品牌：${detail?.brand || product?.brand}` : '',
          detail?.categoryPath || product?.subCategory ? `类目：${detail?.categoryPath || product?.subCategory}` : '',
          price ? `价格：$${price.toFixed(2)}` : '',
          rating ? `评分：${rating.toFixed(1)} / 评论数：${reviewCount ? reviewCount.toLocaleString() : '-'}` : '',
          sales || revenue ? `月销量：${sales ? Math.round(sales).toLocaleString() : '-'} / 月销售额：${revenue ? `$${Math.round(revenue).toLocaleString()}` : '-'}` : '',
          detail?.fulfillment ? `配送：${detail.fulfillment}` : '',
          detail?.sellerName ? `卖家：${detail.sellerName}` : '',
          detail?.sellers ? `卖家数：${detail.sellers}` : '',
          detail?.parentAsin ? `父体 ASIN：${detail.parentAsin}` : '',
          detail?.variationCount ? `变体数量：${detail.variationCount}` : '',
          detail?.skuList?.length ? `当前规格：${detail.skuList.join(' / ')}` : '',
          detail?.dimensions ? `尺寸：${detail.dimensions}` : '',
          detail?.weight ? `重量：${detail.weight}` : '',
          detail?.bsrRank || product?.subBsr ? `BSR：#${(detail?.bsrRank || product?.subBsr).toLocaleString()} ${detail?.bsrLabel || product?.subCategory || ''}` : '',
          formatBadges(detail),
          ...(detail?.features?.length ? detail.features.map((feature, i) => `五点 ${i + 1}：${feature}`) : []),
        ].filter(Boolean)} />

        <Section title="产品力判断" items={[productJudgement]} tone="good" />
        <Section title="运营力判断" items={[operationJudgement]} tone="brand" />
        <Section title="可攻击缝隙" items={[gapJudgement]} tone="warn" />
      </div>
    </Card>
  );
}

function latestTrendSales(trend?: AsinSalesTrendSnapshot): number {
  const points = trend?.points ?? [];
  const last = points[points.length - 1];
  return last?.childUnitSales ?? last?.parentUnitSales ?? 0;
}

function latestTrendRevenue(trend?: AsinSalesTrendSnapshot): number {
  const points = trend?.points ?? [];
  const last = points[points.length - 1];
  return last?.childSalesRevenue ?? last?.parentSalesRevenue ?? 0;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-black/5 bg-[#fafafa] px-3 py-2">
      <p className="text-[11px] text-[#86868b]">{label}</p>
      <p className="text-sm font-semibold text-[#1d1d1f] mt-0.5 truncate">{value}</p>
    </div>
  );
}

function TrendMiniChart({ trend }: { trend?: AsinSalesTrendSnapshot }) {
  const points = (trend?.points ?? []).slice(-12).map((point) => ({
    month: point.month,
    sales: point.childUnitSales ?? point.parentUnitSales ?? 0,
    revenue: point.childSalesRevenue ?? point.parentSalesRevenue ?? 0,
  }));
  return (
    <div className="rounded-xl border border-black/5 bg-[#fafafa] p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-[#424245]">市场趋势（历史）</p>
        <BarChart3 className="w-3.5 h-3.5 text-indigo-500" />
      </div>
      {points.length ? (
        <>
          <div className="h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={points} margin={{ top: 8, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  fontSize={10}
                  stroke="#86868b"
                  tickFormatter={(value) => String(value).slice(2)}
                />
                <YAxis hide yAxisId="sales" />
                <YAxis hide yAxisId="revenue" />
                <Tooltip
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  formatter={(value: number, name: string) => [
                    name === 'sales' ? Math.round(value).toLocaleString() : `$${Math.round(value).toLocaleString()}`,
                    name === 'sales' ? '销量' : '销售额',
                  ]}
                />
                <Bar yAxisId="sales" dataKey="sales" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="revenue" dataKey="revenue" fill="#4f46e5" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-black/5 bg-white">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-white text-[#86868b]">
                <tr className="border-b border-black/5">
                  <th className="py-1.5 px-2 text-left font-semibold">月份</th>
                  <th className="py-1.5 px-2 text-right font-semibold">销量</th>
                  <th className="py-1.5 px-2 text-right font-semibold">销售额</th>
                </tr>
              </thead>
              <tbody>
                {points.map((point) => (
                  <tr key={point.month} className="border-b border-black/5 last:border-0">
                    <td className="py-1.5 px-2 text-[#424245]">{point.month}</td>
                    <td className="py-1.5 px-2 text-right font-semibold text-emerald-700">{Math.round(point.sales).toLocaleString()}</td>
                    <td className="py-1.5 px-2 text-right font-semibold text-indigo-700">${Math.round(point.revenue).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-[#86868b] truncate">{points[0]?.month} - {points[points.length - 1]?.month}</p>
        </>
      ) : (
        <p className="text-xs text-[#aeaeb2] leading-5">上传历史月数据后，填入对应 ASIN 会自动显示。</p>
      )}
    </div>
  );
}

function TrafficBlock({ traffic, keywords }: { traffic?: TrafficStatSnapshot; keywords: TrafficKeywordDetail[] }) {
  const adRate = traffic && traffic.keywords > 0 ? Math.round((traffic.ads / traffic.keywords) * 100) : 0;
  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-[#424245]">流量分析</p>
        <span className="text-[11px] text-indigo-700">{traffic ? `广告依赖 ${adRate}%` : '待分析'}</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5 mb-2">
        <TinyMetric label="流量词" value={traffic?.keywords} />
        <TinyMetric label="自然词" value={traffic?.ranks} />
        <TinyMetric label="广告词" value={traffic?.ads} />
      </div>
      {keywords.length ? (
        <div className="space-y-1">
          {keywords.slice(0, 6).map((kw) => (
            <div key={kw.keyword} className="rounded-lg bg-white/80 px-2 py-1 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[#424245] font-medium">{kw.keyword}</span>
                <span className="shrink-0 font-semibold text-indigo-700">{Math.round(kw.trafficPercentage * 100)}%</span>
              </div>
              <div className="mt-0.5 grid grid-cols-3 gap-1 text-[10px] text-[#86868b]">
                <span>ABA {kw.abaRank ? `#${kw.abaRank.toLocaleString()}` : '-'}</span>
                <span>自然 {formatRank(kw.organicPosition)}</span>
                <span>广告 {formatRank(kw.adPosition)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-[#86868b] leading-5">暂无核心流量词。</p>
      )}
    </div>
  );
}

function formatRank(rank: number | null): string {
  return rank ? `#${rank.toLocaleString()}` : '-';
}

function formatBadges(detail?: AsinDetailSnapshot): string {
  if (!detail?.badge) return '';
  const labels: Record<string, string> = {
    bestSeller: 'Best Seller',
    amazonChoice: 'Amazon Choice',
    ebc: 'A+',
    video: 'Video',
  };
  const entries = Object.entries(detail.badge)
    .filter(([, value]) => {
      const text = String(value || '').trim();
      return text && text !== '0' && text.toLowerCase() !== 'false';
    })
    .map(([key, value]) => labels[key] || `${key}=${value}`);
  return entries.length ? `标识：${entries.join(' / ')}` : '';
}

function MatrixBlock({ matrix }: { matrix?: ParentMatrixSnapshot }) {
  const children = matrix?.children ?? [];
  const prices = children.map((item) => item.price).filter((price) => price > 0);
  const min = prices.length ? Math.min(...prices) : 0;
  const max = prices.length ? Math.max(...prices) : 0;
  return (
    <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-[#424245]">产品矩阵</p>
        <Layers className="w-3.5 h-3.5 text-emerald-600" />
      </div>
      <div className="grid grid-cols-3 gap-1.5 mb-2">
        <TinyMetric label="父体" value={matrix?.parentAsin || '-'} />
        <TinyMetric label="变体" value={matrix?.variationCount} />
        <TinyMetric label="价格带" value={min && max ? `$${min.toFixed(0)}-${max.toFixed(0)}` : '-'} />
      </div>
      {children.length ? (
        <div className="space-y-1">
          {children.slice(0, 4).map((child) => (
            <div key={child.asin} className="flex items-center justify-between gap-2 rounded-lg bg-white/80 px-2 py-1 text-[11px]">
              <span className="truncate text-[#424245]">{child.attribute || child.asin}</span>
              <span className="shrink-0 font-semibold text-emerald-700">{child.price ? `$${child.price.toFixed(0)}` : '-'}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-[#86868b] leading-5">暂无父体/变体矩阵。</p>
      )}
    </div>
  );
}

function TinyMetric({ label, value }: { label: string; value?: string | number }) {
  return (
    <div className="rounded-lg bg-white/80 px-2 py-1.5">
      <p className="text-[10px] text-[#86868b]">{label}</p>
      <p className="text-[11px] font-semibold text-[#1d1d1f] truncate">{value || '-'}</p>
    </div>
  );
}

function Section({
  title,
  items,
  tone = 'neutral',
}: {
  title: string;
  items: string[];
  tone?: 'neutral' | 'good' | 'brand' | 'warn';
}) {
  const toneCls = {
    neutral: 'bg-[#fafafa] border-black/5',
    good: 'bg-emerald-50/70 border-emerald-100',
    brand: 'bg-indigo-50/70 border-indigo-100',
    warn: 'bg-amber-50/70 border-amber-100',
  }[tone];
  return (
    <div className={`rounded-xl border p-3 ${toneCls}`}>
      <p className="text-xs font-semibold text-[#424245] mb-1.5">{title}</p>
      {items.length ? (
        items.map((item, index) => (
          <p key={`${item}-${index}`} className="text-xs text-[#424245] leading-5">
            {item}
          </p>
        ))
      ) : (
        <p className="text-xs text-[#aeaeb2] leading-5">暂无数据。</p>
      )}
    </div>
  );
}
