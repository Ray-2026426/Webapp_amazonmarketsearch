import React, { useMemo, useState } from 'react';
import {
  Crosshair, Loader2, Sparkles, Image as ImageIcon, Activity, Grid3X3, Plus, X, RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import { CompetitorAnalysis } from './CompetitorAnalysis';
import {
  SELLERSPRITE_MARKETPLACES,
  normalizeMarketplaceCode,
  parseAsinList,
  fetchAsinDetailFromMcp,
  fetchTrafficStatFromMcp,
  fetchKeywordsFromMcp,
  type AsinDetailSnapshot,
  type TrafficStatSnapshot,
} from '../utils/sellerspriteApi';
import type { Keyword, Product } from '../utils/parser';
import { loadAiSettings, generateText } from '../utils/aiConfig';
import { toast } from 'sonner';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type HubTab = 'listing' | 'traffic' | 'matrix';

interface CompetitorHubProps {
  products: Product[];
  marketplaceCode?: string;
  domain?: string;
  /** 大盘勾选的 ASIN，可作为默认对比池 */
  preselectedAsins?: string[];
}

const MAX_ASINS = 5;

function fmtNum(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export const CompetitorHub: React.FC<CompetitorHubProps> = ({
  products,
  marketplaceCode = 'US',
  preselectedAsins = [],
}) => {
  const [tab, setTab] = useState<HubTab>('listing');
  const [asinInput, setAsinInput] = useState('');
  const [selected, setSelected] = useState<string[]>(() =>
    preselectedAsins.slice(0, MAX_ASINS).map((a) => a.toUpperCase())
  );
  const [marketplace, setMarketplace] = useState(normalizeMarketplaceCode(marketplaceCode));

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [details, setDetails] = useState<AsinDetailSnapshot[]>([]);
  const [trafficStats, setTrafficStats] = useState<TrafficStatSnapshot[]>([]);
  const [topKeywords, setTopKeywords] = useState<Record<string, Keyword[]>>({});
  const [aiBrief, setAiBrief] = useState('');

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

  const removeAsin = (asin: string) => setSelected((prev) => prev.filter((a) => a !== asin));

  const runFetch = async () => {
    if (!selected.length) {
      toast.error('请先选择至少 1 个 ASIN');
      return;
    }
    setLoading(true);
    setProgress('开始拉取竞品数据…');
    setAiBrief('');
    try {
      const detailList: AsinDetailSnapshot[] = [];
      const trafficList: TrafficStatSnapshot[] = [];
      const kwMap: Record<string, Keyword[]> = {};

      for (let i = 0; i < selected.length; i++) {
        const asin = selected[i];
        setProgress(`(${i + 1}/${selected.length}) 拉取 ${asin} Listing…`);
        try {
          detailList.push(await fetchAsinDetailFromMcp(asin, marketplace));
        } catch (e) {
          toast.warning(`${asin} Listing 拉取失败：${e instanceof Error ? e.message : ''}`);
        }

        setProgress(`(${i + 1}/${selected.length}) 拉取 ${asin} 流量结构…`);
        try {
          trafficList.push(await fetchTrafficStatFromMcp(asin, marketplace));
        } catch (e) {
          toast.warning(`${asin} 流量结构拉取失败：${e instanceof Error ? e.message : ''}`);
        }

        setProgress(`(${i + 1}/${selected.length}) 拉取 ${asin} 核心流量词…`);
        try {
          const kws = await fetchKeywordsFromMcp({
            asin,
            marketplace,
            maxPages: 1,
            pageSize: 20,
          });
          kwMap[asin] = kws.slice(0, 15);
        } catch {
          kwMap[asin] = [];
        }
      }

      setDetails(detailList);
      setTrafficStats(trafficList);
      setTopKeywords(kwMap);
      toast.success(`已完成 ${selected.length} 个 ASIN 的基础对比数据拉取`);

      // 可选：一键 AI 对比摘要
      const cfg = loadAiSettings();
      if (cfg?.apiKey && detailList.length >= 2) {
        setProgress('正在生成 AI 对比摘要…');
        try {
          const briefPrompt = `你是亚马逊竞品分析顾问。请用中文输出一份简洁对比纪要（Markdown），面向业务负责人，结论先行。

## 对比 ASIN
${detailList
  .map(
    (d, idx) =>
      `### ${idx + 1}. ${d.asin}
- 品牌：${d.brand}
- 标题：${d.title}
- 价格：${d.price}
- 评分：${d.rating}（${d.ratings} 评）
- LQS：${d.lqs}
- 卖家数：${d.sellers}，配送：${d.fulfillment}
- 类目：${d.categoryPath}
- 五点摘录：${d.features.slice(0, 3).join(' | ') || '无'}`
  )
  .join('\n\n')}

## 流量结构
${trafficList
  .map((t) => `- ${t.asin}：流量词 ${t.keywords}，有排名词 ${t.ranks}，广告词 ${t.ads}`)
  .join('\n')}

请输出：
1. 一句话总判断
2. Listing 优劣势对照（表格或要点）
3. 流量结构差异与机会
4. 3 条可执行动作建议`;
          const text = await generateText(briefPrompt, cfg);
          setAiBrief(text);
        } catch (e) {
          toast.warning(`AI 摘要失败：${e instanceof Error ? e.message : ''}`);
        }
      }
    } finally {
      setLoading(false);
      setProgress('');
    }
  };

  const tabs: { id: HubTab; label: string; icon: React.ReactNode; desc: string }[] = [
    { id: 'listing', label: '① Listing', icon: <ImageIcon className="w-4 h-4" />, desc: '主图/A+/五点视觉与文案拆解' },
    { id: 'traffic', label: '② 流量', icon: <Activity className="w-4 h-4" />, desc: '流量结构与核心词对比' },
    { id: 'matrix', label: '③ 产品矩阵', icon: <Grid3X3 className="w-4 h-4" />, desc: '价格销量评分等全盘对照' },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-[24px] font-bold text-[#1d1d1f] tracking-tight flex items-center gap-2">
          <Crosshair className="w-6 h-6 text-indigo-600" />
          竞品分析
        </h2>
        <p className="text-[#86868b] text-sm mt-1">
          选定 2–5 个 ASIN，从 Listing、流量结构、产品矩阵三视角做全盘对比。
        </p>
      </div>

      {/* ASIN 选择器 */}
      <Card className="border-none shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">对比池</CardTitle>
          <CardDescription>可从大盘快捷填入，也可手动粘贴 ASIN（最多 {MAX_ASINS} 个）</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={marketplace}
              onChange={(e) => setMarketplace(normalizeMarketplaceCode(e.target.value))}
              className="border border-black/10 rounded-xl px-3 py-2 text-sm bg-white"
            >
              {SELLERSPRITE_MARKETPLACES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input
              value={asinInput}
              onChange={(e) => setAsinInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addAsins(asinInput);
              }}
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
            <button
              type="button"
              onClick={runFetch}
              disabled={loading || selected.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              拉取对比数据
            </button>
          </div>

          <div className="flex flex-wrap gap-2 min-h-[36px]">
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
          {progress && (
            <div className="text-xs text-violet-700 bg-violet-50 rounded-lg px-3 py-2">{progress}</div>
          )}
        </CardContent>
      </Card>

      {/* 子模块切换 */}
      <div className="flex gap-1 bg-[#f5f5f7] p-1 rounded-2xl w-fit flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              tab === t.id ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#86868b] hover:text-[#1d1d1f]'
            }`}
            title={t.desc}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {aiBrief && (
        <Card className="border-indigo-100 bg-indigo-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              AI 对比摘要
            </CardTitle>
          </CardHeader>
          <CardContent className="prose prose-sm max-w-none text-[#1d1d1f]">
            <Markdown remarkPlugins={[remarkGfm]}>{aiBrief}</Markdown>
          </CardContent>
        </Card>
      )}

      {tab === 'listing' && (
        <div className="space-y-4">
          {details.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Listing 要点对照（来自卖家精灵详情）</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm min-w-[720px]">
                  <thead>
                    <tr className="text-left text-xs text-[#86868b] border-b border-black/5">
                      <th className="py-2 pr-3">ASIN</th>
                      <th className="py-2 pr-3">品牌</th>
                      <th className="py-2 pr-3">价格</th>
                      <th className="py-2 pr-3">评分</th>
                      <th className="py-2 pr-3">评论数</th>
                      <th className="py-2 pr-3">LQS</th>
                      <th className="py-2">五点前 2 条</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.map((d) => (
                      <tr key={d.asin} className="border-b border-black/5 align-top">
                        <td className="py-2 pr-3 font-mono text-xs">{d.asin}</td>
                        <td className="py-2 pr-3">{d.brand || '-'}</td>
                        <td className="py-2 pr-3">{d.price ? d.price.toFixed(2) : '-'}</td>
                        <td className="py-2 pr-3">{d.rating || '-'}</td>
                        <td className="py-2 pr-3">{fmtNum(d.ratings)}</td>
                        <td className="py-2 pr-3">{d.lqs || '-'}</td>
                        <td className="py-2 text-xs text-[#86868b] max-w-xs">
                          {d.features.slice(0, 2).join(' / ') || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
          <div className="rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/20 p-3 text-xs text-indigo-800">
            下方是「主图 / A+ / 五点」视觉文案深度拆解：上传竞品图包 ZIP 即可。适合和上方数据表一起看。
          </div>
          <CompetitorAnalysis />
        </div>
      )}

      {tab === 'traffic' && (
        <div className="space-y-4">
          {trafficStats.length === 0 ? (
            <EmptyHint text="先在上方点「拉取对比数据」，会抓取各 ASIN 的流量词规模与核心词。" />
          ) : (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">流量结构对比</CardTitle>
                  <CardDescription>keywords=流量词总量；ranks=有排名词；ads=广告词</CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[560px]">
                    <thead>
                      <tr className="text-left text-xs text-[#86868b] border-b border-black/5">
                        <th className="py-2 pr-3">ASIN</th>
                        <th className="py-2 pr-3">流量词</th>
                        <th className="py-2 pr-3">有排名词</th>
                        <th className="py-2 pr-3">广告词</th>
                        <th className="py-2">广告依赖度（广告词/流量词）</th>
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
            </>
          )}
        </div>
      )}

      {tab === 'matrix' && (
        <div className="space-y-4">
          {selected.length === 0 ? (
            <EmptyHint text="先添加 ASIN。矩阵会优先用大盘已有数据，并与 MCP 详情互补。" />
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">产品矩阵对照</CardTitle>
                <CardDescription>大盘字段 + MCP 详情字段并排，方便找差异化切入点</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm min-w-[960px]">
                  <thead>
                    <tr className="text-left text-xs text-[#86868b] border-b border-black/5">
                      <th className="py-2 pr-2">ASIN</th>
                      <th className="py-2 pr-2">品牌</th>
                      <th className="py-2 pr-2">大盘价</th>
                      <th className="py-2 pr-2">MCP价</th>
                      <th className="py-2 pr-2">月销量</th>
                      <th className="py-2 pr-2">评分</th>
                      <th className="py-2 pr-2">评论</th>
                      <th className="py-2 pr-2">BSR</th>
                      <th className="py-2 pr-2">上架</th>
                      <th className="py-2 pr-2">LQS</th>
                      <th className="py-2">流量词</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.map((asin) => {
                      const p = productMap.get(asin);
                      const d = details.find((x) => x.asin === asin);
                      const t = trafficStats.find((x) => x.asin === asin);
                      return (
                        <tr key={asin} className="border-b border-black/5">
                          <td className="py-2 pr-2 font-mono text-xs">{asin}</td>
                          <td className="py-2 pr-2">{d?.brand || p?.brand || '-'}</td>
                          <td className="py-2 pr-2">{p ? p.price.toFixed(2) : '-'}</td>
                          <td className="py-2 pr-2">{d?.price ? d.price.toFixed(2) : '-'}</td>
                          <td className="py-2 pr-2 font-semibold">{p ? fmtNum(p.monthlySales) : '-'}</td>
                          <td className="py-2 pr-2">{(d?.rating || p?.rating || 0) || '-'}</td>
                          <td className="py-2 pr-2">{fmtNum(d?.ratings || p?.reviewCount || 0)}</td>
                          <td className="py-2 pr-2">{p?.subBsr ? `#${fmtNum(p.subBsr)}` : '-'}</td>
                          <td className="py-2 pr-2 text-xs">{p?.launchDate || '-'}</td>
                          <td className="py-2 pr-2">{d?.lqs || '-'}</td>
                          <td className="py-2">{t ? fmtNum(t.keywords) : '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
};

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-black/10 bg-white p-10 text-center text-sm text-[#86868b]">
      {text}
    </div>
  );
}
