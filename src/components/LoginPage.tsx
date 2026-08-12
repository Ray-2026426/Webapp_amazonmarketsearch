import React, { useState, useEffect, useMemo } from 'react';
import {
  Eye, EyeOff, User, Lock, BarChart3, Search, X, MessageCircle, QrCode,
  MessageSquareWarning, KeyRound, FolderOpen, Compass, Tags, GitCompare, MessagesSquare,
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

const FONT_IMPORT = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&display=swap');
`;

const pageCss = `
  .amz-login-page {
    --void: #070b16;
    --panel: #0f1424;
    --ink: #f8fafc;
    --muted: #94a3b8;
    --accent: #f59e0b;
    --positive: #2dd4bf;
    font-family: 'DM Sans', system-ui, sans-serif;
    color: var(--ink);
    background: var(--void);
  }
  .amz-login-page .font-display {
    font-family: 'Fraunces', Georgia, serif;
  }
  .amz-login-page .tabular-num {
    font-variant-numeric: tabular-nums;
    font-feature-settings: 'tnum' 1;
    transition: opacity 0.25s ease, transform 0.25s ease;
  }
  .amz-login-page .tabular-num.flash {
    opacity: 0.72;
    transform: translateY(-2px);
  }
  .amz-login-page input[type='range'] {
    -webkit-appearance: none;
    appearance: none;
    height: 6px;
    border-radius: 999px;
    background: rgba(255,255,255,0.08);
    outline: none;
  }
  .amz-login-page input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--accent);
    border: 2px solid #fff7ed;
    cursor: pointer;
    box-shadow: 0 0 0 4px rgba(245,158,11,0.18);
  }
  .amz-login-page input[type='range']::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--accent);
    border: 2px solid #fff7ed;
    cursor: pointer;
  }
  @media (prefers-reduced-motion: reduce) {
    .amz-login-page .tabular-num,
    .amz-login-page .tabular-num.flash {
      transition: none;
      transform: none;
      opacity: 1;
    }
  }
`;

const Nav: React.FC<{ a: string | null; on: (id: string) => void; onBrandClick: () => void }> = ({ a, on, onBrandClick }) => (
  <nav className="sticky top-0 z-50 flex items-center justify-between px-6 lg:px-10 h-14 border-b border-white/[0.06] bg-[#070b16]/80 backdrop-blur-xl">
    <button type="button" onClick={onBrandClick} className="flex items-center gap-2.5 group">
      <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
        <BarChart3 className="w-4 h-4 text-amber-400" />
      </div>
      <span className="font-display text-white font-semibold text-[15px] tracking-tight group-hover:text-amber-200 transition-colors">AmzDev Tool</span>
    </button>
    <div className="flex items-center gap-1">
      {MENU.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => on(m.id)}
          className={`px-3.5 py-2 rounded-lg text-[13px] font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400/60 ${
            a === m.id ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  </nav>
);

