import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import {
  Upload, FileSpreadsheet, Brain, Trash2, Edit2, Check, X, Filter, ExternalLink, Zap, Search,
  Target, Lightbulb, Sparkles, TrendingUp, Tag, Download, ArrowUpDown, ChevronDown, ChevronUp,
  Users, Map, Route, HeartHandshake, ChevronLeft, ChevronRight, Info, MousePointerClick, Package,
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
const PAGE_SIZE_JTBD = 8;
const PAGE_SIZE_RAW = 30;

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
        {[['任务类型', jm.label], ['周搜索量', d.totalVolume.toLocaleString()], ['平均CPC', `$${d.avgCpc.toFixed(2)}`], ['均CVR', `${(d.avgCvr * 100).toFixed(1)}%`], ['平均难度', d.avgDifficulty.toFixed(1)], ['词数', String(d.count)],
        ].map(([l, v]) => (
          <div key={String(l)} className="flex justify-between gap-4"><span>{l}</span><span className="font-semibold text-[#1d1d1f]">{v}</span></div>
        ))}
      </div>
      {d.topKeywords?.length > 0 && (
        <div className="mt-2 pt-2 border-t border-black/5"><div className="text-[10px] text-[#86868b] mb-1">代表词</div>
          <div className="flex flex-wrap gap-1">{d.topKeywords.slice(0, 3).map((kw: string) => (<span key={kw} className="text-[10px] bg-[#f5f5f7] px-1.5 py-0.5 rounded">{kw}</span>))}</div>
        </div>
      )}
    </div>
  );
};

