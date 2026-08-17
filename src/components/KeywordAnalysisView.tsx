import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import {
  Upload, FileSpreadsheet, Brain, Trash2, Edit2, Check, X, Filter, ExternalLink, Zap, Search,
  Target, Lightbulb, Sparkles, TrendingUp, Tag, Download, ArrowUpDown, ChevronDown, ChevronUp,
  Users, Map as MapIcon, Route, HeartHandshake, ChevronLeft, ChevronRight, Info, MousePointerClick, HelpCircle,
  Save,
} from 'lucide-react';
import { Keyword } from '../utils/parser';
import {
  XAxis, YAxis, CartesianGrid, ResponsiveContainer, Cell,
  BarChart, Bar,
} from 'recharts';
import {
  IntentStat, JTBDStat, ScenarioInsights, AiInsight, INTENT_META, JOB_TYPE_META, SC, TAGS,
  calcKwValueDensity,
  calcLongTailOpportunities,
} from './KeywordAnalysis';
import { InsightReportPanels } from './InsightReportPanels';
import { Select } from './ui/Select';
import { FeishuPushButton } from './FeishuPushButton';
import { aiInsightToMarkdown } from '../utils/reportToMarkdown';

const scoreColor = (s: number) => s >= 75 ? '#10b981' : s >= 60 ? '#3b82f6' : s >= 45 ? '#f59e0b' : '#9ca3af';
const scoreBg = (s: number) => s >= 75 ? 'bg-emerald-50' : s >= 60 ? 'bg-blue-50' : s >= 45 ? 'bg-amber-50' : 'bg-[#f5f5f7]';
const fmtNum = (v: number) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0);
};
const PAGE_SIZE_JTBD = 8;
const PAGE_SIZE_RAW = 30;
const PAGE_SIZE_DRILL = 20;

const safeNum = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const safeIntentMeta = (stage?: string) =>
  (stage && INTENT_META[stage as keyof typeof INTENT_META]) || null;


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

const safeJobMeta = (jobType?: string) =>
  (jobType && JOB_TYPE_META[jobType as keyof typeof JOB_TYPE_META]) || JOB_TYPE_META.functional;

