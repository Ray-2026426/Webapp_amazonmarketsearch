import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { X, Cloud, Sparkles, Loader2 } from 'lucide-react';
import WordCloud from 'wordcloud';
import { Product } from '../utils/parser';
import { loadAiSettings, generateText } from '../utils/aiConfig';
import { toast } from 'sonner';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as',
  'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'it', 'its', 'you',
  'your', 'we', 'our', 'they', 'their', 'them', 'he', 'she', 'his', 'her', 'not', 'no', 'all', 'any',
  'each', 'every', 'some', 'other', 'more', 'most', 'much', 'many', 'very', 'just', 'also', 'only', 'out',
  'up', 'so', 'than', 'if', 'what', 'which', 'who', 'when', 'where', 'how', 'why', 'about', 'into', 'through',
  'over', 'after', 'before', 'between', 'under', 'above', 'new', 'pack', 'pcs', 'set', 'x', 'amazon', 'com',
  'inch', 'inches', 'cm', 'mm', 'oz', 'lb', 'lbs', 'count', 'size', 'color', 'pro', 'max', 'plus', 'mini',
  'non', 'per', 'off', 'sale', 'best', 'top', 'brand', 'made', 'use', 'used', 'one', 'two', 'three', 'four',
  'five', 'fits', 'fit', 'free', 'shipping', 'gift', 'year', 'black', 'white', 'red', 'blue', 'green',
]);

function tokenizeTitle(title: string): string[] {
  const lower = title.toLowerCase();
  const out: string[] = [];
  const en = lower.match(/[a-z0-9]{2,}/g);
  if (en) {
    for (const w of en) {
      if (!STOPWORDS.has(w)) out.push(w);
    }
  }
  const cjk = lower.match(/[\u4e00-\u9fff]{2,8}/g);
  if (cjk) {
    for (const w of cjk) {
      out.push(w);
    }
  }
  return out;
}

