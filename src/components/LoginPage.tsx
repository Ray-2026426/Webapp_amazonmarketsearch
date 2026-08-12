import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Eye, EyeOff, User, Lock, BarChart3, Search, X, MessageCircle, QrCode,
  MessageSquareWarning, KeyRound, FolderOpen, Compass, Tags, GitCompare, MessagesSquare,
  Calculator, Sparkles, Upload, Plug, ArrowDown, Layers, Route, CheckCircle2,
  TrendingUp, Shield, Zap, Clock,
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
    .amz-login-page .drift-particle { animation: none !important; }
  }
`;

/* ═══════════════════════════════════════
   Nav – 与页面内一致
   ═══════════════════════════════════════ */
const Nav: React.FC<{ a: string | null; on: (id: string) => void; onBrandClick: () => void }> = ({ a, on, onBrandClick }) => (
  <nav className="sticky top-0 z-50 flex items-center justify-between px-6 lg:px-10 h-14 border-b border-black/[0.06] bg-white/80 backdrop-blur-xl">
    <button type="button" onClick={onBrandClick} className="flex items-center gap-2.5 group">
      <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center group-hover:shadow-sm group-hover:shadow-indigo-200/50 transition-all">
        <BarChart3 className="w-4 h-4 text-indigo-600" />
      </div>
      <span className="text-[#1d1d1f] font-semibold text-[15px] tracking-tight group-hover:text-indigo-600 transition-colors">AmzDev Tool</span>
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
    <div className="bg-white border border-black/[0.06] w-full max-w-lg rounded-2xl shadow-2xl">
      <div className="p-5 border-b border-black/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center">
            <BarChart3 className="w-[18px] h-[18px] text-indigo-600" />
          </div>
          <div>
            <h3 className="text-[#1d1d1f] font-semibold">关于 AmzDev Tool</h3>
            <p className="text-xs text-[#86868b]">亚马逊市调与用户洞察工作台</p>
          </div>
        </div>
        <button type="button" onClick={c} className="p-1.5 hover:bg-black/[0.04] rounded-lg text-[#86868b] hover:text-[#1d1d1f]">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-6 space-y-5 text-sm text-[#424245]">
        <p>
          <strong className="text-[#1d1d1f]">AmzDev Tool</strong> 把关键词、评论、竞品 Listing 收成同一套工作流，用 JTBD 视角读懂「谁要买、为什么买、还差什么」。
        </p>
        <div className="space-y-3">
          <h4 className="text-[#1d1d1f] font-semibold text-sm">系统能回答</h4>
          {[
            { i: Search, lb: '市场规模与集中度', ds: '大盘趋势、价格带、新品窗口，一眼对齐选品方向' },
            { i: Tags, lb: '搜索意图分层', ds: '不止搜索量/CPC，拆出认知→决策四层意图与场景×人群' },
            { i: MessagesSquare, lb: '用户真话解码', ds: '评论按痛点/赞美/场景自动打标，可写进开发简报' },
            { i: GitCompare, lb: '竞品差距对照', ds: '主图、五点、流量词结构并排，少翻十几个页面' },
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
        <p className="text-xs text-[#aeaeb2] pt-1">Version 2.0 · Built for Amazon ops & PMs</p>
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
        <div className="w-44 h-44 rounded-2xl bg-[#f5f5f7] border border-dashed border-black/10 flex flex-col items-center justify-center text-[#aeaeb2] gap-2">
          <QrCode className="w-10 h-10" />
          <span className="text-xs">二维码占位</span>
          <span className="text-[10px]">后续替换为实际二维码</span>
        </div>
        <p className="text-xs text-[#86868b] text-center">扫码沟通市调工作流<br />或申请团队试用开通</p>
      </div>
    </div>
  </div>
);

const Docs: React.FC<{ c: () => void }> = ({ c }) => (
  <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={(e) => { if (e.target === e.currentTarget) c(); }}>
    <div className="bg-white border border-black/[0.06] w-full max-w-lg rounded-2xl shadow-2xl">
      <div className="p-5 border-b border-black/[0.06] flex items-center justify-between">
        <h3 className="text-[#1d1d1f] font-semibold">帮助文档</h3>
        <button type="button" onClick={c} className="p-1.5 hover:bg-black/[0.04] rounded-lg text-[#86868b] hover:text-[#1d1d1f]">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-6 space-y-4 text-sm text-[#424245]">
        <ol className="list-decimal list-inside space-y-1.5 text-[13px] text-[#86868b]">
          <li>登录后进「市场大盘」，导入 ASIN / 关键词，先看机会与集中度</li>
          <li>在「关键词分析」跑种子词，输出购买意图与 JTBD 任务分层</li>
          <li>在「竞品对比」对齐 Listing、流量结构与卖点差距</li>
          <li>在「评论洞察」提炼痛点、赞美点与未满足需求</li>
          <li>需要测算时，用「利润计算器」验证 FBA 模型是否扛得住</li>
        </ol>
        <p className="text-xs text-[#aeaeb2] pt-2">更多问题请通过「联系我们」扫码咨询。</p>
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
        {/* glow underlay */}
        <defs>
          <linearGradient id="flowGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.15" />
            <stop offset="50%" stopColor="#8b5cf6" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0.15" />
          </linearGradient>
        </defs>
        <path
          d={pathD}
          fill="none"
          stroke="url(#flowGrad)"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.45"
        />
        <path
          d={pathD}
          fill="none"
          stroke="url(#flowGrad)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="1000"
          opacity="0.8"
          style={{ animation: 'data-flow 4.5s linear infinite' }}
        />
        {/* data nodes */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x} cy={p.y}
            r="3"
            fill={i % 3 === 0 ? '#6366f1' : i % 3 === 1 ? '#8b5cf6' : '#4f46e5'}
            style={{ animation: `data-node-pulse ${2.4 + i * 0.3}s ease-in-out ${i * 0.3}s infinite` }}
          />
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
    <div className="glass-card p-5 w-[320px] backdrop-blur-xl">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-2 h-2 rounded-full bg-green-400 shadow-sm shadow-green-400/50" />
        <span className="text-[11px] font-semibold text-[#86868b] uppercase tracking-wider">Live Market · US</span>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[
          { v: '2,847', l: 'ASINs', c: '#6366f1' },
          { v: '$42.8M', l: '月销额', c: '#8b5cf6' },
          { v: '4.3', l: '均评分', c: '#6366f1' },
        ].map(({ v, l, c }) => (
          <div key={l}>
            <div className="text-xl font-bold" style={{ color: c }}>{v}</div>
            <div className="text-[10px] text-[#aeaeb2] mt-0.5">{l}</div>
          </div>
        ))}
      </div>
      {/* mini bars */}
      <div className="flex items-end gap-1 h-10">
        {[0.7, 0.9, 0.45, 0.8, 0.55, 0.95, 0.6, 0.75, 0.85, 0.5, 0.7, 0.65].map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-[2px] transition-all duration-500"
            style={{
              height: `${h * 100}%`,
              backgroundColor: h > 0.8 ? '#6366f1' : h > 0.6 ? '#8b5cf6' : '#e0e0e8',
              animationDelay: `${i * 0.06}s`,
            }}
          />
        ))}
      </div>
      <div className="flex justify-between mt-1.5 text-[10px] text-[#aeaeb2]">
        <span>Jan</span><span>Jun</span><span>Dec</span>
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

  /* ── Modules ── */
  const modules = [
    {
      icon: Compass, accent: '#6366f1', tagCls: 'bg-indigo-50 text-indigo-700 border-indigo-100',
      title: '市场全景研判',
      q: '这个品类的钱在哪里、谁在赚、还能不能进？',
      points: ['市场集中度与 HHI 指数', '价格带 × 评分分布定位', '新品存活窗口期判断', '品牌梯队与份额变迁'],
    },
    {
      icon: Tags, accent: '#8b5cf6', tagCls: 'bg-violet-50 text-violet-700 border-violet-100',
      title: '搜索意图解码',
      q: '用户搜索的不是词，是要完成的任务。',
      points: ['认知 → 考虑 → 决策 → 忠诚四层意图', 'JTBD 任务聚类与场景 × 人群', '词群转化漏斗与竞品截流点', '品类需求演化趋势追踪'],
    },
    {
      icon: GitCompare, accent: '#6366f1', tagCls: 'bg-indigo-50 text-indigo-700 border-indigo-100',
      title: '竞品差距雷达',
      q: '不是看别人做了啥，是看他们漏了啥。',
      points: ['主图/五点/标题逐项对照', '流量词结构重叠与独占', '父体规格矩阵差异', 'AI 综合差距报告'],
    },
    {
      icon: MessagesSquare, accent: '#8b5cf6', tagCls: 'bg-violet-50 text-violet-700 border-violet-100',
      title: '用户真话引擎',
      q: '评论不是打分，是产品迭代的需求清单。',
      points: ['好评/差评/场景/人群自动打标', '痛点聚类与严重度排序', '未满足需求的 JTBD 转写', '可写进 PRD 的用户原声'],
    },
  ];

  /* ── 洞察：来自真实退款分析 ── */
  const realInsightCards = [
    {
      icon: Shield, iconColor: '#6366f1', iconBg: 'bg-indigo-50',
      title: '高退货变体的品类级缺陷',
      stat: '56.1%', statDesc: '集中在塑料套装',
      detail: '准确度/尺码偏差投诉是金属套装的 2.5 倍，但竞品 A+ 页面完全没有针对性解释。',
    },
    {
      icon: TrendingUp, iconColor: '#8b5cf6', iconBg: 'bg-violet-50',
      title: '误买根因不在产品在 Listing',
      stat: '2.8×', statDesc: '不兼容投诉倍率',
      detail: '金属套装不兼容投诉是塑料的 2.8 倍——标题描述的适用场景不够精确。优化 Listing 文案即可压降。',
    },
    {
      icon: Clock, iconColor: '#6366f1', iconBg: 'bg-indigo-50',
      title: '退货窗口期的干预机会',
      stat: '前 7 天', statDesc: '集中退货窗口',
      detail: '绝大部分退货在收到后一周内发生——开箱体验和首次使用指导是降低退货率的关键节点。',
    },
    {
      icon: Zap, iconColor: '#8b5cf6', iconBg: 'bg-violet-50',
      title: '弃购主因并非质量',
      stat: '38.9%', statDesc: '"不需要了"退货',
      detail: '头号退货原因不是产品缺陷，而是消费者"收到后发现不需要"——购买前信息匹配出了问题。',
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

            <h1 className="font-display text-[2.8rem] sm:text-[3.2rem] lg:text-[3.8rem] text-[#1d1d1f] tracking-tight leading-[1.06] mb-4">
              把数据变成
              <br />
              <span className="bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-500 bg-clip-text text-transparent">
                品类判断力
              </span>
            </h1>
            <p className="text-[#424245] text-lg lg:text-xl leading-snug mb-3 max-w-md">
              不是另一个数据看板——是把市场规模、搜索意图、竞品差距、用户真话收成能拍板的洞察。
            </p>
            <p className="text-[#86868b] text-[14px] leading-relaxed max-w-md mb-6">
              输入一组 ASIN 或一个关键词，系统从四个维度交叉分析，输出可直接进评审的品类判断。
            </p>

            {/* 数据流线 */}
            <div className="mb-6">
              <HeroDataFlow />
              <p className="text-center text-[11px] text-[#aeaeb2] mt-2">系统持续解析品类供需结构</p>
            </div>

            <a href="#modules" className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-500 transition-colors">
              探索四大研判模块 <ArrowDown className="w-4 h-4" />
            </a>
          </div>
        </div>

        {/* 右侧：登录面板 + 浮动预览卡 */}
        <div id="login-panel" className="relative z-10 flex-1 flex items-center justify-center px-6 py-10 lg:py-16 order-1 lg:order-2">
          <div className="w-full max-w-[400px] relative">
            {/* 浮动预览卡片 (登录面板上方) */}
            <div className="absolute -top-32 left-1/2 -translate-x-1/2 hidden lg:block">
              <HeroPreviewCard />
            </div>

            {/* 登录面板 */}
            <div className="glass-card p-7 shadow-[0_24px_64px_-16px_rgba(79,70,229,0.15)]">
              <div className="flex bg-black/[0.03] rounded-xl p-1 mb-6">
                {(['login', 'register'] as const).map((m) => (
                  <button
                    key={m} type="button" onClick={() => setMode(m)}
                    className={`flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-200 ${
                      mode === m ? 'bg-white text-[#1d1d1f] shadow-sm ring-1 ring-black/[0.06]' : 'text-[#86868b] hover:text-[#1d1d1f]'
                    }`}
                  >
                    {m === 'login' ? '登录' : '注册'}
                  </button>
                ))}
              </div>

              <form onSubmit={submit} className="space-y-3.5">
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-[#424245]">用户名</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#aeaeb2]" />
                    <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                      placeholder="请输入用户名" required
                      className="w-full pl-10 pr-4 py-3 bg-black/[0.02] border border-black/[0.08] rounded-xl text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-300 text-sm transition-all" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-[#424245]">密码</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#aeaeb2]" />
                    <input type={showPassword ? 'text' : 'password'} value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={mode === 'register' ? '至少 6 位' : '请输入密码'} required
                      className="w-full pl-10 pr-12 py-3 bg-black/[0.02] border border-black/[0.08] rounded-xl text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-300 text-sm transition-all" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#aeaeb2] hover:text-[#1d1d1f] transition-colors">
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {mode === 'register' && (
                  <div className="space-y-1.5">
                    <label className="text-[12px] font-medium text-[#424245]">确认密码</label>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#aeaeb2]" />
                      <input type={showPassword ? 'text' : 'password'} value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="再次输入密码" required
                        className="w-full pl-10 pr-4 py-3 bg-black/[0.02] border border-black/[0.08] rounded-xl text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-300 text-sm transition-all" />
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3 pt-1">
                  <button type="button" onClick={() => setRememberMe(!rememberMe)}
                    className={`w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center transition-all ${
                      rememberMe ? 'bg-indigo-500 border-indigo-500' : 'border-black/15 bg-transparent'
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
                  className="w-full py-3.5 mt-2 bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 text-white font-semibold rounded-xl transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed text-[14px] tracking-wide active:scale-[0.99]">
                  {isLoading ? '处理中...' : mode === 'login' ? '进入系统' : '创建账号'}
                </button>
              </form>

              <div className="flex items-center gap-3 mt-6">
                <div className="flex-1 h-px bg-black/[0.06]" />
                <span className="text-xs text-[#aeaeb2]">或者</span>
                <div className="flex-1 h-px bg-black/[0.06]" />
              </div>

              <button type="button" onClick={enterGuest}
                className="w-full mt-4 py-3 border border-black/[0.08] hover:border-indigo-200 bg-transparent hover:bg-indigo-50/50 text-[#86868b] hover:text-indigo-600 font-medium rounded-xl transition-all text-[13px]">
                游客模式进入（含示例品类数据）
              </button>
              <p className="text-center text-[11px] text-[#aeaeb2] mt-4">数据仅存储在本地浏览器，安全且私密</p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ 四大研判模块 ═══════ */}
      <section id="modules" className="bg-[#f8f9fb] border-t border-black/[0.04]">
        <div className="max-w-5xl mx-auto px-6 lg:px-10 py-20 lg:py-24">
          <div className="mb-14 max-w-2xl">
            <p className="text-indigo-600 text-xs font-semibold tracking-[0.16em] uppercase mb-3">研判模块</p>
            <h2 className="font-display text-[2.2rem] lg:text-[2.5rem] text-[#1d1d1f] leading-tight mb-3">
              四个维度交叉，锁定品类真相
            </h2>
            <p className="text-[#86868b] text-sm leading-relaxed">
              每个模块独立可用，串起来就是完整的品类研判闭环——从"能不能做"到"怎么做"。
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-5">
            {modules.map(({ icon: Icon, accent, tagCls, title, q, points }) => (
              <div key={title} className="glass-card p-6 group cursor-default">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${accent}10`, border: `1px solid ${accent}20` }}>
                    <Icon className="w-5 h-5" style={{ color: accent }} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[#1d1d1f] text-[16px]">{title}</h3>
                    <p className="text-[13px] text-[#86868b] mt-0.5 leading-snug">{q}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {points.map((p) => (
                    <div key={p} className="flex items-center gap-2 text-[13px] text-[#424245]">
                      <CheckCircle2 className="w-3.5 h-3.5 text-indigo-500 mt-0.5 shrink-0" />
                      {p}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ 洞察深度 — 真实数据示例 ═══════ */}
      <section className="bg-white border-t border-black/[0.04]">
        <div className="max-w-5xl mx-auto px-6 lg:px-10 py-20 lg:py-24">
          <div className="mb-14 max-w-2xl">
            <p className="text-violet-600 text-xs font-semibold tracking-[0.16em] uppercase mb-3 flex items-center gap-2">
              <Search className="w-3.5 h-3.5" /> 洞察深度
            </p>
            <h2 className="font-display text-[2.2rem] lg:text-[2.5rem] text-[#1d1d1f] leading-tight mb-3">
              数据不只是报表
            </h2>
            <p className="text-[#86868b] text-sm leading-relaxed">
              以下是一次真实品类分析的输出摘录——你会发现，埋在退货记录和搜索行为里的，是完整的品类逻辑。
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {realInsightCards.map(({ icon: Icon, iconColor, iconBg, title, stat, statDesc, detail }) => (
              <div key={title} className="glass-card p-5 card-glow-violet">
                <div className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center mb-4`}>
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
              <div className="text-sm font-semibold text-[#1d1d1f]">AmzDev Tool</div>
              <div className="text-[11px] text-[#aeaeb2]">亚马逊市调与用户洞察</div>
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