/** 自绘气泡图：避开 Recharts Scatter/ZAxis 在生产环境的 constructor 崩溃 */
function JTBDBubbleMap({
  points,
  mode,
  onJobClick,
}: {
  points: Array<Record<string, any>>;
  mode: 'job' | 'keyword';
  onJobClick: (job: string) => void;
}) {
  const [hover, setHover] = useState<{ d: Record<string, any>; cx: number; cy: number } | null>(null);
  const W = 720;
  const H = 400;
  const pad = { t: 28, r: 28, b: 48, l: 56 };

  const layout = useMemo(() => {
    if (!points.length) return null;
    const xs = points.map(p => Number(p.x) || 0);
    const ys = points.map(p => Number(p.y) || 0);
    const zs = points.map(p => Number(p.z) || 1);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const spanZ = maxZ - minZ || 1;
    const sx = (x: number) => pad.l + ((x - minX) / spanX) * (W - pad.l - pad.r);
    const sy = (y: number) => pad.t + (1 - (y - minY) / spanY) * (H - pad.t - pad.b);
    const sr = (z: number) => 9 + ((z - minZ) / spanZ) * (mode === 'job' ? 18 : 14);
    const ticksX = [0, 0.25, 0.5, 0.75, 1].map(t => minX + spanX * t);
    const ticksY = [0, 0.25, 0.5, 0.75, 1].map(t => minY + spanY * t);
    return { sx, sy, sr, ticksX, ticksY, minX, maxX, minY, maxY };
  }, [points, mode]);

  if (!points.length || !layout) {
    return <div className="h-full flex items-center justify-center text-sm text-[#86868b]">暂无地图数据</div>;
  }

  const { sx, sy, sr, ticksX, ticksY } = layout;

  return (
    <div className="relative w-full h-full" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" role="img" aria-label="JTBD 需求-竞争地图">
        {ticksX.map((tx, i) => (
          <line key={`vx${i}`} x1={sx(tx)} y1={pad.t} x2={sx(tx)} y2={H - pad.b} stroke="#e5e7eb" strokeDasharray="3 3" />
        ))}
        {ticksY.map((ty, i) => (
          <line key={`hy${i}`} x1={pad.l} y1={sy(ty)} x2={W - pad.r} y2={sy(ty)} stroke="#e5e7eb" strokeDasharray="3 3" />
        ))}
        {ticksX.map((tx, i) => (
          <text key={`xl${i}`} x={sx(tx)} y={H - 18} textAnchor="middle" fill="#86868b" fontSize="11">
            {tx >= 1000 ? `${(tx / 1000).toFixed(0)}k` : Math.round(tx)}
          </text>
        ))}
        {ticksY.map((ty, i) => (
          <text key={`yl${i}`} x={pad.l - 8} y={sy(ty) + 4} textAnchor="end" fill="#86868b" fontSize="11">
            ${ty.toFixed(2)}
          </text>
        ))}
        <text x={W / 2} y={H - 4} textAnchor="middle" fill="#aeaeb2" fontSize="11">需求（周搜）</text>
        <text x={14} y={H / 2} textAnchor="middle" fill="#aeaeb2" fontSize="11" transform={`rotate(-90 14 ${H / 2})`}>竞争 CPC</text>
        {points.map((d, i) => {
          const cx = sx(Number(d.x) || 0);
          const cy = sy(Number(d.y) || 0);
          const r = sr(Number(d.z) || 1);
          const job = String(d.job || '');
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill={d.color || '#6366f1'}
              fillOpacity={0.82}
              stroke="#fff"
              strokeWidth={1.5}
              style={{ cursor: job ? 'pointer' : 'default' }}
              onMouseEnter={() => setHover({ d, cx, cy })}
              onClick={() => { if (job) onJobClick(job); }}
            />
          );
        })}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 bg-white border border-black/10 rounded-2xl shadow-xl p-3 max-w-[240px] text-xs"
          style={{
            left: Math.min(Math.max(hover.cx / W * 100, 18), 72) + '%',
            top: Math.max(8, (hover.cy / H) * 100 - 8) + '%',
            transform: 'translate(-50%, -100%)',
          }}
        >
          {mode === 'job' ? (
            <>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="font-bold text-sm text-[#1d1d1f] truncate">{hover.d.job}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
                  style={{ color: scoreColor(hover.d.opportunityScore || 0), backgroundColor: `${scoreColor(hover.d.opportunityScore || 0)}1A` }}>
                  {hover.d.opportunityScore}分
                </span>
              </div>
              <div className="space-y-1 text-[#86868b]">
                <div className="flex justify-between gap-4"><span>类型</span><span className="font-semibold text-[#1d1d1f]">{safeJobMeta(hover.d.jobType).label}</span></div>
                <div className="flex justify-between gap-4"><span>周搜</span><span className="font-semibold text-[#1d1d1f]">{Number(hover.d.x || 0).toLocaleString()}</span></div>
                <div className="flex justify-between gap-4"><span>CPC</span><span className="font-semibold text-[#1d1d1f]">${Number(hover.d.y || 0).toFixed(2)}</span></div>
                <div className="flex justify-between gap-4"><span>词数</span><span className="font-semibold text-[#1d1d1f]">{hover.d.count}</span></div>
              </div>
            </>
          ) : (
            <>
              <div className="font-bold text-sm text-[#1d1d1f] mb-1">{hover.d.keyword}</div>
              {hover.d.translation && <div className="text-[#86868b] mb-2">{hover.d.translation}</div>}
              <div className="space-y-1 text-[#86868b]">
                <div className="flex justify-between gap-4"><span>任务</span><span className="font-semibold text-[#1d1d1f]">{hover.d.job}</span></div>
                <div className="flex justify-between gap-4"><span>周搜</span><span className="font-semibold text-[#1d1d1f]">{Number(hover.d.x || 0).toLocaleString()}</span></div>
                <div className="flex justify-between gap-4"><span>CPC</span><span className="font-semibold text-[#1d1d1f]">${Number(hover.d.y || 0).toFixed(2)}</span></div>
                <div className="flex justify-between gap-4"><span>CVR</span><span className="font-semibold text-[#1d1d1f]">{(Number(hover.d.cvr || 0) * 100).toFixed(1)}%</span></div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

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
  onSaveInsight?: () => void;
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
    onSaveInsight, onStartEdit, onSaveEdit, onCancelEdit, onTogTag, headerExtra } = p;
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
          const meta = { intent: { l: '意图画像', I: Route, s: true }, jtbd: { l: 'JTBD 地图', I: Target, s: hasInsight }, scenario: { l: '场景洞察', I: MapIcon, s: hasInsight }, report: { l: '用户报告', I: Lightbulb, s: true } }[id];
          if (!meta.s) return null;
          return <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${tab === id ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#86868b] hover:text-[#1d1d1f]'}`}><meta.I className="w-4 h-4" />{meta.l}</button>;
        })}</div>
        {!hasInsight && <QuickGuide />}
        {tab === 'intent' && <IntentTab hasInsight={hasInsight} intentStats={intentStats} tStat={tStat} keywords={keywords} />}
        {tab === 'jtbd' && hasInsight && <JtbdTab jtbdStats={jtbdStats} keywords={keywords} seg={seg} setSeg={setSeg} />}
        {tab === 'scenario' && hasInsight && <ScenarioTab insights={scenarioInsights} keywords={keywords} seg={seg} setSeg={setSeg} />}
        {tab === 'report' && <ReportTab ins={ins} hasInsight={hasInsight} genIns={genIns} onGenAI={onGenAI} onSaveInsight={onSaveInsight} />}
        <div><button type="button" onClick={() => setShowT(!showT)} className="flex items-center gap-2 text-sm text-[#86868b] hover:text-[#1d1d1f] font-medium"><Filter className="w-4 h-4" />{showT ? '收起' : '展开'}原始关键词表<span className="text-xs bg-[#f5f5f7] px-2 py-0.5 rounded-full border border-black/5">{keywords.length} 个词</span></button></div>
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
function IntentTab({ hasInsight, intentStats, tStat, keywords }: { hasInsight: boolean; intentStats: IntentStat[]; tStat: { name: string; count: number; vol: number }[]; keywords: Keyword[] }) {
  const [selStage, setSelStage] = useState<string | null>(null);
  const [selTag, setSelTag] = useState<string | null>(null);
  const dominant = useMemo(() => { if (!intentStats.length) return null; return [...intentStats].sort((a, b) => b.share - a.share)[0]; }, [intentStats]);
  const funnelData = useMemo(() => intentStats.map(s => ({
    stage: s.stage,
    name: INTENT_META[s.stage].label,
    count: s.count,
    share: Math.round(s.share * 100),
    color: INTENT_META[s.stage].color,
  })), [intentStats]);

  const stageWords = useMemo(() => {
    if (!selStage) return [];
    return [...keywords]
      .filter(k => k.userIntentStage === selStage)
      .sort((a, b) => b.weeklySearchVolume - a.weeklySearchVolume);
  }, [keywords, selStage]);

  const tagWords = useMemo(() => {
    if (!selTag) return [];
    return [...keywords]
      .filter(k => (k.aiTags || []).includes(selTag))
      .sort((a, b) => b.weeklySearchVolume - a.weeklySearchVolume);
  }, [keywords, selTag]);

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
                <button key={s.stage} type="button" onClick={() => setSelStage(s.stage)} className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${selStage === s.stage ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white/80 border-black/5 text-[#424245] hover:border-indigo-200'}`}>
                  {INTENT_META[s.stage].label} · CPC ${s.avgCpc.toFixed(2)} · CVR {(s.avgCvr * 100).toFixed(1)}%
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    )}
    <div className="text-xs text-[#86868b] bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5 flex items-start gap-2">
      <MousePointerClick className="w-3.5 h-3.5 text-blue-500 mt-0.5 shrink-0" />
      <span>点击漏斗条、意图卡片或词类柱，可打开对应关键词明细。</span>
    </div>
    <Card className="border-none shadow-sm">
      <CardHeader><CardTitle className="text-base font-semibold flex items-center gap-2"><Route className="w-4 h-4 text-violet-600" />购买意图漏斗</CardTitle></CardHeader>
      <CardContent className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={funnelData} layout="vertical" margin={{ left: 8, right: 50 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
            <XAxis type="number" hide />
            <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} fontSize={12} width={70} />
            <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={22} label={{ position: 'right', fontSize: 11 }} cursor="pointer"
              onClick={(data: any) => { const stage = data?.stage || data?.payload?.stage; if (stage) setSelStage(stage); }}>
              {funnelData.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {intentStats.map(s => {
        const m = INTENT_META[s.stage];
        return (
          <button key={s.stage} type="button" onClick={() => setSelStage(s.stage)} className={`text-left rounded-2xl overflow-hidden border transition-all ${selStage === s.stage ? 'border-indigo-300 shadow-md ring-2 ring-indigo-100' : 'border-transparent shadow-sm hover:border-indigo-100'}`}>
            <Card className="border-none shadow-none">
              <CardHeader className={`${m.bg} border-b border-black/5`}>
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  <span style={{ color: m.color }}>{m.label}</span>
                  <span className="text-xs text-[#86868b]">{s.count} 词 · {(s.share * 100).toFixed(0)}%</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="flex gap-4 mb-3 text-[12px] text-[#86868b]"><span>搜索量 {s.totalVolume.toLocaleString()}</span><span>CPC ${s.avgCpc.toFixed(2)}</span><span>CVR {(s.avgCvr * 100).toFixed(1)}%</span></div>
                <p className="text-[12px] text-[#424245] mb-3 leading-relaxed">{INTENT_STRATEGY[s.stage]}</p>
                <div className="flex flex-wrap gap-1.5">{s.topKeywords.slice(0, 6).map(kw => (<span key={kw} className="px-2 py-0.5 bg-[#f5f5f7] text-[#1d1d1f] rounded-full text-[11px] border border-black/5">{kw}</span>))}</div>
              </CardContent>
            </Card>
          </button>
        );
      })}
    </div>
    {tStat.length > 0 && (
      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2"><Tag className="w-4 h-4 text-violet-600" />词类分布</CardTitle>
          <CardDescription>点击某一词类柱，查看该标签下的关键词，用于标题/后台词布局。</CardDescription>
        </CardHeader>
        <CardContent className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={tStat} layout="vertical" margin={{ left: 8, right: 40 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
              <XAxis type="number" hide />
              <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} fontSize={11} width={60} />
              <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={16} label={{ position: 'right', fontSize: 10 }} cursor="pointer"
                onClick={(data: any) => { const name = data?.name || data?.payload?.name; if (name) setSelTag(name); }}>
                {tStat.map((_, i) => <Cell key={i} fill={SC[i % SC.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    )}
    {selStage && <KeywordDrillModal title={`${INTENT_META[selStage as keyof typeof INTENT_META]?.label || selStage} · 关键词`} words={stageWords} onClose={() => setSelStage(null)} />}
    {selTag && <KeywordDrillModal title={`词类「${selTag}」`} words={tagWords} onClose={() => setSelTag(null)} />}
  </div>);
}

/* ─── Keyword drill-down modal ─── */
function KeywordDrillModal({
  title,
  words,
  onClose,
}: {
  title: string;
  words: Keyword[];
  onClose: () => void;
}) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(words.length / PAGE_SIZE_DRILL));
  useEffect(() => { setPage(0); }, [title, words.length]);
  const paged = words.slice(page * PAGE_SIZE_DRILL, (page + 1) * PAGE_SIZE_DRILL);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white w-full max-w-3xl max-h-[85vh] rounded-2xl shadow-2xl border border-black/5 flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-black/5 flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-semibold text-[#1d1d1f]">「{title}」关键词</h3>
            <p className="text-xs text-[#86868b] mt-0.5">共 {words.length} 个词</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-black/5 text-[#86868b]"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-[#86868b] uppercase bg-[#f5f5f7] sticky top-0">
              <tr>
                <th className="px-5 py-3 text-left">关键词</th>
                <th className="px-5 py-3 text-right">周搜索量</th>
                <th className="px-5 py-3 text-right">CPC</th>
                <th className="px-5 py-3 text-right">CVR</th>
                <th className="px-5 py-3 text-left">意图</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {paged.map(kw => (
                <tr key={kw.id} className="hover:bg-[#f5f5f7]/50">
                  <td className="px-5 py-3"><div className="font-medium">{kw.keyword}</div><div className="text-xs text-[#86868b]">{kw.translation}</div></td>
                  <td className="px-5 py-3 text-right font-mono">{safeNum(kw.weeklySearchVolume).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right font-mono">${safeNum(kw.cpcBid).toFixed(2)}</td>
                  <td className="px-5 py-3 text-right font-mono">{(safeNum(kw.conversionRate) * 100).toFixed(2)}%</td>
                  <td className="px-5 py-3">{(() => {
                    const m = safeIntentMeta(kw.userIntentStage);
                    return m ? <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ color: m.color, background: `${m.color}15` }}>{m.label}</span> : '—';
                  })()}</td>
                </tr>
              ))}
              {paged.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-[#86868b]">暂无关联关键词</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="shrink-0 border-t border-black/5">
          <Pager page={page} total={totalPages} onChange={setPage} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ScoreHelp() {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button type="button" onClick={() => setOpen(v => !v)} className="p-0.5 rounded-full text-[#86868b] hover:text-indigo-600" title="机会分说明" aria-label="机会分说明">
        <HelpCircle className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-2 z-30 w-72 p-3 bg-white border border-black/10 rounded-xl shadow-xl text-[11px] text-[#424245] leading-relaxed normal-case font-normal">
          <div className="font-semibold text-[#1d1d1f] mb-1.5">机会分怎么算</div>
          <ul className="space-y-1 list-disc pl-3.5">
            <li>转化潜力 35%（均 CVR）</li>
            <li>获客效率 25%（CPC÷CVR，越低越好）</li>
            <li>需求量 25%（该任务周搜索量）</li>
            <li>投放难度 15%（难度越低分越高）</li>
          </ul>
          <p className="mt-2 text-[#86868b]">词数少于 3 的任务不进入排行，避免碎片噪声。</p>
          <button type="button" className="mt-2 text-indigo-600 font-medium" onClick={() => setOpen(false)}>知道了</button>
        </div>
      )}
    </span>
  );
}

const JOB_TYPE_HINT: Record<string, string> = {
  functional: '功能任务：用户要完成具体动作（便携、静音、防水）——产品规格与五点优先对上。',
  emotional: '情感任务：用户要获得感受（安心、仪式感）——主图氛围与文案情绪要对齐。',
  social: '社会任务：用户要在他人面前达成身份/礼赠——礼盒与社交场景露出更关键。',
};

/* ─── JtbdTab ─── */
function JtbdTab({ jtbdStats, keywords, seg, setSeg }: { jtbdStats: JTBDStat[]; keywords: Keyword[]; seg: string | null; setSeg: (s: string | null) => void }) {
  const [page, setPage] = useState(0);
  const [mapMode, setMapMode] = useState<'job' | 'keyword'>('job');
  const [modalJob, setModalJob] = useState<string | null>(null);
  const ranked = useMemo(() => [...jtbdStats].sort((a, b) => b.opportunityScore - a.opportunityScore), [jtbdStats]);
  const longTail = useMemo(() => calcLongTailOpportunities(keywords), [keywords]);
  const totalPages = Math.max(1, Math.ceil(ranked.length / PAGE_SIZE_JTBD));
  const paged = ranked.slice(page * PAGE_SIZE_JTBD, (page + 1) * PAGE_SIZE_JTBD);

  const jobSceneHint = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    const intentMap = new Map<string, Map<string, number>>();
    keywords.forEach(k => {
      const job = (k.jobToBeDone || '').trim();
      if (!job) return;
      if (k.useScenario) {
        if (!map.has(job)) map.set(job, new Map());
        const m = map.get(job)!;
        m.set(k.useScenario, (m.get(k.useScenario) || 0) + k.weeklySearchVolume);
      }
      if (k.userIntentStage) {
        if (!intentMap.has(job)) intentMap.set(job, new Map());
        const m = intentMap.get(job)!;
        m.set(k.userIntentStage, (m.get(k.userIntentStage) || 0) + 1);
      }
    });
    const topScene = (job: string) => {
      const m = map.get(job);
      if (!m?.size) return '';
      return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    };
    const topIntent = (job: string) => {
      const m = intentMap.get(job);
      if (!m?.size) return null;
      return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    };
    return { topScene, topIntent };
  }, [keywords]);

  const jobScat = useMemo(() => ranked.map((s, i) => {
    const meta = safeJobMeta(s.jobType);
    return {
      ...s,
      jobType: (JOB_TYPE_META[s.jobType as keyof typeof JOB_TYPE_META] ? s.jobType : 'functional') as typeof s.jobType,
      x: s.totalVolume,
      y: s.avgCpc,
      z: Math.max(s.count * 8, 60),
      color: meta.color || SC[i % SC.length],
      label: s.job,
    };
  }), [ranked]);

  const kwScat = useMemo(() => {
    const withJob = keywords.filter(k => (k.jobToBeDone || '').trim()).sort((a, b) => b.weeklySearchVolume - a.weeklySearchVolume).slice(0, 80);
    return withJob.map((k, i) => {
      const intentMeta = k.userIntentStage ? INTENT_META[k.userIntentStage as keyof typeof INTENT_META] : undefined;
      return {
        keyword: k.keyword,
        job: k.jobToBeDone,
        x: k.weeklySearchVolume,
        y: k.cpcBid,
        z: Math.max(40, Math.min(160, k.weeklySearchVolume / 50)),
        color: intentMeta?.color || SC[i % SC.length],
        cvr: k.conversionRate,
        intent: k.userIntentStage,
        translation: k.translation,
      };
    });
  }, [keywords]);

  const medX = useMemo(() => {
    const xs = (mapMode === 'job' ? jobScat : kwScat).map(d => d.x).sort((a, b) => a - b);
    return xs.length ? xs[Math.floor(xs.length / 2)] : 0;
  }, [mapMode, jobScat, kwScat]);
  const medY = useMemo(() => {
    const ys = (mapMode === 'job' ? jobScat : kwScat).map(d => d.y).sort((a, b) => a - b);
    return ys.length ? ys[Math.floor(ys.length / 2)] : 0;
  }, [mapMode, jobScat, kwScat]);

  const openJob = (job: string) => {
    setSeg(job);
    setModalJob(job);
  };

  const modalWords = useMemo(
    () => modalJob ? keywords.filter(k => (k.jobToBeDone || '').trim() === modalJob).sort((a, b) => b.weeklySearchVolume - a.weeklySearchVolume) : [],
    [keywords, modalJob],
  );

  if (!ranked.length) return (<div className="bg-amber-50 border border-amber-100 rounded-2xl p-6 flex items-center gap-3"><Info className="w-5 h-5 text-amber-500" /><p className="text-sm text-amber-700">暂无 JTBD 任务数据。请重新点击「AI 用户洞察」。</p></div>);
  const top3 = ranked.slice(0, 3);

  return (<div className="space-y-6">
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{(Object.keys(JOB_TYPE_META) as (keyof typeof JOB_TYPE_META)[]).map(k => {
      const m = JOB_TYPE_META[k];
      const count = jtbdStats.filter(j => j.jobType === k).length;
      return (
        <div key={k} className={`${m.bg} border border-black/5 rounded-2xl p-3`}>
          <div className="font-bold text-sm" style={{ color: m.color }}>{m.label}</div>
          <div className="text-xs text-[#86868b] mb-1.5">{count} 个任务</div>
          <p className="text-[11px] text-[#424245] leading-relaxed">{JOB_TYPE_HINT[k]}</p>
        </div>
      );
    })}</div>

    {top3.length > 0 && (
      <div className="rounded-2xl border border-amber-100 bg-gradient-to-r from-amber-50 to-orange-50 p-5">
        <div className="text-sm font-bold text-[#1d1d1f] mb-3 flex items-center gap-2"><Sparkles className="w-4 h-4 text-amber-500" />机会热区 · Top 3 任务</div>
        <div className="grid sm:grid-cols-3 gap-3">
          {top3.map((j, i) => (
            <button key={j.job} type="button" onClick={() => openJob(j.job)} className="text-left rounded-xl bg-white/80 border border-amber-100/80 p-4 hover:border-amber-300 transition-colors">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-amber-600">#{i + 1} · {j.opportunityScore} 分</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: `${safeJobMeta(j.jobType).color}15`, color: safeJobMeta(j.jobType).color }}>{safeJobMeta(j.jobType).label}</span>
              </div>
              <div className="font-semibold text-sm text-[#1d1d1f] mb-1">{j.job}</div>
              <p className="text-[12px] text-[#86868b] leading-relaxed">
                周搜 {safeNum(j.totalVolume).toLocaleString()} · CPC ${safeNum(j.avgCpc).toFixed(2)} · CVR {(safeNum(j.avgCvr) * 100).toFixed(1)}%
                {j.avgCvr >= 0.12 ? ' — 转化偏高，适合主推。' : j.avgCpc < 1.2 ? ' — 需求在、竞争相对可控。' : ' — 先验证 Listing 是否讲清该任务。'}
              </p>
            </button>
          ))}
        </div>
      </div>
    )}

    {longTail.length > 0 && (
      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-emerald-50 to-blue-50 border-b border-black/5">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Zap className="w-4 h-4 text-emerald-500" />
            高意图长尾机会
            <span className="text-xs font-normal text-[#86868b]">不按总量排序，优先看决策意图、CVR、CPC 与难度</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-0 divide-y md:divide-y-0 md:divide-x divide-black/5">
            {longTail.slice(0, 6).map((k) => {
              const intentMeta = k.intent ? INTENT_META[k.intent] : null;
              return (
                <button
                  key={`${k.keyword}-${k.job}`}
                  type="button"
                  onClick={() => setSeg(k.job)}
                  className="text-left p-4 hover:bg-[#f5f5f7]/60 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-semibold text-sm text-[#1d1d1f] truncate">{k.keyword}</span>
                    <span className="text-sm font-bold text-emerald-600">{k.score}</span>
                  </div>
                  {k.translation && <div className="text-xs text-[#86868b] truncate mb-2">{k.translation}</div>}
                  <div className="flex flex-wrap items-center gap-1.5 mb-2">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">{k.job}</span>
                    {intentMeta && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ color: intentMeta.color, background: `${intentMeta.color}15` }}>
                        {intentMeta.label}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[#86868b] leading-relaxed">
                    周搜 {fmtNum(k.weeklySearchVolume)} · {k.reason}
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    )}

    <Card className="border-none shadow-sm overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-blue-50 via-pink-50 to-emerald-50 border-b border-black/5">
        <CardTitle className="text-base font-semibold flex items-center gap-2 flex-wrap">
          <HeartHandshake className="w-4 h-4 text-pink-500" />
          用户任务机会排行
          <ScoreHelp />
          <span className="text-xs font-normal text-[#86868b]">点击行打开关键词明细</span>
          <span className="ml-auto text-[10px] text-[#86868b] bg-white/70 px-2 py-0.5 rounded-full">共 {ranked.length} 项</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-black/5">
          {paged.map((j, i) => {
            const scene = jobSceneHint.topScene(j.job);
            const intent = jobSceneHint.topIntent(j.job);
            return (
              <button key={j.job} type="button" onClick={() => openJob(j.job)} className={`w-full flex items-center gap-3 px-5 py-3 hover:bg-[#f5f5f7]/50 text-left ${seg === j.job ? 'bg-indigo-50/50' : ''}`}>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${(page * PAGE_SIZE_JTBD + i) < 3 ? 'bg-gradient-to-br from-amber-400 to-amber-500 text-white shadow-md' : 'bg-[#f5f5f7] text-[#86868b]'}`}>
                  <span className="text-sm font-bold">{page * PAGE_SIZE_JTBD + i + 1}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-[#1d1d1f] text-sm truncate">{j.job}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium border" style={{ background: `${safeJobMeta(j.jobType).color}15`, color: safeJobMeta(j.jobType).color }}>{safeJobMeta(j.jobType).label}</span>
                    {j.evidenceLevel !== 'strong' && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${
                        j.evidenceLevel === 'medium'
                          ? 'bg-amber-50 text-amber-700 border-amber-100'
                          : 'bg-rose-50 text-rose-700 border-rose-100'
                      }`}>
                        {j.evidenceLevel === 'medium' ? '中样本' : '薄样本'}
                      </span>
                    )}
                    {intent && INTENT_META[intent as keyof typeof INTENT_META] && <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ color: INTENT_META[intent as keyof typeof INTENT_META].color, background: `${INTENT_META[intent as keyof typeof INTENT_META].color}15` }}>{INTENT_META[intent as keyof typeof INTENT_META].label}</span>}
                    <span className="text-[10px] text-[#86868b]">{j.count}词 · {j.totalVolume.toLocaleString()}/周</span>
                  </div>
                  <div className="text-xs text-[#86868b] mt-1 truncate">
                    CPC ${safeNum(j.avgCpc).toFixed(2)} · CVR {(safeNum(j.avgCvr) * 100).toFixed(1)}%
                    {scene ? ` · 主场景：${scene}` : ''} · 代表：{j.topKeywords.slice(0, 3).join('、')}
                  </div>
                </div>
                <div className={`flex flex-col items-center justify-center w-16 h-12 rounded-xl ${scoreBg(j.opportunityScore)} shrink-0`}>
                  <span className="text-xl font-bold" style={{ color: scoreColor(j.opportunityScore) }}>{j.opportunityScore}</span>
                  <span className="text-[9px] text-[#86868b] -mt-0.5">分</span>
                </div>
              </button>
            );
          })}
        </div>
        <Pager page={page} total={totalPages} onChange={setPage} />
      </CardContent>
    </Card>

    <Card className="border-none shadow-sm">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Target className="w-4 h-4 text-rose-500" />JTBD 需求-竞争地图
            </CardTitle>
            <CardDescription className="mt-1">
              X=需求（周搜索量）· Y=竞争成本（CPC）· 点越大={mapMode === 'job' ? '覆盖词数越多' : '搜索量越大'}。右上竞争贵、左下易切入。
            </CardDescription>
          </div>
          <div className="flex bg-[#f5f5f7] p-1 rounded-xl w-fit">
            {(['job', 'keyword'] as const).map(m => (
              <button key={m} type="button" onClick={() => setMapMode(m)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${mapMode === m ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#86868b]'}`}>
                {m === 'job' ? '按任务' : '按关键词'}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-[11px]">
          <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-2.5 py-2 text-emerald-800">高需求 · 低 CPC → 优先打</div>
          <div className="rounded-lg bg-amber-50 border border-amber-100 px-2.5 py-2 text-amber-800">高需求 · 高 CPC → 精耕差异化</div>
          <div className="rounded-lg bg-blue-50 border border-blue-100 px-2.5 py-2 text-blue-800">低需求 · 低 CPC → 长尾试水</div>
          <div className="rounded-lg bg-rose-50 border border-rose-100 px-2.5 py-2 text-rose-800">低需求 · 高 CPC → 谨慎</div>
        </div>
      </CardHeader>
      <CardContent className="h-[440px] flex flex-col">
        <div className="flex-1 min-h-0">
          <JTBDBubbleMap
            points={mapMode === 'job' ? jobScat : kwScat}
            mode={mapMode}
            onJobClick={openJob}
          />
        </div>
        <p className="text-[10px] text-[#aeaeb2] mt-1 text-center shrink-0">中位参考线约：需求 {fmtNum(medX)} · CPC ${safeNum(medY).toFixed(2)}（用于心算象限，非强制切割）</p>
      </CardContent>
    </Card>

    {modalJob && <KeywordDrillModal title={modalJob} words={modalWords} onClose={() => setModalJob(null)} />}
  </div>);
}

/* ─── ScenarioTab ─── */
function ScenarioTab({ insights, keywords, seg, setSeg }: { insights: ScenarioInsights; keywords: Keyword[]; seg: string | null; setSeg: (s: string | null) => void }) {
  const [modalKey, setModalKey] = useState<string | null>(null);
  const words = useMemo(() => {
    if (!modalKey) return [];
    return [...keywords]
      .filter(k =>
        (k.useScenario || '').trim() === modalKey
        || (k.targetUser || '').trim() === modalKey
        || (k.painPoint || '').trim() === modalKey
        || (k.featureDemand || '').trim() === modalKey
      )
      .sort((a, b) => b.weeklySearchVolume - a.weeklySearchVolume);
  }, [keywords, modalKey]);
  const openDim = (name: string) => { setSeg(name); setModalKey(name); };
  const RankCard = ({ title, icon: Icon, items, color }: { title: string; icon: any; items: { name: string; count: number; totalVolume: number }[]; color: string }) => (
    <Card className="border-none shadow-sm overflow-hidden"><CardHeader className="border-b border-black/5"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Icon className="w-4 h-4" style={{ color }} />{title}</CardTitle></CardHeader><CardContent className="p-0"><div className="divide-y divide-black/5 max-h-[280px] overflow-y-auto">{items.slice(0, 10).map((item, i) => (<button key={item.name} type="button" onClick={() => openDim(item.name)} className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[#f5f5f7]/60 ${seg === item.name ? 'bg-indigo-50/60' : ''}`}><span className="w-6 text-xs font-bold text-[#86868b]">{i + 1}</span><div className="flex-1"><div className="text-sm font-medium text-[#1d1d1f] truncate">{item.name}</div><div className="text-[10px] text-[#86868b]">{item.count} 词 · {item.totalVolume.toLocaleString()}/周</div></div></button>))}{!items.length && <div className="p-6 text-center text-xs text-[#86868b]">暂无数据</div>}</div></CardContent></Card>);
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
    <div className="text-xs text-[#86868b] bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5 flex items-start gap-2"><MousePointerClick className="w-3.5 h-3.5 text-blue-500 mt-0.5 shrink-0" /><span>点击排行榜条目，将弹出该维度的关键词明细。</span></div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><RankCard title="使用场景" icon={MapIcon} items={insights.scenarios} color="#3b82f6" /><RankCard title="目标人群" icon={Users} items={insights.users} color="#8b5cf6" /><RankCard title="痛点排行" icon={TrendingUp} items={insights.painPoints} color="#ef4444" /><RankCard title="功能需求" icon={Tag} items={insights.features} color="#10b981" /></div>
    {heatScenarios.length > 0 && heatUsers.length > 0 && (<Card className="border-none shadow-sm"><CardHeader><CardTitle className="text-base font-semibold"><MapIcon className="w-4 h-4 text-indigo-600 inline mr-1" />场景×人群热力</CardTitle><CardDescription>颜色越深，交叉搜索量越大 — 优先打深色格子对应的场景×人群组合</CardDescription></CardHeader><CardContent className="overflow-x-auto"><table className="w-full text-xs min-w-[560px]"><thead><tr><th className="p-3 text-left text-[#86868b] font-medium">场景 \ 人群</th>{heatUsers.map(u => <th key={u} className="p-3 text-center text-[#86868b] font-medium">{u}</th>)}</tr></thead><tbody>{heatScenarios.map(sc => (<tr key={sc}><td className="p-3 font-medium text-[#1d1d1f]">{sc}</td>{heatUsers.map(u => { const cell = insights.crossMatrix.find(c => c.scenario === sc && c.user === u); const vol = cell?.volume || 0; const intensity = vol / heatMax; return (<td key={u} className="p-1.5"><button type="button" onClick={() => cell && openDim(sc)} className="w-full min-h-[52px] rounded-xl py-3 text-center font-mono text-[12px] font-semibold" style={{ background: vol > 0 ? `rgba(79,70,229,${0.10 + intensity * 0.78})` : '#f5f5f7', color: intensity > 0.45 ? '#fff' : '#1d1d1f' }}>{vol > 0 ? fmtNum(vol) : '—'}</button></td>); })}</tr>))}</tbody></table></CardContent></Card>)}
    {modalKey && <KeywordDrillModal title={modalKey} words={words} onClose={() => setModalKey(null)} />}
  </div>);
}

/* ─── ReportTab ─── */
function ReportTab({ ins, hasInsight, genIns, onGenAI, onSaveInsight }: { ins: AiInsight | null; hasInsight: boolean; genIns: boolean; onGenAI: () => void; onSaveInsight?: () => void }) {
  if (!ins) return (<div className="bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-100 rounded-[24px] p-10 flex flex-col items-center text-center gap-4"><div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-md"><Lightbulb className="w-8 h-8 text-indigo-500" /></div><div><h3 className="text-xl font-bold text-[#1d1d1f] mb-2">AI 用户洞察报告</h3><p className="text-sm text-[#86868b] max-w-md">{hasInsight ? '基于意图分层、JTBD 任务与场景洞察，生成完整报告。' : '请先点击「AI 用户洞察」。'}</p></div><button onClick={onGenAI} disabled={genIns || !hasInsight} className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-semibold transition-all disabled:opacity-50 shadow-lg"><Sparkles className={`w-4 h-4 ${genIns ? 'animate-spin' : ''}`} />{genIns ? '生成中...' : '生成报告'}</button></div>);

  return (
    <div className="space-y-6">
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onSaveInsight}
          className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-sm font-semibold hover:bg-emerald-100"
        >
          <Save className="w-4 h-4" />
          保存报告
        </button>
        <FeishuPushButton
          compact
          title="AI 用户洞察报告"
          getMarkdown={() => aiInsightToMarkdown(ins, 'AI 用户洞察报告')}
        />
      </div>
      <InsightReportPanels ins={ins} />
      <div className="flex justify-end">
        <button type="button" onClick={onGenAI} disabled={genIns} className="flex items-center gap-2 px-4 py-2 bg-[#f5f5f7] hover:bg-[#ebebeb] text-[#86868b] rounded-xl text-sm font-medium">
          <Sparkles className="w-4 h-4" />重新生成
        </button>
      </div>
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
  return (<Card className="border-none shadow-sm overflow-hidden"><CardHeader className="bg-[#f5f5f7]/50 border-b border-black/5"><div className="flex flex-col md:flex-row md:items-center justify-between gap-4"><div className="flex items-center gap-4"><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#86868b]" /><input type="text" placeholder="搜索关键词..." value={q} onChange={e => setQ(e.target.value)} className="pl-10 pr-4 py-2 bg-white border border-black/5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 w-56" /></div><div className="flex items-center gap-2"><Filter className="w-4 h-4 text-[#86868b]" /><Select value={cat} onChange={setCat} options={[{ value: 'all', label: '全部' }, ...TAGS.map(t => ({ value: t, label: t }))]} size="sm" aria-label="标签筛选" /></div></div><div className="text-xs text-[#86868b]">{filt.length} 个词 · 第 {page + 1}/{totalPages} 页</div></div></CardHeader>
    <CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs text-[#86868b] uppercase bg-[#f5f5f7] border-b border-black/5"><tr><th className="px-6 py-4">关键词/翻译</th><th className="px-6 py-4 text-right">周搜索量</th><th className="px-6 py-4 text-right">CPC</th><th className="px-6 py-4">意图</th><th className="px-6 py-4">JTBD</th><th className="px-6 py-4">场景/人群</th><th className="px-6 py-4">AI标签</th><th className="px-6 py-4 text-center">操作</th></tr></thead><tbody className="divide-y divide-black/5">{paged.map(kw => (<tr key={kw.id} className="hover:bg-[#f5f5f7]/50"><td className="px-6 py-4"><div className="font-medium">{kw.keyword}</div><div className="text-xs text-[#86868b]">{kw.translation}</div></td><td className="px-6 py-4 text-right font-mono">{safeNum(kw.weeklySearchVolume).toLocaleString()}</td><td className="px-6 py-4 text-right font-mono">${safeNum(kw.cpcBid).toFixed(2)}</td><td className="px-6 py-4">{(() => { const m = safeIntentMeta(kw.userIntentStage); return m ? <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ color: m.color, background: `${m.color}15` }}>{m.label}</span> : <span className="text-[#86868b] text-xs">—</span>; })()}</td><td className="px-6 py-4">{kw.jobToBeDone || '—'}</td><td className="px-6 py-4 text-xs text-[#86868b]">{[kw.useScenario, kw.targetUser].filter(Boolean).join(' · ') || '—'}</td><td className="px-6 py-4">{eid === kw.id ? (<div className="flex flex-wrap gap-1">{TAGS.map(t => (<button key={t} onClick={() => onTogTag(t)} className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${etags.includes(t) ? 'bg-indigo-100 text-indigo-600' : 'bg-white text-[#86868b] border border-black/5'}`}>{t}</button>))}</div>) : (<div className="flex flex-wrap gap-1">{(Array.isArray(kw.aiTags) && kw.aiTags.length > 0) ? kw.aiTags.map(t => <span key={t} className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full text-[10px] border border-indigo-100">{t}</span>) : <span className="text-[#86868b] text-xs italic">—</span>}</div>)}</td><td className="px-6 py-4 text-center">{eid === kw.id ? (<div className="flex items-center justify-center gap-2"><button onClick={() => onSaveEdit(kw.id)} className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg"><Check className="w-4 h-4" /></button><button onClick={onCancelEdit} className="p-1.5 bg-rose-50 text-rose-600 rounded-lg"><X className="w-4 h-4" /></button></div>) : (<button onClick={() => onStartEdit(kw)} className="p-1.5 text-[#86868b] hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"><Edit2 className="w-4 h-4" /></button>)}</td></tr>))}{paged.length === 0 && <tr><td colSpan={8} className="px-6 py-8 text-center text-[#86868b]">没有匹配的关键词</td></tr>}</tbody></table></div><Pager page={page} total={totalPages} onChange={setPage} /></CardContent></Card>);
}