function Pager({ page, total, onChange }: { page: number; total: number; onChange: (p: number) => void }) {
  if (total <= 1) return null;
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-black/5 bg-[#f5f5f7]/30">
      <span className="text-xs text-[#86868b]">第 {page + 1} / {total} 页</span>
      <div className="flex items-center gap-1">
        <button onClick={() => onChange(Math.max(0, page - 1))} disabled={page === 0}
          className="p-1.5 rounded-lg hover:bg-white disabled:opacity-30 transition-colors"><ChevronLeft className="w-4 h-4" /></button>
        <button onClick={() => onChange(Math.min(total - 1, page + 1))} disabled={page >= total - 1}
          className="p-1.5 rounded-lg hover:bg-white disabled:opacity-30 transition-colors"><ChevronRight className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

export type InsightTab = 'intent' | 'jtbd' | 'scenario' | 'report';

export interface KwViewProps {
  keywords: Keyword[]; hasInsight: boolean; intentStats: IntentStat[]; jtbdStats: JTBDStat[];
  scenarioInsights: ScenarioInsights; tStat: { name: string; count: number; vol: number }[];
  filt: Keyword[]; totVol: number; isAI: boolean; prog: { c: number; t: number };
  tab: InsightTab; setTab: (t: InsightTab) => void;
  seg: string | null; setSeg: (s: string | null) => void;
  ins: AiInsight | null; genIns: boolean; showT: boolean; setShowT: (v: boolean) => void;
  q: string; setQ: (v: string) => void; cat: string; setCat: (v: string) => void;
  eid: string | null; etags: string[]; seedHint: string;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRunAI: () => void; onStop: () => void; onGenAI: () => void; onClear: () => void; onExport: () => void;
  onStartEdit: (kw: Keyword) => void; onSaveEdit: (id: string) => void; onCancelEdit: () => void;
  headerExtra?: React.ReactNode; onTogTag: (tag: string) => void;
}

function QuickGuide() {
  return (
    <Card className="border-none shadow-sm bg-gradient-to-r from-indigo-50/60 to-violet-50/40 border border-indigo-100/30">
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
          <div className="space-y-2 text-sm">
            <h4 className="font-semibold text-[#1d1d1f]">三步完成用户洞察</h4>
            <ol className="space-y-1.5 text-[#86868b] text-[13px]">
              <li><span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold mr-1.5">1</span>
                点击右上角 <strong className="text-indigo-600">「在线抓取关键词」</strong>，输入品类核心词</li>
              <li><span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold mr-1.5">2</span>
                点 <strong className="text-indigo-600">「AI 用户洞察」</strong>，系统自动分析意图 + 任务 + 场景</li>
              <li><span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold mr-1.5">3</span>
                点击各 Tab 查看结果，<strong className="text-indigo-600">点击排行榜条目</strong>可下钻查看明细</li>
            </ol>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function KwView(p: KwViewProps) {
  const { keywords, hasInsight, intentStats, jtbdStats, scenarioInsights, tStat, filt, totVol,
    isAI, prog, tab, setTab, seg, setSeg, ins, genIns, showT, setShowT,
    q, setQ, cat, setCat, eid, etags, seedHint,
    onUpload, onRunAI, onStop, onGenAI, onClear, onExport,
    onStartEdit, onSaveEdit, onCancelEdit, onTogTag, headerExtra } = p;
  return (
    <div className="space-y-6">
      <div><div className="flex items-center gap-2 mb-3"><Zap className="w-4 h-4 text-indigo-500" /><span className="text-sm font-semibold text-[#1d1d1f]">选词工具快捷入口</span><span className="text-xs text-[#86868b]">— 新标签页，浏览器可记住密码</span></div><TB /></div>
      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-[#f5f5f7]/50 border-b border-black/5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div><CardTitle className="text-lg font-semibold flex items-center gap-2"><FileSpreadsheet className="w-5 h-5 text-indigo-600" />关键词数据</CardTitle>
              <CardDescription>{hasInsight ? '洞察已完成，切换上方 Tab 查看分析结果' : '推荐：输入种子关键词抓 ABA 关联词；也可输入 ASIN 抓竞品流量词'}</CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">{headerExtra}
              {keywords.length > 0 && (<>
                <button onClick={isAI ? onStop : onRunAI} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${isAI ? 'bg-rose-50 text-rose-600' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}><Brain className="w-4 h-4" />{isAI ? `取消(${prog.c}/${prog.t})` : 'AI 用户洞察'}</button>
                <button onClick={onExport} title="导出 Excel" className="flex items-center justify-center p-2 bg-[#f5f5f7] border border-black/5 rounded-xl text-[#86868b] hover:text-emerald-600 transition-colors"><Download className="w-4 h-4" /></button>
                <button onClick={onClear} className="flex items-center gap-2 bg-rose-50 text-rose-600 px-3 py-2 rounded-xl text-sm font-medium"><Trash2 className="w-4 h-4" /></button>
              </>)}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">{keywords.length === 0 ? (
          <div className="border-2 border-dashed border-black/10 rounded-[24px] p-12 flex flex-col items-center text-center hover:border-indigo-500 hover:bg-indigo-50/30 transition-all cursor-pointer relative group">
            <input type="file" accept=".xlsx,.xls,.csv" onChange={onUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
            <div className="w-16 h-16 bg-[#f5f5f7] rounded-full flex items-center justify-center mb-4 group-hover:bg-indigo-100"><Upload className="w-8 h-8 text-[#86868b] group-hover:text-indigo-600" /></div>
            <h3 className="text-lg font-semibold text-[#1d1d1f]">开始数据分析</h3>
            <p className="text-sm text-[#86868b] mt-2 max-w-md">点击上传 Excel，或点击右上角<strong className="text-indigo-600">「在线抓取关键词」</strong>直接拉取数据</p>
            <span className="flex items-center gap-1.5 mt-3 text-xs text-indigo-500 font-medium"><MousePointerClick className="w-3.5 h-3.5" /> 从抓取开始更简单</span>
          </div>) : (
          <div className="space-y-3">{seedHint && (<div className="text-xs text-violet-700 bg-violet-50 border border-violet-100 rounded-xl px-3 py-2">当前种子词：<span className="font-semibold">{seedHint}</span> · 共抓取 {keywords.length} 个关联词</div>)}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{[{ l: '总词数', v: keywords.length.toLocaleString(), c: 'text-[#1d1d1f]' },{ l: '总周搜索量', v: totVol.toLocaleString(), c: 'text-emerald-600' },{ l: '用户任务', v: `${jtbdStats.length} 个`, c: 'text-indigo-600' },{ l: '已洞察', v: `${keywords.filter(k => k.userIntentStage || k.jobToBeDone).length} 个`, c: 'text-violet-600' }].map(m => (<div key={m.l} className="bg-[#f5f5f7] p-4 rounded-2xl border border-black/5"><div className="text-xs text-[#86868b] uppercase tracking-wider mb-1">{m.l}</div><div className={`text-2xl font-bold ${m.c}`}>{m.v}</div></div>))}</div>
          </div>)}
        </CardContent>
      </Card>
      {keywords.length > 0 && (<>
        <div className="flex gap-1 bg-[#f5f5f7] p-1 rounded-2xl w-fit flex-wrap">{(['intent' as const,'jtbd' as const,'scenario' as const,'report' as const]).map(id => {
          const meta = { intent: { l: '意图画像', I: Route, s: true }, jtbd: { l: 'JTBD 地图', I: Target, s: hasInsight }, scenario: { l: '场景洞察', I: Map, s: hasInsight }, report: { l: '用户报告', I: Lightbulb, s: true } }[id];
          if (!meta.s) return null;
          return <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${tab === id ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#86868b] hover:text-[#1d1d1f]'}`}><meta.I className="w-4 h-4" />{meta.l}</button>;
        })}</div>
        {!hasInsight && <QuickGuide />}
        {tab === 'intent' && <IntentTab hasInsight={hasInsight} intentStats={intentStats} tStat={tStat} />}
        {tab === 'jtbd' && hasInsight && <JtbdTab jtbdStats={jtbdStats} keywords={keywords} seg={seg} setSeg={setSeg} />}
        {tab === 'scenario' && hasInsight && <ScenarioTab insights={scenarioInsights} keywords={keywords} seg={seg} setSeg={setSeg} />}
        {tab === 'report' && <ReportTab ins={ins} hasInsight={hasInsight} genIns={genIns} onGenAI={onGenAI} />}
        <div><button type="button" onClick={() => setShowT(!showT)} className="flex items-center gap-2 text-sm text-[#86868b] hover:text-[#1d1d1f] font-medium"><Filter className="w-4 h-4" />{showT ? '收起' : '展开'}原始关键词表<span className="text-xs bg-[#f5f5f7] px-2 py-0.5 rounded-full border border-black/5">{keywords.length} 个词</span><span className="text-[10px] text-[#86868b]">（可翻页）</span></button></div>
        {showT && <RawTable filt={filt} eid={eid} etags={etags} q={q} setQ={setQ} cat={cat} setCat={setCat} onStartEdit={onStartEdit} onSaveEdit={onSaveEdit} onCancelEdit={onCancelEdit} onTogTag={onTogTag} />}
      </>)}
    </div>);
}

const INTENT_STRATEGY: Record<string, string> = {
  awareness: '主导为认知型 → 重点做痛点教育与场景图，帮用户从「有问题」走到「有方案」。',
  consideration: '主导为考虑型 → 重点优化对比信息、A+ 与评测型卖点，缩短筛选路径。',
  decision: '主导为决策型 → 重点锁规格、价格带与信任信号，标题/主图把决策信息前置。',
  loyalty: '主导为忠诚型 → 重点承接配件/复购与品牌词防御。',
};

/* ─── IntentTab ─── */
function IntentTab({ hasInsight, intentStats, tStat }: { hasInsight: boolean; intentStats: IntentStat[]; tStat: { name: string; count: number; vol: number }[] }) {
  const dominant = useMemo(() => { if (!intentStats.length) return null; return [...intentStats].sort((a, b) => b.share - a.share)[0]; }, [intentStats]);
  const funnelData = useMemo(() => intentStats.map(s => ({ name: INTENT_META[s.stage].label, count: s.count, share: Math.round(s.share * 100), color: INTENT_META[s.stage].color })), [intentStats]);
  if (!hasInsight) return (<div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-6 flex items-center gap-3"><Sparkles className="w-5 h-5 text-indigo-500 shrink-0" /><p className="text-sm text-indigo-700">请先点击「AI 用户洞察」完成标注。</p></div>);
  return (<div className="space-y-6">
    {dominant && (
      <div className="bg-gradient-to-r from-violet-50 via-blue-50 to-emerald-50 border border-black/5 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shrink-0"><Users className="w-5 h-5 text-indigo-600" /></div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-[#1d1d1f] mb-1">意图画像结论</div>
            <p className="text-sm text-[#1d1d1f]">用户主要处于「<span style={{ color: INTENT_META[dominant.stage].color }} className="font-semibold">{INTENT_META[dominant.stage].label}</span>」阶段（{(dominant.share * 100).toFixed(0)}% 词数 · {(dominant.volumeShare * 100).toFixed(0)}% 搜索量）。{INTENT_META[dominant.stage].desc}。</p>
            <p className="text-[13px] text-indigo-700 mt-2 font-medium">{INTENT_STRATEGY[dominant.stage]}</p>
            <div className="flex flex-wrap gap-2 mt-3">
              {intentStats.map(s => (
                <span key={s.stage} className="text-[11px] px-2.5 py-1 rounded-full bg-white/80 border border-black/5 text-[#424245]">
                  {INTENT_META[s.stage].label} · CPC ${s.avgCpc.toFixed(2)} · CVR {(s.avgCvr * 100).toFixed(1)}%
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    )}
    <Card className="border-none shadow-sm"><CardHeader><CardTitle className="text-base font-semibold flex items-center gap-2"><Route className="w-4 h-4 text-violet-600" />购买意图漏斗</CardTitle></CardHeader><CardContent className="h-[280px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={funnelData} layout="vertical" margin={{ left: 8, right: 50 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" /><XAxis type="number" hide /><YAxis dataKey="name" type="category" axisLine={false} tickLine={false} fontSize={12} width={70} /><Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={22} label={{ position: 'right', fontSize: 11 }}>{funnelData.map((d, i) => <Cell key={i} fill={d.color} />)}</Bar></BarChart></ResponsiveContainer></CardContent></Card>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{intentStats.map(s => { const m = INTENT_META[s.stage]; return (<Card key={s.stage} className="border-none shadow-sm overflow-hidden"><CardHeader className={`${m.bg} border-b border-black/5`}><CardTitle className="text-sm font-semibold flex items-center justify-between"><span style={{ color: m.color }}>{m.label}</span><span className="text-xs text-[#86868b]">{s.count} 词 · {(s.share * 100).toFixed(0)}%</span></CardTitle></CardHeader><CardContent className="p-4"><div className="flex gap-4 mb-3 text-[12px] text-[#86868b]"><span>搜索量 {s.totalVolume.toLocaleString()}</span><span>CPC ${s.avgCpc.toFixed(2)}</span><span>CVR {(s.avgCvr * 100).toFixed(1)}%</span></div><div className="flex flex-wrap gap-1.5">{s.topKeywords.slice(0, 6).map(kw => (<span key={kw} className="px-2 py-0.5 bg-[#f5f5f7] text-[#1d1d1f] rounded-full text-[11px] border border-black/5">{kw}</span>))}</div></CardContent></Card>); })}</div>
    {tStat.length > 0 && (<Card className="border-none shadow-sm"><CardHeader><CardTitle className="text-base font-semibold flex items-center gap-2"><Tag className="w-4 h-4 text-violet-600" />词类分布</CardTitle></CardHeader><CardContent className="h-[240px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={tStat} layout="vertical" margin={{ left: 8, right: 40 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" /><XAxis type="number" hide /><YAxis dataKey="name" type="category" axisLine={false} tickLine={false} fontSize={11} width={60} /><Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={16} label={{ position: 'right', fontSize: 10 }}>{tStat.map((_, i) => <Cell key={i} fill={SC[i % SC.length]} />)}</Bar></BarChart></ResponsiveContainer></CardContent></Card>)}
  </div>);
}

/* ─── JtbdTab ─── */
function JtbdTab({ jtbdStats, keywords, seg, setSeg }: { jtbdStats: JTBDStat[]; keywords: Keyword[]; seg: string | null; setSeg: (s: string | null) => void }) {
  const [page, setPage] = useState(0);
  const ranked = useMemo(() => [...jtbdStats].sort((a, b) => b.opportunityScore - a.opportunityScore), [jtbdStats]);
  const totalPages = Math.max(1, Math.ceil(ranked.length / PAGE_SIZE_JTBD));
  const paged = ranked.slice(page * PAGE_SIZE_JTBD, (page + 1) * PAGE_SIZE_JTBD);
  const scat = useMemo(() => ranked.map((s, i) => ({ ...s, x: s.totalVolume, y: s.avgCpc, z: Math.max(s.count * 6, 80), color: JOB_TYPE_META[s.jobType].color || SC[i % SC.length] })), [ranked]);
  const selected = ranked.find(j => j.job === seg);
  const words = useMemo(() => seg ? keywords.filter(k => (k.jobToBeDone || '').trim() === seg).sort((a, b) => b.weeklySearchVolume - a.weeklySearchVolume) : [], [keywords, seg]);
  if (!ranked.length) return (<div className="bg-amber-50 border border-amber-100 rounded-2xl p-6 flex items-center gap-3"><Info className="w-5 h-5 text-amber-500" /><p className="text-sm text-amber-700">暂无 JTBD 任务数据。请重新点击「AI 用户洞察」。</p></div>);
  const top3 = ranked.slice(0, 3);
  return (<div className="space-y-6">
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{(Object.keys(JOB_TYPE_META) as (keyof typeof JOB_TYPE_META)[]).map(k => { const m = JOB_TYPE_META[k]; const count = jtbdStats.filter(j => j.jobType === k).length; return (<div key={k} className={`${m.bg} border border-black/5 rounded-2xl p-3`}><div className="font-bold text-sm" style={{ color: m.color }}>{m.label}</div><div className="text-xs text-[#86868b]">{count} 个任务</div></div>); })}</div>
    {top3.length > 0 && (
      <div className="rounded-2xl border border-amber-100 bg-gradient-to-r from-amber-50 to-orange-50 p-5">
        <div className="text-sm font-bold text-[#1d1d1f] mb-3 flex items-center gap-2"><Sparkles className="w-4 h-4 text-amber-500" />机会热区 · Top 3 任务</div>
        <div className="grid sm:grid-cols-3 gap-3">
          {top3.map((j, i) => (
            <button key={j.job} type="button" onClick={() => setSeg(j.job)} className="text-left rounded-xl bg-white/80 border border-amber-100/80 p-4 hover:border-amber-300 transition-colors">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-amber-600">#{i + 1} · {j.opportunityScore} 分</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: `${JOB_TYPE_META[j.jobType].color}15`, color: JOB_TYPE_META[j.jobType].color }}>{JOB_TYPE_META[j.jobType].label}</span>
              </div>
              <div className="font-semibold text-sm text-[#1d1d1f] mb-1">{j.job}</div>
              <p className="text-[12px] text-[#86868b] leading-relaxed">
                周搜 {j.totalVolume.toLocaleString()} · CPC ${j.avgCpc.toFixed(2)} · CVR {(j.avgCvr * 100).toFixed(1)}%
                {j.avgCpc < 1.2 && j.totalVolume > 0 ? ' — 需求在、竞争相对可控，适合优先切入。' : j.avgCvr >= 0.12 ? ' — 转化偏高，适合作为主推任务。' : ' — 先验证 Listing 是否讲清该任务。'}
              </p>
            </button>
          ))}
        </div>
      </div>
    )}
    <Card className="border-none shadow-sm overflow-hidden"><CardHeader className="bg-gradient-to-r from-blue-50 via-pink-50 to-emerald-50 border-b border-black/5"><CardTitle className="text-base font-semibold flex items-center gap-2"><HeartHandshake className="w-4 h-4 text-pink-500" />用户任务机会排行<span className="text-xs font-normal text-[#86868b] ml-1">点击行可查看关键词</span><span className="ml-auto text-[10px] text-[#86868b] bg-white/70 px-2 py-0.5 rounded-full">共 {jtbdStats.length} 项</span></CardTitle></CardHeader>
      <CardContent className="p-0"><div className="divide-y divide-black/5">{paged.map((j, i) => (<button key={j.job} onClick={() => setSeg(j.job)} className={`w-full flex items-center gap-3 px-5 py-3 hover:bg-[#f5f5f7]/50 text-left ${seg === j.job ? 'bg-indigo-50/50' : ''}`}><div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${(page * PAGE_SIZE_JTBD + i) < 3 ? 'bg-gradient-to-br from-amber-400 to-amber-500 text-white shadow-md' : 'bg-[#f5f5f7] text-[#86868b]'}`}><span className="text-sm font-bold">{page * PAGE_SIZE_JTBD + i + 1}</span></div><div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-[#1d1d1f] text-sm truncate">{j.job}</span><span className="text-[10px] px-2 py-0.5 rounded-full font-medium border" style={{ background: `${JOB_TYPE_META[j.jobType].color}15`, color: JOB_TYPE_META[j.jobType].color }}>{JOB_TYPE_META[j.jobType].label}</span><span className="text-[10px] text-[#86868b]">{j.count}词 · {j.totalVolume.toLocaleString()}/周</span></div><div className="text-xs text-[#86868b] mt-1 truncate">CPC ${j.avgCpc.toFixed(2)} · CVR {(j.avgCvr * 100).toFixed(1)}% · 代表：{j.topKeywords.slice(0, 3).join('、')}</div></div><div className={`flex flex-col items-center justify-center w-16 h-12 rounded-xl ${scoreBg(j.opportunityScore)} shrink-0`}><span className="text-xl font-bold" style={{ color: scoreColor(j.opportunityScore) }}>{j.opportunityScore}</span><span className="text-[9px] text-[#86868b] -mt-0.5">分</span></div></button>))}</div><Pager page={page} total={totalPages} onChange={setPage} /></CardContent></Card>
    <Card className="border-none shadow-sm"><CardHeader><CardTitle className="text-base font-semibold"><Target className="w-4 h-4 text-rose-500 inline mr-1" />JTBD 需求-竞争地图<span className="text-xs font-normal text-[#86868b] ml-1">X=需求 · Y=竞争(CPC)</span></CardTitle></CardHeader><CardContent className="h-[420px]"><ResponsiveContainer><ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 10 }}><CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" /><XAxis type="number" dataKey="x" tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} label={{ value: '需求', position: 'insideBottom', offset: -10, fontSize: 11 }} /><YAxis type="number" dataKey="y" tickFormatter={(v: number) => `$${v.toFixed(2)}`} label={{ value: 'CPC', angle: -90, position: 'insideLeft', offset: 10, fontSize: 11 }} /><Tooltip content={<JTBDTip />} /><Scatter data={scat} onClick={(d: any) => setSeg(d.job)} cursor="pointer">{scat.map((d, i) => <Cell key={i} fill={d.color} fillOpacity={0.85} />)}</Scatter></ScatterChart></ResponsiveContainer></CardContent></Card>
    {selected && (<Card className="border-none shadow-sm overflow-hidden"><CardHeader className="bg-[#f5f5f7]/50 border-b border-black/5"><div className="flex items-center justify-between"><CardTitle className="text-base font-semibold">「{selected.job}」关键词</CardTitle><button onClick={() => setSeg(null)} className="text-xs text-[#86868b]">清除</button></div></CardHeader><CardContent className="p-0"><div className="overflow-x-auto max-h-[400px] overflow-y-auto"><table className="w-full text-sm"><thead className="text-xs text-[#86868b] uppercase bg-[#f5f5f7] sticky top-0"><tr><th className="px-5 py-3">关键词</th><th className="px-5 py-3 text-right">周搜索量</th><th className="px-5 py-3 text-right">CPC</th><th className="px-5 py-3 text-right">CVR</th><th className="px-5 py-3">意图</th></tr></thead><tbody className="divide-y divide-black/5">{words.slice(0, 50).map(kw => (<tr key={kw.id} className="hover:bg-[#f5f5f7]/50"><td className="px-5 py-3"><div className="font-medium">{kw.keyword}</div><div className="text-xs text-[#86868b]">{kw.translation}</div></td><td className="px-5 py-3 text-right font-mono">{kw.weeklySearchVolume.toLocaleString()}</td><td className="px-5 py-3 text-right font-mono">${kw.cpcBid.toFixed(2)}</td><td className="px-5 py-3 text-right font-mono">{(kw.conversionRate * 100).toFixed(2)}%</td><td className="px-5 py-3">{kw.userIntentStage ? <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ color: INTENT_META[kw.userIntentStage].color, background: `${INTENT_META[kw.userIntentStage].color}15` }}>{INTENT_META[kw.userIntentStage].label}</span> : '—'}</td></tr>))}</tbody></table></div></CardContent></Card>)}
  </div>);
}

/* ─── ScenarioTab ─── */
function ScenarioTab({ insights, keywords, seg, setSeg }: { insights: ScenarioInsights; keywords: Keyword[]; seg: string | null; setSeg: (s: string | null) => void }) {
  const [showAll, setShowAll] = useState(false);
  type SortKey = 'weeklySearchVolume' | 'cpcBid' | 'conversionRate' | 'value';
  const [sortCol, setSortCol] = useState<SortKey>('weeklySearchVolume');
  const [sortAsc, setSortAsc] = useState(false);
  const words = useMemo(() => { if (!seg) return []; const list = keywords.filter(k => (k.useScenario || '').trim() === seg || (k.targetUser || '').trim() === seg || (k.painPoint || '').trim() === seg || (k.featureDemand || '').trim() === seg); const getVal = (k: Keyword) => sortCol === 'value' ? calcKwValueDensity(k) : (k[sortCol] as number); return list.sort((a, b) => sortAsc ? getVal(a) - getVal(b) : getVal(b) - getVal(a)); }, [keywords, seg, sortCol, sortAsc]);
  const shown = showAll ? words : words.slice(0, 50);
  const toggleSort = (col: SortKey) => { if (sortCol === col) setSortAsc(v => !v); else { setSortCol(col); setSortAsc(false); } };
  const RankCard = ({ title, icon: Icon, items, color }: { title: string; icon: any; items: { name: string; count: number; totalVolume: number }[]; color: string }) => (
    <Card className="border-none shadow-sm overflow-hidden"><CardHeader className="border-b border-black/5"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Icon className="w-4 h-4" style={{ color }} />{title}</CardTitle></CardHeader><CardContent className="p-0"><div className="divide-y divide-black/5 max-h-[280px] overflow-y-auto">{items.slice(0, 10).map((item, i) => (<button key={item.name} onClick={() => setSeg(item.name)} className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[#f5f5f7]/60 ${seg === item.name ? 'bg-indigo-50/60' : ''}`}><span className="w-6 text-xs font-bold text-[#86868b]">{i + 1}</span><div className="flex-1"><div className="text-sm font-medium text-[#1d1d1f] truncate">{item.name}</div><div className="text-[10px] text-[#86868b]">{item.count} 词 · {item.totalVolume.toLocaleString()}/周</div></div></button>))}{!items.length && <div className="p-6 text-center text-xs text-[#86868b]">暂无数据</div>}</div></CardContent></Card>);
  if (!insights.scenarios.length && !insights.users.length && !insights.painPoints.length && !insights.features.length) return (<div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-6 flex items-center gap-3"><Info className="w-5 h-5 text-indigo-500" /><p className="text-sm text-indigo-700">请重新点击「AI 用户洞察」分析。</p></div>);
  const heatScenarios = insights.scenarios.slice(0, 6).map(s => s.name);
  const heatUsers = insights.users.slice(0, 5).map(u => u.name);
  const heatMax = Math.max(1, ...insights.crossMatrix.map(c => c.volume));
  const topScene = insights.scenarios[0];
  const topUser = insights.users[0];
  const topPain = insights.painPoints[0];
  return (<div className="space-y-6">
    {(topScene || topUser || topPain) && (
      <div className="rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50/80 to-violet-50/60 p-5">
        <div className="text-sm font-bold text-[#1d1d1f] mb-3">场景洞察摘要</div>
        <div className="grid sm:grid-cols-3 gap-3 text-[13px] text-[#424245]">
          {topScene && <div className="rounded-xl bg-white/80 border border-indigo-100/60 p-3"><div className="text-[11px] text-[#86868b] mb-1">最高搜索量场景</div><div className="font-semibold text-[#1d1d1f]">{topScene.name}</div><div className="text-[11px] text-[#86868b] mt-1">{topScene.count} 词 · {topScene.totalVolume.toLocaleString()}/周 — Listing 主图应优先露出该场景。</div></div>}
          {topUser && <div className="rounded-xl bg-white/80 border border-indigo-100/60 p-3"><div className="text-[11px] text-[#86868b] mb-1">最高频人群</div><div className="font-semibold text-[#1d1d1f]">{topUser.name}</div><div className="text-[11px] text-[#86868b] mt-1">{topUser.count} 词 · {topUser.totalVolume.toLocaleString()}/周 — 标题与五点用该人群话术更易匹配。</div></div>}
          {topPain && <div className="rounded-xl bg-white/80 border border-indigo-100/60 p-3"><div className="text-[11px] text-[#86868b] mb-1">最紧迫痛点</div><div className="font-semibold text-[#1d1d1f]">{topPain.name}</div><div className="text-[11px] text-[#86868b] mt-1">{topPain.count} 词 · {topPain.totalVolume.toLocaleString()}/周 — 产品必改项与主图应正面回应。</div></div>}
        </div>
      </div>
    )}
    <div className="text-xs text-[#86868b] bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5 flex items-start gap-2"><MousePointerClick className="w-3.5 h-3.5 text-blue-500 mt-0.5 shrink-0" /><span>点击排行榜中任意条目，下方表格展示该维度的全部关联关键词。</span></div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><RankCard title="使用场景" icon={Map} items={insights.scenarios} color="#3b82f6" /><RankCard title="目标人群" icon={Users} items={insights.users} color="#8b5cf6" /><RankCard title="痛点排行" icon={TrendingUp} items={insights.painPoints} color="#ef4444" /><RankCard title="功能需求" icon={Tag} items={insights.features} color="#10b981" /></div>
    {heatScenarios.length > 0 && heatUsers.length > 0 && (<Card className="border-none shadow-sm"><CardHeader><CardTitle className="text-base font-semibold"><Map className="w-4 h-4 text-indigo-600 inline mr-1" />场景×人群热力</CardTitle><CardDescription>颜色越深，交叉搜索量越大 — 优先打深色格子对应的场景×人群组合</CardDescription></CardHeader><CardContent className="overflow-x-auto"><table className="w-full text-xs min-w-[560px]"><thead><tr><th className="p-3 text-left text-[#86868b] font-medium">场景 \ 人群</th>{heatUsers.map(u => <th key={u} className="p-3 text-center text-[#86868b] font-medium">{u}</th>)}</tr></thead><tbody>{heatScenarios.map(sc => (<tr key={sc}><td className="p-3 font-medium text-[#1d1d1f]">{sc}</td>{heatUsers.map(u => { const cell = insights.crossMatrix.find(c => c.scenario === sc && c.user === u); const vol = cell?.volume || 0; const intensity = vol / heatMax; return (<td key={u} className="p-1.5"><button onClick={() => cell && setSeg(sc)} className="w-full min-h-[52px] rounded-xl py-3 text-center font-mono text-[12px] font-semibold" style={{ background: vol > 0 ? `rgba(79,70,229,${0.10 + intensity * 0.78})` : '#f5f5f7', color: intensity > 0.45 ? '#fff' : '#1d1d1f' }}>{vol > 0 ? fmtNum(vol) : '—'}</button></td>); })}</tr>))}</tbody></table></CardContent></Card>)}
    {seg && (<Card className="border-none shadow-sm overflow-hidden"><CardHeader className="bg-[#f5f5f7]/50"><div className="flex items-center justify-between"><CardTitle className="text-base font-semibold">「{seg}」关键词</CardTitle><span className="text-xs text-[#86868b]">{words.length} 个词</span></div></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs text-[#86868b] uppercase bg-[#f5f5f7]"><tr><th className="px-5 py-3">关键词</th><th className="px-5 py-3 text-right cursor-pointer" onClick={() => toggleSort('weeklySearchVolume')}>周搜索量<ArrowUpDown className="w-3 h-3 inline ml-1" /></th><th className="px-5 py-3 text-right cursor-pointer" onClick={() => toggleSort('cpcBid')}>CPC<ArrowUpDown className="w-3 h-3 inline ml-1" /></th><th className="px-5 py-3 text-right cursor-pointer" onClick={() => toggleSort('conversionRate')}>CVR<ArrowUpDown className="w-3 h-3 inline ml-1" /></th><th className="px-5 py-3">意图</th></tr></thead><tbody className="divide-y divide-black/5">{shown.map(kw => (<tr key={kw.id} className="hover:bg-[#f5f5f7]/50"><td className="px-5 py-3"><div className="font-medium">{kw.keyword}</div><div className="text-xs text-[#86868b]">{kw.translation}</div></td><td className="px-5 py-3 text-right font-mono">{kw.weeklySearchVolume.toLocaleString()}</td><td className="px-5 py-3 text-right font-mono">${kw.cpcBid.toFixed(2)}</td><td className="px-5 py-3 text-right font-mono">{(kw.conversionRate * 100).toFixed(2)}%</td><td className="px-5 py-3">{kw.userIntentStage ? <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ color: INTENT_META[kw.userIntentStage].color, background: `${INTENT_META[kw.userIntentStage].color}15` }}>{INTENT_META[kw.userIntentStage].label}</span> : '—'}</td></tr>))}</tbody></table></div>{words.length > 50 && <div className="p-4 text-center border-t"><button onClick={() => setShowAll(v => !v)} className="text-sm text-indigo-600 font-medium">{showAll ? '收起' : `显示全部 ${words.length} 个词`}</button></div>}</CardContent></Card>)}
    {!seg && <div className="bg-[#f5f5f7] rounded-2xl p-6 text-center text-sm text-[#86868b]">点击上方排行条目下钻查看关键词</div>}
  </div>);
}

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return v.split(/[；;、\n]/).map(s => s.trim()).filter(Boolean);
  return [];
}

/* ─── ReportTab ─── */
function ReportTab({ ins, hasInsight, genIns, onGenAI }: { ins: AiInsight | null; hasInsight: boolean; genIns: boolean; onGenAI: () => void }) {
  if (!ins) return (<div className="bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-100 rounded-[24px] p-10 flex flex-col items-center text-center gap-4"><div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-md"><Lightbulb className="w-8 h-8 text-indigo-500" /></div><div><h3 className="text-xl font-bold text-[#1d1d1f] mb-2">AI 用户洞察报告</h3><p className="text-sm text-[#86868b] max-w-md">{hasInsight ? '基于意图分层、JTBD 任务与场景洞察，生成完整报告。' : '请先点击「AI 用户洞察」。'}</p></div><button onClick={onGenAI} disabled={genIns || !hasInsight} className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-semibold transition-all disabled:opacity-50 shadow-lg"><Sparkles className={`w-4 h-4 ${genIns ? 'animate-spin' : ''}`} />{genIns ? '生成中...' : '生成报告'}</button></div>);

  const scenes = asList(ins.userScenes);
  const needs = asList(ins.userNeeds);
  const pains = asList(ins.userPainPoints);
  const stages = Array.isArray(ins.decisionStages) ? ins.decisionStages : [];
  const listing = ins.listingPlan;
  const product = ins.productPlan;
  const roadmap = Array.isArray(ins.productRoadmap) ? ins.productRoadmap : [];
  const bullets = asList(listing?.bullets);
  const mustFix = asList(product?.mustFix);

  return (
    <div className="space-y-6">
      {/* 1. 用户画像 */}
      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-violet-50 to-indigo-50 border-b border-black/5">
          <CardTitle className="text-base font-semibold flex items-center gap-2"><Users className="w-4 h-4 text-violet-500" />用户画像</CardTitle>
          <CardDescription>谁在买 · 什么场景 · 要什么 · 卡在哪</CardDescription>
        </CardHeader>
        <CardContent className="p-6 space-y-5">
          <p className="text-sm text-[#1d1d1f] leading-relaxed">{ins.userPersona || '—'}</p>
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="rounded-xl bg-[#f8f9fb] border border-black/5 p-4">
              <div className="text-[11px] font-semibold text-indigo-600 uppercase tracking-wider mb-2">核心场景</div>
              <ul className="space-y-1.5">{scenes.length ? scenes.map(s => <li key={s} className="text-[13px] text-[#424245] flex gap-2"><span className="text-indigo-400">·</span>{s}</li>) : <li className="text-[13px] text-[#aeaeb2]">—</li>}</ul>
            </div>
            <div className="rounded-xl bg-[#f8f9fb] border border-black/5 p-4">
              <div className="text-[11px] font-semibold text-violet-600 uppercase tracking-wider mb-2">核心需求</div>
              <ul className="space-y-1.5">{needs.length ? needs.map(s => <li key={s} className="text-[13px] text-[#424245] flex gap-2"><span className="text-violet-400">·</span>{s}</li>) : <li className="text-[13px] text-[#aeaeb2]">—</li>}</ul>
            </div>
            <div className="rounded-xl bg-[#f8f9fb] border border-black/5 p-4">
              <div className="text-[11px] font-semibold text-rose-600 uppercase tracking-wider mb-2">主要痛点</div>
              <ul className="space-y-1.5">{pains.length ? pains.map(s => <li key={s} className="text-[13px] text-[#424245] flex gap-2"><span className="text-rose-400">·</span>{s}</li>) : <li className="text-[13px] text-[#aeaeb2]">—</li>}</ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. 决策路径 */}
      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-black/5">
          <CardTitle className="text-base font-semibold flex items-center gap-2"><Route className="w-4 h-4 text-blue-500" />决策路径</CardTitle>
          <CardDescription>从搜到下单，用户怎么走</CardDescription>
        </CardHeader>
        <CardContent className="p-6 space-y-5">
          {stages.length > 0 ? (
            <div className="flex flex-col lg:flex-row gap-3 lg:items-stretch">
              {stages.map((st, i) => (
                <div key={`${st.name}-${i}`} className="flex-1 relative">
                  <div className="h-full rounded-2xl border border-indigo-100 bg-white p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-6 h-6 rounded-full bg-indigo-50 text-indigo-600 text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
                      <span className="text-sm font-semibold text-[#1d1d1f]">{st.name}</span>
                    </div>
                    <p className="text-[13px] text-[#424245] leading-relaxed mb-2">{st.desc}</p>
                    {st.signals && <p className="text-[11px] text-[#86868b]">信号：{st.signals}</p>}
                  </div>
                  {i < stages.length - 1 && (
                    <div className="hidden lg:flex absolute -right-2 top-1/2 -translate-y-1/2 z-10 text-indigo-300">
                      <ChevronRight className="w-5 h-5" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#aeaeb2]">暂无分阶段路径</p>
          )}
          {ins.decisionSummary && (
            <p className="text-sm text-[#424245] leading-relaxed bg-[#f8f9fb] rounded-xl p-4 border border-black/5">{ins.decisionSummary}</p>
          )}
        </CardContent>
      </Card>

      {/* 3. 洞察结论 */}
      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-indigo-50 via-violet-50 to-indigo-50 border-b border-black/5">
          <CardTitle className="text-base font-semibold flex items-center gap-2"><Lightbulb className="w-4 h-4 text-amber-500" />洞察结论</CardTitle>
          <CardDescription>综合判断 → Listing / 产品 / 路线图</CardDescription>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          <p className="text-sm text-[#1d1d1f] leading-relaxed">{ins.insightAnalysis || '—'}</p>

          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-5">
            <div className="flex items-center gap-2 mb-3"><Sparkles className="w-4 h-4 text-indigo-600" /><h4 className="text-sm font-semibold text-[#1d1d1f]">Listing 方案建议</h4></div>
            <p className="text-[13px] text-[#1d1d1f] mb-3"><span className="text-[#86868b]">标题方向：</span>{listing?.title || '—'}</p>
            {bullets.length > 0 && (
              <ul className="space-y-1.5 mb-3">
                {bullets.map(b => <li key={b} className="text-[13px] text-[#424245] flex gap-2"><span className="text-indigo-500 font-bold">·</span>{b}</li>)}
              </ul>
            )}
            <div className="grid sm:grid-cols-2 gap-3 text-[13px]">
              <div className="rounded-xl bg-white/80 p-3 border border-indigo-100/60"><span className="text-[#86868b]">关键词布局：</span>{listing?.keywords || '—'}</div>
              <div className="rounded-xl bg-white/80 p-3 border border-indigo-100/60"><span className="text-[#86868b]">视觉策略：</span>{listing?.visual || '—'}</div>
            </div>
          </div>

          <div className="rounded-2xl border border-violet-100 bg-violet-50/40 p-5">
            <div className="flex items-center gap-2 mb-3"><Package className="w-4 h-4 text-violet-600" /><h4 className="text-sm font-semibold text-[#1d1d1f]">产品方案建议</h4></div>
            <div className="grid sm:grid-cols-3 gap-3 text-[13px] mb-3">
              <div className="rounded-xl bg-white/80 p-3 border border-violet-100/60"><div className="text-[11px] text-[#86868b] mb-1">核心规格</div>{product?.core || '—'}</div>
              <div className="rounded-xl bg-white/80 p-3 border border-violet-100/60"><div className="text-[11px] text-[#86868b] mb-1">差异化</div>{product?.differentiation || '—'}</div>
              <div className="rounded-xl bg-white/80 p-3 border border-violet-100/60"><div className="text-[11px] text-[#86868b] mb-1">价格带</div>{product?.priceRange || '—'}</div>
            </div>
            {mustFix.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold text-rose-600 mb-1.5">必改项</div>
                <ul className="space-y-1">{mustFix.map(x => <li key={x} className="text-[13px] text-[#424245] flex gap-2"><span className="text-rose-400">·</span>{x}</li>)}</ul>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2 mb-3"><Target className="w-4 h-4 text-emerald-600" /><h4 className="text-sm font-semibold text-[#1d1d1f]">产品路线图（产品矩阵）</h4></div>
            {roadmap.length ? (
              <div className="grid sm:grid-cols-3 gap-3">
                {roadmap.map((r, i) => (
                  <div key={`${r.phase}-${i}`} className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-bold text-emerald-700">{r.phase || `P${i + 1}`}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-white text-emerald-700 border border-emerald-100">{r.priority || '—'}</span>
                    </div>
                    <div className="text-sm font-semibold text-[#1d1d1f] mb-1">{r.name}</div>
                    <div className="text-[12px] text-[#86868b]">目标：{r.target}</div>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-[#aeaeb2]">暂无路线图</p>}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end"><button onClick={onGenAI} disabled={genIns} className="flex items-center gap-2 px-4 py-2 bg-[#f5f5f7] hover:bg-[#ebebeb] text-[#86868b] rounded-xl text-sm font-medium"><Sparkles className="w-4 h-4" />重新生成</button></div>
    </div>
  );
}

/* ─── RawTable ─── */
function RawTable({ filt, eid, etags, q, setQ, cat, setCat, onStartEdit, onSaveEdit, onCancelEdit, onTogTag }: { filt: Keyword[]; eid: string | null; etags: string[]; q: string; setQ: (v: string) => void; cat: string; setCat: (v: string) => void; onStartEdit: (kw: Keyword) => void; onSaveEdit: (id: string) => void; onCancelEdit: () => void; onTogTag: (t: string) => void }) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(filt.length / PAGE_SIZE_RAW));
  const paged = useMemo(() => filt.slice(page * PAGE_SIZE_RAW, (page + 1) * PAGE_SIZE_RAW), [filt, page]);
  const prevQ = React.useRef(q); const prevCat = React.useRef(cat);
  React.useEffect(() => { if (prevQ.current !== q || prevCat.current !== cat) { setPage(0); prevQ.current = q; prevCat.current = cat; } }, [q, cat]);
  return (<Card className="border-none shadow-sm overflow-hidden"><CardHeader className="bg-[#f5f5f7]/50 border-b border-black/5"><div className="flex flex-col md:flex-row md:items-center justify-between gap-4"><div className="flex items-center gap-4"><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#86868b]" /><input type="text" placeholder="搜索关键词..." value={q} onChange={e => setQ(e.target.value)} className="pl-10 pr-4 py-2 bg-white border border-black/5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 w-56" /></div><div className="flex items-center gap-2"><Filter className="w-4 h-4 text-[#86868b]" /><select value={cat} onChange={e => setCat(e.target.value)} className="bg-white border border-black/5 rounded-xl text-sm px-3 py-2"><option value="all">全部</option>{TAGS.map(t => <option key={t} value={t}>{t}</option>)}</select></div></div><div className="text-xs text-[#86868b]">{filt.length} 个词 · 第 {page + 1}/{totalPages} 页</div></div></CardHeader>
    <CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs text-[#86868b] uppercase bg-[#f5f5f7] border-b border-black/5"><tr><th className="px-6 py-4">关键词/翻译</th><th className="px-6 py-4 text-right">周搜索量</th><th className="px-6 py-4 text-right">CPC</th><th className="px-6 py-4">意图</th><th className="px-6 py-4">JTBD</th><th className="px-6 py-4">场景/人群</th><th className="px-6 py-4">AI标签</th><th className="px-6 py-4 text-center">操作</th></tr></thead><tbody className="divide-y divide-black/5">{paged.map(kw => (<tr key={kw.id} className="hover:bg-[#f5f5f7]/50"><td className="px-6 py-4"><div className="font-medium">{kw.keyword}</div><div className="text-xs text-[#86868b]">{kw.translation}</div></td><td className="px-6 py-4 text-right font-mono">{kw.weeklySearchVolume.toLocaleString()}</td><td className="px-6 py-4 text-right font-mono">${kw.cpcBid.toFixed(2)}</td><td className="px-6 py-4">{kw.userIntentStage ? <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ color: INTENT_META[kw.userIntentStage].color, background: `${INTENT_META[kw.userIntentStage].color}15` }}>{INTENT_META[kw.userIntentStage].label}</span> : <span className="text-[#86868b] text-xs">—</span>}</td><td className="px-6 py-4">{kw.jobToBeDone || '—'}</td><td className="px-6 py-4 text-xs text-[#86868b]">{[kw.useScenario, kw.targetUser].filter(Boolean).join(' · ') || '—'}</td><td className="px-6 py-4">{eid === kw.id ? (<div className="flex flex-wrap gap-1">{TAGS.map(t => (<button key={t} onClick={() => onTogTag(t)} className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${etags.includes(t) ? 'bg-indigo-100 text-indigo-600' : 'bg-white text-[#86868b] border border-black/5'}`}>{t}</button>))}</div>) : (<div className="flex flex-wrap gap-1">{kw.aiTags.length > 0 ? kw.aiTags.map(t => <span key={t} className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full text-[10px] border border-indigo-100">{t}</span>) : <span className="text-[#86868b] text-xs italic">—</span>}</div>)}</td><td className="px-6 py-4 text-center">{eid === kw.id ? (<div className="flex items-center justify-center gap-2"><button onClick={() => onSaveEdit(kw.id)} className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg"><Check className="w-4 h-4" /></button><button onClick={onCancelEdit} className="p-1.5 bg-rose-50 text-rose-600 rounded-lg"><X className="w-4 h-4" /></button></div>) : (<button onClick={() => onStartEdit(kw)} className="p-1.5 text-[#86868b] hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"><Edit2 className="w-4 h-4" /></button>)}</td></tr>))}{paged.length === 0 && <tr><td colSpan={8} className="px-6 py-8 text-center text-[#86868b]">没有匹配的关键词</td></tr>}</tbody></table></div><Pager page={page} total={totalPages} onChange={setPage} /></CardContent></Card>);
}
