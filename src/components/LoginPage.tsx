import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Eye, EyeOff, User, Lock, BarChart3, Search, X, MessageCircle,
  MessageSquareWarning, KeyRound, FolderOpen, Compass, Tags, GitCompare, MessagesSquare,
  Calculator, Sparkles, Upload, Plug, ArrowDown, Layers, Route, CheckCircle2,
  TrendingUp, Shield, Zap, Clock, Lightbulb, Package, FlaskConical, RefreshCw, ArrowRight,
  Users, Target, Map, Megaphone, Palette, Quote, Brain,
} from 'lucide-react';
import { login, register, saveCreds, loadCreds, clearCreds } from '../utils/auth';
import { toast } from 'sonner';

interface LoginPageProps { onLoginSuccess: () => void; }
interface MenuItem { id: string; label: string; }

const MENU: MenuItem[] = [
  { id: 'docs', label: '帮助文档' },
  { id: 'about', label: '关于我们' },
  { id: 'contact', label: '联系我们' },
];

/* ── 字体 ── */
const FONT_IMPORT = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Instrument+Serif:ital@0;1&display=swap');
`;

/* ── CSS Tokens & Animations ── */
const pageCss = `
  .amz-login-page {
    --bg: #f8f9fb;
    --surface: #ffffff;
    --ink: #1d1d1f;
    --muted: #86868b;
    --soft: #aeaeb2;
    --accent: #4f46e5;
    --accent-light: #6366f1;
    --accent-glow: rgba(79,70,229,0.10);
    --violet: #7c3aed;
    --violet-glow: rgba(124,58,237,0.08);
    --border: rgba(0,0,0,0.05);
    --border-act: rgba(79,70,229,0.18);
    font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
    color: var(--ink);
    background: var(--bg);
  }
  .amz-login-page .font-display {
    font-family: 'Instrument Serif', Georgia, serif;
    font-weight: 400;
  }
  .amz-login-page .tabular-num {
    font-variant-numeric: tabular-nums;
    font-feature-settings: 'tnum' 1;
  }

  /* Glass card */
  .glass-card {
    background: rgba(255,255,255,0.72);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255,255,255,0.6);
    border-radius: 20px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.04);
    transition: all 0.35s ease;
  }
  .glass-card:hover {
    border-color: rgba(79,70,229,0.25);
    box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 12px 40px rgba(79,70,229,0.10);
    transform: translateY(-2px);
  }
  .glass-card.card-glow-violet:hover {
    border-color: rgba(124,58,237,0.25);
    box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 12px 40px rgba(124,58,237,0.10);
  }

  /* Data flow line in hero */
  @keyframes data-flow {
    0% { stroke-dashoffset: 1000; }
    100% { stroke-dashoffset: 0; }
  }
  @keyframes data-node-pulse {
    0%, 100% { r: 3; opacity: 0.6; }
    50% { r: 5; opacity: 1; }
  }
  @keyframes drift-up {
    0% { transform: translateY(0) scale(1); opacity: 0; }
    20% { opacity: 0.5; }
    80% { opacity: 0.3; }
    100% { transform: translateY(-120px) scale(0.6); opacity: 0; }
  }
  @keyframes hero-float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-8px); }
  }
  .hero-float { animation: hero-float 6s ease-in-out infinite; }

  @keyframes cta-pulse {
    0%, 100% { box-shadow: 0 10px 28px rgba(79,70,229,0.28), 0 0 0 0 rgba(99,102,241,0.45); transform: translateY(0); }
    50% { box-shadow: 0 14px 36px rgba(79,70,229,0.38), 0 0 0 10px rgba(99,102,241,0); transform: translateY(-1px); }
  }
  @keyframes cta-shine {
    0% { transform: translateX(-120%); }
    100% { transform: translateX(120%); }
  }
  .cta-insight {
    position: relative;
    overflow: hidden;
    animation: cta-pulse 2.4s ease-in-out infinite;
  }
  .cta-insight::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.35) 50%, transparent 65%);
    transform: translateX(-120%);
    animation: cta-shine 2.8s ease-in-out infinite;
    pointer-events: none;
  }

  @keyframes demand-glow {
    0%, 100% { filter: drop-shadow(0 0 0 rgba(99,102,241,0)); transform: translateY(0); }
    50% { filter: drop-shadow(0 6px 18px rgba(99,102,241,0.35)); transform: translateY(-1px); }
  }
  @keyframes demand-shine {
    0% { background-position: 0% 50%; }
    100% { background-position: 200% 50%; }
  }
  .demand-glow-wrap {
    position: relative;
    display: inline-block;
    overflow: hidden;
    vertical-align: baseline;
    border-radius: 4px;
  }
  .demand-glow-wrap::after {
    content: '';
    position: absolute;
    inset: -10% -20%;
    background: linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.65) 50%, transparent 65%);
    transform: translateX(-120%);
    animation: cta-shine 2.8s ease-in-out infinite;
    pointer-events: none;
    mix-blend-mode: soft-light;
  }
  .demand-glow {
    display: inline-block;
    background-image: linear-gradient(90deg, #4f46e5, #8b5cf6, #6366f1, #4f46e5);
    background-size: 200% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation: demand-shine 3.2s linear infinite, demand-glow 2.4s ease-in-out infinite;
  }

  /* Trend chart animations */
  @keyframes trend-draw {
    to { stroke-dashoffset: 0; }
  }
  @keyframes trend-reveal {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes bar-rise {
    from { transform: scaleY(0); opacity: 0.4; }
    to { transform: scaleY(1); opacity: 1; }
  }
  .hero-float { animation: hero-float 6s ease-in-out infinite; }

  /* Counter flash */
  @keyframes counter-pop {
    0% { transform: scale(1); }
    40% { transform: scale(1.08); color: var(--accent); }
    100% { transform: scale(1); }
  }
  .counter-flash { animation: counter-pop 0.35s ease-out; }

  /* range slider */
  .amz-login-page input[type='range'] {
    -webkit-appearance: none; appearance: none;
    height: 6px; border-radius: 999px;
    background: linear-gradient(90deg, var(--accent-light), var(--violet));
    outline: none;
  }
  .amz-login-page input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 20px; height: 20px; border-radius: 50%;
    background: #fff; border: 2px solid var(--accent-light);
    cursor: pointer;
    box-shadow: 0 0 0 6px rgba(79,70,229,0.12), 0 2px 8px rgba(0,0,0,0.10);
    transition: box-shadow 0.2s;
  }
  .amz-login-page input[type='range']::-webkit-slider-thumb:hover {
    box-shadow: 0 0 0 10px rgba(79,70,229,0.18), 0 2px 8px rgba(0,0,0,0.10);
  }
  .amz-login-page input[type='range']::-moz-range-thumb {
    width: 20px; height: 20px; border-radius: 50%;
    background: #fff; border: 2px solid var(--accent-light);
    cursor: pointer; box-shadow: 0 0 0 6px rgba(79,70,229,0.12);
  }

  @media (prefers-reduced-motion: reduce) {
    .amz-login-page .hero-float,
    .amz-login-page .drift-particle,
    .amz-login-page .cta-insight,
    .amz-login-page .cta-insight::after,
    .amz-login-page .demand-glow,
    .amz-login-page .demand-glow-wrap::after { animation: none !important; }
  }
`;

/* ═══════════════════════════════════════
   Nav – 与页面内一致
   ═══════════════════════════════════════ */
const Nav: React.FC<{ a: string | null; on: (id: string) => void; onBrandClick: () => void }> = ({ a, on, onBrandClick }) => (
  <nav className="sticky top-0 z-50 flex items-center justify-between px-6 lg:px-10 h-14 border-b border-black/[0.06] bg-white/80 backdrop-blur-xl">
    <button type="button" onClick={onBrandClick} className="flex items-center gap-2.5 group">
      <img src="/logo.svg?v=20260812b" alt="" className="w-8 h-8" />
      <span className="text-[#1d1d1f] font-semibold text-[15px] tracking-tight group-hover:text-indigo-600 transition-colors">Kairo</span>
    </button>
    <div className="flex items-center gap-1">
      {MENU.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => on(m.id)}
          className={`px-3.5 py-2 rounded-lg text-[13px] font-medium transition-all ${
            a === m.id ? 'bg-indigo-50 text-indigo-700' : 'text-[#86868b] hover:text-[#1d1d1f] hover:bg-black/[0.03]'
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  </nav>
);

/* ═══════════════════════════════════════
   About / Contact / Docs — 保留不动
   ═══════════════════════════════════════ */
const About: React.FC<{ c: () => void }> = ({ c }) => (
  <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={(e) => { if (e.target === e.currentTarget) c(); }}>
    <div className="bg-white border border-black/[0.06] w-full max-w-lg rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
      <div className="p-5 border-b border-black/[0.06] flex items-center justify-between sticky top-0 bg-white z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center">
            <BarChart3 className="w-[18px] h-[18px] text-indigo-600" />
          </div>
          <div>
            <h3 className="text-[#1d1d1f] font-semibold">关于 Kairo</h3>
            <p className="text-xs text-[#86868b]">抓住时机的用户洞察工作台</p>
          </div>
        </div>
        <button type="button" onClick={c} className="p-1.5 hover:bg-black/[0.04] rounded-lg text-[#86868b] hover:text-[#1d1d1f]">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-6 space-y-5 text-sm text-[#424245]">
        <div className="rounded-xl overflow-hidden border border-indigo-100/60">
          <img src="/brand/kairo-about.jpg" alt="Kairo · 恰当时机" className="w-full h-40 object-cover" />
        </div>
        <div className="rounded-xl bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-100/60 p-4">
          <p className="text-[13px] leading-relaxed text-[#1d1d1f]">
            <strong className="text-indigo-600">Kairo</strong> 源自希腊语 <em>καιρός (Kairos)</em>——不是日历上的「时间」，而是<strong>恰到好处的那一刻</strong>。
          </p>
          <p className="text-[13px] leading-relaxed mt-2 text-[#424245]">
            在亚马逊选品里，真正稀缺的不是数据，而是<strong>看懂用户、踩准窗口</strong>的判断力。Kairo 帮你在信号刚冒头时抓住爆品时机——用用户洞察把「感觉」变成可拍板的行动。
          </p>
        </div>
        <p>
          我们把关键词、评论、竞品 Listing、市场大盘收成同一套工作流，用 JTBD（用户真实要完成的任务）视角读懂<strong>「谁要买、为什么买、还差什么」</strong>——这正是用户洞察的核心。
        </p>
        <div className="space-y-3">
          <h4 className="text-[#1d1d1f] font-semibold text-sm">Kairo 帮你看见</h4>
          {[
            { i: Search, lb: '市场时机', ds: '大盘集中度、价格带、新品窗口——判断「现在能不能进」' },
            { i: Tags, lb: '搜索背后的需求', ds: '意图分层与 JTBD 任务聚类，看清用户在搜什么「任务」' },
            { i: MessagesSquare, lb: '用户真话', ds: '评论打标成痛点/赞美/场景/人群，直接喂给 Listing 与开发' },
            { i: GitCompare, lb: '竞品空白', ds: '主图、五点、流量词并排对照，找到可攻击的差距' },
          ].map(({ i: I, lb, ds }) => (
            <div key={lb} className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
                <I className="w-4 h-4 text-indigo-600" />
              </div>
              <div>
                <div className="text-[#1d1d1f] font-medium text-[13px]">{lb}</div>
                <div className="text-xs text-[#86868b] mt-0.5">{ds}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-[#aeaeb2] pt-1">Kairo · 为抓住时机而生</p>
      </div>
    </div>
  </div>
);

const Contact: React.FC<{ c: () => void }> = ({ c }) => (
  <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={(e) => { if (e.target === e.currentTarget) c(); }}>
    <div className="bg-white border border-black/[0.06] w-full max-w-sm rounded-2xl shadow-2xl">
      <div className="p-5 border-b border-black/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center">
            <MessageCircle className="w-[18px] h-[18px] text-indigo-600" />
          </div>
          <div>
            <h3 className="text-[#1d1d1f] font-semibold">联系我们</h3>
            <p className="text-xs text-[#86868b]">市调流程 / 洞察 / 试用支持</p>
          </div>
        </div>
        <button type="button" onClick={c} className="p-1.5 hover:bg-black/[0.04] rounded-lg text-[#86868b] hover:text-[#1d1d1f]">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-6 flex flex-col items-center gap-4">
        <div className="w-48 h-48 rounded-2xl overflow-hidden border border-black/[0.06] shadow-sm bg-white">
          <img
            src="/contact-qr.png"
            alt="联系我们二维码"
            className="w-full h-full object-contain p-2"
          />
        </div>
        <p className="text-xs text-[#86868b] text-center">扫码沟通市调工作流<br />或申请团队试用开通</p>
      </div>
    </div>
  </div>
);

const Docs: React.FC<{ c: () => void }> = ({ c }) => (
  <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={(e) => { if (e.target === e.currentTarget) c(); }}>
    <div className="bg-white border border-black/[0.06] w-full max-w-xl rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
      <div className="p-5 border-b border-black/[0.06] flex items-center justify-between shrink-0">
        <h3 className="text-[#1d1d1f] font-semibold">帮助文档</h3>
        <button type="button" onClick={c} className="p-1.5 hover:bg-black/[0.04] rounded-lg text-[#86868b] hover:text-[#1d1d1f]">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-6 space-y-6 text-sm text-[#424245] overflow-y-auto">
        <section>
          <h4 className="text-[#1d1d1f] font-semibold mb-2 flex items-center gap-2">
            <span className="text-indigo-600 font-mono text-xs">01</span> 快速开始
          </h4>
          <ol className="list-decimal list-inside space-y-1.5 text-[13px] text-[#86868b]">
            <li>注册 / 登录，或点「游客模式进入」先体验示例数据</li>
            <li>进入后默认在「市场大盘」——可上传 Excel，或稍后接 MCP 在线抓数</li>
            <li>左上角点 <strong className="text-[#1d1d1f]">Kairo</strong> Logo 可随时返回本主页</li>
          </ol>
        </section>
        <section>
          <h4 className="text-[#1d1d1f] font-semibold mb-2 flex items-center gap-2">
            <span className="text-indigo-600 font-mono text-xs">02</span> 市场大盘
          </h4>
          <p className="text-[13px] text-[#86868b] leading-relaxed mb-2">看品类有没有量、卷不卷、窗口在哪。</p>
          <ul className="list-disc list-inside space-y-1 text-[13px] text-[#86868b]">
            <li>上传产品表 + 历史大盘表，或加载示例</li>
            <li>查看趋势、价格带、集中度、品牌榜、机会扫描</li>
            <li>用「市场细分」做 AI 聚类；一键生成市场分析报告</li>
          </ul>
        </section>
        <section>
          <h4 className="text-[#1d1d1f] font-semibold mb-2 flex items-center gap-2">
            <span className="text-indigo-600 font-mono text-xs">03</span> 关键词与用户洞察
          </h4>
          <p className="text-[13px] text-[#86868b] leading-relaxed mb-2">从搜索词还原用户任务，而不是只看搜索量。</p>
          <ul className="list-disc list-inside space-y-1 text-[13px] text-[#86868b]">
            <li>上传关键词表，或「在线抓取」（按搜索量排名取前 N）</li>
            <li>点「AI 用户洞察」：意图分层 + JTBD + 场景×人群</li>
            <li>在「用户报告」Tab 生成可读的洞察摘要</li>
          </ul>
        </section>
        <section>
          <h4 className="text-[#1d1d1f] font-semibold mb-2 flex items-center gap-2">
            <span className="text-indigo-600 font-mono text-xs">04</span> 评论洞察（用户真话）
          </h4>
          <ul className="list-disc list-inside space-y-1 text-[13px] text-[#86868b]">
            <li>上传或 MCP 抓取评论</li>
            <li>四步：标签库 → 打标 → 深度洞察报告 → 用户旅程 5W1H</li>
            <li>结论可直接写进 Listing Brief / 开发 PRD</li>
          </ul>
        </section>
        <section>
          <h4 className="text-[#1d1d1f] font-semibold mb-2 flex items-center gap-2">
            <span className="text-indigo-600 font-mono text-xs">05</span> 竞品对比与利润
          </h4>
          <ul className="list-disc list-inside space-y-1 text-[13px] text-[#86868b]">
            <li>竞品：选 ASIN → 对照 Listing / 流量 / 父体矩阵 → AI 综合报告</li>
            <li>利润计算器：试算 FBA 成本结构，验证模型是否扛得住</li>
          </ul>
        </section>
        <section>
          <h4 className="text-[#1d1d1f] font-semibold mb-2 flex items-center gap-2">
            <span className="text-indigo-600 font-mono text-xs">06</span> 数据源与 AI 设置
          </h4>
          <p className="text-[13px] text-[#86868b] leading-relaxed">
            「设置 → MCP 数据」填卖家精灵 / 领星密钥即可在线抓取；「设置 → API」填大模型 Key 用于报告与打标。密钥只存在本机浏览器。在「Prompt」里可编辑各分析提示词。
          </p>
        </section>
        <p className="text-xs text-[#aeaeb2] pt-1">更多问题请通过「联系我们」扫码咨询。</p>
      </div>
    </div>
  </div>
);

/* ── 格式化 ── */
function formatInt(n: number): string {
  return Math.round(n).toLocaleString('zh-CN');
}
function formatMoney(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)} 万`;
  return formatInt(n);
}

/* ═══════════════════════════════════════
   Hero Data Flow SVG — 科技感数据流线
   ═══════════════════════════════════════ */
const HeroDataFlow: React.FC = () => {
  const points = [
    { x: 0, y: 48 }, { x: 64, y: 32 }, { x: 128, y: 52 }, { x: 192, y: 20 },
    { x: 256, y: 40 }, { x: 320, y: 16 }, { x: 384, y: 36 }, { x: 448, y: 12 },
  ];
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return (
    <div className="relative w-full max-w-[460px] mx-auto">
      <svg viewBox="0 0 448 64" className="w-full h-16" preserveAspectRatio="none">
        <defs>
          <linearGradient id="flowGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.15" />
            <stop offset="50%" stopColor="#8b5cf6" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0.15" />
          </linearGradient>
        </defs>
        <path d={pathD} fill="none" stroke="url(#flowGrad)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.45" />
        <path d={pathD} fill="none" stroke="url(#flowGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1000" opacity="0.8" style={{ animation: 'data-flow 4.5s linear infinite' }} />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3" fill={i % 3 === 0 ? '#6366f1' : i % 3 === 1 ? '#8b5cf6' : '#4f46e5'} style={{ animation: `data-node-pulse ${2.4 + i * 0.3}s ease-in-out ${i * 0.3}s infinite` }} />
        ))}
      </svg>
    </div>
  );
};

/* ═══════════════════════════════════════
   Hero Preview Card — 浮动的"大盘预览"
   ═══════════════════════════════════════ */
const HeroPreviewCard: React.FC = () => (
  <div className="relative hero-float">
    <div className="glass-card p-7 w-[440px] backdrop-blur-xl shadow-[0_20px_60px_-16px_rgba(79,70,229,0.18)]">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-green-400 shadow-sm shadow-green-400/50 animate-pulse" />
          <span className="text-[12px] font-semibold text-[#86868b] uppercase tracking-wider">Live Market · US</span>
        </div>
        <span className="text-[11px] font-medium text-green-500 bg-green-50 px-2.5 py-0.5 rounded-full">+12.4% MoM</span>
      </div>
      {/* KPI row */}
      <div className="grid grid-cols-3 gap-5 mb-6">
        {[
          { v: '2,847', l: 'ASINs', c: '#6366f1' },
          { v: '$42.8M', l: '月销额', c: '#8b5cf6' },
          { v: '4.3', l: '均评分', c: '#6366f1' },
        ].map(({ v, l, c }) => (
          <div key={l}>
            <div className="text-[1.55rem] font-bold" style={{ color: c }}>{v}</div>
            <div className="text-[12px] text-[#aeaeb2] mt-0.5">{l}</div>
          </div>
        ))}
      </div>
      {/* Ethereal bar chart — 5 soft translucent bars */}
      <div className="flex items-end gap-4 h-24 mb-2 px-2">
        {[
          { h: 0.36, label: 'Q1' },
          { h: 0.55, label: 'Q2' },
          { h: 0.48, label: 'Q3' },
          { h: 0.72, label: 'Q4' },
          { h: 0.88, label: 'Q5' },
        ].map(({ h, label }, i) => (
          <div key={label} className="flex-1 flex flex-col items-center h-full justify-end">
            <div
              className="w-full max-w-[28px] rounded-full"
              style={{
                height: `${h * 100}%`,
                transformOrigin: 'bottom',
                background: i === 4
                  ? 'linear-gradient(180deg, rgba(139,92,246,0.55) 0%, rgba(99,102,241,0.18) 100%)'
                  : 'linear-gradient(180deg, rgba(99,102,241,0.22) 0%, rgba(167,139,250,0.06) 100%)',
                boxShadow: i === 4 ? '0 0 24px rgba(139,92,246,0.18)' : 'none',
                animation: `bar-rise 1s ease-out ${i * 0.12}s both`,
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-[#aeaeb2] px-1">
        <span>H1</span><span>H2</span><span>Now</span>
      </div>
    </div>
  </div>
);

/* ═══════════════════════════════════════
   AnimatedCounter
   ═══════════════════════════════════════ */
const AnimatedCounter: React.FC<{ target: number; suffix?: string; className?: string }> = ({
  target, suffix = '', className = ''
}) => {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setSeen(true); }, { threshold: 0.3 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!seen) return;
    let s = 0;
    const step = Math.max(1, Math.floor(target / 35));
    const t = setInterval(() => {
      s += step;
      if (s >= target) { setVal(target); clearInterval(t); }
      else setVal(s);
    }, 50);
    return () => clearInterval(t);
  }, [seen, target]);

  return <span ref={ref} className={className}>{formatInt(val)}{suffix}</span>;
};

/* ═══════════════════════════════════════
   省时计算器 — 升级版
   ═══════════════════════════════════════ */
const SavingsCalculator: React.FC = () => {
  const [asins, setAsins] = useState(8);
  const [hours, setHours] = useState(6);
  const [cost, setCost] = useState(12000);
  const [flash, setFlash] = useState(false);

  const result = useMemo(() => {
    const yh = asins * hours * 12 * 0.55;
    const hc = yh / 160;
    const yc = hc * cost;
    return { yearHours: yh, headcount: hc, yearCost: yc };
  }, [asins, hours, cost]);

  useEffect(() => {
    setFlash(true);
    const t = window.setTimeout(() => setFlash(false), 220);
    return () => window.clearTimeout(t);
  }, [asins, hours, cost]);

  return (
    <section id="calculator" className="relative border-y border-black/[0.05] overflow-hidden">
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 70% 50% at 30% 50%, rgba(99,102,241,0.06), transparent), radial-gradient(ellipse 40% 40% at 75% 80%, rgba(139,92,246,0.05), transparent)' }}
      />
      <div className="relative max-w-5xl mx-auto px-6 lg:px-10 py-16 lg:py-20">
        <div className="max-w-2xl mb-10">
          <p className="text-indigo-600 text-xs font-semibold tracking-[0.16em] uppercase mb-3 flex items-center gap-2">
            <Zap className="w-3.5 h-3.5" /> 效率测算
          </p>
          <h2 className="font-display text-3xl lg:text-[2.2rem] text-[#1d1d1f] leading-tight mb-3">
            拖一下，看看一年能释放多少调研人力
          </h2>
          <p className="text-[#86868b] text-sm leading-relaxed">
            按「工具大约省掉 55% 重复劳动」粗算——方便你对内讲 ROI，不是承诺数字。
          </p>
        </div>
        <div className="grid lg:grid-cols-2 gap-10 items-start">
          <div className="space-y-7">
            {[
              { v: asins, set: setAsins, min: 1, max: 30, label: '每月研究品类 / ASIN 数' },
              { v: hours, set: setHours, min: 1, max: 20, label: '一次完整市调（小时）' },
              { v: cost, set: setCost, min: 5000, max: 30000, step: 500, label: '人月成本（¥）' },
            ].map(({ v, set, min, max, step, label }) => (
              <label key={label} className="block">
                <div className="flex justify-between mb-2">
                  <span className="text-sm text-[#424245]">{label}</span>
                  <span className="text-sm font-bold text-indigo-600 tabular-num">{step ? v.toLocaleString('zh-CN') : v}</span>
                </div>
                <input type="range" min={min} max={max} step={step ?? 1} value={v} onChange={(e) => set(Number(e.target.value))} className="w-full" />
              </label>
            ))}
          </div>
          <div className="glass-card p-6 lg:p-8 space-y-5">
            <div>
              <div className="text-[11px] text-[#aeaeb2] uppercase tracking-wider mb-1">预估年省小时</div>
              <div className={`text-4xl font-bold text-[#1d1d1f] tabular-num ${flash ? 'counter-flash' : ''}`}>
                {formatInt(result.yearHours)}<span className="text-lg font-medium text-[#86868b] ml-1.5">小时</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-black/[0.05]">
              <div>
                <div className="text-[11px] text-[#86868b] mb-1">约等于人力</div>
                <div className={`text-2xl font-bold text-indigo-600 tabular-num ${flash ? 'counter-flash' : ''}`}>
                  {result.headcount.toFixed(1)}<span className="text-sm font-medium text-[#86868b] ml-1">人月/年</span>
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[#86868b] mb-1">粗略年省成本</div>
                <div className={`text-2xl font-bold text-violet-600 tabular-num ${flash ? 'counter-flash' : ''}`}>
                  ¥{formatMoney(result.yearCost)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

/* ═══════════════════════════════════════
   Main LoginPage
   ═══════════════════════════════════════ */
export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);

  useEffect(() => {
    const c = loadCreds();
    if (c) { setUsername(c.username); setPassword(c.password); setRememberMe(true); }
  }, []);

  const scrollToLogin = () => {
    document.getElementById('login-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const enterGuest = () => {
    sessionStorage.setItem('guest_mode', '1');
    toast.success('已进入游客模式，可直接体验示例数据');
    onLoginSuccess();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      if (mode === 'register') {
        if (password !== confirmPassword) { toast.error('两次密码输入不一致'); return; }
        const r = register(username, password);
        if (!r.success) { toast.error(r.error ?? '注册失败'); return; }
        toast.success('注册成功，正在登录...');
        const lr = login(username, password);
        if (lr.success) {
          if (rememberMe) saveCreds(username, password); else clearCreds();
          onLoginSuccess();
        } else { toast.error(lr.error ?? '自动登录失败，请手动登录'); }
      } else {
        const r = login(username, password);
        if (!r.success) { toast.error(r.error ?? '登录失败'); return; }
        if (rememberMe) saveCreds(username, password); else clearCreds();
        toast.success(`欢迎回来，${r.user?.username}！`);
        onLoginSuccess();
      }
    } finally { setIsLoading(false); }
  };

  /* ── Four Phases ── */
  const phases = [
    {
      step: '01',
      icon: Lightbulb,
      accent: '#6366f1',
      accentBg: 'bg-indigo-50',
      title: '信号洞察',
      subtitle: '发现问题，还原需求',
      thesis: '别停在热词，要把需求说具体。',
      items: [
        '发现信号：Amazon 市场/竞品/评论、搜索广告、TikTok 趋势',
        '还原需求：人群 × 场景 × 审美 × 功能 × 情绪价值',
      ],
    },
    {
      step: '02',
      icon: Package,
      accent: '#8b5cf6',
      accentBg: 'bg-violet-50',
      title: '机会商品化',
      subtitle: '变成可开发的东西',
      thesis: '机会必须落到"能开一款产品"，不是一句"这里有机会"。',
      items: [
        '形成机会假设：现有产品为何没满足、竞争是否可进',
        '完成商品定义：规格、材质、功能、价格带、卖点、目标用户',
      ],
    },
    {
      step: '03',
      icon: FlaskConical,
      accent: '#6366f1',
      accentBg: 'bg-indigo-50',
      title: '市场验证',
      subtitle: '能不能真做、先小测',
      thesis: '有需求 ≠ 适合我们；先小实验，别直接正式开发。',
      items: [
        '检查可行性：毛利、供应链、品质、开发周期、品牌匹配（一票否决感）',
        '开展最小实验：打样/小测，低成本验证需求',
      ],
    },
    {
      step: '04',
      icon: RefreshCw,
      accent: '#8b5cf6',
      accentBg: 'bg-violet-50',
      title: '决策与学习',
      subtitle: '人拍板 + 闭环',
      thesis: '每次实战都让下一次"发现信号"更准。',
      items: [
        '人工决策：继续 / 调整 / 停止，并记录理由',
        '结果回流：真实市场结果写回机会卡，校准标签、门槛、评分',
      ],
    },
  ];

  /* ── 洞察深度：搜索词 + 评论 → 画像 / JTBD / 决策路径 → 方案 ── */
  const insightPipeline = [
    {
      step: '01',
      icon: Search,
      accent: '#6366f1',
      title: '输入信号',
      subtitle: '搜索词 × 评论',
      points: [
        '关键词：意图分层（认知 → 考虑 → 决策 → 忠诚）',
        '评论：痛点 / 赞美 / 场景 / 人群自动打标',
        'AI 清洗噪音，保留可验证的事实证据',
      ],
    },
    {
      step: '02',
      icon: Users,
      accent: '#8b5cf6',
      title: '用户画像',
      subtitle: '谁在买、谁在用',
      points: [
        '决策者 vs 使用者是否同一人',
        '高频人群标签与购买触发条件',
        '一句话 persona，可直接写进 Brief',
      ],
    },
    {
      step: '03',
      icon: Target,
      accent: '#6366f1',
      title: 'JTBD 任务',
      subtitle: '用户雇用产品做什么',
      points: [
        '功能任务 / 情感任务 / 社会任务分层',
        '同类搜索词收敛成可开发的任务名',
        '机会分：搜索量 × 竞争空隙交叉排序',
      ],
    },
    {
      step: '04',
      icon: Map,
      accent: '#8b5cf6',
      title: '决策路径',
      subtitle: '从搜到下单怎么走',
      points: [
        '认知：发现痛点与解决方案',
        '考虑：对比属性、评测、适用场景',
        '决策：规格锁定与信任信号触发购买',
      ],
    },
  ];

  const solutionPillars = [
    {
      icon: Package,
      accent: '#6366f1',
      title: '产品方案',
      image: '/brand/kairo-sol-product.jpg',
      desc: '规格、材质、功能组合、价格带与差异化卖点——对齐 JTBD 里尚未被满足的任务。',
      bullets: ['主规格与变体矩阵', '必改痛点 vs 可延后项', '首发验证假设清单'],
    },
    {
      icon: Palette,
      accent: '#8b5cf6',
      title: '视觉方案',
      image: '/brand/kairo-sol-visual.jpg',
      desc: '主图叙事、场景图、信息图与 A+ 结构——让买家在 3 秒内看懂「适不适合我」。',
      bullets: ['主图卖点优先级', '场景 × 人群露出', '误买风险点提前说清'],
    },
    {
      icon: Megaphone,
      accent: '#6366f1',
      title: '推广方案',
      image: '/brand/kairo-sol-promo.jpg',
      desc: '词库分层、广告切入点与 Listing 话术——跟着决策路径投放，而不是广撒网。',
      bullets: ['核心词 / 长尾 / 防御词', '广告与自然位协同', '标题五点话术素材'],
    },
  ];

  /* ── 洞察：薄枕头退货/评论摘录（与示例数据同一品类，一眼能懂） ── */
  const realInsightCards = [
    {
      icon: Shield, iconColor: '#6366f1', iconBg: 'bg-indigo-50',
      title: '头号差评不是「坏了」',
      stat: '太高', statDesc: '退货原话高频',
      detail: '买家反复写 Too high / 顶脖子——枕头未必坏，是「想象中的薄」和「到手的高」对不上。主图加尺子就能改。',
    },
    {
      icon: TrendingUp, iconColor: '#8b5cf6', iconBg: 'bg-violet-50',
      title: '退货留言里藏着正确规格',
      stat: '再订矮一档', statDesc: '误买后自救',
      detail: '有人退货写 will reorder 5"：产品矩阵其实够，是选购页没帮人选对高度。改 Listing / A+「选高度」，比改模具便宜。',
    },
    {
      icon: Clock, iconColor: '#6366f1', iconBg: 'bg-indigo-50',
      title: '退货多发生在开箱那一周',
      stat: '前 7 天', statDesc: '集中退货窗口',
      detail: '真空包装拆开先「扁扁的」，膨松步骤没写清就直接退。把开箱三步写进主图/五点，能拦住一批冲动退。',
    },
    {
      icon: Zap, iconColor: '#8b5cf6', iconBg: 'bg-violet-50',
      title: '平台勾「描述不符」= 预期管理失败',
      stat: '描述不符', statDesc: '多于纯质量问题',
      detail: '勾的是 Not as described，白话是「广告说 ultra slim，体感仍偏厚」。先修表达与高度可视化，别一上来怪供应链。',
    },
  ];

  /* ── Workflow steps ── */
  const flow = [
    { icon: Upload, title: '接入品类数据', desc: '上传 Excel 或连接卖家精灵 MCP，ASIN / 词 / 评论自动入库并结构化。' },
    { icon: Layers, title: '多维度交叉研判', desc: '大盘结构、意图分层、竞品差距、用户真话四维联动，提问即出图。' },
    { icon: Route, title: '输出决策报告', desc: '一键生成可读品类研判报告，市场/关键词/竞品/评论四个视角，直接进评审。' },
    { icon: Sparkles, title: '沉淀研判历史', desc: '每次分析保存为快照，复盘时有据可查，不再"结论散落在群聊里"。' },
  ];

  /* ── Connect table ── */
  const connectItems = [
    { need: '只想先体验', has: '游客模式 / 示例数据即可，无需密钥' },
    { need: '自己的 Excel 出大盘', has: '上传产品表 + 历史大盘表' },
    { need: '在线拉 ASIN / 词 / 评论', has: '设置里填卖家精灵 MCP Key' },
    { need: '一键 AI 洞察报告', has: '设置里填大模型 API Key（DeepSeek 等）' },
  ];

  return (
    <div className="amz-login-page min-h-screen">
      <style>{FONT_IMPORT}</style>
      <style>{pageCss}</style>

      <Nav a={menu} on={setMenu} onBrandClick={scrollToLogin} />
      {menu === 'about' && <About c={() => setMenu(null)} />}
      {menu === 'contact' && <Contact c={() => setMenu(null)} />}
      {menu === 'docs' && <Docs c={() => setMenu(null)} />}

      {/* ═══════ Hero ═══════ */}
      <section className="relative min-h-[calc(100vh-3.5rem)] flex flex-col lg:flex-row overflow-hidden bg-white">
        {/* 背景光晕 */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 55% 45% at 15% 25%, rgba(99,102,241,0.08), transparent 55%), radial-gradient(ellipse 40% 35% at 85% 75%, rgba(139,92,246,0.06), transparent 50%)' }}
        />
        {/* 微网格 */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.025]"
          style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.12) 1px, transparent 1px)', backgroundSize: '72px 72px' }}
        />

        {/* 左侧 Thesis */}
        <div className="relative z-10 flex-1 flex flex-col justify-center px-6 lg:px-14 xl:px-20 py-12 lg:py-16 order-2 lg:order-1">
          <div className="max-w-xl">
            {/* 标签 */}
            <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 rounded-full bg-gradient-to-r from-indigo-50 to-violet-50 border border-indigo-100/60">
              <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-sm shadow-indigo-500/40 animate-pulse" />
              <span className="text-[11px] font-bold text-indigo-600 tracking-[0.10em] uppercase">Amazon Market Intelligence</span>
            </div>

            <h1 className="font-display text-[2.6rem] sm:text-[3rem] lg:text-[3.5rem] text-[#1d1d1f] tracking-tight leading-[1.08] mb-4">
              洞察数据背后的
              <br />
              <span className="demand-glow-wrap"><span className="demand-glow">真需求</span></span>
            </h1>
            <p className="text-[#424245] text-lg lg:text-xl leading-snug mb-3 max-w-md">
              AI 读懂搜索词与买家真话，把零散数据还原成用户洞察——谁要买、为何买、还缺什么。
            </p>
            <p className="text-[#86868b] text-[14px] leading-relaxed max-w-md mb-6">
              输入关键词或评论，AI 自动抽出画像、JTBD 任务与决策路径，再落到可评审的产品 / 视觉 / 推广方案。
            </p>

            {/* 数据流线 */}
            <div className="mb-6">
              <HeroDataFlow />
              <p className="text-center text-[11px] text-[#aeaeb2] mt-2">系统持续解析品类供需结构</p>
            </div>

            <a href="#phases" className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-500 transition-colors">
              探索四阶段研判流程 <ArrowDown className="w-4 h-4" />
            </a>
          </div>
        </div>

        {/* 中部：浮动预览卡 */}
        <div className="hidden lg:flex absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none">
          <HeroPreviewCard />
        </div>

        {/* 右侧：登录面板 */}
        <div id="login-panel" className="relative z-10 flex-1 flex items-center justify-center px-6 py-10 lg:py-16 order-1 lg:order-2">
          <div className="w-full max-w-[400px] relative">

            {/* 登录面板 */}
            <div className="glass-card p-7 shadow-[0_24px_64px_-16px_rgba(79,70,229,0.15)]">
              {/* 面板头部 */}
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center mb-3">
                  <img src="/logo.svg?v=20260812b" alt="Kairo" className="w-12 h-12" />
                </div>
                <h3 className="font-semibold text-[#1d1d1f] text-[15px]">欢迎使用 Kairo</h3>
                <p className="text-[12px] text-[#aeaeb2] mt-0.5">{mode === 'login' ? '登录您的账号以继续' : '创建新账号以开始使用'}</p>
              </div>

              {/* Tab 切换 */}
              <div className="flex bg-gradient-to-r from-indigo-50/60 to-violet-50/60 rounded-xl p-1 mb-5">
                {(['login', 'register'] as const).map((m) => (
                  <button
                    key={m} type="button" onClick={() => setMode(m)}
                    className={`flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-300 ${
                      mode === m
                        ? 'bg-white text-[#1d1d1f] shadow-sm shadow-black/[0.04]'
                        : 'text-[#86868b] hover:text-[#1d1d1f]'
                    }`}
                  >
                    {m === 'login' ? '登录' : '注册'}
                  </button>
                ))}
              </div>

              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[12px] font-semibold text-[#424245]">用户名</label>
                  <div className="relative group">
                    <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-indigo-400/0 via-indigo-400/0 to-violet-400/0 group-focus-within:from-indigo-400/6 group-focus-within:via-indigo-400/10 group-focus-within:to-violet-400/6 transition-all duration-300 pointer-events-none" />
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#aeaeb2] group-focus-within:text-indigo-400 transition-colors z-10" />
                    <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                      placeholder="请输入用户名" required
                      className="relative w-full pl-10 pr-4 py-3 bg-white border border-black/[0.08] rounded-xl text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:outline-none focus:border-indigo-300 text-sm transition-all shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)]" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[12px] font-semibold text-[#424245]">密码</label>
                  <div className="relative group">
                    <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-indigo-400/0 via-indigo-400/0 to-violet-400/0 group-focus-within:from-indigo-400/6 group-focus-within:via-indigo-400/10 group-focus-within:to-violet-400/6 transition-all duration-300 pointer-events-none" />
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#aeaeb2] group-focus-within:text-indigo-400 transition-colors z-10" />
                    <input type={showPassword ? 'text' : 'password'} value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={mode === 'register' ? '至少 6 位' : '请输入密码'} required
                      className="relative w-full pl-10 pr-12 py-3 bg-white border border-black/[0.08] rounded-xl text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:outline-none focus:border-indigo-300 text-sm transition-all shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)]" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#aeaeb2] hover:text-indigo-500 transition-colors z-10 p-1"
                      tabIndex={-1}>
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {mode === 'register' && (
                  <div className="space-y-1.5">
                    <label className="text-[12px] font-semibold text-[#424245]">确认密码</label>
                    <div className="relative group">
                      <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-indigo-400/0 via-indigo-400/0 to-violet-400/0 group-focus-within:from-indigo-400/6 group-focus-within:via-indigo-400/10 group-focus-within:to-violet-400/6 transition-all duration-300 pointer-events-none" />
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#aeaeb2] group-focus-within:text-indigo-400 transition-colors z-10" />
                      <input type={showPassword ? 'text' : 'password'} value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="再次输入密码" required
                        className="relative w-full pl-10 pr-4 py-3 bg-white border border-black/[0.08] rounded-xl text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:outline-none focus:border-indigo-300 text-sm transition-all shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)]" />
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3 pt-1">
                  <button type="button" onClick={() => setRememberMe(!rememberMe)}
                    className={`w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center transition-all duration-200 ${
                      rememberMe
                        ? 'bg-indigo-500 border-indigo-500 shadow-sm shadow-indigo-500/25'
                        : 'border-black/15 bg-transparent hover:border-indigo-300'
                    }`} aria-pressed={rememberMe}>
                    {rememberMe && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <span className="text-[13px] text-[#86868b] select-none">记住密码</span>
                </div>

                <button type="submit" disabled={isLoading}
                  className={`w-full py-3.5 mt-2 bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 text-white font-semibold rounded-xl transition-all duration-300 shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/30 hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed text-[14px] tracking-wide active:scale-[0.98] ${!isLoading && mode === 'login' ? 'cta-insight' : ''}`}>
                  {isLoading ? (
                    <span className="inline-flex items-center gap-2">
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round" className="opacity-30" /><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
                      处理中...
                    </span>
                  ) : mode === 'login' ? '开启洞察' : '创建账号'}
                </button>
              </form>

              <div className="flex items-center gap-3 mt-5">
                <div className="flex-1 h-px bg-gradient-to-r from-transparent via-black/[0.06] to-transparent" />
                <span className="text-[11px] font-medium text-[#aeaeb2] uppercase tracking-wider">或者</span>
                <div className="flex-1 h-px bg-gradient-to-r from-transparent via-black/[0.06] to-transparent" />
              </div>

              <button type="button" onClick={enterGuest}
                className="w-full mt-4 py-3 border border-black/[0.08] hover:border-indigo-200 bg-white/60 hover:bg-indigo-50/70 text-[#86868b] hover:text-indigo-600 font-medium rounded-xl transition-all duration-300 text-[13px]">
                游客模式进入
              </button>
              <p className="text-center text-[11px] text-[#aeaeb2] mt-4">数据仅存储在本地浏览器，安全且私密</p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ 四阶段研判流程 ═══════ */}
      <section id="phases" className="bg-[#f8f9fb] border-t border-black/[0.04]">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-20 lg:py-24">
          <div className="mb-14 max-w-3xl">
            <p className="text-indigo-600 text-xs font-semibold tracking-[0.16em] uppercase mb-3">研判流程</p>
            <h2 className="font-display text-[2.2rem] lg:text-[2.5rem] text-[#1d1d1f] leading-tight mb-3">
              四个阶段：从发现信号到持续进化
            </h2>
            <p className="text-[#86868b] text-sm leading-relaxed">
              不是堆数据看板，而是沿着"发现 → 商品化 → 验证 → 学习"四步闭环，让每次研判都沉淀为下一次的起点。
            </p>
          </div>

          {/* Phase cards with connectors */}
          <div className="space-y-6">
            {phases.map(({ step, icon: Icon, accent, accentBg, title, subtitle, thesis, items }, idx) => {
              const isLast = idx === phases.length - 1;
              return (
                <div key={step} className="relative">
                  <div className="glass-card p-6 lg:p-8 flex flex-col lg:flex-row lg:items-start gap-6">
                    {/* Left badge */}
                    <div className="shrink-0 flex items-center lg:flex-col gap-3 lg:w-[120px]">
                      <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                        style={{ backgroundColor: `${accent}12`, border: `1px solid ${accent}25` }}>
                        <Icon className="w-6 h-6" style={{ color: accent }} />
                      </div>
                      <div>
                        <div className="text-[1.4rem] font-bold text-[#1d1d1f] leading-none">{step}</div>
                        <div className="text-[11px] text-[#aeaeb2] mt-0.5">阶段</div>
                      </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-3 mb-2 flex-wrap">
                        <h3 className="text-xl font-semibold text-[#1d1d1f]">{title}</h3>
                        <span className="text-[13px] text-[#86868b]">— {subtitle}</span>
                      </div>
                      <p className="text-[13px] font-medium italic mb-4"
                        style={{ color: `${accent}cc` }}>
                        "{thesis}"
                      </p>
                      <ul className="space-y-2.5">
                        {items.map((item) => (
                          <li key={item} className="flex items-start gap-2.5 text-[14px] text-[#424245] leading-relaxed">
                            <ArrowRight className="w-4 h-4 mt-0.5 shrink-0" style={{ color: accent }} />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Connector arrow between phases */}
                  {!isLast && (
                    <div className="flex justify-center py-3">
                      <div className="w-0.5 h-8 rounded-full"
                        style={{ background: `linear-gradient(to bottom, ${phases[idx].accent}, ${phases[idx + 1].accent})` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Return loop indicator */}
          <div className="mt-10 flex items-center justify-center gap-3 text-[13px] text-[#aeaeb2]">
            <RefreshCw className="w-4 h-4 text-[#8b5cf6]" />
            <span>第四阶段结果回流，校准第一阶段信号识别——形成持续进化的品类研判闭环</span>
          </div>
        </div>
      </section>

      {/* ═══════ 洞察深度 — 搜索/评论 → 画像/JTBD/路径 → 方案 ═══════ */}
      <section className="bg-white border-t border-black/[0.04]">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-24 lg:py-32">
          {/* Header */}
          <div className="mb-16 max-w-3xl">
            <p className="text-violet-600 text-xs font-semibold tracking-[0.16em] uppercase mb-3 flex items-center gap-2">
              <Brain className="w-3.5 h-3.5" /> 洞察深度
            </p>
            <h2 className="font-display text-[2.4rem] lg:text-[3rem] text-[#1d1d1f] leading-tight mb-4">
              从搜索词与评论，到可落地的产品方案
            </h2>
            <p className="text-[#86868b] text-[15px] leading-relaxed">
              AI 不是再堆一张表——它把搜索行为与买家真话，还原成<strong className="text-[#424245] font-medium">用户画像、JTBD 任务、决策路径</strong>，再落到产品 / 视觉 / 推广三套动作。下面是完整链路示意。
            </p>
          </div>

          <div className="mb-10 rounded-2xl overflow-hidden border border-indigo-100/50 shadow-sm">
            <img src="/brand/kairo-pipeline.jpg" alt="洞察链路" className="w-full max-h-[220px] object-cover object-center" />
          </div>

          {/* Pipeline: 4 stages — large */}
          <div className="mb-20">
            <div className="flex items-center gap-2 mb-8">
              <div className="h-px flex-1 bg-gradient-to-r from-indigo-200/80 to-transparent" />
              <span className="text-[12px] font-semibold text-indigo-600 tracking-wider uppercase">洞察链路</span>
              <div className="h-px flex-1 bg-gradient-to-l from-violet-200/80 to-transparent" />
            </div>
            <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-5 lg:gap-6">
              {insightPipeline.map(({ step, icon: Icon, accent, title, subtitle, points }, idx) => (
                <div key={step} className="relative glass-card p-6 lg:p-7 min-h-[280px] flex flex-col">
                  <div className="flex items-center justify-between mb-5">
                    <div className="w-11 h-11 rounded-2xl flex items-center justify-center"
                      style={{ backgroundColor: `${accent}12`, border: `1px solid ${accent}22` }}>
                      <Icon className="w-5 h-5" style={{ color: accent }} />
                    </div>
                    <span className="text-[1.5rem] font-bold text-[#1d1d1f]/opacity-25 font-mono">{step}</span>
                  </div>
                  <h3 className="text-lg font-semibold text-[#1d1d1f] mb-1">{title}</h3>
                  <p className="text-[13px] mb-5" style={{ color: accent }}>{subtitle}</p>
                  <ul className="space-y-3 mt-auto">
                    {points.map((p) => (
                      <li key={p} className="flex items-start gap-2 text-[13px] text-[#424245] leading-relaxed">
                        <ArrowRight className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: accent }} />
                        {p}
                      </li>
                    ))}
                  </ul>
                  {idx < insightPipeline.length - 1 && (
                    <div className="hidden xl:block absolute -right-3 top-1/2 -translate-y-1/2 z-10 text-[#aeaeb2]">
                      <ArrowRight className="w-5 h-5" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Example insight block: persona + JTBD + path */}
          <div className="mb-20 grid lg:grid-cols-5 gap-6 lg:gap-8">
            <div className="lg:col-span-2 glass-card p-7 lg:p-8 card-glow-violet">
              <div className="flex items-center gap-2 mb-4">
                <Quote className="w-4 h-4 text-violet-500" />
                <span className="text-[12px] font-semibold text-violet-600 uppercase tracking-wider">示例 · 用户画像</span>
              </div>
              <div className="mb-5 rounded-xl overflow-hidden border border-violet-100/60">
                <img src="/brand/kairo-persona.jpg" alt="用户画像分析" className="w-full h-40 object-cover" />
              </div>
              <p className="text-[15px] text-[#1d1d1f] leading-relaxed mb-6">
                「25–40 岁都市轻办公人群，为通勤与短途出行选购；决策者多为本人，常在对比「便携 / 耐用 / 颜值」后下单，对误买与退货成本敏感。」
              </p>
              <div className="space-y-3">
                {[
                  { k: '核心场景', v: '通勤、差旅、居家办公' },
                  { k: '触发条件', v: '旧物损坏 / 礼赠 / 换季升级' },
                  { k: '决策标准', v: '场景匹配 > 价格 > 品牌' },
                ].map(({ k, v }) => (
                  <div key={k} className="flex gap-3 text-[13px]">
                    <span className="text-[#aeaeb2] w-16 shrink-0">{k}</span>
                    <span className="text-[#424245] font-medium">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-3 space-y-5">
              <div className="glass-card p-7 lg:p-8">
                <div className="flex items-center gap-2 mb-5">
                  <Target className="w-4 h-4 text-indigo-500" />
                  <span className="text-[12px] font-semibold text-indigo-600 uppercase tracking-wider">示例 · JTBD 任务聚类</span>
                </div>
                <div className="grid sm:grid-cols-3 gap-4">
                  {[
                    { type: '功能任务', job: '便携收纳', vol: '高搜索量', tip: '未满足：一手可拿 + 不皱' },
                    { type: '情感任务', job: '显品味', vol: '中搜索量', tip: '未满足：低调但不廉价' },
                    { type: '社会任务', job: '送礼得体', vol: '长尾机会', tip: '未满足：开箱仪式感' },
                  ].map(({ type, job, vol, tip }) => (
                    <div key={job} className="rounded-xl bg-gradient-to-br from-indigo-50/80 to-violet-50/40 border border-indigo-100/50 p-4">
                      <div className="text-[11px] text-[#86868b] mb-1">{type}</div>
                      <div className="text-[16px] font-semibold text-[#1d1d1f] mb-1">{job}</div>
                      <div className="text-[11px] text-indigo-500 font-medium mb-2">{vol}</div>
                      <div className="text-[12px] text-[#424245] leading-snug">{tip}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="glass-card p-7 lg:p-8">
                <div className="flex items-center gap-2 mb-4">
                  <Map className="w-4 h-4 text-violet-500" />
                  <span className="text-[12px] font-semibold text-violet-600 uppercase tracking-wider">示例 · 用户决策路径</span>
                </div>
                <div className="mb-5 rounded-xl overflow-hidden border border-violet-100/60">
                  <img src="/brand/kairo-decision.jpg" alt="决策路径四阶段" className="w-full h-28 object-cover" />
                </div>
                <div className="flex flex-col sm:flex-row gap-3 sm:gap-0 sm:items-stretch">
                  {[
                    { stage: '认知', desc: '搜痛点词 / how-to，确认有没有解决方案', bg: 'bg-violet-50', text: 'text-violet-700', ring: 'bg-violet-100' },
                    { stage: '考虑', desc: '比材质、尺寸、场景适配；看评测与差评', bg: 'bg-blue-50', text: 'text-blue-700', ring: 'bg-blue-100' },
                    { stage: '决策', desc: '锁规格与价格带；信任信号决定是否下单', bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'bg-emerald-100' },
                    { stage: '使用', desc: '开箱与首次使用决定留评或退货', bg: 'bg-amber-50', text: 'text-amber-700', ring: 'bg-amber-100' },
                  ].map(({ stage, desc, bg, text, ring }, i) => (
                    <div key={stage} className={`flex-1 relative sm:mx-1 rounded-xl ${bg} border border-black/5 p-3`}>
                      <div className={`text-[13px] font-semibold ${text} mb-1.5 flex items-center gap-2`}>
                        <span className={`w-6 h-6 rounded-full ${ring} ${text} text-[11px] font-bold flex items-center justify-center`}>{i + 1}</span>
                        {stage}
                      </div>
                      <p className="text-[12px] text-[#86868b] leading-relaxed">{desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Solution pillars: 产品 / 视觉 / 推广 */}
          <div className="mb-20">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-indigo-500" />
              <span className="text-[12px] font-semibold text-indigo-600 uppercase tracking-wider">落地输出</span>
            </div>
            <h3 className="text-xl lg:text-2xl font-semibold text-[#1d1d1f] mb-2">洞察之后：三套可评审方案</h3>
            <p className="text-[14px] text-[#86868b] mb-8 max-w-2xl">
              画像与任务对齐后，AI 协助把结论拆成产品、视觉、推广三份动作清单——方便直接进评审，而不是停在「感觉有机会」。
            </p>
            <div className="grid md:grid-cols-3 gap-5 lg:gap-6">
              {solutionPillars.map(({ icon: Icon, accent, title, desc, bullets, image }) => (
                <div key={title} className="glass-card overflow-hidden min-h-[320px] flex flex-col">
                  <div className="aspect-[4/3] bg-[#f5f5f7] overflow-hidden border-b border-black/[0.04]">
                    <img src={image} alt={title} className="w-full h-full object-cover object-center" />
                  </div>
                  <div className="p-6 lg:p-7 flex flex-col flex-1">
                    <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-4"
                      style={{ backgroundColor: `${accent}12`, border: `1px solid ${accent}22` }}>
                      <Icon className="w-5 h-5" style={{ color: accent }} />
                    </div>
                    <h4 className="text-lg font-semibold text-[#1d1d1f] mb-2">{title}</h4>
                    <p className="text-[13px] text-[#86868b] leading-relaxed mb-4">{desc}</p>
                    <ul className="space-y-2.5 mt-auto">
                      {bullets.map((b) => (
                        <li key={b} className="flex items-center gap-2 text-[13px] text-[#424245]">
                          <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: accent }} />
                          {b}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Evidence cards from refund analysis */}
          <div>
            <div className="mb-8 max-w-2xl">
              <p className="text-[12px] font-semibold text-[#86868b] uppercase tracking-wider mb-2">证据摘录 · 薄枕头示例</p>
              <h3 className="text-xl font-semibold text-[#1d1d1f] mb-2">退货原话一读，就知道该改产品还是改页面</h3>
              <p className="text-[14px] text-[#86868b] leading-relaxed">
                下面四条来自薄枕头品类的评论/退货摘录——不是堆百分比，而是「买家怎么说 → 你该动哪一块」。
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
              {realInsightCards.map(({ icon: Icon, iconColor, iconBg, title, stat, statDesc, detail }) => (
                <div key={title} className="glass-card p-6 card-glow-violet min-h-[200px]">
                  <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center mb-4`}>
                    <Icon className="w-4 h-4" style={{ color: iconColor }} />
                  </div>
                  <div className="flex items-baseline gap-1.5 mb-2">
                    <span className="text-[1.7rem] font-bold" style={{ color: iconColor }}>{stat}</span>
                    <span className="text-[11px] text-[#86868b]">{statDesc}</span>
                  </div>
                  <h4 className="font-semibold text-[#1d1d1f] text-[14px] mb-1.5">{title}</h4>
                  <p className="text-[12px] text-[#86868b] leading-relaxed">{detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ 研判路径 ═══════ */}
      <section className="bg-[#f8f9fb] border-t border-black/[0.04]">
        <div className="max-w-5xl mx-auto px-6 lg:px-10 py-20 lg:py-24">
          <div className="mb-14 max-w-2xl">
            <p className="text-[#86868b] text-xs font-semibold tracking-[0.16em] uppercase mb-3">研判路径</p>
            <h2 className="font-display text-[2.2rem] lg:text-[2.5rem] text-[#1d1d1f] leading-tight mb-3">
              三步完成品类研判
            </h2>
            <p className="text-[#86868b] text-sm">接入即出图，边看边形成判断，不是先搭数据再等报告。</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {flow.map(({ icon: Icon, title, desc }, idx) => (
              <div key={title} className="glass-card p-5">
                <div className="text-[11px] font-bold text-indigo-500 mb-3 font-mono tracking-wider">{`0${idx + 1}`}</div>
                <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center mb-3">
                  <Icon className="w-4 h-4 text-indigo-600" />
                </div>
                <h3 className="font-semibold text-[#1d1d1f] text-[15px] mb-1.5">{title}</h3>
                <p className="text-[13px] text-[#86868b] leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ 效率提升价值页 ═══════ */}
      <section className="bg-white border-t border-black/[0.04]">
        <div className="max-w-5xl mx-auto px-6 lg:px-10 py-20 lg:py-24">
          <div className="mb-12 max-w-2xl">
            <p className="text-indigo-600 text-xs font-semibold tracking-[0.16em] uppercase mb-3 flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5" /> 效率提升
            </p>
            <h2 className="font-display text-[2.2rem] lg:text-[2.5rem] text-[#1d1d1f] leading-tight mb-3">
              这套系统，能帮团队省下什么
            </h2>
            <p className="text-[#86868b] text-sm leading-relaxed">
              不是再堆一个看板——把「找词、读评论、对竞品、写结论」收成同一条链路，把重复劳动换成可评审的洞察。
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
            {[
              { v: '55%', l: '重复劳动可压缩', d: '抓取、清洗、打标、汇总报告' },
              { v: '3→1', l: '工具跳转次数', d: '词库 / 评论 / 竞品同一工作台' },
              { v: '1 次', l: '生成可评审结论', d: '画像 + 路径 + Listing/产品动作' },
              { v: '本机', l: '数据留在浏览器', d: '密钥与文件不上传服务器' },
            ].map(item => (
              <div key={item.l} className="glass-card p-5">
                <div className="text-3xl font-bold text-indigo-600 mb-1 tabular-num">{item.v}</div>
                <div className="text-sm font-semibold text-[#1d1d1f] mb-1">{item.l}</div>
                <p className="text-[12px] text-[#86868b] leading-relaxed">{item.d}</p>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50/80 to-violet-50/50 p-6 lg:p-8">
            <div className="grid md:grid-cols-3 gap-6 text-[13px] text-[#424245]">
              <div>
                <div className="font-semibold text-[#1d1d1f] mb-2">以前</div>
                <ul className="space-y-1.5 text-[#86868b]">
                  <li>· 多个工具来回导出 Excel</li>
                  <li>· 评论人工翻页记痛点</li>
                  <li>· 结论散落在聊天与表格</li>
                </ul>
              </div>
              <div>
                <div className="font-semibold text-[#1d1d1f] mb-2">用 Kairo 之后</div>
                <ul className="space-y-1.5 text-[#86868b]">
                  <li>· 关键词 / 评论 / 竞品一站交叉</li>
                  <li>· AI 打标 + 结构化报告</li>
                  <li>· 直接进评审的三套动作清单</li>
                </ul>
              </div>
              <div>
                <div className="font-semibold text-[#1d1d1f] mb-2">适合谁</div>
                <ul className="space-y-1.5 text-[#86868b]">
                  <li>· 选品 / 产品经理周复盘</li>
                  <li>· 运营准备 Listing 改版</li>
                  <li>· 需要对外讲清「为什么开这款」</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <SavingsCalculator />

      {/* ═══════ 接入方式 ═══════ */}
      <section className="bg-white border-t border-black/[0.04]">
        <div className="max-w-5xl mx-auto px-6 lg:px-10 py-20 lg:py-24">
          <div className="mb-10 flex flex-col sm:flex-row sm:items-end gap-4 justify-between">
            <div className="max-w-xl">
              <p className="text-[#86868b] text-xs font-semibold tracking-[0.14em] uppercase mb-3 flex items-center gap-2">
                <Plug className="w-3.5 h-3.5" /> 按目标选配
              </p>
              <h2 className="font-display text-[2rem] text-[#1d1d1f] leading-tight">不必一次配齐</h2>
            </div>
            <p className="text-xs text-[#aeaeb2] max-w-xs sm:text-right">密钥只存在本机浏览器，不上传任何服务器。</p>
          </div>
          <div className="overflow-hidden rounded-2xl border border-black/[0.05]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#f5f5f7] text-left text-xs text-[#86868b] uppercase tracking-wider">
                  <th className="px-5 py-3.5 font-semibold">你想做的事</th>
                  <th className="px-5 py-3.5 font-semibold">最少需要</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {connectItems.map((row) => (
                  <tr key={row.need} className="bg-white hover:bg-[#fafbfc] transition-colors">
                    <td className="px-5 py-3.5 text-[#1d1d1f] font-medium">{row.need}</td>
                    <td className="px-5 py-3.5 text-[#86868b]">{row.has}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ═══════ Footer ═══════ */}
      <footer className="border-t border-black/[0.06] bg-white">
        <div className="max-w-5xl mx-auto px-6 lg:px-10 py-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center">
              <BarChart3 className="w-4 h-4 text-indigo-600" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[#1d1d1f]">Kairo</div>
              <div className="text-[11px] text-[#aeaeb2]">抓住时机 · 用户洞察</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-[13px] text-[#86868b]">
            <button type="button" onClick={() => setMenu('docs')} className="hover:text-indigo-600 transition-colors">帮助</button>
            <button type="button" onClick={() => setMenu('about')} className="hover:text-indigo-600 transition-colors">关于</button>
            <button type="button" onClick={() => setMenu('contact')} className="hover:text-indigo-600 transition-colors">联系</button>
            <button type="button" onClick={scrollToLogin} className="hover:text-indigo-600 transition-colors">回到顶部</button>
          </div>
        </div>
      </footer>
    </div>
  );
};
