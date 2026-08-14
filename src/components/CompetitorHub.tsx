import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Crosshair, Loader2, Image as ImageIcon, Activity, Grid3X3, Plus, X, Upload,
  ChevronRight, ChevronLeft, ChevronUp, ChevronDown, Star, Package, ExternalLink, RefreshCw, Sparkles, HelpCircle, Trash2,
  History, Save,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import { SecondaryReportPage } from './SecondaryReportPage';
import {
  SELLERSPRITE_MARKETPLACES,
  normalizeMarketplaceCode,
  parseAsinList,
  fetchAsinDetailFromMcp,
  fetchTrafficStatFromMcp,
  fetchTrafficKeywordsDetailedFromMcp,
  fetchParentMatrixFromMcp,
  type AsinDetailSnapshot,
  type TrafficStatSnapshot,
  type ParentMatrixSnapshot,
  type TrafficKeywordDetail,
} from '../utils/sellerspriteApi';
import { parseSingleCompetitorZip } from '../utils/competitorArchiveParser';
import type { Product } from '../utils/parser';
import type { CompetitorDemoSnapshot } from '../utils/demoData';
import { loadAiSettings, generateText } from '../utils/aiConfig';
import { getPrompt } from './AiPromptManager';
import { toast } from 'sonner';
import { Select } from './ui/Select';
import {
  listCompetitorHistoryMeta,
  saveCompetitorSnapshot,
  loadCompetitorSnapshot,
  deleteCompetitorSnapshot,
  suggestCompetitorSnapshotTitle,
  type CompetitorHistoryMeta,
} from '../utils/competitorHistory';
import { FeishuPushButton } from './FeishuPushButton';
import { competitorReportToMarkdown } from '../utils/reportToMarkdown';

type WizardStep = 1 | 2 | 3;
type ResultTab = 'listing' | 'traffic' | 'matrix';

interface CompetitorHubProps {
  products: Product[];
  marketplaceCode?: string;
  domain?: string;
  preselectedAsins?: string[];
  /** 示例模式：直接展示真实竞品对比结果（无需再点「开始对比」） */
  demoSnapshot?: CompetitorDemoSnapshot | null;
  /** 登录用户 id；游客用 guest，用于本机历史隔离 */
  userId?: string;
}

interface AsinPack {
  zipName: string;
  /** 附图/副图预览；主图对比永远用 MCP，不受图包影响 */
  secondaryPreviewUrls: string[];
  /** A+ 模块图预览 */
  aplusPreviewUrls: string[];
  bulletPoints: string;
}

function revokePackUrls(pack?: AsinPack | null) {
  if (!pack) return;
  [...pack.secondaryPreviewUrls, ...pack.aplusPreviewUrls].forEach((u) => {
    if (u.startsWith('blob:')) URL.revokeObjectURL(u);
  });
}

async function blobsToPreviewUrls(images: { blob: Blob }[], limit = 24): Promise<string[]> {
  const urls: string[] = [];
  for (const img of images.slice(0, limit)) {
    urls.push(URL.createObjectURL(img.blob));
  }
  return urls;
}

interface BrandSiblingRow {
  brand: string;
  items: Product[];
  currentParentAsin: string;
  anchorAsin: string;
}

const MAX_ASINS = 5;

function fmtNum(n: number, digits = 0): string {
  if (!Number.isFinite(n) || n === 0) return '-';
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtPct(ratio: number, digits = 1): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return '-';
  return `${(ratio * 100).toFixed(digits)}%`;
}

function badgeYes(v: string | undefined): boolean {
  return String(v || '').toUpperCase() === 'Y';
}

function starsLabel(rating: number): string {
  if (!rating) return '暂无评分';
  return `${rating.toFixed(1)} ★`;
}

/** 用 fixed + portal，避免表格 overflow 把气泡裁掉 */
function Tip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const place = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = 224;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const top = r.bottom + 6;
    setPos({ top, left });
    setOpen(true);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={text}
        aria-label={text}
        className="inline-flex align-middle ml-0.5 text-[#c7c7cc] hover:text-indigo-600 focus:outline-none focus-visible:text-indigo-600"
        onMouseEnter={place}
        onMouseLeave={() => setOpen(false)}
        onFocus={place}
        onBlur={() => setOpen(false)}
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>
      {open &&
        createPortal(
          <div
            role="tooltip"
            className="fixed z-[9999] w-56 rounded-lg bg-[#1d1d1f] text-white text-[11px] leading-relaxed px-2.5 py-2 shadow-lg pointer-events-none"
            style={{ top: pos.top, left: pos.left }}
          >
            {text}
          </div>,
          document.body
        )}
    </>
  );
}

