import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import {
  Upload, FileSpreadsheet, Brain, Trash2, Edit2, Check, X, Filter, ExternalLink, Zap, Search,
  Target, Lightbulb, Sparkles, TrendingUp, Tag, Download, ArrowUpDown, ChevronDown, ChevronUp,
  Users, Map, Route, HeartHandshake,
} from 'lucide-react';
import { Keyword } from '../utils/parser';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  BarChart, Bar,
} from 'recharts';
import {
  IntentStat, JTBDStat, ScenarioInsights, AiInsight, INTENT_META, JOB_TYPE_META, SC, TAGS,
  calcKwValueDensity,
} from './KeywordAnalysis';

const scoreColor = (s: number) => s >= 75 ? '#10b981' : s >= 60 ? '#3b82f6' : s >= 45 ? '#f59e0b' : '#9ca3af';
const scoreBg = (s: number) => s >= 75 ? 'bg-emerald-50' : s >= 60 ? 'bg-blue-50' : s >= 45 ? 'bg-amber-50' : 'bg-[#f5f5f7]';
const fmtNum = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0);

const TL = [
  { id: 'ss', name: '卖家精灵', desc: 'ABA 关键词反查', url: 'https://www.sellersprite.com/v3/aba-research', bg: 'bg-violet-50', bd: 'border-violet-100', ac: 'text-violet-600', ib: 'bg-violet-100', tag: 'ABA 反查' },
  { id: 'xy', name: '西柚找词', desc: '搜索词浏览器', url: 'https://www.xiyouzhaoci.com/searchTerm_explorer?country=US', bg: 'bg-orange-50', bd: 'border-orange-100', ac: 'text-orange-500', ib: 'bg-orange-100', tag: '搜索词挖掘' },
];

