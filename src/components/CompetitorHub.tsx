import React, { useMemo, useRef, useState } from 'react';
import {
  Crosshair, Loader2, Image as ImageIcon, Activity, Grid3X3, Plus, X, Upload,
  ChevronRight, ChevronLeft, Star, Package, ExternalLink, RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import {
  SELLERSPRITE_MARKETPLACES,
  normalizeMarketplaceCode,
  parseAsinList,
  fetchAsinDetailFromMcp,
  fetchTrafficStatFromMcp,
  fetchKeywordsFromMcp,
  fetchParentMatrixFromMcp,
  fetchBrandParentsFromMcp,
  type AsinDetailSnapshot,
  type TrafficStatSnapshot,
  type ParentMatrixSnapshot,
  type BrandParentItem,
} from '../utils/sellerspriteApi';
import { parseSingleCompetitorZip } from '../utils/competitorArchiveParser';
import type { Keyword, Product } from '../utils/parser';
import { toast } from 'sonner';

type WizardStep = 1 | 2 | 3;
type ResultTab = 'listing' | 'traffic' | 'matrix';

interface CompetitorHubProps {
  products: Product[];
  marketplaceCode?: string;
  domain?: string;
  preselectedAsins?: string[];
}

interface AsinPack {
  zipName: string;
  mainPreviewUrls: string[];
  aplusCount: number;
  bulletPoints: string;
}

const MAX_ASINS = 5;

function fmtNum(n: number, digits = 0): string {
  if (!Number.isFinite(n) || n === 0) return '-';
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function badgeYes(v: string | undefined): boolean {
  return String(v || '').toUpperCase() === 'Y';
}

function starsLabel(rating: number): string {
  if (!rating) return '暂无评分';
  return `${rating.toFixed(1)} ★`;
}

export const CompetitorHub: React.FC<CompetitorHubProps> = ({
  products,
  marketplaceCode = 'US',
  preselectedAsins = [],
}) => {
  const [step, setStep] = useState<WizardStep>(1);
  const [asinInput, setAsinInput] = useState('');
  const [selected, setSelected] = useState<string[]>(() =>
    preselectedAsins.slice(0, MAX_ASINS).map((a) => a.toUpperCase())
  );
  const [marketplace, setMarketplace] = useState(normalizeMarketplaceCode(marketplaceCode));
  const [packs, setPacks] = useState<Record<string, AsinPack>>({});
  const [parsingAsin, setParsingAsin] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [hasResult, setHasResult] = useState(false);
  const [resultTab, setResultTab] = useState<ResultTab>('listing');

  const [details, setDetails] = useState<AsinDetailSnapshot[]>([]);
  const [trafficStats, setTrafficStats] = useState<TrafficStatSnapshot[]>([]);
  const [topKeywords, setTopKeywords] = useState<Record<string, Keyword[]>>({});
  const [matrices, setMatrices] = useState<ParentMatrixSnapshot[]>([]);
  const [brandParents, setBrandParents] = useState<BrandParentItem[][]>([]);

  const productMap = useMemo(() => {
    const m = new Map<string, Product>();
    products.forEach((p) => m.set(p.asin.toUpperCase(), p));
    return m;
  }, [products]);

  const suggestAsins = useMemo(
    () =>
      [...products]
        .sort((a, b) => b.monthlySales - a.monthlySales)
        .slice(0, 12)
        .map((p) => p.asin),
    [products]
  );

  const addAsins = (raw: string | string[]) => {
    const list = Array.isArray(raw) ? raw : parseAsinList(raw);
    if (!list.length) {
      toast.error('请输入有效 ASIN');
      return;
    }
    setSelected((prev) => {
      const next = [...prev];
      for (const a of list) {
        if (next.includes(a)) continue;
        if (next.length >= MAX_ASINS) {
          toast.warning(`最多对比 ${MAX_ASINS} 个 ASIN`);
          break;
        }
        next.push(a);
      }
      return next;
    });
    setAsinInput('');
  };

  const removeAsin = (asin: string) => {
    setSelected((prev) => prev.filter((a) => a !== asin));
    setPacks((prev) => {
      const next = { ...prev };
      const pack = next[asin];
      if (pack) pack.mainPreviewUrls.forEach((u) => URL.revokeObjectURL(u));
      delete next[asin];
      return next;
    });
  };

  const handleZipUpload = async (asin: string, file: File | null) => {
    if (!file) return;
    setParsingAsin(asin);
    try {
      const { competitor: parsed, warnings } = await parseSingleCompetitorZip(file, asin);
      const previews: string[] = [];
      for (const img of parsed.mainImages.slice(0, 8)) {
        previews.push(URL.createObjectURL(img.blob));
      }
      setPacks((prev) => {
        const old = prev[asin];
        if (old) old.mainPreviewUrls.forEach((u) => URL.revokeObjectURL(u));
        return {
          ...prev,
          [asin]: {
            zipName: file.name,
            mainPreviewUrls: previews,
            aplusCount: parsed.aplusImages.length,
            bulletPoints: parsed.bulletPoints,
          },
        };
      });
      toast.success(
        `${asin} 图包已导入：主图 ${parsed.mainImages.length} · A+ ${parsed.aplusImages.length}`
      );
      if (warnings[0]) toast.warning(warnings[0], { duration: 4000 });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '图包解析失败');
    } finally {
      setParsingAsin(null);
      const input = fileRefs.current[asin];
      if (input) input.value = '';
    }
  };

  const clearPack = (asin: string) => {
    setPacks((prev) => {
      const next = { ...prev };
      const pack = next[asin];
      if (pack) pack.mainPreviewUrls.forEach((u) => URL.revokeObjectURL(u));
      delete next[asin];
      return next;
    });
  };

  const runCompare = async () => {
    if (selected.length < 1) {
      toast.error('请先选择至少 1 个 ASIN');
      return;
    }
    setLoading(true);
    setProgress('开始对比分析…');
    setHasResult(false);
    try {
      const detailList: AsinDetailSnapshot[] = [];
      const trafficList: TrafficStatSnapshot[] = [];
      const kwMap: Record<string, Keyword[]> = {};
      const matrixList: ParentMatrixSnapshot[] = [];
      const brandParentList: BrandParentItem[][] = [];

      for (let i = 0; i < selected.length; i++) {
        const asin = selected[i];
        setProgress(`(${i + 1}/${selected.length}) 抓取 ${asin} 详情页信息…`);
        try {
          detailList.push(await fetchAsinDetailFromMcp(asin, marketplace));
        } catch (e) {
          toast.warning(`${asin} Listing 拉取失败：${e instanceof Error ? e.message : ''}`);
        }

        setProgress(`(${i + 1}/${selected.length}) 抓取 ${asin} 流量结构…`);
        try {
          trafficList.push(await fetchTrafficStatFromMcp(asin, marketplace));
        } catch (e) {
          toast.warning(`${asin} 流量拉取失败：${e instanceof Error ? e.message : ''}`);
        }

        setProgress(`(${i + 1}/${selected.length}) 抓取 ${asin} 核心流量词…`);
        try {
          const kws = await fetchKeywordsFromMcp({ asin, marketplace, maxPages: 1, pageSize: 20 });
          kwMap[asin] = kws.slice(0, 15);
        } catch {
          kwMap[asin] = [];
        }

        setProgress(`(${i + 1}/${selected.length}) 解析 ${asin} 父体变体矩阵…`);
        try {
          matrixList.push(
            await fetchParentMatrixFromMcp(asin, marketplace, (msg) =>
              setProgress(`(${i + 1}/${selected.length}) ${msg}`)
            )
          );
        } catch (e) {
          toast.warning(`${asin} 父体结构拉取失败：${e instanceof Error ? e.message : ''}`);
        }
      }

      // 品牌下其他父体（按品牌去重后搜一次）
      const doneBrands = new Set<string>();
      for (let i = 0; i < detailList.length; i++) {
        const d = detailList[i];
        const b = (d.brand || '').trim();
        if (!b || doneBrands.has(b.toLowerCase())) {
          brandParentList.push([]);
          continue;
        }
        doneBrands.add(b.toLowerCase());
        const excludeParents = new Set<string>();
        detailList.forEach((x) => {
          if (x.parentAsin) excludeParents.add(x.parentAsin);
          excludeParents.add(x.asin);
        });
        setProgress(`搜索品牌「${b}」下其他父体链接…`);
        try {
          brandParentList.push(
            await fetchBrandParentsFromMcp(b, marketplace, [...excludeParents], (msg) => setProgress(msg))
          );
        } catch {
          brandParentList.push([]);
        }
      }

      setDetails(detailList);
      setTrafficStats(trafficList);
      setTopKeywords(kwMap);
      setMatrices(matrixList);
      setBrandParents(brandParentList);
      setHasResult(true);
      setStep(3);
      setResultTab('listing');
      toast.success(`对比分析完成（${detailList.length}/${selected.length} 个 ASIN）`);
    } finally {
      setLoading(false);
      setProgress('');
    }
  };

  const stepItems = [
    { n: 1 as const, label: '选竞品 ASIN' },
    { n: 2 as const, label: '上传图包（可选）' },
    { n: 3 as const, label: '对比结果' },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-[24px] font-bold text-[#1d1d1f] tracking-tight flex items-center gap-2">
          <Crosshair className="w-6 h-6 text-indigo-600" />
          竞品分析
        </h2>
        <p className="text-[#86868b] text-sm mt-1">
          先选 ASIN → 可选手传图包 → 一键对比。Listing 按买家进详情页的浏览顺序展示；产品矩阵看各品牌父体下的子体链接。
        </p>
      </div>

      {/* 步骤条 */}
      <div className="flex items-center gap-2 flex-wrap">
        {stepItems.map((s, i) => (
          <React.Fragment key={s.n}>
            {i > 0 && <ChevronRight className="w-4 h-4 text-[#d2d2d7]" />}
            <button
              type="button"
              onClick={() => {
                if (s.n === 3 && !hasResult) return;
                setStep(s.n);
              }}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                step === s.n
                  ? 'bg-indigo-600 text-white'
                  : s.n === 3 && !hasResult
                    ? 'bg-[#f5f5f7] text-[#c7c7cc] cursor-not-allowed'
                    : 'bg-[#f5f5f7] text-[#86868b] hover:text-[#1d1d1f]'
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-black/10 flex items-center justify-center text-xs">
                {s.n}
              </span>
              {s.label}
            </button>
          </React.Fragment>
        ))}
      </div>

      {/* Step 1 */}
      {step === 1 && (
        <Card className="border-none shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">① 选择要对比的竞品 ASIN</CardTitle>
            <CardDescription>建议 2–{MAX_ASINS} 个。可从大盘勾选带入，或手动粘贴。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2 items-center">
              <select
                value={marketplace}
                onChange={(e) => setMarketplace(normalizeMarketplaceCode(e.target.value))}
                className="border border-black/10 rounded-xl px-3 py-2 text-sm bg-white"
              >
                {SELLERSPRITE_MARKETPLACES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <input
                value={asinInput}
                onChange={(e) => setAsinInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addAsins(asinInput); }}
                placeholder="输入 ASIN，回车添加"
                className="flex-1 min-w-[180px] border border-black/10 rounded-xl px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => addAsins(asinInput)}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold"
              >
                <Plus className="w-4 h-4" /> 添加
              </button>
              {suggestAsins.length > 0 && (
                <button
                  type="button"
                  onClick={() => addAsins(suggestAsins.slice(0, 3))}
                  className="px-3 py-2 rounded-xl border border-black/10 text-sm text-[#86868b] hover:text-indigo-600"
                >
                  填入销量 Top3
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-2 min-h-[40px]">
              {selected.length === 0 ? (
                <span className="text-xs text-[#86868b]">尚未选择 ASIN</span>
              ) : (
                selected.map((a) => {
                  const p = productMap.get(a);
                  return (
                    <span
                      key={a}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-indigo-50 text-indigo-800 text-xs font-medium border border-indigo-100"
                    >
                      {p?.image ? (
                        <img src={p.image} alt="" className="w-5 h-5 rounded object-cover" />
                      ) : null}
                      {a}
                      {p?.brand ? <span className="text-indigo-500/80">· {p.brand}</span> : null}
                      <button type="button" onClick={() => removeAsin(a)} className="hover:text-rose-600">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })
              )}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                disabled={selected.length === 0}
                onClick={() => setStep(2)}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-40"
              >
                下一步：上传图包 <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2 */}
      {step === 2 && (
        <Card className="border-none shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">② 上传 Listing 图包（可选）</CardTitle>
            <CardDescription>
              有图包的 ASIN 会在 Listing 对比里展示你上传的主图；没有也可以直接点「对比分析」，数据一律从 MCP 抓。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {selected.map((asin) => {
                const pack = packs[asin];
                const p = productMap.get(asin);
                return (
                  <div key={asin} className="rounded-2xl border border-black/10 bg-white p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-mono text-sm font-semibold text-[#1d1d1f]">{asin}</div>
                        <div className="text-xs text-[#86868b] mt-0.5 truncate max-w-[180px]">
                          {p?.brand || '等待 MCP 补品牌'}
                        </div>
                      </div>
                      {pack && (
                        <button type="button" onClick={() => clearPack(asin)} className="text-xs text-rose-600">
                          清除
                        </button>
                      )}
                    </div>

                    {pack ? (
                      <div className="space-y-2">
                        <div className="flex gap-1.5 overflow-x-auto">
                          {pack.mainPreviewUrls.slice(0, 4).map((url, i) => (
                            <img key={url} src={url} alt="" className="w-14 h-14 rounded-lg object-cover border border-black/5 shrink-0" />
                          ))}
                        </div>
                        <p className="text-[11px] text-emerald-700">
                          已导入 {pack.zipName} · 主图预览 {pack.mainPreviewUrls.length}
                          {pack.aplusCount ? ` · A+ ${pack.aplusCount}` : ''}
                        </p>
                      </div>
                    ) : (
                      <label className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-black/15 bg-[#fafafa] py-6 cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors">
                        <input
                          ref={(el) => { fileRefs.current[asin] = el; }}
                          type="file"
                          accept=".zip,application/zip"
                          className="hidden"
                          onChange={(e) => handleZipUpload(asin, e.target.files?.[0] || null)}
                        />
                        {parsingAsin === asin ? (
                          <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
                        ) : (
                          <Upload className="w-5 h-5 text-[#86868b]" />
                        )}
                        <span className="text-xs text-[#86868b]">
                          {parsingAsin === asin ? '解析中…' : '点击上传 ZIP（可跳过）'}
                        </span>
                      </label>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex justify-between gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="inline-flex items-center gap-1 px-4 py-2 rounded-xl border border-black/10 text-sm text-[#86868b]"
              >
                <ChevronLeft className="w-4 h-4" /> 上一步
              </button>
              <button
                type="button"
                onClick={runCompare}
                disabled={loading || selected.length === 0}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                对比分析
              </button>
            </div>
            {progress && (
              <div className="text-xs text-violet-700 bg-violet-50 rounded-lg px-3 py-2">{progress}</div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 3 Results */}
      {step === 3 && (
        <div className="space-y-4">
          {!hasResult ? (
            <EmptyHint text="还没有结果。请回到上一步点「对比分析」。" />
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex gap-1 bg-[#f5f5f7] p-1 rounded-2xl w-fit flex-wrap">
                  {([
                    { id: 'listing' as const, label: 'Listing 详情页', icon: <ImageIcon className="w-4 h-4" /> },
                    { id: 'traffic' as const, label: '流量', icon: <Activity className="w-4 h-4" /> },
                    { id: 'matrix' as const, label: '产品矩阵（父体）', icon: <Grid3X3 className="w-4 h-4" /> },
                  ]).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setResultTab(t.id)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                        resultTab === t.id ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#86868b] hover:text-[#1d1d1f]'
                      }`}
                    >
                      {t.icon}
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="px-3 py-2 rounded-xl border border-black/10 text-sm text-[#86868b]"
                  >
                    返回改图包
                  </button>
                  <button
                    type="button"
                    onClick={runCompare}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    重新对比
                  </button>
                </div>
              </div>
              {progress && (
                <div className="text-xs text-violet-700 bg-violet-50 rounded-lg px-3 py-2">{progress}</div>
              )}

              {resultTab === 'listing' && (
                <ListingBuyerView details={details} packs={packs} marketplace={marketplace} />
              )}
              {resultTab === 'traffic' && (
                <TrafficView selected={selected} trafficStats={trafficStats} topKeywords={topKeywords} />
              )}
              {resultTab === 'matrix' && <ParentMatrixView matrices={matrices} brandParents={brandParents} />}
            </>
          )}
        </div>
      )}
    </div>
  );
};

/** Listing：按买家进详情页的浏览顺序并排展示 */
function ListingBuyerView({
  details,
  packs,
  marketplace,
}: {
  details: AsinDetailSnapshot[];
  packs: Record<string, AsinPack>;
  marketplace: string;
}) {
  if (!details.length) {
    return <EmptyHint text="暂无 Listing 数据。请检查 MCP 密钥后重新对比。" />;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-[#86868b]">
        下面按亚马逊买家打开详情页时的大致视线顺序排列：主图 → 标题 → 品牌/评分 → 价格与徽章 → 规格选择 → 五点 → 配送卖家。左右并排方便对照「第一眼差在哪」。
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {details.map((d) => {
          const pack = packs[d.asin];
          const gallery =
            pack?.mainPreviewUrls?.length
              ? pack.mainPreviewUrls
              : d.zoomImageUrl || d.imageUrl
                ? [d.zoomImageUrl || d.imageUrl]
                : [];
          const bullets =
            pack?.bulletPoints?.trim()
              ? pack.bulletPoints.split(/\n+/).map((s) => s.replace(/^[\d.\-•\s]+/, '').trim()).filter(Boolean)
              : d.features;

          return (
            <article
              key={d.asin}
              className="rounded-2xl border border-black/10 bg-white overflow-hidden shadow-sm flex flex-col"
            >
              {/* ① 主图区 */}
              <div className="bg-[#fafafa] border-b border-black/5 p-3">
                <div className="text-[10px] uppercase tracking-wider text-[#86868b] mb-2">① 买家先看主图</div>
                {gallery.length > 0 ? (
                  <div className="space-y-2">
                    <img
                      src={gallery[0]}
                      alt={d.title}
                      className="w-full aspect-square max-h-56 object-contain bg-white rounded-xl border border-black/5"
                    />
                    {gallery.length > 1 && (
                      <div className="flex gap-1.5 overflow-x-auto">
                        {gallery.slice(0, 6).map((url, i) => (
                          <img
                            key={`${d.asin}-g-${i}`}
                            src={url}
                            alt=""
                            className={`w-12 h-12 rounded-lg object-cover border shrink-0 ${i === 0 ? 'border-indigo-400' : 'border-black/10'}`}
                          />
                        ))}
                      </div>
                    )}
                    {!pack && (
                      <p className="text-[10px] text-[#86868b]">未上传图包，仅显示 MCP 主图；上传 ZIP 可看更多主图位</p>
                    )}
                  </div>
                ) : (
                  <div className="aspect-square max-h-40 flex items-center justify-center text-xs text-[#86868b] bg-white rounded-xl border border-dashed border-black/10">
                    暂无图片
                  </div>
                )}
              </div>

              <div className="p-4 space-y-3 flex-1">
                {/* ② 标题 */}
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[#86868b] mb-1">② 标题</div>
                  <h3 className="text-sm font-medium text-[#1d1d1f] leading-snug line-clamp-4">
                    {d.title || '（无标题）'}
                  </h3>
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[11px] text-[#86868b]">{d.asin}</span>
                    {d.asinUrl && (
                      <a
                        href={d.asinUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-[11px] text-indigo-600 hover:underline"
                      >
                        打开亚马逊页 <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>

                {/* ③ 品牌 + 评分 */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[#86868b]">③ 品牌</div>
                    <div className="text-sm font-semibold text-[#0f60c5]">{d.brand || '-'}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-[#86868b]">评分与评论</div>
                    <div className="flex items-center gap-1 justify-end text-sm">
                      <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                      <span className="font-semibold">{starsLabel(d.rating)}</span>
                      <span className="text-[#86868b] text-xs">({fmtNum(d.ratings)})</span>
                    </div>
                  </div>
                </div>

                {/* ④ 价格 + 徽章 */}
                <div className="rounded-xl bg-[#f5f5f7] px-3 py-2.5 space-y-2">
                  <div className="text-[10px] uppercase tracking-wider text-[#86868b]">④ 价格与运营徽章</div>
                  <div className="text-2xl font-bold text-[#1d1d1f]">
                    {d.price ? `$${d.price.toFixed(2)}` : '价格未知'}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {badgeYes(d.badge.amazonChoice) && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-[#232f3e] text-white">Amazon&apos;s Choice</span>
                    )}
                    {badgeYes(d.badge.bestSeller) && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-[#e67a00] text-white">Best Seller</span>
                    )}
                    {badgeYes(d.badge.newRelease) && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-[#067d62] text-white">New Release</span>
                    )}
                    {badgeYes(d.badge.ebc) && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-100 text-indigo-800">有 A+ / EBC</span>
                    )}
                    {badgeYes(d.badge.video) && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-rose-100 text-rose-800">有视频</span>
                    )}
                    {!badgeYes(d.badge.amazonChoice) &&
                      !badgeYes(d.badge.bestSeller) &&
                      !badgeYes(d.badge.ebc) &&
                      !badgeYes(d.badge.video) && (
                        <span className="text-[10px] text-[#86868b]">无明显徽章</span>
                      )}
                  </div>
                  {d.lqs > 0 && (
                    <div className="text-[11px] text-[#86868b]">Listing 质量分 LQS：{d.lqs}</div>
                  )}
                </div>

                {/* ⑤ 规格选择 */}
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[#86868b] mb-1.5">
                    ⑤ 规格选择（买家会点的变体）
                  </div>
                  {d.skuList.length || d.variationList.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {(d.skuList.length ? d.skuList : d.variationList.map((v) => v.attribute).filter(Boolean))
                        .slice(0, 8)
                        .map((sku) => (
                          <span
                            key={sku}
                            className="text-[11px] px-2 py-1 rounded-lg border border-[#ff9900]/60 bg-[#fff8f0] text-[#1d1d1f]"
                          >
                            {sku}
                          </span>
                        ))}
                      {d.variationCount > 1 && (
                        <span className="text-[11px] text-[#86868b] self-center">
                          共 {d.variationCount} 个子体
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-[#86868b]">未见变体信息（可能是单规格链接）</p>
                  )}
                </div>

                {/* ⑥ 五点 */}
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[#86868b] mb-1.5">
                    ⑥ About this item（五点）
                  </div>
                  {bullets.length ? (
                    <ul className="space-y-1.5">
                      {bullets.slice(0, 5).map((b, i) => (
                        <li key={i} className="text-xs text-[#1d1d1f] leading-relaxed flex gap-1.5">
                          <span className="text-[#86868b] shrink-0">•</span>
                          <span className="line-clamp-3">{b}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-[#86868b]">暂无五点文案</p>
                  )}
                </div>

                {/* ⑦ 配送 / 类目 */}
                <div className="pt-2 border-t border-black/5 grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <div className="text-[#86868b]">⑦ 配送</div>
                    <div className="font-medium text-[#1d1d1f]">{d.fulfillment || '-'}</div>
                    <div className="text-[#86868b] truncate">{d.sellerName || `${d.sellers || 0} 卖家`}</div>
                  </div>
                  <div>
                    <div className="text-[#86868b]">类目 / BSR</div>
                    <div className="font-medium text-[#1d1d1f] truncate" title={d.categoryPath}>
                      {d.bsrRank ? `#${fmtNum(d.bsrRank)}` : '-'}
                      {d.bsrLabel ? ` · ${d.bsrLabel}` : ''}
                    </div>
                    <div className="text-[#86868b] line-clamp-2" title={d.categoryPath}>
                      {d.categoryPath || '-'}
                    </div>
                  </div>
                </div>

                {(d.dimensions || d.weight) && (
                  <div className="text-[11px] text-[#86868b] flex items-center gap-1">
                    <Package className="w-3 h-3" />
                    {[d.dimensions, d.weight].filter(Boolean).join(' · ')}
                  </div>
                )}

                <div className="text-[10px] text-[#c7c7cc]">站点 {marketplace}</div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function TrafficView({
  selected,
  trafficStats,
  topKeywords,
}: {
  selected: string[];
  trafficStats: TrafficStatSnapshot[];
  topKeywords: Record<string, Keyword[]>;
}) {
  if (!trafficStats.length) {
    return <EmptyHint text="暂无流量数据。请检查 MCP 后重新对比。" />;
  }
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">流量结构对比</CardTitle>
          <CardDescription>流量词总量 · 有排名词 · 广告词（广告依赖度 = 广告词 / 流量词）</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-xs text-[#86868b] border-b border-black/5">
                <th className="py-2 pr-3">ASIN</th>
                <th className="py-2 pr-3">流量词</th>
                <th className="py-2 pr-3">有排名词</th>
                <th className="py-2 pr-3">广告词</th>
                <th className="py-2">广告依赖度</th>
              </tr>
            </thead>
            <tbody>
              {trafficStats.map((t) => {
                const dep = t.keywords > 0 ? (t.ads / t.keywords) * 100 : 0;
                return (
                  <tr key={t.asin} className="border-b border-black/5">
                    <td className="py-2 pr-3 font-mono text-xs">{t.asin}</td>
                    <td className="py-2 pr-3 font-semibold">{fmtNum(t.keywords)}</td>
                    <td className="py-2 pr-3">{fmtNum(t.ranks)}</td>
                    <td className="py-2 pr-3">{fmtNum(t.ads)}</td>
                    <td className="py-2">
                      <span className={dep >= 40 ? 'text-amber-600 font-semibold' : 'text-emerald-600'}>
                        {dep.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {selected.map((asin) => (
          <Card key={asin}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">{asin} · Top 流量词</CardTitle>
            </CardHeader>
            <CardContent>
              {(topKeywords[asin] || []).length === 0 ? (
                <p className="text-xs text-[#86868b]">暂无词数据</p>
              ) : (
                <ul className="space-y-1.5">
                  {(topKeywords[asin] || []).slice(0, 10).map((k) => (
                    <li key={k.id} className="flex justify-between gap-2 text-xs">
                      <span className="text-[#1d1d1f] truncate">{k.keyword}</span>
                      <span className="text-[#86868b] shrink-0">
                        周搜 {fmtNum(k.weeklySearchVolume)} · CPC {k.cpcBid.toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ParentMatrixView({
  matrices,
  brandParents,
}: {
  matrices: ParentMatrixSnapshot[];
  brandParents: BrandParentItem[][];
}) {
  return (
    <div className="space-y-6">
      {/* 板块一：父体结构 */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-[#1d1d1f] flex items-center gap-2">
          <Grid3X3 className="w-4 h-4 text-indigo-600" />
          父体结构（你选的 ASIN 所属链接下有哪些子体）
        </h3>
        {!matrices.length ? (
          <EmptyHint text="暂无父体数据。请检查 MCP 后重新对比。" />
        ) : (
          matrices.map((m) => {
            const prices = m.children.map((c) => c.price).filter((p) => p > 0);
            const priceMin = prices.length ? Math.min(...prices) : 0;
            const priceMax = prices.length ? Math.max(...prices) : 0;
            return (
              <Card key={m.anchorAsin}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                    <span>{m.brand || '未知品牌'}</span>
                    <span className="text-xs font-normal text-[#86868b]">锚点 {m.anchorAsin}</span>
                  </CardTitle>
                  <CardDescription>
                    父体 ASIN：<span className="font-mono text-[#1d1d1f]">{m.parentAsin || '-'}</span>
                    {' · '}子体数 {m.variationCount || m.children.length}
                    {priceMin > 0 && (
                      <>
                        {' · '}价格带 ${priceMin.toFixed(2)}
                        {priceMax !== priceMin ? ` – $${priceMax.toFixed(2)}` : ''}
                      </>
                    )}
                    {m.anchorSku ? ` · 当前规格「${m.anchorSku}」` : ''}
                  </CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead>
                      <tr className="text-left text-xs text-[#86868b] border-b border-black/5">
                        <th className="py-2 pr-2">子体 ASIN</th>
                        <th className="py-2 pr-2">规格 / 属性</th>
                        <th className="py-2 pr-2">价格</th>
                        <th className="py-2 pr-2">评分</th>
                        <th className="py-2 pr-2">评论数</th>
                        <th className="py-2">角色</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.children.map((c) => (
                        <tr
                          key={c.asin}
                          className={`border-b border-black/5 ${c.isAnchor ? 'bg-indigo-50/60 font-semibold' : ''}`}
                        >
                          <td className="py-2 pr-2 font-mono text-xs">
                            <div className="flex items-center gap-2">
                              {c.imageUrl ? (
                                <img src={c.imageUrl} alt="" className="w-8 h-8 rounded object-cover border border-black/5" />
                              ) : null}
                              {c.asin}
                            </div>
                          </td>
                          <td className="py-2 pr-2 text-xs">{c.attribute || '-'}</td>
                          <td className="py-2 pr-2">{c.price ? `$${c.price.toFixed(2)}` : '-'}</td>
                          <td className="py-2 pr-2">{c.rating || '-'}</td>
                          <td className="py-2 pr-2">{fmtNum(c.ratings)}</td>
                          <td className="py-2 text-xs">
                            {c.isAnchor ? (
                              <span className="text-indigo-700">当前对比子体</span>
                            ) : (
                              <span className="text-[#86868b]">同父体变体</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* 板块二：品牌下其他父体 */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-[#1d1d1f] flex items-center gap-2">
          <Package className="w-4 h-4 text-violet-600" />
          品牌下其他父体链接（同品牌还在卖哪些产品线）
        </h3>
        {!brandParents.length || brandParents.every((arr) => !arr.length) ? (
          <EmptyHint text="暂无品牌其他父体数据。可能是该品牌只有当前对比的产品，或者 MCP 搜索没返回结果。" />
        ) : (
          brandParents.map((items, idx) => {
            if (!items.length) return null;
            const brand = items[0]?.title ? matrices[idx]?.brand || '未知品牌' : '未知品牌';
            return (
              <Card key={idx}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">品牌：{brand}</CardTitle>
                  <CardDescription>
                    除当前对比 ASIN 的父体之外，该品牌还有 {items.length} 个父体链接在售
                  </CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead>
                      <tr className="text-left text-xs text-[#86868b] border-b border-black/5">
                        <th className="py-2 pr-2">父体 ASIN</th>
                        <th className="py-2 pr-2">标题</th>
                        <th className="py-2 pr-2">价格</th>
                        <th className="py-2 pr-2">评分</th>
                        <th className="py-2 pr-2">评论</th>
                        <th className="py-2">月销量</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.asin} className="border-b border-black/5">
                          <td className="py-2 pr-2 font-mono text-xs">
                            <div className="flex items-center gap-2">
                              {item.imageUrl ? (
                                <img src={item.imageUrl} alt="" className="w-8 h-8 rounded object-cover border border-black/5" />
                              ) : null}
                              {item.asin}
                            </div>
                          </td>
                          <td className="py-2 pr-2 text-xs max-w-[240px] truncate" title={item.title}>
                            {item.title || '-'}
                          </td>
                          <td className="py-2 pr-2">{item.price ? `$${item.price.toFixed(2)}` : '-'}</td>
                          <td className="py-2 pr-2">{item.rating || '-'}</td>
                          <td className="py-2 pr-2">{fmtNum(item.ratings)}</td>
                          <td className="py-2 font-semibold">{fmtNum(item.monthlySales)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-black/10 bg-white p-10 text-center text-sm text-[#86868b]">
      {text}
    </div>
  );
}