function stripHtmlFence(raw: string): string {
  let html = raw.replace(/^```html?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
  if (!html.startsWith('<')) {
    const start = html.search(/<(div|section|article|table|h[1-6]|p|ul|ol)/i);
    if (start >= 0) html = html.slice(start);
  }
  return html;
}

function fmtOrganic(k: TrafficKeywordDetail): string {
  if (!k.organicPage && !k.organicPosition) return '-';
  const page = k.organicPage ? `第${k.organicPage}页` : '';
  const pos = k.organicPosition ? `总第${k.organicPosition}位` : '';
  return [page, pos].filter(Boolean).join(' · ');
}

function fmtAd(k: TrafficKeywordDetail): string {
  if (!k.adPage && !k.adPosition) return '-';
  const page = k.adPage ? `第${k.adPage}页` : '';
  const slot = k.adIndex ? `第${k.adIndex}位` : k.adPosition ? `总第${k.adPosition}位` : '';
  return [page, slot].filter(Boolean).join(' · ');
}

/** 从大盘产品列表提取同品牌其他链接（排除当前父体下已知子体） */
function extractBrandSiblingsFromProducts(
  products: Product[],
  details: AsinDetailSnapshot[],
  matrices: ParentMatrixSnapshot[]
): BrandSiblingRow[] {
  const rows: BrandSiblingRow[] = [];
  const seenBrand = new Set<string>();

  for (const d of details) {
    const brand = (d.brand || '').trim();
    if (!brand) continue;
    const key = brand.toLowerCase();
    if (seenBrand.has(key)) continue;
    seenBrand.add(key);

    const matrix = matrices.find((m) => m.anchorAsin === d.asin);
    const exclude = new Set<string>();
    exclude.add(d.asin);
    if (d.parentAsin) exclude.add(d.parentAsin);
    (matrix?.children || d.variationList || []).forEach((c) => exclude.add(c.asin));

    const siblings = products.filter(
      (p) =>
        p.brand.trim().toLowerCase() === key &&
        !exclude.has(p.asin.toUpperCase())
    );
    // 按月销量去重（同 asin）
    const map = new Map<string, Product>();
    siblings.forEach((p) => {
      const a = p.asin.toUpperCase();
      if (!map.has(a)) map.set(a, p);
    });
    const items = [...map.values()].sort((a, b) => b.monthlySales - a.monthlySales);
    rows.push({
      brand,
      items,
      currentParentAsin: d.parentAsin || d.asin,
      anchorAsin: d.asin,
    });
  }
  return rows;
}

export const CompetitorHub: React.FC<CompetitorHubProps> = ({
  products,
  marketplaceCode = 'US',
  preselectedAsins = [],
  demoSnapshot = null,
  userId = 'guest',
}) => {
  const historyUserId = userId || 'guest';
  const [step, setStep] = useState<WizardStep>(1);
  const [asinInput, setAsinInput] = useState('');
  const [selected, setSelected] = useState<string[]>(() =>
    (demoSnapshot?.selectedAsins?.length
      ? demoSnapshot.selectedAsins
      : preselectedAsins
    )
      .slice(0, MAX_ASINS)
      .map((a) => a.toUpperCase())
  );
  const [marketplace, setMarketplace] = useState(normalizeMarketplaceCode(marketplaceCode));
  const [packs, setPacks] = useState<Record<string, AsinPack>>(() => {
    if (!demoSnapshot?.packs) return {};
    const next: Record<string, AsinPack> = {};
    for (const [asin, pack] of Object.entries(demoSnapshot.packs)) {
      next[asin.toUpperCase()] = {
        zipName: pack.zipName,
        secondaryPreviewUrls: [...(pack.secondaryPreviewUrls || [])],
        aplusPreviewUrls: [...(pack.aplusPreviewUrls || [])],
        bulletPoints: pack.bulletPoints,
      };
    }
    return next;
  });
  const [parsingAsin, setParsingAsin] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [hasResult, setHasResult] = useState(() => Boolean(demoSnapshot?.details?.length));
  const [resultTab, setResultTab] = useState<ResultTab>('listing');

  const [details, setDetails] = useState<AsinDetailSnapshot[]>(() => demoSnapshot?.details ?? []);
  const [trafficStats, setTrafficStats] = useState<TrafficStatSnapshot[]>([]);
  const [topKeywords, setTopKeywords] = useState<Record<string, TrafficKeywordDetail[]>>({});
  const [matrices, setMatrices] = useState<ParentMatrixSnapshot[]>([]);
  const [brandSiblings, setBrandSiblings] = useState<BrandSiblingRow[]>([]);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiReportHtml, setAiReportHtml] = useState(() => demoSnapshot?.aiReportHtml ?? '');
  const [aiReportOpen, setAiReportOpen] = useState(false);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyList, setHistoryList] = useState<CompetitorHistoryMeta[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [savingHistory, setSavingHistory] = useState(false);

  const refreshHistoryList = async () => {
    try {
      const items = await listCompetitorHistoryMeta(historyUserId);
      setHistoryList(items);
    } catch (e) {
      console.error('listCompetitorHistoryMeta', e);
    }
  };

  useEffect(() => {
    void refreshHistoryList();
  }, [historyUserId]);

  const handleSaveHistory = async () => {
    if (!hasResult || !details.length) {
      toast.error('请先完成对比分析再保存');
      return;
    }
    setSavingHistory(true);
    try {
      const res = await saveCompetitorSnapshot(historyUserId, {
        title: suggestCompetitorSnapshotTitle(marketplace, selected),
        marketplace,
        selected,
        details,
        trafficStats,
        topKeywords,
        matrices,
        aiReportHtml,
        packs,
      });
      if (res.ok === false) {
        toast.error(res.error || '保存失败');
        return;
      }
      toast.success(`已保存：${res.meta.title}`);
      await refreshHistoryList();
    } finally {
      setSavingHistory(false);
    }
  };

  const handleLoadHistory = async (id: string) => {
    setHistoryLoading(true);
    try {
      const snap = await loadCompetitorSnapshot(historyUserId, id);
      if (!snap) {
        toast.error('找不到该历史记录');
        return;
      }
      setMarketplace(normalizeMarketplaceCode(snap.marketplace));
      setSelected(snap.selected.map((a) => a.toUpperCase()));
      setDetails(snap.details || []);
      setTrafficStats(snap.trafficStats || []);
      setTopKeywords(snap.topKeywords || {});
      setMatrices(snap.matrices || []);
      setAiReportHtml(snap.aiReportHtml || '');
      const nextPacks: Record<string, AsinPack> = {};
      for (const [asin, pack] of Object.entries(snap.packs || {})) {
        nextPacks[asin.toUpperCase()] = {
          zipName: pack.zipName,
          secondaryPreviewUrls: [...(pack.secondaryPreviewUrls || [])],
          aplusPreviewUrls: [...(pack.aplusPreviewUrls || [])],
          bulletPoints: pack.bulletPoints,
        };
      }
      setPacks(nextPacks);
      setBrandSiblings(extractBrandSiblingsFromProducts(products, snap.details || [], []));
      setHasResult(true);
      setStep(3);
      setResultTab('listing');
      setHistoryOpen(false);
      toast.success(`已加载：${snap.meta.title}`);
    } catch (e) {
      toast.error(`加载失败：${e instanceof Error ? e.message : ''}`);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleDeleteHistory = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteCompetitorSnapshot(historyUserId, id);
      await refreshHistoryList();
      toast.success('已删除历史记录');
    } catch {
      toast.error('删除失败');
    }
  };

  // 示例快照：直接进入结果页，展示真实 Listing / 主图
  useEffect(() => {
    if (!demoSnapshot?.details?.length) return;
    const asins = demoSnapshot.selectedAsins.slice(0, MAX_ASINS).map((a) => a.toUpperCase());
    setSelected(asins);
    const nextPacks: Record<string, AsinPack> = {};
    for (const [asin, pack] of Object.entries(demoSnapshot.packs || {})) {
      nextPacks[asin.toUpperCase()] = {
        zipName: pack.zipName,
        secondaryPreviewUrls: [...(pack.secondaryPreviewUrls || [])],
        aplusPreviewUrls: [...(pack.aplusPreviewUrls || [])],
        bulletPoints: pack.bulletPoints,
      };
    }
    setPacks(nextPacks);
    setDetails(demoSnapshot.details);
    setBrandSiblings(extractBrandSiblingsFromProducts(products, demoSnapshot.details, []));
    setHasResult(true);
    setStep(3);
    setResultTab('listing');
    if (demoSnapshot.aiReportHtml) {
      setAiReportHtml(demoSnapshot.aiReportHtml);
    }
  }, [demoSnapshot, products]);

  // 大盘勾选变化时同步进对比池（示例模式不覆盖已选对比池）
  useEffect(() => {
    if (demoSnapshot?.details?.length) return;
    if (!preselectedAsins.length) return;
    setSelected(preselectedAsins.slice(0, MAX_ASINS).map((a) => a.toUpperCase()));
  }, [preselectedAsins.join('|'), demoSnapshot]);

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
      revokePackUrls(next[asin]);
      delete next[asin];
      return next;
    });
  };

  const handleZipUpload = async (asin: string, file: File | null) => {
    if (!file) return;
    setParsingAsin(asin);
    try {
      const { competitor: parsed, warnings } = await parseSingleCompetitorZip(file, asin);
      // 图包「主图」文件夹内容：不进主图对比（主图用 MCP），一并并入附图池，便于展开对比
      const secondarySource = [...parsed.secondaryImages, ...parsed.mainImages];
      const secondaryPreviewUrls = await blobsToPreviewUrls(secondarySource, 24);
      const aplusPreviewUrls = await blobsToPreviewUrls(parsed.aplusImages, 24);
      setPacks((prev) => {
        revokePackUrls(prev[asin]);
        return {
          ...prev,
          [asin]: {
            zipName: file.name,
            secondaryPreviewUrls,
            aplusPreviewUrls,
            bulletPoints: parsed.bulletPoints,
          },
        };
      });
      toast.success(
        `${asin} 图包已导入：附图 ${secondarySource.length} · A+ ${parsed.aplusImages.length}（主图对比仍用卖家精灵）`
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
      revokePackUrls(next[asin]);
      delete next[asin];
      return next;
    });
  };

  const updatePackImages = (
    asin: string,
    field: 'secondaryPreviewUrls' | 'aplusPreviewUrls',
    nextUrls: string[]
  ) => {
    setPacks((prev) => {
      const pack = prev[asin];
      if (!pack) return prev;
      return { ...prev, [asin]: { ...pack, [field]: nextUrls } };
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
    setAiReportHtml('');
    setAiReportOpen(false);
    try {
      const detailList: AsinDetailSnapshot[] = [];
      const trafficList: TrafficStatSnapshot[] = [];
      const kwMap: Record<string, TrafficKeywordDetail[]> = {};
      const matrixList: ParentMatrixSnapshot[] = [];

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

        setProgress(`(${i + 1}/${selected.length}) 抓取 ${asin} 流量词明细…`);
        try {
          const kws = await fetchTrafficKeywordsDetailedFromMcp({
            asin,
            marketplace,
            maxPages: 2,
            pageSize: 50,
          });
          kwMap[asin] = kws.slice(0, 30);
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

      setProgress('从大盘数据提取同品牌其他链接…');
      const siblings = extractBrandSiblingsFromProducts(products, detailList, matrixList);

      setDetails(detailList);
      setTrafficStats(trafficList);
      setTopKeywords(kwMap);
      setMatrices(matrixList);
      setBrandSiblings(siblings);
      setHasResult(true);
      setStep(3);
      setResultTab('listing');
      toast.success(`对比分析完成（${detailList.length}/${selected.length} 个 ASIN）`);
    } finally {
      setLoading(false);
      setProgress('');
    }
  };

  const runFullAiReport = async () => {
    const cfg = loadAiSettings();
    if (!cfg?.apiKey) {
      toast.error('请先在「设置」配置 AI API Key');
      return;
    }
    if (!hasResult) {
      toast.error('请先完成对比分析');
      return;
    }
    setAiLoading(true);
    try {
      const base = getPrompt('competitor_full_report');

      const listingBlock = details.map((d) => `### ${d.asin} | ${d.brand}
标题: ${d.title}
价格: ${d.price} | 评分: ${d.rating}(${d.ratings}) | LQS: ${d.lqs}
规格: ${d.skuList.join(' / ') || '-'}
五点: ${d.features.slice(0, 5).join(' | ')}
徽章: AC=${d.badge.amazonChoice} BS=${d.badge.bestSeller} A+=${d.badge.ebc} 视频=${d.badge.video}
配送: ${d.fulfillment} ${d.sellerName}`).join('\n\n');

      const trafficBlock =
        trafficStats.map((t) => {
          const dep = t.keywords > 0 ? ((t.ads / t.keywords) * 100).toFixed(1) : '0';
          return `${t.asin}: 流量词${t.keywords} 有排名${t.ranks} 广告词${t.ads} 广告依赖度${dep}%`;
        }).join('\n') +
        '\n\n' +
        selected.map((asin) => {
          const kws = (topKeywords[asin] || []).slice(0, 12);
          return `## ${asin}\n` + kws.map((k) =>
            `- ${k.keyword} | 流量占比${fmtPct(k.trafficPercentage)} | ABA#${k.abaRank || '-'} | 自然${fmtOrganic(k)} | 广告${fmtAd(k)} | 自然流量比${fmtPct(k.naturalRatio)}`
          ).join('\n');
        }).join('\n\n');

      const matrixBlock =
        matrices.map((m) => {
          const kids = m.children.map((c) => {
            const p = productMap.get(c.asin);
            return `${c.asin}${c.isAnchor ? '(锚点)' : ''} ${c.attribute} $${c.price || '-'} 大盘月销${p?.monthlySales ?? '-'}`;
          }).join('\n');
          return `## ${m.brand} 父体 ${m.parentAsin}\n${kids}`;
        }).join('\n\n') +
        '\n\n## 同品牌其他链接（大盘）\n' +
        brandSiblings.map((b) =>
          `### ${b.brand}\n` + b.items.slice(0, 15).map((p) =>
            `${p.asin} $${p.price} 月销${p.monthlySales} 评${p.reviewCount} BSR#${p.subBsr || '-'} ${p.title.slice(0, 60)}`
          ).join('\n')
        ).join('\n\n');

      const dataBlock = `## Listing 对比数据\n${listingBlock}\n\n## 流量对比数据\n${trafficBlock}\n\n## 产品矩阵数据\n${matrixBlock}`;
      const text = await generateText(`${base}\n\n## 对比数据\n${dataBlock}`, cfg);
      const html = stripHtmlFence(text);
      setAiReportHtml(html);
      setAiReportOpen(true);
      toast.success('竞品综合报告已生成');
    } catch (e) {
      toast.error(`AI 解析失败：${e instanceof Error ? e.message : ''}`);
    } finally {
      setAiLoading(false);
    }
  };

  const stepItems = [
    { n: 1 as const, label: '选竞品 ASIN' },
    { n: 2 as const, label: '上传图包（可选）' },
    { n: 3 as const, label: '对比结果' },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-[24px] font-bold text-[#1d1d1f] tracking-tight flex items-center gap-2">
            <Crosshair className="w-6 h-6 text-indigo-600" />
            竞品分析
          </h2>
          <p className="text-[#86868b] text-sm mt-1">
            可从市场大盘 ASIN 列表勾选带入，或手动添加。对比完成后可一键生成「Listing + 流量 + 产品矩阵」综合 AI 报告。
          </p>
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => {
              setHistoryOpen((v) => !v);
              void refreshHistoryList();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-black/[0.08] bg-white text-sm font-semibold text-[#1d1d1f] hover:border-indigo-200 shadow-sm"
          >
            <History className="w-4 h-4 text-indigo-500" />
            历史分析
            {historyList.length > 0 && (
              <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full">
                {historyList.length}
              </span>
            )}
          </button>
          {historyOpen && (
            <div className="absolute right-0 top-full mt-2 z-40 w-[min(100vw-2rem,360px)] rounded-2xl border border-black/8 bg-white shadow-[0_12px_40px_rgba(15,23,42,0.14)] p-2 max-h-80 overflow-auto">
              {historyLoading ? (
                <div className="px-3 py-6 text-center text-xs text-[#86868b]">加载中…</div>
              ) : historyList.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-[#86868b]">暂无历史。完成对比后点「保存本次分析」。</div>
              ) : (
                historyList.map((item) => (
                  <div
                    key={item.id}
                    className="group flex items-start gap-2 rounded-xl px-2.5 py-2 hover:bg-[#f5f5f7] cursor-pointer"
                    onClick={() => void handleLoadHistory(item.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-[#1d1d1f] truncate">{item.title}</div>
                      <div className="text-[11px] text-[#86868b] mt-0.5">
                        {item.marketplace} · {item.asinList.length} 个 ASIN
                        {item.hasAiReport ? ' · 含 AI 报告' : ''}
                        {item.hasTraffic ? ' · 含流量' : ''}
                      </div>
                      <div className="text-[10px] text-[#aeaeb2] mt-0.5">
                        {new Date(item.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <button
                      type="button"
                      title="删除"
                      onClick={(e) => void handleDeleteHistory(item.id, e)}
                      className="p-1.5 rounded-lg text-[#aeaeb2] hover:text-rose-600 hover:bg-rose-50 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

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
              <span className="w-5 h-5 rounded-full bg-black/10 flex items-center justify-center text-xs">{s.n}</span>
              {s.label}
            </button>
          </React.Fragment>
        ))}
      </div>

      {step === 1 && (
        <Card className="border-none shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">① 选择要对比的竞品 ASIN</CardTitle>
            <CardDescription>
              建议 2–{MAX_ASINS} 个。市场大盘左侧勾选后会自动带到这里。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2 items-center">
              <Select
                value={marketplace}
                onChange={(v) => setMarketplace(normalizeMarketplaceCode(v))}
                options={SELLERSPRITE_MARKETPLACES.map((m) => ({ value: m, label: m }))}
                size="sm"
                aria-label="站点"
              />
              <input
                value={asinInput}
                onChange={(e) => setAsinInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addAsins(asinInput); }}
                placeholder="输入 ASIN，回车添加"
                className="flex-1 min-w-[180px] border border-black/10 rounded-xl px-3 py-2 text-sm"
              />
              <button type="button" onClick={() => addAsins(asinInput)} className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold">
                <Plus className="w-4 h-4" /> 添加
              </button>
              {suggestAsins.length > 0 && (
                <button type="button" onClick={() => addAsins(suggestAsins.slice(0, 3))} className="px-3 py-2 rounded-xl border border-black/10 text-sm text-[#86868b] hover:text-indigo-600">
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
                    <span key={a} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-indigo-50 text-indigo-800 text-xs font-medium border border-indigo-100">
                      {p?.image ? <img src={p.image} alt="" className="w-5 h-5 rounded object-cover" /> : null}
                      {a}
                      {p?.brand ? <span className="text-indigo-500/80">· {p.brand}</span> : null}
                      <button type="button" onClick={() => removeAsin(a)} className="hover:text-rose-600"><X className="w-3 h-3" /></button>
                    </span>
                  );
                })
              )}
            </div>
            <div className="flex justify-end">
              <button type="button" disabled={selected.length === 0} onClick={() => setStep(2)} className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-40">
                下一步：上传图包 <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card className="border-none shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">② 上传 Listing 图包（可选）</CardTitle>
            <CardDescription>
              主图对比一律用卖家精灵抓取；图包只用于附图 / A+。建议 zip 内分文件夹：附图（或副图）、A+。
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
                        <div className="font-mono text-sm font-semibold">{asin}</div>
                        <div className="text-xs text-[#86868b] mt-0.5 truncate max-w-[180px]">{p?.brand || '等待 MCP 补品牌'}</div>
                      </div>
                      {pack && (
                        <button type="button" onClick={() => clearPack(asin)} className="text-xs text-rose-600">清除</button>
                      )}
                    </div>
                    {pack ? (
                      <div className="space-y-2">
                        <div className="text-[10px] text-[#86868b]">附图预览</div>
                        <div className="flex gap-1.5 overflow-x-auto">
                          {pack.secondaryPreviewUrls.slice(0, 4).map((url) => (
                            <img key={url} src={url} alt="" className="w-14 h-14 rounded-lg object-cover border border-black/5 shrink-0" />
                          ))}
                          {!pack.secondaryPreviewUrls.length && (
                            <span className="text-[11px] text-[#aeaeb2] py-4">无附图</span>
                          )}
                        </div>
                        <div className="text-[10px] text-[#86868b]">A+ 预览</div>
                        <div className="flex gap-1.5 overflow-x-auto">
                          {pack.aplusPreviewUrls.slice(0, 4).map((url) => (
                            <img key={`a-${url}`} src={url} alt="" className="w-14 h-14 rounded-lg object-cover border border-black/5 shrink-0" />
                          ))}
                          {!pack.aplusPreviewUrls.length && (
                            <span className="text-[11px] text-[#aeaeb2] py-4">无 A+</span>
                          )}
                        </div>
                        <p className="text-[11px] text-emerald-700">
                          已导入 {pack.zipName} · 附图 {pack.secondaryPreviewUrls.length} · A+ {pack.aplusPreviewUrls.length}
                        </p>
                      </div>
                    ) : (
                      <label className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-black/15 bg-[#fafafa] py-6 cursor-pointer hover:border-indigo-300">
                        <input
                          ref={(el) => { fileRefs.current[asin] = el; }}
                          type="file"
                          accept=".zip,application/zip"
                          className="hidden"
                          onChange={(e) => handleZipUpload(asin, e.target.files?.[0] || null)}
                        />
                        {parsingAsin === asin ? <Loader2 className="w-5 h-5 animate-spin text-indigo-600" /> : <Upload className="w-5 h-5 text-[#86868b]" />}
                        <span className="text-xs text-[#86868b]">{parsingAsin === asin ? '解析中…' : '点击上传 ZIP（可跳过）'}</span>
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between gap-2 flex-wrap">
              <button type="button" onClick={() => setStep(1)} className="inline-flex items-center gap-1 px-4 py-2 rounded-xl border border-black/10 text-sm text-[#86868b]">
                <ChevronLeft className="w-4 h-4" /> 上一步
              </button>
              <button type="button" onClick={runCompare} disabled={loading || selected.length === 0} className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold disabled:opacity-50">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                对比分析
              </button>
            </div>
            {progress && <div className="text-xs text-violet-700 bg-violet-50 rounded-lg px-3 py-2">{progress}</div>}
          </CardContent>
        </Card>
      )}

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
                    { id: 'matrix' as const, label: '产品矩阵', icon: <Grid3X3 className="w-4 h-4" /> },
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
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => void handleSaveHistory()}
                    disabled={savingHistory || !hasResult}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm font-semibold disabled:opacity-50 hover:bg-emerald-100"
                  >
                    {savingHistory ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    保存本次分析
                  </button>
                  <button
                    type="button"
                    onClick={() => void runFullAiReport()}
                    disabled={aiLoading}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50"
                  >
                    {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {aiLoading ? '生成综合报告…' : 'AI 综合报告'}
                  </button>
                  {aiReportHtml && (
                    <button
                      type="button"
                      onClick={() => setAiReportOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-indigo-200 bg-white text-indigo-700 text-sm font-semibold hover:bg-indigo-50"
                    >
                      查看报告
                    </button>
                  )}
                  <button type="button" onClick={() => setStep(2)} className="px-3 py-2 rounded-xl border border-black/10 text-sm text-[#86868b]">
                    返回改图包
                  </button>
                  <button type="button" onClick={runCompare} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold disabled:opacity-50">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    重新对比
                  </button>
                </div>
              </div>
              {progress && <div className="text-xs text-violet-700 bg-violet-50 rounded-lg px-3 py-2">{progress}</div>}

              {resultTab === 'listing' && (
                <ListingBuyerView
                  details={details}
                  packs={packs}
                  marketplace={marketplace}
                  onUpdatePackImages={updatePackImages}
                />
              )}
              {resultTab === 'traffic' && (
                <TrafficView selected={selected} trafficStats={trafficStats} topKeywords={topKeywords} />
              )}
              {resultTab === 'matrix' && (
                <ParentMatrixView
                  matrices={matrices}
                  brandSiblings={brandSiblings}
                  productMap={productMap}
                />
              )}
            </>
          )}
        </div>
      )}

      {aiReportOpen && aiReportHtml && (
        <SecondaryReportPage
          title="竞品 AI 综合报告"
          subtitle={`对比 ${selected.join(' · ')} · Listing + 流量 + 产品矩阵`}
          icon={<Sparkles className="w-5 h-5" />}
          onClose={() => setAiReportOpen(false)}
          onRegenerate={() => void runFullAiReport()}
          regenerating={aiLoading}
          extraActions={
            <FeishuPushButton
              compact
              title="竞品 AI 综合报告"
              getMarkdown={() => competitorReportToMarkdown(aiReportHtml, '竞品 AI 综合报告')}
            />
          }
        >
          <div
            className="competitor-ai-report text-[15px] leading-[1.75] text-[#3f3f46] [&_h1]:text-[22px] [&_h1]:font-semibold [&_h1]:text-indigo-950 [&_h1]:mb-4 [&_h2]:text-[18px] [&_h2]:font-semibold [&_h2]:text-indigo-900 [&_h2]:mt-8 [&_h2]:mb-3 [&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:text-indigo-800 [&_h3]:mt-5 [&_h3]:mb-2 [&_p]:mb-3 [&_ul]:mb-3 [&_li]:mb-1.5 [&_table]:w-full [&_table]:text-sm [&_th]:text-left [&_th]:py-2 [&_td]:py-2 [&_td]:border-b [&_td]:border-indigo-50"
            dangerouslySetInnerHTML={{ __html: aiReportHtml }}
          />
        </SecondaryReportPage>
      )}
    </div>
  );
}

function moveUrl(list: string[], index: number, dir: -1 | 1): string[] {
  const j = index + dir;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

function PackImageEditor({
  asin,
  urls,
  label,
  onChange,
}: {
  asin: string;
  urls: string[];
  label: string;
  onChange: (next: string[]) => void;
}) {
  if (!urls.length) {
    return <p className="text-[11px] text-[#aeaeb2] py-2">{asin} 暂无{label}</p>;
  }
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold text-[#86868b]">{asin} · 调整{label}顺序 / 删除</div>
      <div className="flex flex-wrap gap-2">
        {urls.map((url, i) => (
          <div key={`${url}-${i}`} className="relative w-[88px] rounded-xl border border-black/10 bg-white overflow-hidden shadow-sm">
            <img src={url} alt="" className="w-full aspect-square object-contain bg-[#fafafa]" />
            <div className="absolute top-1 left-1 text-[9px] font-bold bg-black/60 text-white px-1.5 py-0.5 rounded">
              #{i + 1}
            </div>
            <div className="flex border-t border-black/5">
              <button
                type="button"
                title="上移"
                disabled={i === 0}
                onClick={() => onChange(moveUrl(urls, i, -1))}
                className="flex-1 py-1 hover:bg-[#f5f5f7] disabled:opacity-30"
              >
                <ChevronUp className="w-3.5 h-3.5 mx-auto" />
              </button>
              <button
                type="button"
                title="下移"
                disabled={i === urls.length - 1}
                onClick={() => onChange(moveUrl(urls, i, 1))}
                className="flex-1 py-1 hover:bg-[#f5f5f7] disabled:opacity-30 border-l border-black/5"
              >
                <ChevronDown className="w-3.5 h-3.5 mx-auto" />
              </button>
              <button
                type="button"
                title="删除"
                onClick={() => {
                  const removed = urls[i];
                  if (removed.startsWith('blob:')) URL.revokeObjectURL(removed);
                  onChange(urls.filter((_, idx) => idx !== i));
                }}
                className="flex-1 py-1 hover:bg-rose-50 text-rose-600 border-l border-black/5"
              >
                <Trash2 className="w-3.5 h-3.5 mx-auto" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ImageCompareRows({
  details,
  packs,
  field,
  emptyHint,
}: {
  details: AsinDetailSnapshot[];
  packs: Record<string, AsinPack>;
  field: 'secondaryPreviewUrls' | 'aplusPreviewUrls';
  emptyHint: string;
}) {
  const maxLen = Math.max(0, ...details.map((d) => packs[d.asin]?.[field]?.length || 0));
  if (maxLen === 0) {
    return <EmptyHint text={emptyHint} />;
  }
  return (
    <div className="space-y-4">
      {Array.from({ length: maxLen }, (_, row) => (
        <div key={row} className="rounded-2xl border border-black/10 bg-white overflow-hidden">
          <div className="px-4 py-2 bg-[#f5f5f7] border-b border-black/5 text-xs font-semibold text-[#1d1d1f]">
            第 {row + 1} 张 · 同位置横向对比
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 p-3">
            {details.map((d) => {
              const url = packs[d.asin]?.[field]?.[row];
              return (
                <div key={d.asin} className="rounded-xl border border-black/5 bg-[#fafafa] p-2">
                  <div className="text-[10px] font-mono text-[#86868b] mb-1.5">{d.asin}</div>
                  {url ? (
                    <img src={url} alt="" className="w-full aspect-[4/3] object-contain bg-white rounded-lg border border-black/5" />
                  ) : (
                    <div className="aspect-[4/3] flex items-center justify-center text-[11px] text-[#aeaeb2] border border-dashed rounded-lg">
                      该位置无图
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function ListingBuyerView({
  details,
  packs,
  marketplace,
  onUpdatePackImages,
}: {
  details: AsinDetailSnapshot[];
  packs: Record<string, AsinPack>;
  marketplace: string;
  onUpdatePackImages: (
    asin: string,
    field: 'secondaryPreviewUrls' | 'aplusPreviewUrls',
    nextUrls: string[]
  ) => void;
}) {
  const [showSecondary, setShowSecondary] = useState(false);
  const [showAplus, setShowAplus] = useState(false);

  if (!details.length) return <EmptyHint text="暂无 Listing 数据。请检查 MCP 密钥后重新对比。" />;

  const secondaryTotal = details.reduce((n, d) => n + (packs[d.asin]?.secondaryPreviewUrls?.length || 0), 0);
  const aplusTotal = details.reduce((n, d) => n + (packs[d.asin]?.aplusPreviewUrls?.length || 0), 0);

  return (
    <div className="space-y-4">
      <p className="text-xs text-[#86868b]">
        默认只看主图（卖家精灵抓取，不受图包影响）。需要时再展开附图 / A+，按「第 N 张对第 N 张」横向对比；可在下方调整顺序或删除。
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {details.map((d) => {
          const mainUrl = d.zoomImageUrl || d.imageUrl;
          const pack = packs[d.asin];
          const bullets =
            pack?.bulletPoints?.trim()
              ? pack.bulletPoints.split(/\n+/).map((s) => s.replace(/^[\d.\-•\s]+/, '').trim()).filter(Boolean)
              : d.features;

          return (
            <article key={d.asin} className="rounded-2xl border border-black/10 bg-white overflow-hidden shadow-sm flex flex-col">
              <div className="bg-[#fafafa] border-b border-black/5 p-3">
                <div className="text-[10px] uppercase tracking-wider text-[#86868b] mb-2">① 买家先看主图（MCP）</div>
                {mainUrl ? (
                  <img src={mainUrl} alt={d.title} className="w-full aspect-square max-h-56 object-contain bg-white rounded-xl border border-black/5" />
                ) : (
                  <div className="aspect-square max-h-40 flex items-center justify-center text-xs text-[#86868b] bg-white rounded-xl border border-dashed">暂无图片</div>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-[#86868b]">
                  <span className="px-2 py-0.5 rounded-full bg-white border border-black/5">附图 {(pack?.secondaryPreviewUrls.length || 0)} 张</span>
                  <span className="px-2 py-0.5 rounded-full bg-white border border-black/5">A+ {(pack?.aplusPreviewUrls.length || 0)} 张</span>
                </div>
              </div>
              <div className="p-4 space-y-3 flex-1">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[#86868b] mb-1">② 标题</div>
                  <h3 className="text-sm font-medium leading-snug line-clamp-4">{d.title || '（无标题）'}</h3>
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[11px] text-[#86868b]">{d.asin}</span>
                    {d.asinUrl && (
                      <a href={d.asinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[11px] text-indigo-600 hover:underline">
                        打开亚马逊页 <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
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
                <div className="rounded-xl bg-[#f5f5f7] px-3 py-2.5 space-y-2">
                  <div className="text-[10px] uppercase tracking-wider text-[#86868b]">④ 价格与运营徽章</div>
                  <div className="text-2xl font-bold">{d.price ? `$${d.price.toFixed(2)}` : '价格未知'}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {badgeYes(d.badge.amazonChoice) && <span className="text-[10px] px-2 py-0.5 rounded bg-[#232f3e] text-white">Amazon&apos;s Choice</span>}
                    {badgeYes(d.badge.bestSeller) && <span className="text-[10px] px-2 py-0.5 rounded bg-[#e67a00] text-white">Best Seller</span>}
                    {badgeYes(d.badge.ebc) && <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-100 text-indigo-800">有 A+</span>}
                    {badgeYes(d.badge.video) && <span className="text-[10px] px-2 py-0.5 rounded bg-rose-100 text-rose-800">有视频</span>}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[#86868b] mb-1.5">⑤ 规格选择</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(d.skuList.length ? d.skuList : d.variationList.map((v) => v.attribute).filter(Boolean)).slice(0, 8).map((sku) => (
                      <span key={sku} className="text-[11px] px-2 py-1 rounded-lg border border-[#ff9900]/60 bg-[#fff8f0]">{sku}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[#86868b] mb-1.5">⑥ About this item（五点）</div>
                  {bullets.length ? (
                    <ul className="space-y-1.5">
                      {bullets.slice(0, 5).map((b, i) => (
                        <li key={i} className="text-xs leading-relaxed flex gap-1.5">
                          <span className="text-[#86868b]">•</span>
                          <span className="line-clamp-3">{b}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-[#86868b]">暂无五点</p>
                  )}
                </div>
                <div className="pt-2 border-t border-black/5 grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <div className="text-[#86868b]">⑦ 配送</div>
                    <div className="font-medium">{d.fulfillment || '-'}</div>
                  </div>
                  <div>
                    <div className="text-[#86868b]">类目 / BSR</div>
                    <div className="font-medium">{d.bsrRank ? `#${fmtNum(d.bsrRank)}` : '-'}</div>
                  </div>
                </div>
                <div className="text-[10px] text-[#c7c7cc]">站点 {marketplace}</div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setShowSecondary((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
            showSecondary ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-[#1d1d1f] border-black/10 hover:border-indigo-300'
          }`}
        >
          <ImageIcon className="w-4 h-4" />
          {showSecondary ? '收起附图对比' : `展开附图对比（${secondaryTotal}）`}
        </button>
        <button
          type="button"
          onClick={() => setShowAplus((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
            showAplus ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-[#1d1d1f] border-black/10 hover:border-violet-300'
          }`}
        >
          <ImageIcon className="w-4 h-4" />
          {showAplus ? '收起 A+ 对比' : `展开 A+ 对比（${aplusTotal}）`}
        </button>
      </div>

      {showSecondary && (
        <Card className="border-none shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">附图对比</CardTitle>
            <CardDescription>同一行 = 同一位置（第 1 张对第 1 张）。顺序不对时，用下方箭头调整或删除。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <ImageCompareRows
              details={details}
              packs={packs}
              field="secondaryPreviewUrls"
              emptyHint="还没有附图。请在上一步上传含「附图/副图」文件夹的 zip。"
            />
            <div className="space-y-4 pt-2 border-t border-black/5">
              {details.map((d) => (
                <PackImageEditor
                  key={`sec-edit-${d.asin}`}
                  asin={d.asin}
                  urls={packs[d.asin]?.secondaryPreviewUrls || []}
                  label="附图"
                  onChange={(next) => onUpdatePackImages(d.asin, 'secondaryPreviewUrls', next)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {showAplus && (
        <Card className="border-none shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">A+ 对比</CardTitle>
            <CardDescription>同一行 = 同一模块位置。可调序、可删除，方便对齐竞品模块。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <ImageCompareRows
              details={details}
              packs={packs}
              field="aplusPreviewUrls"
              emptyHint="还没有 A+ 图。请在上一步上传含「A+」文件夹的 zip。"
            />
            <div className="space-y-4 pt-2 border-t border-black/5">
              {details.map((d) => (
                <PackImageEditor
                  key={`aplus-edit-${d.asin}`}
                  asin={d.asin}
                  urls={packs[d.asin]?.aplusPreviewUrls || []}
                  label="A+"
                  onChange={(next) => onUpdatePackImages(d.asin, 'aplusPreviewUrls', next)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
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
  topKeywords: Record<string, TrafficKeywordDetail[]>;
}) {
  if (!trafficStats.length) return <EmptyHint text="暂无流量数据。请检查 MCP 后重新对比。" />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">流量结构对比</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-xs text-[#86868b] border-b border-black/5">
                <th className="py-2 pr-3">ASIN</th>
                <th className="py-2 pr-3">
                  流量词
                  <Tip text="能给这个 ASIN 带来搜索曝光的关键词总数（卖家精灵统计）。" />
                </th>
                <th className="py-2 pr-3">
                  有排名词
                  <Tip text="在自然搜索结果里有排名位置的词数量。" />
                </th>
                <th className="py-2 pr-3">
                  广告词
                  <Tip text="出现在 SP 等广告里的词数量。" />
                </th>
                <th className="py-2">
                  广告依赖度
                  <Tip text="广告词 ÷ 流量词。越高说明越依赖打广告获客，自然流量越弱。一般超过 40% 要警惕。" />
                </th>
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

      {selected.map((asin) => {
        const kws = topKeywords[asin] || [];
        return (
          <Card key={asin}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">{asin} · 核心流量词明细（按流量占比）</CardTitle>
              <CardDescription className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                <span>流量占比<Tip text="这个词给该 ASIN 贡献了多少搜索流量，百分比越高越重要。" /></span>
                <span>ABA排名<Tip text="亚马逊品牌分析里的搜索热度排名，数字越小说明词越热门。" /></span>
                <span>自然排名<Tip text="不打广告时，在搜索结果第几页、大致第几位。" /></span>
                <span>广告排名<Tip text="SP 广告出现在第几页第几位。" /></span>
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {kws.length === 0 ? (
                <p className="text-xs text-[#86868b]">暂无词明细</p>
              ) : (
                <table className="w-full text-xs min-w-[880px]">
                  <thead>
                    <tr className="text-left text-[#86868b] border-b border-black/5">
                      <th className="py-2 pr-2">关键词</th>
                      <th className="py-2 pr-2">流量占比</th>
                      <th className="py-2 pr-2">ABA排名</th>
                      <th className="py-2 pr-2">月搜</th>
                      <th className="py-2 pr-2">自然排名</th>
                      <th className="py-2 pr-2">广告排名</th>
                      <th className="py-2 pr-2">自然/广告流量比</th>
                      <th className="py-2">CPC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kws.slice(0, 20).map((k) => (
                      <tr key={k.keyword} className="border-b border-black/5 align-top">
                        <td className="py-2 pr-2">
                          <div className="font-medium text-[#1d1d1f]">{k.keyword}</div>
                          {k.translation ? <div className="text-[10px] text-[#86868b]">{k.translation}</div> : null}
                        </td>
                        <td className="py-2 pr-2 font-semibold text-indigo-700">{fmtPct(k.trafficPercentage)}</td>
                        <td className="py-2 pr-2">{k.abaRank ? `#${fmtNum(k.abaRank)}` : '-'}</td>
                        <td className="py-2 pr-2">{fmtNum(k.monthlySearches)}</td>
                        <td className="py-2 pr-2 whitespace-nowrap">{fmtOrganic(k)}</td>
                        <td className="py-2 pr-2 whitespace-nowrap">{fmtAd(k)}</td>
                        <td className="py-2 pr-2">
                          {fmtPct(k.naturalRatio)} / {fmtPct(k.adRatio)}
                        </td>
                        <td className="py-2">{k.cpcBid ? k.cpcBid.toFixed(2) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function ParentMatrixView({
  matrices,
  brandSiblings,
  productMap,
}: {
  matrices: ParentMatrixSnapshot[];
  brandSiblings: BrandSiblingRow[];
  productMap: Map<string, Product>;
}) {
  return (
    <div className="space-y-6">
      {/* 板块一（靠前）：品牌下其他父体/链接 — 来自大盘 */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-[#1d1d1f] flex items-center gap-2">
          <Package className="w-4 h-4 text-violet-600" />
          品牌下其他链接（来自大盘数据）
          <Tip text="不额外调 MCP。直接从你已导入的市场大盘里，找出同品牌、且不在当前父体变体里的其他 ASIN。" />
        </h3>
        {!brandSiblings.length || brandSiblings.every((b) => !b.items.length) ? (
          <EmptyHint text="大盘里没找到同品牌其他 ASIN。可能是品牌名不一致，或大盘只有当前这几条。" />
        ) : (
          brandSiblings.map((b) => (
            <BrandSiblingCard key={b.brand} row={b} />
          ))
        )}
      </div>

      {/* 板块二：父体结构 */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-[#1d1d1f] flex items-center gap-2">
          <Grid3X3 className="w-4 h-4 text-indigo-600" />
          父体结构（当前 ASIN 所属链接下的子体）
        </h3>
        {!matrices.length ? (
          <EmptyHint text="暂无父体数据。" />
        ) : (
          matrices.map((m) => (
            <ParentVariationCard key={m.anchorAsin} matrix={m} productMap={productMap} />
          ))
        )}
      </div>
    </div>
  );
}

const MATRIX_PAGE_SIZE = 8;

function TablePager({
  page,
  totalPages,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-black/5">
      <span className="text-[11px] text-[#86868b]">
        第 {from}–{to} 条，共 {total} 条
      </span>
      <div className="flex items-center gap-1.5 text-xs text-[#86868b]">
        <button
          type="button"
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className="p-1.5 rounded-lg hover:bg-black/5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          aria-label="上一页"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="min-w-[3.5rem] text-center tabular-nums">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          className="p-1.5 rounded-lg hover:bg-black/5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          aria-label="下一页"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function ParentVariationCard({
  matrix: m,
  productMap,
}: {
  matrix: ParentMatrixSnapshot;
  productMap: Map<string, Product>;
}) {
  const [page, setPage] = useState(1);
  const total = m.children.length;
  const totalPages = Math.max(1, Math.ceil(total / MATRIX_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = m.children.slice((safePage - 1) * MATRIX_PAGE_SIZE, safePage * MATRIX_PAGE_SIZE);

  const prices = m.children.map((c) => c.price).filter((p) => p > 0);
  const priceMin = prices.length ? Math.min(...prices) : 0;
  const priceMax = prices.length ? Math.max(...prices) : 0;

  return (
    <Card>
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
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm min-w-[880px]">
          <thead>
            <tr className="text-left text-xs text-[#86868b] border-b border-black/5">
              <th className="py-2 pr-2">子体 ASIN</th>
              <th className="py-2 pr-2">规格</th>
              <th className="py-2 pr-2">价格</th>
              <th className="py-2 pr-2">月销量</th>
              <th className="py-2 pr-2">月销售额</th>
              <th className="py-2 pr-2">评分</th>
              <th className="py-2 pr-2">评论</th>
              <th className="py-2 pr-2">小类BSR</th>
              <th className="py-2">角色</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((c) => {
              const p = productMap.get(c.asin);
              return (
                <tr key={c.asin} className={`border-b border-black/5 ${c.isAnchor ? 'bg-indigo-50/60 font-semibold' : ''}`}>
                  <td className="py-2 pr-2 font-mono text-xs">
                    <div className="flex items-center gap-2">
                      {(c.imageUrl || p?.image) ? (
                        <img src={c.imageUrl || p?.image} alt="" className="w-8 h-8 rounded object-cover border" />
                      ) : null}
                      {c.asin}
                    </div>
                  </td>
                  <td className="py-2 pr-2 text-xs">{c.attribute || '-'}</td>
                  <td className="py-2 pr-2">{c.price ? `$${c.price.toFixed(2)}` : p ? `$${p.price.toFixed(2)}` : '-'}</td>
                  <td className="py-2 pr-2 font-semibold">{p ? fmtNum(p.monthlySales) : '-'}</td>
                  <td className="py-2 pr-2">{p ? `$${fmtNum(Math.round(p.monthlyRevenue))}` : '-'}</td>
                  <td className="py-2 pr-2">{c.rating || p?.rating || '-'}</td>
                  <td className="py-2 pr-2">{fmtNum(c.ratings || p?.reviewCount || 0)}</td>
                  <td className="py-2 pr-2">{p?.subBsr ? `#${fmtNum(p.subBsr)}` : '-'}</td>
                  <td className="py-2 text-xs">
                    {c.isAnchor ? <span className="text-indigo-700">当前对比子体</span> : <span className="text-[#86868b]">同父体变体</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <TablePager
          page={safePage}
          totalPages={totalPages}
          total={total}
          pageSize={MATRIX_PAGE_SIZE}
          onChange={setPage}
        />
        <p className="text-[11px] text-[#86868b] mt-2">月销量/销售额/BSR：优先用大盘已导入数据；大盘没有的显示「-」。</p>
      </CardContent>
    </Card>
  );
}

function BrandSiblingCard({ row: b }: { row: BrandSiblingRow }) {
  const [page, setPage] = useState(1);
  const total = b.items.length;
  const totalPages = Math.max(1, Math.ceil(total / MATRIX_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = b.items.slice((safePage - 1) * MATRIX_PAGE_SIZE, safePage * MATRIX_PAGE_SIZE);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">品牌：{b.brand}</CardTitle>
        <CardDescription>
          当前锚点 {b.anchorAsin} · 父体 {b.currentParentAsin} · 大盘另有 {b.items.length} 条同品牌链接
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm min-w-[800px]">
          <thead>
            <tr className="text-left text-xs text-[#86868b] border-b border-black/5">
              <th className="py-2 pr-2">ASIN</th>
              <th className="py-2 pr-2">标题</th>
              <th className="py-2 pr-2">价格</th>
              <th className="py-2 pr-2">月销量</th>
              <th className="py-2 pr-2">月销售额</th>
              <th className="py-2 pr-2">评分</th>
              <th className="py-2 pr-2">评论</th>
              <th className="py-2">小类BSR</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((p) => (
              <tr key={p.asin} className="border-b border-black/5">
                <td className="py-2 pr-2 font-mono text-xs">
                  <div className="flex items-center gap-2">
                    {p.image ? <img src={p.image} alt="" className="w-8 h-8 rounded object-cover border" /> : null}
                    {p.asin}
                  </div>
                </td>
                <td className="py-2 pr-2 text-xs max-w-[220px] truncate" title={p.title}>{p.title}</td>
                <td className="py-2 pr-2">${p.price.toFixed(2)}</td>
                <td className="py-2 pr-2 font-semibold">{fmtNum(p.monthlySales)}</td>
                <td className="py-2 pr-2">${fmtNum(Math.round(p.monthlyRevenue))}</td>
                <td className="py-2 pr-2">{p.rating || '-'}</td>
                <td className="py-2 pr-2">{fmtNum(p.reviewCount)}</td>
                <td className="py-2">{p.subBsr ? `#${fmtNum(p.subBsr)}` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <TablePager
          page={safePage}
          totalPages={totalPages}
          total={total}
          pageSize={MATRIX_PAGE_SIZE}
          onChange={setPage}
        />
      </CardContent>
    </Card>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-black/10 bg-white p-10 text-center text-sm text-[#86868b]">
      {text}
    </div>
  );
}