const About: React.FC<{ c: () => void }> = ({ c }) => (
  <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#070b16]/80 backdrop-blur-sm p-4" onClick={(e) => { if (e.target === e.currentTarget) c(); }}>
    <div className="bg-[#0f1424] border border-white/[0.08] w-full max-w-lg rounded-2xl shadow-2xl">
      <div className="p-5 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <BarChart3 className="w-[18px] h-[18px] text-amber-400" />
          </div>
          <div>
            <h3 className="text-white font-semibold font-display">关于 AmzDev Tool</h3>
            <p className="text-xs text-slate-400">亚马逊市调与用户洞察工作台</p>
          </div>
        </div>
        <button type="button" onClick={c} className="p-1.5 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400/60">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-6 space-y-5 text-sm text-slate-300">
        <p>
          <strong className="text-white">AmzDev Tool</strong> 面向亚马逊运营与产品经理：把关键词、评论、竞品 Listing 收成同一套工作流，用 JTBD（用户真实要完成的任务）视角读懂「谁要买、为什么买、还差什么」。
        </p>
        <div className="space-y-3">
          <h4 className="text-white font-semibold text-sm">我们帮你回答</h4>
          {[
            { i: Search, lb: '市场在涨还是在卷', ds: '大盘趋势、集中度与机会窗口，一眼对齐选品方向' },
            { i: Tags, lb: '词背后的购买任务', ds: '不止搜索量 / CPC，拆出意图分层与场景×人群' },
            { i: MessagesSquare, lb: '评论里的可执行洞察', ds: '痛点、赞美点、未满足需求，直接喂给 Listing / 开发' },
            { i: GitCompare, lb: '竞品差距可对照', ds: '主图、卖点、流量结构并排，少翻十几个页面' },
          ].map(({ i: I, lb, ds }) => (
            <div key={lb} className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
                <I className="w-4 h-4 text-teal-400" />
              </div>
              <div>
                <div className="text-white font-medium text-[13px]">{lb}</div>
                <div className="text-xs text-slate-400 mt-0.5">{ds}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 pt-1">Version 2.0 · Built for Amazon ops & PMs</p>
      </div>
    </div>
  </div>
);

const Contact: React.FC<{ c: () => void }> = ({ c }) => (
  <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#070b16]/80 backdrop-blur-sm p-4" onClick={(e) => { if (e.target === e.currentTarget) c(); }}>
    <div className="bg-[#0f1424] border border-white/[0.08] w-full max-w-sm rounded-2xl shadow-2xl">
      <div className="p-5 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <MessageCircle className="w-[18px] h-[18px] text-amber-400" />
          </div>
          <div>
            <h3 className="text-white font-semibold font-display">联系我们</h3>
            <p className="text-xs text-slate-400">市调流程 / JTBD 洞察 / 试用支持</p>
          </div>
        </div>
        <button type="button" onClick={c} className="p-1.5 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400/60">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-6 flex flex-col items-center gap-4">
        <div className="w-44 h-44 rounded-2xl bg-white/[0.03] border border-white/[0.08] border-dashed flex flex-col items-center justify-center text-slate-500 gap-2">
          <QrCode className="w-10 h-10" />
          <span className="text-xs">二维码占位</span>
          <span className="text-[10px] text-slate-600">后续替换为实际二维码</span>
        </div>
        <p className="text-xs text-slate-400 text-center">
          扫码沟通市调工作流、用户洞察方法<br />或申请团队试用开通
        </p>
      </div>
    </div>
  </div>
);

const Docs: React.FC<{ c: () => void }> = ({ c }) => (
  <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#070b16]/80 backdrop-blur-sm p-4" onClick={(e) => { if (e.target === e.currentTarget) c(); }}>
    <div className="bg-[#0f1424] border border-white/[0.08] w-full max-w-lg rounded-2xl shadow-2xl">
      <div className="p-5 border-b border-white/[0.06] flex items-center justify-between">
        <h3 className="text-white font-semibold font-display">帮助文档</h3>
        <button type="button" onClick={c} className="p-1.5 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400/60">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-6 space-y-4 text-sm text-slate-300">
        <div>
          <h4 className="text-white font-semibold mb-2">从市调到用户洞察</h4>
          <ol className="list-decimal list-inside space-y-1.5 text-[13px] text-slate-400">
            <li>登录后进「市场大盘」，导入 ASIN / 关键词，先看机会与集中度</li>
            <li>在「关键词分析」跑种子词，输出购买意图与 JTBD 任务分层</li>
            <li>在「竞品对比」对齐 Listing、流量结构与卖点差距</li>
            <li>在「评论洞察」提炼痛点、赞美点与未满足需求</li>
            <li>需要测算时，用「利润计算器」验证 FBA 模型是否扛得住</li>
          </ol>
        </div>
        <div>
          <h4 className="text-white font-semibold mb-2">MCP 数据源</h4>
          <p className="text-[13px] text-slate-400">
            「设置 → MCP 数据」添加卖家精灵或领星密钥后即可在线抓取。密钥只存在本机浏览器，不会上传服务器。
          </p>
        </div>
        <p className="text-xs text-slate-500 pt-2">更多问题请通过「联系我们」扫码咨询。</p>
      </div>
    </div>
  </div>
);

function formatInt(n: number): string {
  return Math.round(n).toLocaleString('zh-CN');
}

function formatMoney(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)} 万`;
  return formatInt(n);
}

const SavingsCalculator: React.FC = () => {
  const [asins, setAsins] = useState(8);
  const [hours, setHours] = useState(6);
  const [cost, setCost] = useState(12000);
  const [flash, setFlash] = useState(false);

  const result = useMemo(() => {
    const yearHours = asins * hours * 12 * 0.55;
    const headcount = yearHours / 160;
    const yearCost = headcount * cost;
    return { yearHours, headcount, yearCost };
  }, [asins, hours, cost]);

  useEffect(() => {
    setFlash(true);
    const t = window.setTimeout(() => setFlash(false), 220);
    return () => window.clearTimeout(t);
  }, [asins, hours, cost]);

  return (
    <section id="calculator" className="relative border-y border-white/[0.06] bg-[#0a0f1c]">
      <div
        className="absolute inset-0 pointer-events-none opacity-40"
        style={{
          background:
            'radial-gradient(ellipse 70% 50% at 20% 0%, rgba(245,158,11,0.12), transparent 55%), radial-gradient(ellipse 50% 40% at 90% 80%, rgba(45,212,191,0.08), transparent 50%)',
        }}
      />
      <div className="relative max-w-5xl mx-auto px-6 lg:px-10 py-16 lg:py-20">
        <div className="max-w-2xl mb-10">
          <p className="text-amber-400/90 text-xs font-semibold tracking-[0.14em] uppercase mb-3">市调省时计算器</p>
          <h2 className="font-display text-3xl lg:text-[2.35rem] font-semibold text-white leading-tight mb-3">
            拖一下，看看一年能省多少调研时间
          </h2>
          <p className="text-slate-400 text-[15px] leading-relaxed">
            按「工具大约节省 55% 手工翻查与整理时间」粗算。公式透明，方便你跟团队对齐投入产出。
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-start">
          <div className="space-y-8">
            <label className="block space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-slate-300">每月研究品类 / ASIN 数</span>
                <span className={`tabular-num text-amber-400 font-semibold text-lg ${flash ? 'flash' : ''}`}>{asins}</span>
              </div>
              <input
                type="range"
                min={1}
                max={40}
                value={asins}
                onChange={(e) => setAsins(Number(e.target.value))}
                aria-label="每月研究品类或 ASIN 数"
              />
              <div className="flex justify-between text-[11px] text-slate-600">
                <span>1</span>
                <span>40</span>
              </div>
            </label>

            <label className="block space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-slate-300">一次完整市调（小时）</span>
                <span className={`tabular-num text-amber-400 font-semibold text-lg ${flash ? 'flash' : ''}`}>{hours}</span>
              </div>
              <input
                type="range"
                min={1}
                max={24}
                step={0.5}
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
                aria-label="一次完整市调小时数"
              />
              <div className="flex justify-between text-[11px] text-slate-600">
                <span>1h</span>
                <span>24h</span>
              </div>
            </label>

            <label className="block space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-slate-300">人月成本（人民币）</span>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 text-sm">¥</span>
                  <input
                    type="number"
                    min={3000}
                    max={50000}
                    step={500}
                    value={cost}
                    onChange={(e) => setCost(Math.max(0, Number(e.target.value) || 0))}
                    className="w-28 bg-white/[0.04] border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-right text-amber-400 font-semibold tabular-num text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                    aria-label="人月成本人民币"
                  />
                </div>
              </div>
              <input
                type="range"
                min={5000}
                max={30000}
                step={500}
                value={Math.min(30000, Math.max(5000, cost))}
                onChange={(e) => setCost(Number(e.target.value))}
                aria-label="人月成本滑块"
              />
            </label>

            <p className="text-[12px] text-slate-500 leading-relaxed border-t border-white/[0.06] pt-4">
              年省小时 = 月研究数 × 单次小时 × 12 × 0.55；人月 = 年省小时 ÷ 160；年省成本 = 人月 × 月成本。仅为粗略估算，不构成承诺。
            </p>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-[#0f1424]/80 p-6 lg:p-8 space-y-6">
            <div>
              <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">预估年省小时</div>
              <div className={`font-display tabular-num text-5xl lg:text-6xl font-semibold text-white leading-none ${flash ? 'flash' : ''}`}>
                {formatInt(result.yearHours)}
                <span className="text-2xl text-slate-500 font-normal ml-2">h</span>
              </div>
            </div>
            <div className="h-px bg-white/[0.06]" />
            <div className="grid grid-cols-2 gap-6">
              <div>
                <div className="text-xs text-slate-500 mb-1">约等于省人力</div>
                <div className={`font-display tabular-num text-3xl font-semibold text-teal-400 ${flash ? 'flash' : ''}`}>
                  {result.headcount.toFixed(1)}
                  <span className="text-base text-slate-500 font-normal ml-1">人·年</span>
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">粗略年省成本</div>
                <div className={`font-display tabular-num text-3xl font-semibold text-amber-400 ${flash ? 'flash' : ''}`}>
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

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);

  useEffect(() => {
    const creds = loadCreds();
    if (creds) {
      setUsername(creds.username);
      setPassword(creds.password);
      setRememberMe(true);
    }
  }, []);

  const scrollToLogin = () => {
    document.getElementById('login-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const enterGuest = () => {
    sessionStorage.setItem('guest_mode', '1');
    onLoginSuccess();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      if (mode === 'register') {
        if (password !== confirmPassword) {
          toast.error('两次密码输入不一致');
          return;
        }
        const r = register(username, password);
        if (!r.success) {
          toast.error(r.error ?? '注册失败');
          return;
        }
        toast.success('注册成功，正在登录...');
        const lr = login(username, password);
        if (lr.success) {
          if (rememberMe) saveCreds(username, password);
          else clearCreds();
          onLoginSuccess();
        } else {
          toast.error(lr.error ?? '自动登录失败，请手动登录');
        }
      } else {
        const r = login(username, password);
        if (!r.success) {
          toast.error(r.error ?? '登录失败');
          return;
        }
        if (rememberMe) saveCreds(username, password);
        else clearCreds();
        toast.success(`欢迎回来，${r.user?.username}！`);
        onLoginSuccess();
      }
    } finally {
      setIsLoading(false);
    }
  };

  const pains = [
    {
      icon: MessageSquareWarning,
      title: '竞品评论翻半天，洞察出不来',
      pain: '几十页差评和好评混在一起，截图进群聊，最后还是靠感觉写卖点。',
      solve: 'AmzDev 把评论聚合成痛点 / 赞美 / 未满足需求，按 JTBD 任务归类，直接可写进 Listing 与开发简报。',
    },
    {
      icon: KeyRound,
      title: '关键词只有搜索量 / CPC，看不清用户要买什么',
      pain: '词表很长，却说不出「用户此刻要完成什么任务、在什么场景买」。',
      solve: '从种子词拆购买意图与场景×人群，让选品和文案对准真实需求，而不是只追高搜索量。',
    },
    {
      icon: FolderOpen,
      title: '报告散落 Excel / 飞书 / 微信，决策靠拍脑袋',
      pain: '大盘在一个表、竞品在另一个文档、结论在群里——复盘时对不上版本。',
      solve: '市场大盘、关键词洞察、竞品对比、评论洞察同屏流转，结论留在工作台，开会能直接指给人看。',
    },
  ];

  const caps = [
    { icon: Compass, title: '市场大盘', desc: '趋势、集中度、机会窗口' },
    { icon: Tags, title: '关键词用户洞察', desc: '意图分层与 JTBD 任务' },
    { icon: GitCompare, title: '竞品对比', desc: 'Listing 与流量结构并排' },
    { icon: MessagesSquare, title: '评论洞察', desc: '痛点与未满足需求提炼' },
  ];

  return (
    <div className="amz-login-page min-h-screen">
      <style>{FONT_IMPORT}</style>
      <style>{pageCss}</style>

      <Nav a={menu} on={setMenu} onBrandClick={scrollToLogin} />
      {menu === 'about' && <About c={() => setMenu(null)} />}
      {menu === 'contact' && <Contact c={() => setMenu(null)} />}
      {menu === 'docs' && <Docs c={() => setMenu(null)} />}

      {/* Hero */}
      <section className="relative min-h-[calc(100vh-3.5rem)] flex flex-col lg:flex-row overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 55% 45% at 15% 30%, rgba(245,158,11,0.09), transparent 60%), radial-gradient(ellipse 40% 35% at 85% 70%, rgba(45,212,191,0.06), transparent 55%)',
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(rgba(148,163,184,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.5) 1px, transparent 1px)',
            backgroundSize: '64px 64px',
          }}
        />

        <div className="relative z-10 flex-1 flex flex-col justify-center px-6 lg:px-14 xl:px-20 py-12 lg:py-16 order-2 lg:order-1">
          <div className="max-w-xl">
            <p className="text-teal-400/90 text-xs font-semibold tracking-[0.16em] uppercase mb-5">
              亚马逊市调 · 用户洞察工作台
            </p>
            <h1 className="font-display text-[2.75rem] sm:text-5xl lg:text-[3.4rem] font-semibold text-white tracking-tight leading-[1.08] mb-5">
              AmzDev Tool
            </h1>
            <p className="text-slate-300 text-lg lg:text-xl leading-snug mb-4 max-w-md">
              把评论、关键词和大盘，收成能拍板的用户洞察。
            </p>
            <p className="text-slate-500 text-[14px] leading-relaxed max-w-md mb-8">
              给运营和产品经理：少在 Excel 与群聊之间来回翻，多在「用户要买什么、还差什么」上对齐决策。
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={scrollToLogin}
                className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#070b16] text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
              >
                登录开始
              </button>
              <button
                type="button"
                onClick={enterGuest}
                className="px-5 py-2.5 rounded-xl border border-white/[0.12] hover:border-white/25 text-slate-300 hover:text-white text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400/50"
              >
                游客试用
              </button>
              <a
                href="#calculator"
                className="px-5 py-2.5 rounded-xl text-slate-500 hover:text-amber-300 text-sm font-medium transition-colors"
              >
                算算能省多少时间 →
              </a>
            </div>
          </div>
        </div>

        <div
          id="login-panel"
          className="relative z-10 flex-1 flex items-center justify-center px-6 py-10 lg:py-16 order-1 lg:order-2 border-b lg:border-b-0 lg:border-l border-white/[0.05] bg-white/[0.015]"
        >
          <div className="w-full max-w-[380px]">
            <div className="bg-[#0f1424]/90 backdrop-blur-xl border border-white/[0.08] rounded-2xl p-7 shadow-[0_24px_60px_-28px_rgba(0,0,0,0.7)]">
              <div className="mb-6">
                <h2 className="font-display text-xl font-semibold text-white">进入工作台</h2>
                <p className="text-xs text-slate-500 mt-1">登录后继续市调；也可游客模式先试用</p>
              </div>

              <div className="flex bg-white/[0.04] rounded-xl p-1 mb-6">
                {(['login', 'register'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400/50 ${
                      mode === m ? 'bg-amber-500 text-[#070b16] shadow-sm' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {m === 'login' ? '登录' : '注册'}
                  </button>
                ))}
              </div>

              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">用户名</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="请输入用户名"
                      required
                      className="w-full pl-10 pr-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/30 text-sm transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">密码</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={mode === 'register' ? '至少 6 位' : '请输入密码'}
                      required
                      className="w-full pl-10 pr-12 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/30 text-sm transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {mode === 'register' && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">确认密码</label>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="再次输入密码"
                        required
                        className="w-full pl-10 pr-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/30 text-sm transition-all"
                      />
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setRememberMe(!rememberMe)}
                    className={`w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center transition-all ${
                      rememberMe ? 'bg-amber-500 border-amber-500' : 'border-slate-600 bg-transparent'
                    }`}
                    aria-pressed={rememberMe}
                  >
                    {rememberMe && (
                      <svg className="w-3 h-3 text-[#070b16]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <span className="text-[13px] text-slate-400 select-none">记住密码</span>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3.5 mt-2 bg-amber-500 hover:bg-amber-400 text-[#070b16] font-semibold rounded-xl transition-all shadow-lg shadow-amber-500/15 disabled:opacity-50 disabled:cursor-not-allowed text-[14px] tracking-wide active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
                >
                  {isLoading ? '处理中...' : mode === 'login' ? '登录' : '创建账号'}
                </button>
              </form>

              <div className="flex items-center gap-3 mt-6">
                <div className="flex-1 h-px bg-white/[0.06]" />
                <span className="text-xs text-slate-600">或者</span>
                <div className="flex-1 h-px bg-white/[0.06]" />
              </div>

              <button
                type="button"
                onClick={enterGuest}
                className="w-full mt-4 py-3 border border-white/[0.08] hover:border-teal-500/30 bg-white/[0.02] hover:bg-teal-500/[0.06] text-slate-400 hover:text-teal-300 font-medium rounded-xl transition-all text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400/50"
              >
                游客模式进入
              </button>

              <p className="text-center text-[11px] text-slate-600 mt-4">数据仅存储在本地浏览器，安全且私密</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pain points */}
      <section className="max-w-5xl mx-auto px-6 lg:px-10 py-16 lg:py-20">
        <div className="mb-12 max-w-xl">
          <p className="text-slate-500 text-xs font-semibold tracking-[0.14em] uppercase mb-3">市调现场</p>
          <h2 className="font-display text-3xl lg:text-[2.2rem] font-semibold text-white leading-tight">
            运营和产品经理最耗时的三件事
          </h2>
        </div>
        <div className="space-y-0 divide-y divide-white/[0.06] border-y border-white/[0.06]">
          {pains.map(({ icon: Icon, title, pain, solve }) => (
            <article key={title} className="py-8 lg:py-10 grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-4 lg:gap-10">
              <div className="flex gap-4">
                <div className="mt-1 w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <h3 className="font-display text-xl font-semibold text-white mb-2 leading-snug">{title}</h3>
                  <p className="text-slate-400 text-[14px] leading-relaxed">{pain}</p>
                </div>
              </div>
              <p className="text-[14px] leading-relaxed text-teal-300/90 lg:pt-1 border-l-0 lg:border-l border-teal-500/20 lg:pl-6">
                <span className="text-teal-500/70 text-xs font-semibold uppercase tracking-wider block mb-1.5">AmzDev 怎么解</span>
                {solve}
              </p>
            </article>
          ))}
        </div>
      </section>

      <SavingsCalculator />

      {/* Capabilities */}
      <section className="max-w-5xl mx-auto px-6 lg:px-10 py-16 lg:py-20">
        <div className="mb-10 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <p className="text-slate-500 text-xs font-semibold tracking-[0.14em] uppercase mb-3">能力速览</p>
            <h2 className="font-display text-3xl font-semibold text-white leading-tight">一条市调链路，四种镜头</h2>
          </div>
          <p className="text-slate-500 text-sm max-w-xs">不堆功能墙——每块对应你开会时真正要回答的问题。</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-x-12 gap-y-10">
          {caps.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="border-t border-white/[0.08] pt-5 group hover:border-amber-500/30 transition-colors">
              <div className="flex items-center gap-2.5 mb-1.5">
                <Icon className="w-4 h-4 text-teal-400" />
                <h3 className="text-white font-semibold text-[15px]">{title}</h3>
              </div>
              <p className="text-slate-500 text-[13px]">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer CTA */}
      <footer className="border-t border-white/[0.06] bg-[#0a0f1c]">
        <div className="max-w-5xl mx-auto px-6 lg:px-10 py-12 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
          <div>
            <p className="font-display text-xl font-semibold text-white mb-1">准备好对齐下一场选品决策了吗？</p>
            <p className="text-slate-500 text-sm">登录进工作台，或游客模式先走一遍流程。</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={scrollToLogin}
              className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#070b16] text-sm font-semibold transition-colors"
            >
              回到登录
            </button>
            <button
              type="button"
              onClick={enterGuest}
              className="px-5 py-2.5 rounded-xl border border-white/[0.12] hover:border-white/25 text-slate-300 hover:text-white text-sm font-medium transition-colors"
            >
              游客进入
            </button>
          </div>
        </div>
        <div className="text-center text-[11px] text-slate-600 pb-8">AmzDev Tool · 亚马逊市调与用户洞察</div>
      </footer>
    </div>
  );
};