const TB = () => (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
    {TL.map(t => (
      <a key={t.id} href={t.url} target="_blank" rel="noopener noreferrer"
        className={`group flex items-center gap-4 p-4 rounded-2xl border ${t.bd} ${t.bg} hover:shadow-md transition-all hover:-translate-y-0.5 no-underline`}>
        <div className={`w-11 h-11 rounded-xl ${t.ib} flex items-center justify-center shrink-0`}>
          <span className={`text-lg font-black ${t.ac}`}>{t.name[0]}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-[#1d1d1f] text-[15px]">{t.name}</span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${t.bg} ${t.ac} border ${t.bd}`}>{t.tag}</span>
          </div>
          <p className="text-xs text-[#86868b] mt-0.5 truncate">{t.desc}</p>
        </div>
        <ExternalLink className={`w-4 h-4 ${t.ac} opacity-50 group-hover:opacity-100 shrink-0`} />
      </a>
    ))}
  </div>
);

const JTBDTip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as JTBDStat & { color: string };
  const jm = JOB_TYPE_META[d.jobType];
  return (
    <div className="bg-white border border-black/10 rounded-2xl shadow-xl p-4 max-w-[260px]">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="font-bold text-[#1d1d1f] text-sm truncate">{d.job}</span>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
          style={{ color: scoreColor(d.opportunityScore), backgroundColor: `${scoreColor(d.opportunityScore)}1A` }}>
          {d.opportunityScore}分
        </span>
      </div>
      <div className="space-y-1 text-xs text-[#86868b]">
        {[
          ['任务类型', jm.label],
          ['周搜索量', d.totalVolume.toLocaleString()],
          ['平均CPC', `$${d.avgCpc.toFixed(2)}`],
          ['均CVR', `${(d.avgCvr * 100).toFixed(1)}%`],
          ['平均难度', d.avgDifficulty.toFixed(1)],
          ['词数', String(d.count)],
        ].map(([l, v]) => (
          <div key={String(l)} className="flex justify-between gap-4">
            <span>{l}</span>
            <span className="font-semibold text-[#1d1d1f]">{v}</span>
          </div>
        ))}
      </div>
      {d.topKeywords?.length > 0 && (
        <div className="mt-2 pt-2 border-t border-black/5">
          <div className="text-[10px] text-[#86868b] mb-1">代表词</div>
          <div className="flex flex-wrap gap-1">
            {d.topKeywords.slice(0, 3).map((kw: string) => (
              <span key={kw} className="text-[10px] bg-[#f5f5f7] px-1.5 py-0.5 rounded">{kw}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export type InsightTab = 'intent' | 'jtbd' | 'scenario' | 'report';

export interface KwViewProps {
  keywords: Keyword[];
  hasInsight: boolean;
  intentStats: IntentStat[];
  jtbdStats: JTBDStat[];
  scenarioInsights: ScenarioInsights;
  tStat: { name: string; count: number; vol: number }[];
  filt: Keyword[];
  totVol: number;
  isAI: boolean;
  prog: { c: number; t: number };
  tab: InsightTab;
  setTab: (t: InsightTab) => void;
  seg: string | null;
  setSeg: (s: string | null) => void;
  ins: AiInsight | null;
  genIns: boolean;
  showT: boolean;
  setShowT: (v: boolean) => void;
  q: string;
  setQ: (v: string) => void;
  cat: string;
  setCat: (v: string) => void;
  eid: string | null;
  etags: string[];
  seedHint: string;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRunAI: () => void;
  onStop: () => void;
  onGenAI: () => void;
  onClear: () => void;
  onExport: () => void;
  onStartEdit: (kw: Keyword) => void;
  onSaveEdit: (id: string) => void;
  onCancelEdit: () => void;
  headerExtra?: React.ReactNode;
  onTogTag: (tag: string) => void;
}

export function KwView(p: KwViewProps) {
  const {
    keywords, hasInsight, intentStats, jtbdStats, scenarioInsights, tStat, filt, totVol,
    isAI, prog, tab, setTab, seg, setSeg, ins, genIns, showT, setShowT,
    q, setQ, cat, setCat, eid, etags, seedHint,
    onUpload, onRunAI, onStop, onGenAI, onClear, onExport,
    onStartEdit, onSaveEdit, onCancelEdit, onTogTag, headerExtra,
  } = p;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-4 h-4 text-indigo-500" />
          <span className="text-sm font-semibold text-[#1d1d1f]">选词工具快捷入口</span>
          <span className="text-xs text-[#86868b]">— 新标签页，浏览器可记住密码</span>
        </div>
        <TB />
      </div>

      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-[#f5f5f7]/50 border-b border-black/5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-indigo-600" />关键词数据
              </CardTitle>
              <CardDescription>
                推荐：输入种子关键词抓 ABA 关联词；也可输入 ASIN 抓竞品流量词，或上传 Excel
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {headerExtra}
              {keywords.length > 0 && (
                <>
                  <button onClick={onExport}
                    className="flex items-center gap-1.5 px-3 py-2 bg-[#f5f5f7] border border-black/5 rounded-xl text-xs font-medium text-[#86868b] hover:text-emerald-600 transition-colors">
                    <Download className="w-3.5 h-3.5" />导出 Excel
                  </button>
                  <button onClick={isAI ? onStop : onRunAI}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${isAI ? 'bg-rose-50 text-rose-600' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
                    <Brain className="w-4 h-4" />
                    {isAI ? `取消(${prog.c}/${prog.t})` : 'AI 用户洞察'}
                  </button>
                  <button onClick={onClear} className="flex items-center gap-2 bg-rose-50 text-rose-600 px-3 py-2 rounded-xl text-sm font-medium">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {keywords.length === 0 ? (
            <div className="border-2 border-dashed border-black/10 rounded-[24px] p-12 flex flex-col items-center text-center hover:border-indigo-500 hover:bg-indigo-50/30 transition-all cursor-pointer relative group">
              <input type="file" accept=".xlsx,.xls,.csv" onChange={onUpload}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
              <div className="w-16 h-16 bg-[#f5f5f7] rounded-full flex items-center justify-center mb-4 group-hover:bg-indigo-100">
                <Upload className="w-8 h-8 text-[#86868b] group-hover:text-indigo-600" />
              </div>
              <h3 className="text-lg font-semibold text-[#1d1d1f]">点击上传，或用右上角「在线抓取关键词」</h3>
              <p className="text-sm text-[#86868b] mt-2 max-w-md">
                推荐输入种子关键词拉 ABA 词库做用户洞察；也可填竞品 ASIN 拉流量词
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {seedHint && (
                <div className="text-xs text-violet-700 bg-violet-50 border border-violet-100 rounded-xl px-3 py-2">
                  当前种子词：<span className="font-semibold">{seedHint}</span>
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { l: '总词数', v: keywords.length.toLocaleString(), c: 'text-[#1d1d1f]' },
                  { l: '总周搜索量', v: totVol.toLocaleString(), c: 'text-emerald-600' },
                  { l: '用户任务', v: `${jtbdStats.length} 个`, c: 'text-indigo-600' },
                  { l: '已洞察标注', v: `${keywords.filter(k => k.userIntentStage || k.jobToBeDone).length} 个`, c: 'text-violet-600' },
                ].map(m => (
                  <div key={m.l} className="bg-[#f5f5f7] p-4 rounded-2xl border border-black/5">
                    <div className="text-xs text-[#86868b] uppercase tracking-wider mb-1">{m.l}</div>
                    <div className={`text-2xl font-bold ${m.c}`}>{m.v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {keywords.length > 0 && (
        <>
          <div className="flex gap-1 bg-[#f5f5f7] p-1 rounded-2xl w-fit flex-wrap">
            {([
              { id: 'intent' as const, l: '意图画像', I: Route, s: true },
              { id: 'jtbd' as const, l: 'JTBD 地图', I: Target, s: hasInsight },
              { id: 'scenario' as const, l: '场景洞察', I: Map, s: hasInsight },
              { id: 'report' as const, l: '用户报告', I: Lightbulb, s: true },
            ]).filter(t => t.s).map(({ id, l, I }) => (
              <button key={id} onClick={() => setTab(id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${tab === id ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#86868b] hover:text-[#1d1d1f]'}`}>
                <I className="w-4 h-4" />{l}
              </button>
            ))}
          </div>

          {tab === 'intent' && <IntentTab hasInsight={hasInsight} intentStats={intentStats} tStat={tStat} />}
          {tab === 'jtbd' && hasInsight && (
            <JtbdTab jtbdStats={jtbdStats} keywords={keywords} seg={seg} setSeg={setSeg} />
          )}
          {tab === 'scenario' && hasInsight && (
            <ScenarioTab insights={scenarioInsights} keywords={keywords} seg={seg} setSeg={setSeg} />
          )}
          {tab === 'report' && (
            <ReportTab ins={ins} hasInsight={hasInsight} genIns={genIns} onGenAI={onGenAI} setSeg={setSeg} setTab={setTab} />
          )}

          <div>
            <button type="button" onClick={() => setShowT(!showT)}
              className="flex items-center gap-2 text-sm text-[#86868b] hover:text-[#1d1d1f] font-medium">
              <Filter className="w-4 h-4" />
              {showT ? '收起' : '展开'}原始关键词表
              <span className="text-xs bg-[#f5f5f7] px-2 py-0.5 rounded-full border border-black/5">{keywords.length} 个词</span>
            </button>
          </div>
          {showT && (
            <RawTable
              filt={filt} eid={eid} etags={etags} q={q} setQ={setQ} cat={cat} setCat={setCat}
              onStartEdit={onStartEdit} onSaveEdit={onSaveEdit} onCancelEdit={onCancelEdit} onTogTag={onTogTag}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── IntentTab 意图画像 ───────────────────────────────────────────────────────
function IntentTab({
  hasInsight, intentStats, tStat,
}: {
  hasInsight: boolean;
  intentStats: IntentStat[];
  tStat: { name: string; count: number; vol: number }[];
}) {
  const dominant = useMemo(() => {
    if (!intentStats.length) return null;
    return [...intentStats].sort((a, b) => b.share - a.share)[0];
  }, [intentStats]);

  const funnelData = useMemo(
    () => intentStats.map(s => ({
      name: INTENT_META[s.stage].label,
      stage: s.stage,
      count: s.count,
      volume: s.totalVolume,
      share: Math.round(s.share * 100),
      color: INTENT_META[s.stage].color,
    })),
    [intentStats]
  );

  return (
    <div className="space-y-6">
      {!hasInsight && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 flex items-center gap-3">
          <Sparkles className="w-5 h-5 text-indigo-500 shrink-0" />
          <p className="text-sm text-indigo-700">
            点击「AI 用户洞察」，系统会按购买意图、JTBD 任务、场景/人群/痛点三合一标注，解锁意图漏斗与任务地图。
          </p>
        </div>
      )}

      {hasInsight && dominant && (
        <div className="bg-gradient-to-r from-violet-50 via-blue-50 to-emerald-50 border border-black/5 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center shrink-0">
              <Users className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <div className="text-sm font-bold text-[#1d1d1f] mb-1">意图画像结论</div>
              <p className="text-sm text-[#1d1d1f] leading-relaxed">
                用户主要处于「
                <span style={{ color: INTENT_META[dominant.stage].color }} className="font-semibold">
                  {INTENT_META[dominant.stage].label}
                </span>
                」阶段（约占 {(dominant.share * 100).toFixed(0)}% 词量）。
                {INTENT_META[dominant.stage].desc}。
                {dominant.stage === 'consideration' && '说明该品类用户决策谨慎，Listing 需强化对比卖点与场景匹配。'}
                {dominant.stage === 'awareness' && '说明用户仍在找方案，内容种草与问题解决型标题更有效。'}
                {dominant.stage === 'decision' && '说明需求明确、转化导向强，规格图与价格锚点更关键。'}
                {dominant.stage === 'loyalty' && '说明复购/品牌忠诚流量突出，配件与替换件值得布局。'}
              </p>
            </div>
          </div>
        </div>
      )}

      {hasInsight && funnelData.length > 0 && (
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Route className="w-4 h-4 text-violet-600" />
              购买意图漏斗
              <span className="text-xs font-normal text-[#86868b] ml-1">（按关键词数占比）</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelData} layout="vertical" margin={{ left: 8, right: 50, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} fontSize={12} width={70} />
                <Tooltip
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0/0.1)' }}
                  formatter={(v: number, name: string) => [
                    name === 'count' ? `${v} 个词` : v.toLocaleString(),
                    name === 'count' ? '词数' : '周搜索量',
                  ]}
                />
                <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={22}
                  label={{ position: 'right', fontSize: 11, formatter: (v: number) => `${v}` }}>
                  {funnelData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {hasInsight && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {intentStats.map(s => {
            const meta = INTENT_META[s.stage];
            return (
              <Card key={s.stage} className="border-none shadow-sm overflow-hidden">
                <CardHeader className={`${meta.bg} border-b border-black/5`}>
                  <CardTitle className="text-sm font-semibold flex items-center justify-between">
                    <span style={{ color: meta.color }}>{meta.label}</span>
                    <span className="text-xs font-normal text-[#86868b]">
                      {s.count} 词 · {(s.share * 100).toFixed(0)}%
                    </span>
                  </CardTitle>
                  <CardDescription>{meta.desc}</CardDescription>
                </CardHeader>
                <CardContent className="p-4">
                  <div className="text-xs text-[#86868b] mb-2">
                    周搜索量 {s.totalVolume.toLocaleString()} · 均CVR {(s.avgCvr * 100).toFixed(1)}%
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {s.topKeywords.length ? s.topKeywords.map(kw => (
                      <span key={kw} className="px-2 py-0.5 bg-[#f5f5f7] text-[#1d1d1f] rounded-full text-[11px] border border-black/5">
                        {kw}
                      </span>
                    )) : <span className="text-xs text-[#86868b]">暂无代表词</span>}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {tStat.length > 0 && (
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Tag className="w-4 h-4 text-violet-600" />
              词类分布
              <span className="text-xs font-normal text-[#86868b] ml-1">（辅助理解用户搜索习惯）</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={tStat} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} fontSize={11} width={60} />
                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0/0.1)' }} />
                <Bar dataKey="count" name="词数" radius={[0, 6, 6, 0]} barSize={16} label={{ position: 'right', fontSize: 10 }}>
                  {tStat.map((_, i) => <Cell key={i} fill={SC[i % SC.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── JtbdTab JTBD 地图 ────────────────────────────────────────────────────────
function JtbdTab({
  jtbdStats, keywords, seg, setSeg,
}: {
  jtbdStats: JTBDStat[];
  keywords: Keyword[];
  seg: string | null;
  setSeg: (s: string | null) => void;
}) {
  const scat = useMemo(() => jtbdStats.map((s, i) => ({
    ...s,
    x: s.totalVolume,
    y: s.avgCpc,
    z: Math.max(s.count * 6, 80),
    color: JOB_TYPE_META[s.jobType].color || SC[i % SC.length],
  })), [jtbdStats]);

  const selected = jtbdStats.find(j => j.job === seg);
  const words = useMemo(() => {
    if (!seg) return [];
    return keywords
      .filter(k => (k.jobToBeDone || '').trim() === seg)
      .sort((a, b) => b.weeklySearchVolume - a.weeklySearchVolume);
  }, [keywords, seg]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {(Object.keys(JOB_TYPE_META) as JobTypeKey[]).map((k) => {
          const m = JOB_TYPE_META[k];
          const count = jtbdStats.filter(j => j.jobType === k).length;
          return (
            <div key={k} className={`${m.bg} border border-black/5 rounded-2xl p-3`}>
              <div className="font-bold text-sm mb-0.5" style={{ color: m.color }}>{m.label}</div>
              <div className="text-xs text-[#86868b]">{count} 个用户任务</div>
            </div>
          );
        })}
      </div>

      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-blue-50 via-pink-50 to-emerald-50 border-b border-black/5">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <HeartHandshake className="w-4 h-4 text-pink-500" />
            用户任务机会排行
            <span className="text-xs font-normal text-[#86868b] ml-1">用户「雇用」产品要完成什么</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-black/5">
            {jtbdStats.map((j, i) => (
              <button key={j.job} onClick={() => setSeg(j.job)}
                className={`w-full flex items-center gap-3 px-5 py-3 hover:bg-[#f5f5f7]/50 transition-colors text-left ${seg === j.job ? 'bg-indigo-50/50' : ''}`}>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${i < 3 ? 'bg-gradient-to-br from-amber-400 to-amber-500 text-white shadow-md' : 'bg-[#f5f5f7] text-[#86868b]'}`}>
                  <span className="text-sm font-bold">{i + 1}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-[#1d1d1f] text-sm truncate">{j.job}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium border"
                      style={{
                        background: `${JOB_TYPE_META[j.jobType].color}15`,
                        color: JOB_TYPE_META[j.jobType].color,
                        borderColor: `${JOB_TYPE_META[j.jobType].color}33`,
                      }}>
                      {JOB_TYPE_META[j.jobType].label}
                    </span>
                    <span className="text-[10px] text-[#86868b]">{j.count}个词 · {j.totalVolume.toLocaleString()}/周</span>
                  </div>
                  <div className="text-xs text-[#86868b] mt-1 truncate">
                    代表词：{j.topKeywords.slice(0, 3).join('、')}
                  </div>
                </div>
                <div className={`flex flex-col items-center justify-center w-16 h-12 rounded-xl ${scoreBg(j.opportunityScore)} shrink-0`}>
                  <span className="text-xl font-bold" style={{ color: scoreColor(j.opportunityScore) }}>{j.opportunityScore}</span>
                  <span className="text-[9px] text-[#86868b] -mt-0.5">分</span>
                </div>
              </button>
            ))}
            {!jtbdStats.length && (
              <div className="p-8 text-center text-sm text-[#86868b]">暂无 JTBD 任务，请重新跑 AI 用户洞察</div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Target className="w-4 h-4 text-rose-500" />
            JTBD 需求-竞争地图
            <span className="text-xs font-normal text-[#86868b] ml-1">X=需求强度 · Y=竞争成本(CPC) · 颜色=任务类型</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="h-[420px]">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis type="number" dataKey="x"
                tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
                label={{ value: '需求（周搜索量）', position: 'insideBottom', offset: -10, fontSize: 11, fill: '#86868b' }} />
              <YAxis type="number" dataKey="y"
                tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                label={{ value: '竞争（均CPC）', angle: -90, position: 'insideLeft', offset: 10, fontSize: 11, fill: '#86868b' }} />
              <Tooltip content={<JTBDTip />} />
              <Scatter data={scat} onClick={(d: any) => setSeg(d.job)} cursor="pointer">
                {scat.map((d, i) => <Cell key={i} fill={d.color} fillOpacity={0.85} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {selected && (
        <Card className="border-none shadow-sm overflow-hidden">
          <CardHeader className="bg-[#f5f5f7]/50 border-b border-black/5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">任务「{selected.job}」关键词</CardTitle>
              <button onClick={() => setSeg(null)} className="text-xs text-[#86868b] hover:text-[#1d1d1f]">清除筛选</button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-[#86868b] uppercase bg-[#f5f5f7] border-b border-black/5 sticky top-0">
                  <tr>
                    <th className="px-5 py-3 font-medium">关键词</th>
                    <th className="px-5 py-3 font-medium text-right">周搜索量</th>
                    <th className="px-5 py-3 font-medium text-right">CPC</th>
                    <th className="px-5 py-3 font-medium text-right">转化率</th>
                    <th className="px-5 py-3 font-medium">意图</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5">
                  {words.slice(0, 40).map(kw => (
                    <tr key={kw.id} className="hover:bg-[#f5f5f7]/50">
                      <td className="px-5 py-3">
                        <div className="font-medium text-[#1d1d1f]">{kw.keyword}</div>
                        <div className="text-xs text-[#86868b]">{kw.translation}</div>
                      </td>
                      <td className="px-5 py-3 text-right font-mono">{kw.weeklySearchVolume.toLocaleString()}</td>
                      <td className="px-5 py-3 text-right font-mono">${kw.cpcBid.toFixed(2)}</td>
                      <td className="px-5 py-3 text-right font-mono">{(kw.conversionRate * 100).toFixed(2)}%</td>
                      <td className="px-5 py-3">
                        {kw.userIntentStage ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                            style={{
                              color: INTENT_META[kw.userIntentStage].color,
                              background: `${INTENT_META[kw.userIntentStage].color}15`,
                            }}>
                            {INTENT_META[kw.userIntentStage].label}
                          </span>
                        ) : <span className="text-xs text-[#86868b]">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

type JobTypeKey = keyof typeof JOB_TYPE_META;

// ─── ScenarioTab 场景洞察 ─────────────────────────────────────────────────────
function ScenarioTab({
  insights, keywords, seg, setSeg,
}: {
  insights: ScenarioInsights;
  keywords: Keyword[];
  seg: string | null;
  setSeg: (s: string | null) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  type SortKey = 'weeklySearchVolume' | 'cpcBid' | 'conversionRate' | 'difficulty' | 'value';
  const [sortCol, setSortCol] = useState<SortKey>('weeklySearchVolume');
  const [sortAsc, setSortAsc] = useState(false);

  const words = useMemo(() => {
    if (!seg) return [];
    const list = keywords.filter(k =>
      (k.useScenario || '').trim() === seg ||
      (k.targetUser || '').trim() === seg ||
      (k.painPoint || '').trim() === seg ||
      (k.featureDemand || '').trim() === seg
    );
    const getVal = (k: Keyword) => {
      if (sortCol === 'value') return calcKwValueDensity(k);
      return k[sortCol] as number;
    };
    return list.sort((a, b) => sortAsc ? getVal(a) - getVal(b) : getVal(b) - getVal(a));
  }, [keywords, seg, sortCol, sortAsc]);

  const shown = showAll ? words : words.slice(0, 50);
  const toggleSort = (col: SortKey) => {
    if (sortCol === col) setSortAsc(v => !v);
    else { setSortCol(col); setSortAsc(false); }
  };

  const RankCard = ({
    title, icon: Icon, items, color,
  }: {
    title: string;
    icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
    items: { name: string; count: number; totalVolume: number; topKeywords: string[] }[];
    color: string;
  }) => (
    <Card className="border-none shadow-sm overflow-hidden">
      <CardHeader className="border-b border-black/5">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Icon className="w-4 h-4" style={{ color }} />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-black/5 max-h-[280px] overflow-y-auto">
          {items.slice(0, 10).map((item, i) => (
            <button key={item.name} onClick={() => setSeg(item.name)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[#f5f5f7]/60 ${seg === item.name ? 'bg-indigo-50/60' : ''}`}>
              <span className="w-6 text-xs font-bold text-[#86868b]">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[#1d1d1f] truncate">{item.name}</div>
                <div className="text-[10px] text-[#86868b]">{item.count} 词 · {item.totalVolume.toLocaleString()}/周</div>
              </div>
            </button>
          ))}
          {!items.length && <div className="p-6 text-center text-xs text-[#86868b]">暂无数据</div>}
        </div>
      </CardContent>
    </Card>
  );

  // 简易交叉热力：取 Top 场景 × Top 人群
  const heatScenarios = insights.scenarios.slice(0, 6).map(s => s.name);
  const heatUsers = insights.users.slice(0, 5).map(u => u.name);
  const heatMax = Math.max(1, ...insights.crossMatrix.map(c => c.volume));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <RankCard title="使用场景排行" icon={Map} items={insights.scenarios} color="#3b82f6" />
        <RankCard title="目标人群排行" icon={Users} items={insights.users} color="#8b5cf6" />
        <RankCard title="痛点排行榜" icon={TrendingUp} items={insights.painPoints} color="#ef4444" />
        <RankCard title="功能需求排行" icon={Tag} items={insights.features} color="#10b981" />
      </div>

      {heatScenarios.length > 0 && heatUsers.length > 0 && (
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Map className="w-4 h-4 text-indigo-600" />
              场景 × 人群交叉热力
              <span className="text-xs font-normal text-[#86868b] ml-1">颜色越深，搜索需求越强</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-xs min-w-[480px]">
              <thead>
                <tr>
                  <th className="p-2 text-left text-[#86868b] font-medium">场景 \ 人群</th>
                  {heatUsers.map(u => (
                    <th key={u} className="p-2 text-center text-[#86868b] font-medium max-w-[90px] truncate">{u}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatScenarios.map(sc => (
                  <tr key={sc}>
                    <td className="p-2 font-medium text-[#1d1d1f] max-w-[100px] truncate">{sc}</td>
                    {heatUsers.map(u => {
                      const cell = insights.crossMatrix.find(c => c.scenario === sc && c.user === u);
                      const vol = cell?.volume || 0;
                      const intensity = vol / heatMax;
                      return (
                        <td key={u} className="p-1">
                          <button
                            onClick={() => cell && setSeg(sc)}
                            className="w-full rounded-lg py-2 text-center font-mono text-[10px] transition-all"
                            style={{
                              background: vol > 0 ? `rgba(79,70,229,${0.12 + intensity * 0.7})` : '#f5f5f7',
                              color: intensity > 0.5 ? '#fff' : '#1d1d1f',
                            }}
                            title={cell ? `${cell.count} 词 · ${vol.toLocaleString()}/周` : '无交叉'}
                          >
                            {vol > 0 ? fmtNum(vol) : '—'}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {seg && (
        <Card className="border-none shadow-sm overflow-hidden">
          <CardHeader className="bg-[#f5f5f7]/50 border-b border-black/5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">「{seg}」相关关键词</CardTitle>
              <div className="flex items-center gap-3">
                <span className="text-xs text-[#86868b]">{words.length} 个词</span>
                <button onClick={() => setSeg(null)} className="text-xs text-[#86868b] hover:text-[#1d1d1f]">清除</button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-[#86868b] uppercase bg-[#f5f5f7] border-b border-black/5">
                  <tr>
                    <th className="px-5 py-3 font-medium">关键词 / 翻译</th>
                    <th className="px-5 py-3 font-medium text-right cursor-pointer hover:text-indigo-600 select-none" onClick={() => toggleSort('weeklySearchVolume')}>
                      <span className="flex items-center justify-end gap-1">周搜索量<ArrowUpDown className="w-3 h-3" /></span>
                    </th>
                    <th className="px-5 py-3 font-medium text-right cursor-pointer hover:text-indigo-600 select-none" onClick={() => toggleSort('cpcBid')}>
                      <span className="flex items-center justify-end gap-1">CPC<ArrowUpDown className="w-3 h-3" /></span>
                    </th>
                    <th className="px-5 py-3 font-medium text-right cursor-pointer hover:text-indigo-600 select-none" onClick={() => toggleSort('conversionRate')}>
                      <span className="flex items-center justify-end gap-1">转化率<ArrowUpDown className="w-3 h-3" /></span>
                    </th>
                    <th className="px-5 py-3 font-medium text-right cursor-pointer hover:text-indigo-600 select-none" onClick={() => toggleSort('value')}>
                      <span className="flex items-center justify-end gap-1">价值密度<ArrowUpDown className="w-3 h-3" /></span>
                    </th>
                    <th className="px-5 py-3 font-medium">意图</th>
                    <th className="px-5 py-3 font-medium">任务</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5">
                  {shown.map(kw => (
                    <tr key={kw.id} className="hover:bg-[#f5f5f7]/50">
                      <td className="px-5 py-3">
                        <div className="font-medium text-[#1d1d1f]">{kw.keyword}</div>
                        <div className="text-xs text-[#86868b]">{kw.translation}</div>
                      </td>
                      <td className="px-5 py-3 text-right font-mono">{kw.weeklySearchVolume.toLocaleString()}</td>
                      <td className="px-5 py-3 text-right font-mono">${kw.cpcBid.toFixed(2)}</td>
                      <td className="px-5 py-3 text-right font-mono">{(kw.conversionRate * 100).toFixed(2)}%</td>
                      <td className="px-5 py-3 text-right font-mono text-xs text-violet-600">{fmtNum(calcKwValueDensity(kw))}</td>
                      <td className="px-5 py-3">
                        {kw.userIntentStage ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                            style={{ color: INTENT_META[kw.userIntentStage].color, background: `${INTENT_META[kw.userIntentStage].color}15` }}>
                            {INTENT_META[kw.userIntentStage].label}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-5 py-3 text-xs text-[#1d1d1f]">{kw.jobToBeDone || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {words.length > 50 && (
              <div className="p-4 text-center border-t border-black/5">
                <button onClick={() => setShowAll(v => !v)} className="flex items-center gap-2 mx-auto text-sm text-indigo-600 hover:text-indigo-700 font-medium">
                  {showAll ? <><ChevronUp className="w-4 h-4" />收起</> : <><ChevronDown className="w-4 h-4" />显示全部 {words.length} 个词</>}
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!seg && (
        <div className="bg-[#f5f5f7] rounded-2xl p-6 text-center text-[#86868b] text-sm">
          点击上方排行中的场景 / 人群 / 痛点 / 功能，可下钻查看相关关键词
        </div>
      )}
    </div>
  );
}

// ─── ReportTab 用户报告 ───────────────────────────────────────────────────────
function ReportTab({
  ins, hasInsight, genIns, onGenAI, setSeg, setTab,
}: {
  ins: AiInsight | null;
  hasInsight: boolean;
  genIns: boolean;
  onGenAI: () => void;
  setSeg: (s: string | null) => void;
  setTab: (t: InsightTab) => void;
}) {
  if (!ins) {
    return (
      <div className="bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-100 rounded-[24px] p-10 flex flex-col items-center text-center gap-4">
        <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-md">
          <Lightbulb className="w-8 h-8 text-indigo-500" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-[#1d1d1f] mb-2">AI 用户洞察报告</h3>
          <p className="text-sm text-[#86868b] max-w-md">
            {hasInsight
              ? '基于意图分层、JTBD 任务与场景洞察，生成用户画像、决策路径与行动建议。'
              : '请先点击「AI 用户洞察」完成标注，再生成报告。'}
          </p>
        </div>
        <button onClick={onGenAI} disabled={genIns || !hasInsight}
          className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-semibold transition-all disabled:opacity-50 shadow-lg shadow-indigo-200">
          <Sparkles className={`w-4 h-4 ${genIns ? 'animate-spin' : ''}`} />
          {genIns ? '生成中...' : '生成用户洞察报告'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-amber-500" />市场总体判断
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[#1d1d1f] leading-relaxed">{ins.summary}</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Users className="w-4 h-4 text-violet-500" />用户画像
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[#1d1d1f] leading-relaxed">{ins.userPersona || '—'}</p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Route className="w-4 h-4 text-blue-500" />购买决策路径
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[#1d1d1f] leading-relaxed">{ins.decisionPath || '—'}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Target className="w-4 h-4 text-emerald-500" />最值得切入的方向
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(ins.topOpportunities || []).map((op, i) => (
            <div key={i} className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-100 rounded-2xl">
              <div className="w-7 h-7 bg-emerald-500 text-white rounded-full flex items-center justify-center shrink-0 text-sm font-bold">{i + 1}</div>
              <div className="flex-1">
                <div className="font-semibold text-[#1d1d1f] text-sm">{op.segment}</div>
                <div className="text-xs text-[#86868b] mt-1">{op.reason}</div>
              </div>
              <button
                onClick={() => { setSeg(op.segment); setTab('jtbd'); }}
                className="shrink-0 text-xs text-emerald-600 hover:text-emerald-700 font-medium"
              >
                查看详情 →
              </button>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-500" />未满足需求（白空间）
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[#1d1d1f] leading-relaxed">{ins.whitespace}</p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Tag className="w-4 h-4 text-rose-500" />用户核心痛点
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[#1d1d1f] leading-relaxed">{ins.userPainPoints}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-500" />产品 / Listing 行动建议
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[#1d1d1f] leading-relaxed">{ins.listingAdvice || '—'}</p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <button onClick={onGenAI} disabled={genIns}
          className="flex items-center gap-2 px-4 py-2 bg-[#f5f5f7] hover:bg-[#ebebeb] text-[#86868b] rounded-xl text-sm font-medium disabled:opacity-50">
          <Sparkles className="w-4 h-4" />{genIns ? '生成中...' : '重新生成'}
        </button>
      </div>
    </div>
  );
}

// ─── RawTable ─────────────────────────────────────────────────────────────────
function RawTable({
  filt, eid, etags, q, setQ, cat, setCat, onStartEdit, onSaveEdit, onCancelEdit, onTogTag,
}: {
  filt: Keyword[];
  eid: string | null;
  etags: string[];
  q: string;
  setQ: (v: string) => void;
  cat: string;
  setCat: (v: string) => void;
  onStartEdit: (kw: Keyword) => void;
  onSaveEdit: (id: string) => void;
  onCancelEdit: () => void;
  onTogTag: (t: string) => void;
}) {
  return (
    <Card className="border-none shadow-sm overflow-hidden">
      <CardHeader className="bg-[#f5f5f7]/50 border-b border-black/5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#86868b]" />
              <input type="text" placeholder="搜索关键词或翻译..." value={q} onChange={e => setQ(e.target.value)}
                className="pl-10 pr-4 py-2 bg-white border border-black/5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 w-56" />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-[#86868b]" />
              <select value={cat} onChange={e => setCat(e.target.value)}
                className="bg-white border border-black/5 rounded-xl text-sm px-3 py-2 focus:outline-none">
                <option value="all">全部类别</option>
                {TAGS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="text-xs text-[#86868b]">显示 {filt.length} 个关键词</div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-[#86868b] uppercase bg-[#f5f5f7] border-b border-black/5">
              <tr>
                <th className="px-6 py-4 font-medium">关键词/翻译</th>
                <th className="px-6 py-4 font-medium text-right">周搜索量</th>
                <th className="px-6 py-4 font-medium text-right">CPC</th>
                <th className="px-6 py-4 font-medium">意图</th>
                <th className="px-6 py-4 font-medium">JTBD任务</th>
                <th className="px-6 py-4 font-medium">场景/人群</th>
                <th className="px-6 py-4 font-medium">AI标签</th>
                <th className="px-6 py-4 font-medium text-center">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {filt.map(kw => (
                <tr key={kw.id} className="hover:bg-[#f5f5f7]/50">
                  <td className="px-6 py-4">
                    <div className="font-medium text-[#1d1d1f]">{kw.keyword}</div>
                    <div className="text-xs text-[#86868b] mt-0.5">{kw.translation}</div>
                  </td>
                  <td className="px-6 py-4 text-right font-mono">{kw.weeklySearchVolume.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right font-mono">${kw.cpcBid.toFixed(2)}</td>
                  <td className="px-6 py-4">
                    {kw.userIntentStage ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                        style={{ color: INTENT_META[kw.userIntentStage].color, background: `${INTENT_META[kw.userIntentStage].color}15` }}>
                        {INTENT_META[kw.userIntentStage].label}
                      </span>
                    ) : <span className="text-[#86868b] text-xs italic">未标注</span>}
                  </td>
                  <td className="px-6 py-4">
                    {kw.jobToBeDone ? (
                      <span className="px-2 py-0.5 bg-[#f5f5f7] text-[#1d1d1f] rounded-full text-[10px] font-medium border border-black/5">
                        {kw.jobToBeDone}
                      </span>
                    ) : <span className="text-[#86868b] text-xs italic">—</span>}
                  </td>
                  <td className="px-6 py-4 text-xs text-[#86868b]">
                    {[kw.useScenario, kw.targetUser].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="px-6 py-4">
                    {eid === kw.id ? (
                      <div className="flex flex-wrap gap-1 max-w-[280px]">
                        {TAGS.map(t => (
                          <button key={t} onClick={() => onTogTag(t)}
                            className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-all ${etags.includes(t) ? 'bg-indigo-100 text-indigo-600 border border-indigo-200' : 'bg-white text-[#86868b] border border-black/5'}`}>
                            {t}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {kw.aiTags.length > 0
                          ? kw.aiTags.map(t => (
                            <span key={t} className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-medium border border-indigo-100">{t}</span>
                          ))
                          : <span className="text-[#86868b] text-xs italic">未打标</span>}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-center">
                    {eid === kw.id ? (
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => onSaveEdit(kw.id)} className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100"><Check className="w-4 h-4" /></button>
                        <button onClick={onCancelEdit} className="p-1.5 bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-100"><X className="w-4 h-4" /></button>
                      </div>
                    ) : (
                      <button onClick={() => onStartEdit(kw)} className="p-1.5 text-[#86868b] hover:text-indigo-600 hover:bg-indigo-50 rounded-lg">
                        <Edit2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
