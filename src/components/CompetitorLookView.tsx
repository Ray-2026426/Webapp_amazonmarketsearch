import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, ChevronLeft, ChevronRight, ImageIcon, Layers, Loader2, Sparkles, Star, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Card, cn } from './ui/Card';
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
  fetchAsinSalesTrendFromMcp,
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
import type { Product } from '../utils/parser';

const COMPETITOR_ROLES = ['细分头部', '强力跟随者', '新上架链接'] as const;

interface AssetPack {
  zipName: string;
  secondaryPreviewUrls: string[];
  aplusPreviewUrls: string[];
  bulletPoints: string;
}

type AnalysisState = 'idle' | 'running';

export function CompetitorLookView({
  userId,
  project,
  competitorContext,
  products = [],
  onProjectChange,
  onOpenCompetitorTool,
}: {
  userId: string;
  project: ResearchProject;
  competitorContext: CompetitorContext;
  products?: Product[];
  onProjectChange: (updated: ResearchProject) => void;
  onOpenCompetitorTool?: () => void;
  onNavigateSelf?: () => void;
}) {
  const [data, setData] = useState<CompetitorLookData | null>(null);
  const [marketLook, setMarketLook] = useState<MarketLookData | null>(null);
  const [details, setDetails] = useState<Record<string, AsinDetailSnapshot>>({});
  const [trends, setTrends] = useState<Record<string, AsinSalesTrendSnapshot>>({});
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
  const gaps = data.gaps.filter(Boolean);
  const productFindings = data.productPowerFindings.filter(Boolean);
  const operationFindings = data.operationPowerFindings.filter(Boolean);
  const selectedSegment = marketLook.selectedOpportunitySegment?.trim() || '';
  const progress = project.fiveLookProgress.competitor;
  const marketplace = competitorContext.marketplace || project.marketplace || 'US';
  const judgement = filledSlots === 3
    ? `已形成三列竞品对比，可继续一键抓取 Listing、流量、销量趋势和产品矩阵。`
    : selectedSegment
      ? `已选择「${selectedSegment}」，需要补齐头部、跟随者、新链接三类竞品 ASIN。`
      : '还没有从看市场带入目标细分市场，竞品对比缺少聚焦对象。';

  const setSlot = (index: number, value: string) => {
    const asin = value.trim().toUpperCase();
    const nextSlots = [...slots];
    nextSlots[index] = asin;
    const samplePool = [...data.samplePool];
    const benchmarkAsins = [...data.benchmarkAsins];
    benchmarkAsins[0] = nextSlots[0] || '';
    benchmarkAsins[1] = nextSlots[1] || '';
    samplePool[0] = nextSlots[0] || '';
    samplePool[1] = nextSlots[1] || '';
    samplePool[2] = nextSlots[2] || '';
    updateData({
      ...data,
      samplePool: samplePool.filter((item, i) => item || i < 3),
      benchmarkAsins: benchmarkAsins.filter((item, i) => item || i < 2),
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
    setProgressText('开始抓取竞品数据...');
    const nextDetails = { ...details };
    const nextTrends = { ...trends };
    const nextTraffic = { ...trafficStats };
    const nextKeywords = { ...topKeywords };
    const nextMatrices = { ...matrices };

    for (let i = 0; i < asins.length; i += 1) {
      const asin = asins[i];
      setProgressText(`(${i + 1}/${asins.length}) 抓取 ${asin} Listing 与主图...`);
      try {
        nextDetails[asin] = await fetchAsinDetailFromMcp(asin, marketplace);
        setDetails({ ...nextDetails });
      } catch (error) {
        toast.warning(`${asin} Listing 拉取失败：${error instanceof Error ? error.message : ''}`);
      }

      setProgressText(`(${i + 1}/${asins.length}) 抓取 ${asin} 销量趋势...`);
      try {
        nextTrends[asin] = await fetchAsinSalesTrendFromMcp(asin, marketplace);
        setTrends({ ...nextTrends });
      } catch {
        nextTrends[asin] = { asin: nextDetails[asin] ?? null, points: [], raw: {} };
        setTrends({ ...nextTrends });
      }

      setProgressText(`(${i + 1}/${asins.length}) 抓取 ${asin} 流量结构...`);
      try {
        nextTraffic[asin] = await fetchTrafficStatFromMcp(asin, marketplace);
        setTrafficStats({ ...nextTraffic });
      } catch (error) {
        toast.warning(`${asin} 流量结构拉取失败：${error instanceof Error ? error.message : ''}`);
      }

      setProgressText(`(${i + 1}/${asins.length}) 抓取 ${asin} 核心流量词...`);
      try {
        nextKeywords[asin] = (await fetchTrafficKeywordsDetailedFromMcp({ asin, marketplace, pageSize: 50, maxPages: 2 })).slice(0, 12);
        setTopKeywords({ ...nextKeywords });
      } catch {
        nextKeywords[asin] = [];
        setTopKeywords({ ...nextKeywords });
      }

      setProgressText(`(${i + 1}/${asins.length}) 抓取 ${asin} 产品矩阵...`);
      try {
        nextMatrices[asin] = await fetchParentMatrixFromMcp(asin, marketplace, (msg) => setProgressText(`(${i + 1}/${asins.length}) ${msg}`));
        setMatrices({ ...nextMatrices });
      } catch (error) {
        toast.warning(`${asin} 产品矩阵拉取失败：${error instanceof Error ? error.message : ''}`);
      }
    }

    setProgressText('竞品数据抓取完成');
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
        title="看竞品 · 三列对比"
        judgement={judgement}
        description="三列结构不变：每列对应一个竞品，内部承载 Listing、流量分析、产品矩阵、附图/A+和销量趋势。"
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
            product={asin ? productByAsin.get(asin) : undefined}
            detail={asin ? details[asin] : undefined}
            trend={asin ? trends[asin] : undefined}
            traffic={asin ? trafficStats[asin] : undefined}
            keywords={asin ? topKeywords[asin] ?? [] : []}
            matrix={asin ? matrices[asin] : undefined}
            pack={asin ? packs[asin] : undefined}
            productFindings={productFindings}
            operationFindings={operationFindings}
            gaps={gaps}
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
          <button
            type="button"
            title="上一张"
            aria-label="上一张"
            onClick={() => move(-1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 border border-black/5 text-[#424245] shadow-sm flex items-center justify-center hover:bg-white"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="下一张"
            aria-label="下一张"
            onClick={() => move(1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 border border-black/5 text-[#424245] shadow-sm flex items-center justify-center hover:bg-white"
          >
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
  const productJudgement = productFindings[fallbackIndex] || productFindings[0] || '暂无产品力判断。';
  const operationJudgement = operationFindings[fallbackIndex] || operationFindings[0] || '暂无运营力判断。';
  const gapJudgement = gaps[fallbackIndex] || gaps[0] || '暂无明确可攻击缝隙。';
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
            <p className="text-sm font-semibold text-[#1d1d1f] mt-0.5">{asin || '待选择 ASIN'}</p>
          </div>
          {rating ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
              <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" /> {rating.toFixed(1)}
            </span>
          ) : null}
        </div>

        <MediaCarousel asin={asin} title={title} mainImage={image} pack={pack} onZipUpload={onZipUpload} />

        <div>
          <p className="text-sm font-semibold text-[#1d1d1f] line-clamp-3">{title}</p>
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

        <Section
          title="Listing 信息"
          items={[
            detail?.brand || product?.brand ? `品牌：${detail?.brand || product?.brand}` : '',
            detail?.categoryPath || product?.subCategory ? `类目：${detail?.categoryPath || product?.subCategory}` : '',
            detail?.fulfillment ? `配送：${detail.fulfillment}` : '',
            detail?.sellerName ? `卖家：${detail.sellerName}` : '',
            detail?.features?.length ? `五点：${detail.features.slice(0, 2).join(' / ')}` : '',
          ].filter(Boolean)}
        />

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
  const points = (trend?.points ?? []).slice(-8);
  const values = points.map((point) => point.childUnitSales ?? point.parentUnitSales ?? 0);
  const max = Math.max(...values, 1);
  const coords = values.map((value, index) => {
    const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * 100;
    const y = 42 - (value / max) * 36;
    return `${x},${y}`;
  }).join(' ');
  return (
    <div className="rounded-xl border border-black/5 bg-[#fafafa] p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-[#424245]">销量趋势</p>
        <BarChart3 className="w-3.5 h-3.5 text-indigo-500" />
      </div>
      {values.length ? (
        <>
          <svg viewBox="0 0 100 48" className="w-full h-14">
            <polyline points={coords} fill="none" stroke="#4f46e5" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="text-[11px] text-[#86868b] truncate">{points[0]?.month} - {points[points.length - 1]?.month}</p>
        </>
      ) : (
        <p className="text-xs text-[#aeaeb2] leading-5">暂无趋势数据，一键分析后显示。</p>
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
        <span className="text-[11px] text-indigo-700">{traffic ? `广告依赖 ${adRate}%` : '待抓取'}</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5 mb-2">
        <TinyMetric label="流量词" value={traffic?.keywords} />
        <TinyMetric label="自然词" value={traffic?.ranks} />
        <TinyMetric label="广告词" value={traffic?.ads} />
      </div>
      {keywords.length ? (
        <div className="space-y-1">
          {keywords.slice(0, 4).map((kw) => (
            <div key={kw.keyword} className="flex items-center justify-between gap-2 rounded-lg bg-white/80 px-2 py-1 text-[11px]">
              <span className="truncate text-[#424245]">{kw.keyword}</span>
              <span className="shrink-0 font-semibold text-indigo-700">{Math.round(kw.trafficPercentage * 100)}%</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-[#86868b] leading-5">暂无核心流量词。</p>
      )}
    </div>
  );
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
    <div className={cn('rounded-xl border p-3', toneCls)}>
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