export function buildWordListFromProducts(products: Product[], topN: number): [string, number][] {
  const counts = new Map<string, number>();
  for (const p of products) {
    for (const tok of tokenizeTitle(p.title)) {
      counts.set(tok, (counts.get(tok) ?? 0) + 1);
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, topN).map(([w, c]) => [w, c]);
}

export type WordCloudTopN = 30 | 50 | 100;

const TOP_FOR_AI = 30;

/** 按月销售额取前 N 个 ASIN，供 AI 读标题提炼搜索词 */
export function pickTopProductsByRevenue(products: Product[], n: number): Product[] {
  if (products.length <= n) return [...products].sort((a, b) => b.monthlyRevenue - a.monthlyRevenue);
  return [...products].sort((a, b) => b.monthlyRevenue - a.monthlyRevenue).slice(0, n);
}

function titlesCacheKey(products: Product[]): string {
  return pickTopProductsByRevenue(products, TOP_FOR_AI)
    .map((p) => p.asin)
    .sort()
    .join(',');
}

/** 相对当前实现的视觉与字号整体缩放（画布高度、字重系数等） */
const WORD_CLOUD_SCALE = 1.3;

interface TitleWordCloudModalProps {
  open: boolean;
  onClose: () => void;
  products: Product[];
  /** 当前左侧选中的细分名称，仅用于展示说明 */
  segmentLabel?: string | null;
  /** 无标题时提示 */
  emptyHint?: string;
}

export const TitleWordCloudModal: React.FC<TitleWordCloudModalProps> = ({
  open,
  onClose,
  products,
  segmentLabel = null,
  emptyHint = '暂无产品标题可用于统计',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [topN, setTopN] = useState<WordCloudTopN>(50);
  const [coreKeywords, setCoreKeywords] = useState<string[] | null>(null);
  const [kwLoading, setKwLoading] = useState(false);
  const kwCacheRef = useRef<Record<string, string[]>>({});

  const topForAi = useMemo(() => pickTopProductsByRevenue(products, TOP_FOR_AI), [products]);
  const aiKey = useMemo(() => titlesCacheKey(products), [products]);

  useEffect(() => {
    if (!open) return;
    const hit = kwCacheRef.current[aiKey];
    setCoreKeywords(hit ?? null);
  }, [open, aiKey]);

  const runCoreKeywordAi = useCallback(
    async (force: boolean) => {
      if (topForAi.length === 0) {
        toast.error('当前范围内没有产品');
        return;
      }
      if (!force && kwCacheRef.current[aiKey]?.length) {
        setCoreKeywords(kwCacheRef.current[aiKey]);
        return;
      }
      const aiSettings = loadAiSettings();
      if (!aiSettings?.apiKey) {
        toast.error('请先在「AI 设置」中配置 API Key');
        return;
      }
      setKwLoading(true);
      try {
        const scopeNote = segmentLabel
          ? `当前细分市场（中文名供你理解类目）：${segmentLabel}`
          : '当前为全部产品或未选单一细分。';
        const lines = topForAi.map((p, i) => `${i + 1}. ${p.title}`);
        const prompt = `你是亚马逊 SEO 与类目研究助手。${scopeNote}

下面共 ${topForAi.length} 条 Listing 标题（已按销售额优先取前 ${TOP_FOR_AI} 条）。请归纳买家在亚马逊上检索该细分时最可能使用的「核心关键词短语」（英文），用于理解主流量入口，例如 "laundry shoe bag"、"shoe bag" 这类。

规则：
- 输出 1～3 个短语；每个短语 2～5 个英文单词为宜，全小写，不要品牌名。
- 短语应覆盖不同颗粒度（可更具体 + 可更泛），避免无意义堆砌。
- 仅输出 JSON：{"keywords":["...","..."]}`;

        const responseText = await generateText(
          `${prompt}\n\n标题列表：\n${lines.join('\n')}`,
          aiSettings,
          { jsonMode: true }
        );
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
        const raw = Array.isArray(parsed.keywords) ? parsed.keywords : [];
        const cleaned = raw
          .map((s: unknown) => (typeof s === 'string' ? s.trim() : ''))
          .filter(Boolean)
          .slice(0, 3);
        if (cleaned.length === 0) {
          toast.error('AI 未返回有效关键词');
          return;
        }
        kwCacheRef.current[aiKey] = cleaned;
        setCoreKeywords(cleaned);
        toast.success('已提炼核心关键词');
      } catch (e) {
        console.error(e);
        toast.error(e instanceof Error ? e.message : '提炼失败');
      } finally {
        setKwLoading(false);
      }
    },
    [topForAi, aiKey, segmentLabel]
  );

  const list = useMemo(() => buildWordListFromProducts(products, topN), [products, topN]);

  const renderCloud = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !open || list.length === 0) return;

    const w = wrap.clientWidth;
    const h = Math.min(
      Math.round(480 * WORD_CLOUD_SCALE),
      Math.max(Math.round(320 * WORD_CLOUD_SCALE), Math.floor(w * 0.45 * WORD_CLOUD_SCALE))
    );
    canvas.width = w;
    canvas.height = h;

    WordCloud.stop();
    WordCloud(canvas, {
      list,
      gridSize: Math.max(5, Math.round((w / 128) * WORD_CLOUD_SCALE)),
      weightFactor: (size) => {
        const maxW = Math.max(...list.map(([, c]) => c));
        const minW = Math.min(...list.map(([, c]) => c));
        const norm = maxW === minW ? 1 : (size - minW) / (maxW - minW);
        return (12 + norm * (Math.min(w, h) / 18)) * WORD_CLOUD_SCALE;
      },
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      color: 'random-dark',
      backgroundColor: '#fafafa',
      minRotation: 0,
      maxRotation: 0,
      rotateRatio: 0,
      clearCanvas: true,
    });
  }, [list, open]);

  useEffect(() => {
    if (!open) {
      WordCloud.stop();
      return;
    }
    const t = requestAnimationFrame(() => renderCloud());
    return () => cancelAnimationFrame(t);
  }, [open, renderCloud]);

  useEffect(() => {
    if (!open) return;
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => renderCloud());
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      WordCloud.stop();
    };
  }, [open, renderCloud]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-4xl rounded-[24px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-5 border-b border-black/5 flex items-center justify-between bg-gradient-to-r from-sky-50 to-indigo-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white rounded-xl shadow-sm">
              <Cloud className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#1d1d1f]">标题词云</h2>
              <p className="text-xs text-[#86868b]">
                基于当前左侧所选分类范围内的产品标题分词统计（英文去常见停用词）
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-black/5 rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-[#86868b]" />
          </button>
        </div>

        <div className="p-4 flex flex-wrap items-center gap-3 border-b border-black/5">
          <span className="text-sm font-medium text-[#1d1d1f]">展示词数</span>
          {([30, 50, 100] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setTopN(n)}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all ${
                topN === n
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'bg-[#f5f5f7] text-[#86868b] hover:bg-indigo-50 hover:text-indigo-700'
              }`}
            >
              前 {n} 词
            </button>
          ))}
          <span className="text-xs text-[#86868b] ml-auto">共 {products.length} 个 ASIN 参与统计</span>
        </div>

        {products.length > 0 && (
          <div className="px-4 pb-3 border-b border-black/5">
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-[#1d1d1f]">核心关键词（AI）</div>
                  <p className="text-[11px] text-[#86868b] mt-0.5">
                    读取当前范围内<strong className="text-indigo-700"> 销售额 Top{TOP_FOR_AI} </strong>
                    条标题，归纳 1～3 个英文检索短语（如 laundry shoe bag）
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={kwLoading}
                    onClick={() => void runCoreKeywordAi(false)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {kwLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {coreKeywords?.length ? '再次提炼' : '智能提炼'}
                  </button>
                  {coreKeywords?.length ? (
                    <button
                      type="button"
                      disabled={kwLoading}
                      onClick={() => void runCoreKeywordAi(true)}
                      className="px-3 py-2 rounded-xl text-xs font-semibold text-indigo-700 border border-indigo-200 hover:bg-white disabled:opacity-50"
                    >
                      强制重新分析
                    </button>
                  ) : null}
                </div>
              </div>
              {coreKeywords && coreKeywords.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {coreKeywords.map((kw) => (
                    <span
                      key={kw}
                      className="px-3 py-1.5 rounded-lg bg-white border border-indigo-100 text-sm font-medium text-indigo-900 shadow-sm"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="p-4 flex-1 min-h-0 flex flex-col">
          {list.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-[#86868b] text-sm">{emptyHint}</div>
          ) : (
            <div
              ref={wrapRef}
              className="w-full flex-1 min-h-[416px] rounded-xl border border-black/5 overflow-hidden bg-[#fafafa]"
            >
              <canvas ref={canvasRef} className="w-full h-full block" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
