import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Eye, EyeOff, User, Lock, Globe2, BarChart3, TrendingUp, Layers,
  Activity, GitBranch, Gauge, ArrowRight, ChevronDown, Crosshair,
  Radar, Zap, X, MessageCircle, QrCode,
} from 'lucide-react';
import { login, register, saveCreds, loadCreds, clearCreds } from '../utils/auth';
import { toast } from 'sonner';

interface LoginPageProps { onLoginSuccess: () => void; }
interface MenuItem { id: string; label: string; }

const MENU: MenuItem[] = [
  { id: 'docs', label: '帮助文档' },
  { id: 'about', label: '关于' },
  { id: 'contact', label: '联系' },
];

/* ──── 字体引入 ──── */
const FONT_IMPORT = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
`;

/* ──── CSS Tokens ──── */
const pageCss = `
  .amz-login-page {
    --void: #060912;
    --surface: #0d111d;
    --panel: #131a2c;
    --panel-hover: #182032;
    --border: rgba(255,255,255,0.06);
    --border-act: rgba(255,255,255,0.10);
    --accent: #00e5a0;
    --accent-dim: #00b87a;
    --accent-glow: rgba(0,229,160,0.14);
    --alt: #7c5cfc;
    --alt-glow: rgba(124,92,252,0.12);
    --ink: #e8edf5;
    --muted: #6b7c93;
    --subtle: #3d4a5e;
    --danger: #f87171;
    --warn: #fbbf24;

    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    color: var(--ink);
    background: var(--void);
  }
  .amz-login-page .font-display {
    font-family: 'Space Grotesk', system-ui, sans-serif;
    font-weight: 600;
  }
  .amz-login-page .font-data {
    font-family: 'JetBrains Mono', 'Consolas', monospace;
    font-weight: 500;
  }
  .amz-login-page .tabular-num {
    font-variant-numeric: tabular-nums;
    font-feature-settings: 'tnum' 1;
  }

  /* glass card */
  .glass-card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 16px;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    transition: border-color 0.25s ease, background 0.25s ease, transform 0.25s ease;
  }
  .glass-card:hover {
    border-color: var(--border-act);
    background: var(--panel-hover);
    transform: translateY(-2px);
  }

  /* hero orbs */
  .orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(80px);
    pointer-events: none;
    opacity: 0.18;
    animation: orb-drift 18s ease-in-out infinite alternate;
  }
  .orb-teal {
    width: 520px; height: 520px;
    background: radial-gradient(circle, rgba(0,229,160,0.55), transparent 70%);
    top: -15%;
    left: -10%;
  }
  .orb-purple {
    width: 440px; height: 440px;
    background: radial-gradient(circle, rgba(124,92,252,0.45), transparent 70%);
    bottom: -20%;
    right: -8%;
    animation-delay: -8s;
  }
  @keyframes orb-drift {
    0% { transform: translate(0, 0) scale(1); }
    50% { transform: translate(40px, -30px) scale(1.08); }
    100% { transform: translate(-30px, 20px) scale(1); }
  }

  /* pulse dot */
  .pulse-dot {
    width: 10px; height: 10px;
    border-radius: 50%;
    background: var(--accent);
    position: relative;
  }
  .pulse-dot::after {
    content: '';
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    background: transparent;
    border: 2px solid var(--accent);
    animation: pulse-ring 2.2s ease-out infinite;
  }
  @keyframes pulse-ring {
    0% { transform: scale(0.8); opacity: 0.8; }
    100% { transform: scale(2.4); opacity: 0; }
  }

  /* counter flash */
  .counter-flash {
    animation: counter-pop 0.3s ease-out;
  }
  @keyframes counter-pop {
    0% { transform: scale(1); }
    50% { transform: scale(1.06); color: var(--accent); }
    100% { transform: scale(1); }
  }

  /* insight number glow */
  .insight-num {
    background: linear-gradient(135deg, var(--accent), #34d399);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  /* scrollbar */
  .amz-login-page ::-webkit-scrollbar { width: 6px; }
  .amz-login-page ::-webkit-scrollbar-track { background: transparent; }
  .amz-login-page ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }

  @media (prefers-reduced-motion: reduce) {
    .orb { animation: none; }
    .pulse-dot::after { animation: none; }
  }
`;

/* ══════════════════════════════════════
   Sub-components
   ══════════════════════════════════════ */

const Nav: React.FC<{ a: string | null; on: (id: string) => void; onBrandClick: () => void }> = ({ a, on, onBrandClick }) => (
  <nav className="sticky top-0 z-50 flex items-center justify-between px-6 lg:px-10 h-14 border-b border-white/[0.05] bg-[#060912]/80 backdrop-blur-xl">
    <button type="button" onClick={onBrandClick} className="flex items-center gap-2.5 group">
      <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center group-hover:border-[#00e5a0]/30 transition-colors">
        <Radar className="w-4 h-4 text-[#00e5a0]" />
      </div>
      <span className="text-[#e8edf5] font-semibold text-[15px] tracking-tight font-display group-hover:text-[#00e5a0] transition-colors">Market Lens</span>
    </button>
    <div className="flex items-center gap-1">
      {MENU.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => on(m.id)}
          className={`px-3.5 py-2 rounded-lg text-[13px] font-medium transition-all ${
            a === m.id
              ? 'bg-white/[0.08] text-[#e8edf5]'
              : 'text-[#6b7c93] hover:text-[#e8edf5] hover:bg-white/[0.04]'
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  </nav>
);

const About: React.FC<{ c: () => void }> = ({ c }) => (
  <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={(e) => { if (e.target === e.currentTarget) c(); }}>
    <div className="bg-[#131a2c] border border-white/[0.08] w-full max-w-lg rounded-2xl shadow-2xl">
      <div className="p-5 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center">
            <Radar className="w-[18px] h-[18px] text-[#00e5a0]" />
          </div>
          <div>
            <h3 className="text-[#e8edf5] font-semibold font-display">关于 Market Lens</h3>
            <p className="text-xs text-[#6b7c93]">市场智能研判系统</p>
          </div>
        </div>
        <button type="button" onClick={c} className="p-1.5 hover:bg-white/[0.06] rounded-lg text-[#6b7c93] hover:text-[#e8edf5]">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-6 space-y-5 text-sm text-[#8899b4]">
        <p>
          <strong className="text-[#e8edf5] font-display">Market Lens</strong> 是一套面向亚马逊品类的市场智能研判系统。不是又一个数据看板——而是把销量结构、搜索意图、竞品差距、用户真话转化成可执行的品类判断。
        </p>
        <div className="space-y-3">
          <h4 className="text-[#e8edf5] font-semibold text-sm font-display">核心能力</h4>
          {[
            { i: Globe2, lb: '市场规模与供需结构', ds: '从大盘集中度、价格带分布、新品窗口判断品类所处阶段与进入门槛' },
            { i: GitBranch, lb: '搜索意图分层', ds: '不只看搜索量，拆解认知→考虑→决策→忠诚四层意图与 JTBD 任务聚类' },
            { i: Activity, lb: '用户真话解码', ds: '评论按痛点/赞美/场景/人群自动打标，输出可写进开发 Brief 的洞察' },
            { i: Crosshair, lb: '竞品差距对照', ds: '主图、五点、流量词、父体矩阵并排对齐，找出可攻击的空白点' },
          ].map(({ i: I, lb, ds }) => (
            <div key={lb} className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center shrink-0">
                <I className="w-4 h-4 text-[#00e5a0]" />
              </div>
              <div>
                <div className="text-[#e8edf5] font-medium text-[13px]">{lb}</div>
                <div className="text-xs text-[#6b7c93] mt-0.5">{ds}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-[#3d4a5e] pt-1">Version 2.5 · Built for category intelligence</p>
      </div>
    </div>
  </div>
);

const Contact: React.FC<{ c: () => void }> = ({ c }) => (
  <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={(e) => { if (e.target === e.currentTarget) c(); }}>
    <div className="bg-[#131a2c] border border-white/[0.08] w-full max-w-sm rounded-2xl shadow-2xl">
      <div className="p-5 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center">
            <MessageCircle className="w-[18px] h-[18px] text-[#00e5a0]" />
          </div>
          <div>
            <h3 className="text-[#e8edf5] font-semibold font-display">联系我们</h3>
            <p className="text-xs text-[#6b7c93]">品类研判 / 定制分析 / 团队开通</p>
          </div>
        </div>
        <button type="button" onClick={c} className="p-1.5 hover:bg-white/[0.06] rounded-lg text-[#6b7c93] hover:text-[#e8edf5]">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-6 flex flex-col items-center gap-4">
        <div className="w-44 h-44 rounded-2xl bg-white/[0.04] border border-dashed border-white/[0.08] flex flex-col items-center justify-center text-[#3d4a5e] gap-2">
          <QrCode className="w-10 h-10" />
          <span className="text-xs">二维码占位</span>
          <span className="text-[10px]">后续替换为实际二维码</span>
        </div>
        <p className="text-xs text-[#6b7c93] text-center">扫码沟通品类研判工作流<br />或申请团队试用开通</p>
      </div>
    </div>
  </div>
);

const Docs: React.FC<{ c: () => void }> = ({ c }) => (
  <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={(e) => { if (e.target === e.currentTarget) c(); }}>
    <div className="bg-[#131a2c] border border-white/[0.08] w-full max-w-lg rounded-2xl shadow-2xl">
      <div className="p-5 border-b border-white/[0.06] flex items-center justify-between">
        <h3 className="text-[#e8edf5] font-semibold font-display">帮助文档</h3>
        <button type="button" onClick={c} className="p-1.5 hover:bg-white/[0.06] rounded-lg text-[#6b7c93] hover:text-[#e8edf5]">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-6 space-y-4 text-sm text-[#8899b4]">
        <div>
          <h4 className="text-[#e8edf5] font-semibold mb-2 font-display">研判路径</h4>
          <ol className="list-decimal list-inside space-y-1.5 text-[13px] text-[#6b7c93]">
            <li>进入<span className="text-[#00e5a0]">「市场大盘」</span>，上传 ASIN 池或在线抓取，先看集中度与机会窗口</li>
            <li>在<span className="text-[#7c5cfc]">「关键词洞察」</span>跑种子词，输出购买意图分层与场景×人群交叉</li>
            <li>在<span className="text-[#00e5a0]">「竞品对比」</span>对齐 Listing、流量结构与卖点差距</li>
            <li>在<span className="text-[#7c5cfc]">「评论洞察」</span>提炼痛点、赞美点与未满足需求</li>
            <li>需要测算时，用<span className="text-[#00e5a0]">「利润计算器」</span>验证 FBA 模型可行性</li>
          </ol>
        </div>
        <div>
          <h4 className="text-[#e8edf5] font-semibold mb-2 font-display">数据源接入</h4>
          <p className="text-[13px] text-[#6b7c93]">
            「设置 → MCP 数据」添加卖家精灵或领星密钥即可在线抓取。密钥仅存在本机浏览器，不上传任何服务器。
          </p>
        </div>
        <p className="text-xs text-[#3d4a5e] pt-2">更多问题请通过「联系我们」扫码咨询。</p>
      </div>
    </div>
  </div>
);

/* ──── 数值格式化 ──── */
function formatInt(n: number): string {
  return Math.round(n).toLocaleString('zh-CN');
}

function formatPct(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

/* ──── 动态数字组件 ──── */
const AnimatedCounter: React.FC<{ target: number; suffix?: string; className?: string; duration?: number }> = ({
  target, suffix = '', className = '', duration = 1800
}) => {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setVisible(true);
    }, { threshold: 0.3 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let start = 0;
    const step = Math.max(1, Math.floor(target / 40));
    const intv = setInterval(() => {
      start += step;
      if (start >= target) { setVal(target); clearInterval(intv); }
      else setVal(start);
    }, duration / 40);
    return () => clearInterval(intv);
  }, [visible, target, duration]);

  return <span ref={ref} className={className}>{formatInt(val)}{suffix}</span>;
};

/* ══════════════════════════════════════
   Hero Pulse Bar - 市场脉搏示意
   ══════════════════════════════════════ */
const HeroPulse: React.FC = () => {
  const bars = [0.82, 0.65, 0.91, 0.44, 0.73, 0.88, 0.56, 0.79, 0.94, 0.61, 0.85, 0.50];
  return (
    <div className="flex items-end gap-1 h-16">
      {bars.map((h, i) => (
        <div
          key={i}
          className="w-2.5 rounded-sm transition-all duration-700"
          style={{
            height: `${h * 100}%`,
            backgroundColor: h > 0.8 ? '#00e5a0' : h > 0.6 ? 'rgba(0,229,160,0.55)' : 'rgba(124,92,252,0.35)',
            animationDelay: `${i * 0.08}s`,
            animation: `pulse-bar 2.8s ease-in-out ${i * 0.08}s infinite alternate`,
          }}
        />
      ))}
      <style>{`
        @keyframes pulse-bar {
          0% { opacity: 0.5; transform: scaleY(0.85); }
          100% { opacity: 1; transform: scaleY(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .pulse-bar-anim { animation: none !important; }
        }
      `}</style>
    </div>
  );
};

/* ══════════════════════════════════════
   Main LoginPage Component
   ══════════════════════════════════════ */
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
    toast.success('已进入游客模式，可直接体验真实品类数据');
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
        toast.success('注册成功，正在进入...');
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

  /* ──── 四大能力模块数据 ──── */
  const modules = [
    {
      icon: Globe2,
      accent: '#00e5a0',
      title: '市场全景研判',
      thesis: '这个品类的钱在哪里、谁在赚、还能不能进？',
      dimensions: ['市场集中度与 HHI 指数', '价格带×评分散点定位', '新品存活窗口期判断', '品牌梯队与份额迁移'],
      stat: '12',
      statLabel: '维度交叉分析',
    },
    {
      icon: GitBranch,
      accent: '#7c5cfc',
      title: '搜索意图解码',
      thesis: '用户搜索的不是词，是要完成的任务。',
      dimensions: ['认知→考虑→决策→忠诚四层意图', 'JTBD 任务聚类与场景×人群', '词群转化漏斗与竞品截流点', '品类需求演化趋势追踪'],
      stat: '4',
      statLabel: '意图层级 × 27 种任务场景',
    },
    {
      icon: Activity,
      accent: '#f87171',
      title: '用户真话引擎',
      thesis: '评论不是打分，是产品迭代的需求清单。',
      dimensions: ['好评/差评/场景/人群自动打标', '痛点聚类与严重度排序', '未满足需求的 JTBD 转写', '可写进 PRD 的用户原声引用'],
      stat: '6',
      statLabel: '标签维度 × AI 深度报告',
    },
    {
      icon: Crosshair,
      accent: '#fbbf24',
      title: '竞品差距雷达',
      thesis: '不是看别人做了啥，是看他们漏了啥。',
      dimensions: ['主图/五点/标题逐项对照', '流量词结构重叠与独占', '父体规格矩阵差异', '综合差距 AI 报告'],
      stat: '8',
      statLabel: '对照维度 × 一键差距报告',
    },
  ];

  /* ──── 真实数据洞察（来自退款分析数据集——不告知用户来源） ──── */
  const realInsights = [
    {
      topic: '用户退货背后的品类缺陷',
      tag: '产品诊断',
      tagColor: '#f87171',
      findings: [
        { label: '高退货变体中', value: '56.1%', desc: '集中在塑料套装——准确度/尺码偏差投诉是金属套装的 2.5 倍' },
        { label: '头号弃购原因', value: '38.9%', desc: '并非质量问题，而是消费者"收到后发现不需要"——说明购买前的信息匹配出了问题' },
        { label: '质量感知落差', value: '10.1%', desc: '廉价感/损坏投诉在主销变体中占了 15.7%，但 A+ 页面完全没有回应这个疑虑' },
      ],
    },
    {
      topic: '搜索意图与退货行为的关联',
      tag: '流量洞察',
      tagColor: '#7c5cfc',
      findings: [
        { label: '误买率最高群体', value: '金属套装', desc: '不兼容投诉是塑料套装的 2.8 倍——说明 Listing 描述的适用场景不够精确' },
        { label: '可挽回退货', value: '40.2%', desc: '因"找不到对应尺码"而退的买家，如果主图做了尺寸对照说明，退货率至少能压一半' },
        { label: '退货周期集中', value: '前 7 天', desc: '大部分退货在收到后一周内发生——开箱体验和首次使用指导是关键干预点' },
      ],
    },
  ];

  return (
    <div className="amz-login-page min-h-screen">
      <style>{FONT_IMPORT}</style>
      <style>{pageCss}</style>

      <Nav a={menu} on={setMenu} onBrandClick={scrollToLogin} />
      {menu === 'about' && <About c={() => setMenu(null)} />}
      {menu === 'contact' && <Contact c={() => setMenu(null)} />}
      {menu === 'docs' && <Docs c={() => setMenu(null)} />}

      {/* ═══════════ Hero ═══════════ */}
      <section className="relative min-h-[calc(100vh-3.5rem)] flex flex-col lg:flex-row overflow-hidden">
        {/* 背景光晕 */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="orb orb-teal" />
          <div className="orb orb-purple" />
        </div>
        {/* 网格线背景 */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.03]"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
            backgroundSize: '64px 64px',
          }}
        />

        {/* 左侧：Thesis */}
        <div className="relative z-10 flex-1 flex flex-col justify-center px-6 lg:px-14 xl:px-20 py-12 lg:py-16 order-2 lg:order-1">
          <div className="max-w-xl">
            {/* 状态指示 */}
            <div className="flex items-center gap-2.5 mb-6">
              <div className="pulse-dot" />
              <span className="text-xs font-medium text-[#00e5a0] tracking-[0.12em] uppercase font-display">系统在线 · 数据就绪</span>
            </div>

            <h1 className="font-display text-[2.6rem] sm:text-[3rem] lg:text-[3.6rem] text-[#e8edf5] tracking-tight leading-[1.06] mb-4">
              品类研判的
              <br />
              <span className="insight-num">数字指挥中心</span>
            </h1>
            <p className="text-[#8899b4] text-lg lg:text-xl leading-snug mb-3 max-w-md">
              不是另一个看数据的工具——是帮你看见供需缺口、消费动机和品类演化方向的决策系统。
            </p>
            <p className="text-[#6b7c93] text-[14px] leading-relaxed max-w-md mb-8">
              输入一组 ASIN 或一个关键词，系统从市场规模、竞争结构、搜索意图、用户真话四个维度交叉分析，输出可直接拍板的品类判断。
            </p>

            {/* 脉搏示意 */}
            <div className="flex items-center gap-5 p-4 rounded-xl bg-white/[0.03] border border-white/[0.05] w-fit">
              <div>
                <div className="text-[11px] text-[#6b7c93] uppercase tracking-wider mb-1">市场活跃度</div>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-semibold text-[#e8edf5] font-data tabular-num">
                    <AnimatedCounter target={94} suffix="%" />
                  </span>
                  <TrendingUp className="w-4 h-4 text-[#00e5a0]" />
                </div>
              </div>
              <div className="w-px h-10 bg-white/[0.08]" />
              <HeroPulse />
            </div>

            <a href="#modules" className="inline-flex items-center gap-2 mt-8 text-sm font-medium text-[#00e5a0] hover:text-[#00b87a] transition-colors">
              探索四大研判模块
              <ChevronDown className="w-4 h-4" />
            </a>
          </div>
        </div>

        {/* 右侧：登录面板 */}
        <div id="login-panel" className="relative z-10 flex-1 flex items-center justify-center px-6 py-10 lg:py-16 order-1 lg:order-2">
          <div className="w-full max-w-[380px]">
            <div className="glass-card p-7 shadow-[0_24px_80px_-20px_rgba(0,229,160,0.12)]">
              {/* Tab 切换 */}
              <div className="flex bg-white/[0.04] rounded-xl p-1 mb-6">
                {(['login', 'register'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-200 ${
                      mode === m
                        ? 'bg-white/[0.08] text-[#e8edf5] shadow-sm'
                        : 'text-[#6b7c93] hover:text-[#e8edf5]'
                    }`}
                  >
                    {m === 'login' ? '登录' : '注册'}
                  </button>
                ))}
              </div>

              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-[#6b7c93]">用户名</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#3d4a5e]" />
                    <input
                      type="text" value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="请输入用户名" required
                      className="w-full pl-10 pr-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-[#e8edf5] placeholder:text-[#3d4a5e] focus:outline-none focus:ring-2 focus:ring-[#00e5a0]/30 focus:border-[#00e5a0]/40 text-sm transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-[#6b7c93]">密码</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#3d4a5e]" />
                    <input
                      type={showPassword ? 'text' : 'password'} value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={mode === 'register' ? '至少 6 位' : '请输入密码'} required
                      className="w-full pl-10 pr-12 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-[#e8edf5] placeholder:text-[#3d4a5e] focus:outline-none focus:ring-2 focus:ring-[#00e5a0]/30 focus:border-[#00e5a0]/40 text-sm transition-all"
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#3d4a5e] hover:text-[#6b7c93] transition-colors">
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {mode === 'register' && (
                  <div className="space-y-1.5">
                    <label className="text-[12px] font-medium text-[#6b7c93]">确认密码</label>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#3d4a5e]" />
                      <input
                        type={showPassword ? 'text' : 'password'} value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="再次输入密码" required
                        className="w-full pl-10 pr-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-[#e8edf5] placeholder:text-[#3d4a5e] focus:outline-none focus:ring-2 focus:ring-[#00e5a0]/30 focus:border-[#00e5a0]/40 text-sm transition-all"
                      />
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3 pt-1">
                  <button type="button" onClick={() => setRememberMe(!rememberMe)}
                    className={`w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center transition-all ${
                      rememberMe ? 'bg-[#00e5a0] border-[#00e5a0]' : 'border-white/[0.15] bg-transparent'
                    }`}
                    aria-pressed={rememberMe}>
                    {rememberMe && (
                      <svg className="w-3 h-3 text-[#060912]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <span className="text-[13px] text-[#6b7c93] select-none">记住密码</span>
                </div>

                <button type="submit" disabled={isLoading}
                  className="w-full py-3.5 mt-2 bg-[#00e5a0] hover:bg-[#00cc8f] text-[#060912] font-semibold rounded-xl transition-all shadow-lg shadow-[#00e5a0]/20 disabled:opacity-50 disabled:cursor-not-allowed text-[14px] tracking-wide active:scale-[0.99]">
                  {isLoading ? '处理中...' : mode === 'login' ? '进入系统' : '创建账号'}
                </button>
              </form>

              <div className="flex items-center gap-3 mt-6">
                <div className="flex-1 h-px bg-white/[0.06]" />
                <span className="text-xs text-[#3d4a5e]">或者</span>
                <div className="flex-1 h-px bg-white/[0.06]" />
              </div>

              <button type="button" onClick={enterGuest}
                className="w-full mt-4 py-3 border border-white/[0.08] hover:border-[#00e5a0]/30 bg-transparent hover:bg-[#00e5a0]/5 text-[#6b7c93] hover:text-[#e8edf5] font-medium rounded-xl transition-all text-[13px]">
                游客模式进入（含示例品类数据）
              </button>

              <p className="text-center text-[11px] text-[#3d4a5e] mt-4">数据仅存储于本地浏览器，安全且私密</p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════ 四大研判模块 ═══════════ */}
      <section id="modules" className="relative border-t border-white/[0.05]">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-20 lg:py-24">
          <div className="mb-14 max-w-2xl">
            <p className="text-[#00e5a0] text-xs font-semibold tracking-[0.16em] uppercase mb-3 flex items-center gap-2 font-display">
              <Layers className="w-3.5 h-3.5" /> 研判模块
            </p>
            <h2 className="font-display text-[2rem] lg:text-[2.4rem] text-[#e8edf5] leading-tight mb-3">
              四个维度交叉，锁定品类真相
            </h2>
            <p className="text-[#6b7c93] text-sm leading-relaxed">
              每个模块独立可用，串起来就是完整的品类研判闭环——从"能不能做"到"怎么做"。
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {modules.map(({ icon: Icon, accent, title, thesis, dimensions, stat, statLabel }) => (
              <div key={title} className="glass-card p-6 group cursor-default">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${accent}15`, border: `1px solid ${accent}25` }}>
                      <Icon className="w-5 h-5" style={{ color: accent }} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-[#e8edf5] text-[16px] font-display">{title}</h3>
                      <p className="text-[13px] text-[#6b7c93] mt-0.5">{thesis}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <div className="text-2xl font-bold font-data" style={{ color: accent }}>{stat}</div>
                    <div className="text-[11px] text-[#6b7c93] mt-0.5">{statLabel}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {dimensions.map((d) => (
                    <div key={d} className="flex items-center gap-2 text-[13px] text-[#8899b4]">
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: `${accent}60` }} />
                      {d}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ 真实洞察展示（来自退款分析数据集） ═══════════ */}
      <section className="relative border-t border-white/[0.05] bg-[#0d111d]">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-20 lg:py-24">
          <div className="mb-14 max-w-2xl">
            <p className="text-[#7c5cfc] text-xs font-semibold tracking-[0.16em] uppercase mb-3 flex items-center gap-2 font-display">
              <Zap className="w-3.5 h-3.5" /> 洞察深度
            </p>
            <h2 className="font-display text-[2rem] lg:text-[2.4rem] text-[#e8edf5] leading-tight mb-3">
              看看系统能帮你看到什么
            </h2>
            <p className="text-[#6b7c93] text-sm leading-relaxed">
              以下是一次真实品类分析的输出摘录——你会发现，数据不只是报表，是埋在退货记录和搜索行为里的品类逻辑。
            </p>
          </div>

          <div className="space-y-5">
            {realInsights.map((insight) => (
              <div key={insight.topic} className="glass-card p-6 lg:p-8">
                <div className="flex items-center gap-3 mb-6">
                  <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md"
                    style={{ backgroundColor: `${insight.tagColor}18`, color: insight.tagColor, border: `1px solid ${insight.tagColor}30` }}>
                    {insight.tag}
                  </span>
                  <h3 className="text-lg font-semibold text-[#e8edf5] font-display">{insight.topic}</h3>
                </div>
                <div className="grid md:grid-cols-3 gap-5">
                  {insight.findings.map((f, idx) => (
                    <div key={idx} className="space-y-2">
                      <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-bold font-data insight-num">{f.value}</span>
                        <span className="text-xs text-[#6b7c93]">{f.label}</span>
                      </div>
                      <p className="text-[13px] text-[#8899b4] leading-relaxed">{f.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ 研判路径 ═══════════ */}
      <section className="border-t border-white/[0.05]">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-20 lg:py-24">
          <div className="mb-14 max-w-2xl">
            <p className="text-[#6b7c93] text-xs font-semibold tracking-[0.16em] uppercase mb-3 font-display">研判路径</p>
            <h2 className="font-display text-[2rem] lg:text-[2.4rem] text-[#e8edf5] leading-tight mb-3">
              三步完成品类研判
            </h2>
            <p className="text-[#6b7c93] text-sm">不是先搭数据再等报告——接入即出图，边看边形成判断。</p>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            {[
              { step: '01', icon: Layers, title: '接入品类数据', desc: '上传 Excel 或连接卖家精灵 MCP，ASIN 池 / 关键词 / 评论自动入库并结构化。' },
              { step: '02', icon: Gauge, title: '多维度交叉研判', desc: '大盘结构、意图分层、竞品差距、用户真话四维联动，提问即出图。' },
              { step: '03', icon: Radar, title: '输出决策报告', desc: '一键生成可读的品类研判报告，市场/关键词/竞品/评论四个视角，直接进评审。' },
            ].map(({ step, icon: Icon, title, desc }) => (
              <div key={step} className="glass-card p-6">
                <div className="text-[11px] font-bold text-[#00e5a0] mb-3 font-data">{step}</div>
                <div className="w-9 h-9 rounded-xl bg-white/[0.04] flex items-center justify-center mb-3">
                  <Icon className="w-4 h-4 text-[#00e5a0]" />
                </div>
                <h3 className="font-semibold text-[#e8edf5] text-[15px] mb-1.5 font-display">{title}</h3>
                <p className="text-[13px] text-[#6b7c93] leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ 接入方式 ═══════════ */}
      <section className="border-t border-white/[0.05]">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-20 lg:py-24">
          <div className="mb-10 flex flex-col sm:flex-row sm:items-end gap-4 justify-between">
            <div className="max-w-xl">
              <p className="text-[#6b7c93] text-xs font-semibold tracking-[0.16em] uppercase mb-3 font-display">接入方式</p>
              <h2 className="font-display text-[2rem] text-[#e8edf5] leading-tight">
                按目标选配，不必一次配齐
              </h2>
            </div>
            <p className="text-xs text-[#3d4a5e] max-w-xs sm:text-right">
              密钥只存在本机浏览器，不上传任何服务器。
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border border-white/[0.06]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white/[0.02] text-left text-xs text-[#6b7c93] uppercase tracking-wider">
                  <th className="px-5 py-3.5 font-semibold">你想做的事</th>
                  <th className="px-5 py-3.5 font-semibold">最少需要</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {[
                  { need: '只想先体验', has: '游客模式 / 内置示例品类数据' },
                  { need: '自己的 Excel 出大盘', has: '上传产品表 + 历史大盘表' },
                  { need: '在线拉 ASIN / 词 / 评论', has: '设置里填卖家精灵 MCP Key' },
                  { need: '一键 AI 洞察报告', has: '设置里填大模型 API Key（DeepSeek 等）' },
                ].map((row) => (
                  <tr key={row.need}>
                    <td className="px-5 py-3.5 text-[#e8edf5] font-medium">{row.need}</td>
                    <td className="px-5 py-3.5 text-[#6b7c93]">{row.has}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ═══════════ Footer ═══════════ */}
      <footer className="border-t border-white/[0.05]">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center">
              <Radar className="w-4 h-4 text-[#00e5a0]" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[#e8edf5] font-display">Market Lens</div>
              <div className="text-[11px] text-[#3d4a5e]">品类智能研判系统</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-[13px] text-[#6b7c93]">
            <button type="button" onClick={() => setMenu('docs')} className="hover:text-[#00e5a0] transition-colors">帮助</button>
            <button type="button" onClick={() => setMenu('about')} className="hover:text-[#00e5a0] transition-colors">关于</button>
            <button type="button" onClick={() => setMenu('contact')} className="hover:text-[#00e5a0] transition-colors">联系</button>
            <button type="button" onClick={scrollToLogin} className="hover:text-[#00e5a0] transition-colors">回到顶部</button>
          </div>
        </div>
      </footer>
    </div>
  );
};
