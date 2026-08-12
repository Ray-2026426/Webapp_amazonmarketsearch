import React, { useState, useEffect, useMemo } from 'react';
import {
  Eye, EyeOff, User, Lock, BarChart3, Search, X, MessageCircle, QrCode,
  MessageSquareWarning, KeyRound, FolderOpen, Compass, Tags, GitCompare, MessagesSquare,
  Calculator, Sparkles, Upload, Plug, ArrowDown, Layers, Route, CheckCircle2,
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

/** 与应用内一致：白底 + indigo / violet */
const FONT_IMPORT = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Instrument+Serif:ital@0;1&display=swap');
`;

const pageCss = `
  .amz-login-page {
    --void: #f5f5f7;
    --panel: #ffffff;
    --ink: #1d1d1f;
    --muted: #86868b;
    --accent: #6366f1;
    --accent-deep: #4f46e5;
    --violet: #8b5cf6;
    font-family: 'DM Sans', system-ui, sans-serif;
    color: var(--ink);
    background: var(--void);
  }
  .amz-login-page .font-display {
    font-family: 'Instrument Serif', Georgia, serif;
    font-weight: 400;
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
    background: #e8e8ed;
    outline: none;
  }
  .amz-login-page input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--accent);
    border: 2px solid #eef2ff;
    cursor: pointer;
    box-shadow: 0 0 0 4px rgba(99,102,241,0.18);
  }
  .amz-login-page input[type='range']::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--accent);
    border: 2px solid #eef2ff;
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
  <nav className="sticky top-0 z-50 flex items-center justify-between px-6 lg:px-10 h-14 border-b border-black/[0.06] bg-white/80 backdrop-blur-xl">
    <button type="button" onClick={onBrandClick} className="flex items-center gap-2.5 group">
      <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center">
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
          className={`px-3.5 py-2 rounded-lg text-[13px] font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 ${
            a === m.id ? 'bg-indigo-50 text-indigo-700' : 'text-[#86868b] hover:text-[#1d1d1f] hover:bg-black/[0.03]'
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  </nav>
);

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
          <strong className="text-[#1d1d1f]">AmzDev Tool</strong> 面向亚马逊运营与产品经理：把关键词、评论、竞品 Listing 收成同一套工作流，用 JTBD（用户真实要完成的任务）视角读懂「谁要买、为什么买、还差什么」。
        </p>
        <div className="space-y-3">
          <h4 className="text-[#1d1d1f] font-semibold text-sm">我们帮你回答</h4>
          {[
            { i: Search, lb: '市场在涨还是在卷', ds: '大盘趋势、集中度与机会窗口，一眼对齐选品方向' },
            { i: Tags, lb: '词背后的购买任务', ds: '不止搜索量 / CPC，拆出意图分层与场景×人群' },
            { i: MessagesSquare, lb: '评论里的可执行洞察', ds: '痛点、赞美点、未满足需求，直接喂给 Listing / 开发' },
            { i: GitCompare, lb: '竞品差距可对照', ds: '主图、卖点、流量结构并排，少翻十几个页面' },
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
            <p className="text-xs text-[#86868b]">市调流程 / JTBD 洞察 / 试用支持</p>
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
        <p className="text-xs text-[#86868b] text-center">
          扫码沟通市调工作流、用户洞察方法<br />或申请团队试用开通
        </p>
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
        <div>
          <h4 className="text-[#1d1d1f] font-semibold mb-2">从市调到用户洞察</h4>
          <ol className="list-decimal list-inside space-y-1.5 text-[13px] text-[#86868b]">
            <li>登录后进「市场大盘」，导入 ASIN / 关键词，先看机会与集中度</li>
            <li>在「关键词分析」跑种子词，输出购买意图与 JTBD 任务分层</li>
            <li>在「竞品对比」对齐 Listing、流量结构与卖点差距</li>
            <li>在「评论洞察」提炼痛点、赞美点与未满足需求</li>
            <li>需要测算时，用「利润计算器」验证 FBA 模型是否扛得住</li>
          </ol>
        </div>
        <div>
          <h4 className="text-[#1d1d1f] font-semibold mb-2">MCP 数据源</h4>
          <p className="text-[13px] text-[#86868b]">
            「设置 → MCP 数据」添加卖家精灵或领星密钥后即可在线抓取。密钥只存在本机浏览器，不会上传服务器。
          </p>
        </div>
        <p className="text-xs text-[#aeaeb2] pt-2">更多问题请通过「联系我们」扫码咨询。</p>
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
    <section id="calculator" className="relative border-y border-black/[0.06] bg-gradient-to-br from-indigo-50 via-white to-violet-50">
      <div className="relative max-w-5xl mx-auto px-6 lg:px-10 py-16 lg:py-20">
        <div className="max-w-2xl mb-10">
          <p className="text-indigo-600 text-xs font-semibold tracking-[0.14em] uppercase mb-3 flex items-center gap-2">
            <Calculator className="w-3.5 h-3.5" /> 市调省时计算器
          </p>
          <h2 className="font-display text-3xl lg:text-[2.35rem] text-[#1d1d1f] leading-tight mb-3">
            拖一下，看看一年能省多少调研时间
          </h2>
          <p className="text-[#86868b] text-sm leading-relaxed">
            按「工具大约省掉 55% 重复劳动」粗算——方便你对内讲 ROI，不是承诺数字。
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-10 items-start">
          <div className="space-y-7">
            <label className="block">
              <div className="flex justify-between mb-2">
                <span className="text-sm text-[#424245]">每月研究品类 / ASIN 数</span>
                <span className="text-sm font-semibold text-indigo-600 tabular-num">{asins}</span>
              </div>
              <input
                type="range"
                min={1}
                max={30}
                value={asins}
                onChange={(e) => setAsins(Number(e.target.value))}
                className="w-full"
                aria-label="每月研究品类或 ASIN 数"
              />
            </label>
            <label className="block">
              <div className="flex justify-between mb-2">
                <span className="text-sm text-[#424245]">一次完整市调（小时）</span>
                <span className="text-sm font-semibold text-indigo-600 tabular-num">{hours}</span>
              </div>
              <input
                type="range"
                min={1}
                max={20}
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
                className="w-full"
                aria-label="一次完整市调小时数"
              />
            </label>
            <label className="block">
              <div className="flex justify-between mb-2">
                <span className="text-sm text-[#424245]">人月成本（人民币）</span>
                <span className="text-sm font-semibold text-indigo-600 tabular-num">{cost.toLocaleString('zh-CN')}</span>
              </div>
              <input
                type="range"
                min={5000}
                max={30000}
                step={500}
                value={cost}
                onChange={(e) => setCost(Number(e.target.value))}
                className="w-full"
                aria-label="人月成本"
              />
            </label>
            <p className="text-[11px] text-[#aeaeb2] leading-relaxed">
              年省小时 = 月研究数 × 单次小时 × 12 × 0.55；人月 = 年省小时 ÷ 160；年省成本 = 人月 × 月成本。
            </p>
          </div>

          <div className="rounded-2xl bg-white border border-indigo-100 shadow-sm shadow-indigo-100/50 p-6 lg:p-8 space-y-5">
            <div>
              <div className="text-xs text-[#86868b] uppercase tracking-wider mb-1">预估年省小时</div>
              <div className={`text-4xl font-semibold text-[#1d1d1f] tabular-num ${flash ? 'flash' : ''}`}>
                {formatInt(result.yearHours)}
                <span className="text-lg font-medium text-[#86868b] ml-1.5">小时</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-black/[0.05]">
              <div>
                <div className="text-xs text-[#86868b] mb-1">约等于人力</div>
                <div className={`text-2xl font-semibold text-indigo-600 tabular-num ${flash ? 'flash' : ''}`}>
                  {result.headcount.toFixed(1)}
                  <span className="text-sm font-medium text-[#86868b] ml-1">人月/年</span>
                </div>
              </div>
              <div>
                <div className="text-xs text-[#86868b] mb-1">粗略年省成本</div>
                <div className={`text-2xl font-semibold text-violet-600 tabular-num ${flash ? 'flash' : ''}`}>
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
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);

  useEffect(() => {
    const c = loadCreds();
    if (c) {
      setUsername(c.username);
      setPassword(c.password);
      setRememberMe(true);
    }
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

  const flow = [
    { icon: Upload, title: '接入数据', desc: '上传大盘 Excel，或用卖家精灵 / 领星 MCP 在线抓 ASIN、词、评论。' },
    { icon: Layers, title: '结构化整理', desc: '大盘指标、意图分层、竞品 Listing、VOC 标签各自归位，不再散落。' },
    { icon: Route, title: '诊断提问', desc: '围绕选品、需求、对标、体验、利润五类问题推进，而不是堆图表。' },
    { icon: Sparkles, title: '出洞察报告', desc: '市场 / 关键词 / 竞品 / 评论一键生成可读报告，可给团队直接用。' },
  ];

  const modules = [
    {
      icon: Compass,
      title: '市场大盘',
      q: '这个池子有没有量？卷不卷？',
      points: ['销量与集中度', '价格带与评分分布', '新品窗口与头部品牌', '一键市场洞察报告'],
    },
    {
      icon: Tags,
      title: '关键词用户洞察',
      q: '用户在搜什么「任务」？',
      points: ['认知→考虑→决策意图', 'JTBD 任务聚类', '场景 × 人群交叉', '用户洞察报告'],
    },
    {
      icon: GitCompare,
      title: '竞品对比',
      q: '别人强在哪、我们缺什么？',
      points: ['主图与五点对照', '流量词结构', '父体规格矩阵', '竞品综合 AI 报告'],
    },
    {
      icon: MessagesSquare,
      title: '评论洞察',
      q: '买家夸什么、骂什么？',
      points: ['好评 / 差评 / 场景 / 人群', '深度 VOC 报告', '用户旅程 5W1H', '反哺 Listing Brief'],
    },
  ];

  const connectItems = [
    { need: '只想先体验', has: '游客模式 / 示例数据即可，无需密钥' },
    { need: '自己的 Excel 出大盘', has: '上传产品表 + 历史大盘表' },
    { need: '在线拉 ASIN / 词 / 评论', has: '设置里填卖家精灵 MCP Key' },
    { need: '一键 AI 洞察报告', has: '设置里填大模型 API Key（DeepSeek 等）' },
  ];

  const sampleInsights = [
    { tag: '市场', text: '薄枕头是「睡姿匹配」驱动的细分赛道，机会在精确高度表达与凉感叙事。' },
    { tag: '关键词', text: '决策期词落在 stomach sleeper / 精确英寸高度；宽泛 soft pillow 易稀释转化。' },
    { tag: '评论', text: '差评核心是厚度预期差与硬度，而非材质完全失效——主图要用尺子对齐预期。' },
  ];

  return (
    <div className="amz-login-page min-h-screen">
      <style>{FONT_IMPORT}</style>
      <style>{pageCss}</style>

      <Nav a={menu} on={setMenu} onBrandClick={scrollToLogin} />
      {menu === 'about' && <About c={() => setMenu(null)} />}
      {menu === 'contact' && <Contact c={() => setMenu(null)} />}
      {menu === 'docs' && <Docs c={() => setMenu(null)} />}

      {/* Hero：左侧 thesis + 右侧唯一登录入口 */}
      <section className="relative min-h-[calc(100vh-3.5rem)] flex flex-col lg:flex-row overflow-hidden bg-[#f5f5f7]">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 50% 40% at 10% 20%, rgba(99,102,241,0.10), transparent 55%), radial-gradient(ellipse 40% 35% at 90% 80%, rgba(139,92,246,0.08), transparent 50%)',
          }}
        />

        <div className="relative z-10 flex-1 flex flex-col justify-center px-6 lg:px-14 xl:px-20 py-12 lg:py-16 order-2 lg:order-1">
          <div className="max-w-xl">
            <p className="text-indigo-600 text-xs font-semibold tracking-[0.16em] uppercase mb-5">
              亚马逊市调 · 用户洞察工作台
            </p>
            <h1 className="font-display text-[2.85rem] sm:text-5xl lg:text-[3.5rem] text-[#1d1d1f] tracking-tight leading-[1.08] mb-5">
              AmzDev Tool
            </h1>
            <p className="text-[#424245] text-lg lg:text-xl leading-snug mb-4 max-w-md">
              把评论、关键词和大盘，收成能拍板的用户洞察。
            </p>
            <p className="text-[#86868b] text-[14px] leading-relaxed max-w-md mb-8">
              给运营和产品经理：少在 Excel 与群聊之间来回翻，多在「用户要买什么、还差什么」上对齐决策。右侧登录即可进入；游客也可先看示例。
            </p>
            <a
              href="#pain"
              className="inline-flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
            >
              往下看能力与流程
              <ArrowDown className="w-4 h-4" />
            </a>
          </div>
        </div>

        {/* 唯一登录入口：对齐截图——白 Tab + 蓝紫主按钮 */}
        <div
          id="login-panel"
          className="relative z-10 flex-1 flex items-center justify-center px-6 py-10 lg:py-16 order-1 lg:order-2"
        >
          <div className="w-full max-w-[380px]">
            <div className="bg-[#1c1c1e] border border-white/[0.08] rounded-2xl p-7 shadow-[0_24px_60px_-20px_rgba(79,70,229,0.35)]">
              <div className="flex bg-white/[0.06] rounded-xl p-1 mb-6">
                {(['login', 'register'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 ${
                      mode === m ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-white/50 hover:text-white/80'
                    }`}
                  >
                    {m === 'login' ? '登录' : '注册'}
                  </button>
                ))}
              </div>

              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-white/55">用户名</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/35" />
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="请输入用户名"
                      required
                      className="w-full pl-10 pr-4 py-3 bg-white/[0.06] border border-white/[0.1] rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400/40 text-sm transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-white/55">密码</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/35" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={mode === 'register' ? '至少 6 位' : '请输入密码'}
                      required
                      className="w-full pl-10 pr-12 py-3 bg-white/[0.06] border border-white/[0.1] rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400/40 text-sm transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/35 hover:text-white/70 transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {mode === 'register' && (
                  <div className="space-y-1.5">
                    <label className="text-[12px] font-medium text-white/55">确认密码</label>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/35" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="再次输入密码"
                        required
                        className="w-full pl-10 pr-4 py-3 bg-white/[0.06] border border-white/[0.1] rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400/40 text-sm transition-all"
                      />
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setRememberMe(!rememberMe)}
                    className={`w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center transition-all ${
                      rememberMe ? 'bg-indigo-500 border-indigo-500' : 'border-white/25 bg-transparent'
                    }`}
                    aria-pressed={rememberMe}
                  >
                    {rememberMe && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <span className="text-[13px] text-white/55 select-none">记住密码</span>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3.5 mt-2 bg-indigo-500 hover:bg-indigo-400 text-white font-semibold rounded-xl transition-all shadow-lg shadow-indigo-500/25 disabled:opacity-50 disabled:cursor-not-allowed text-[14px] tracking-wide active:scale-[0.99]"
                >
                  {isLoading ? '处理中...' : mode === 'login' ? '登录' : '创建账号'}
                </button>
              </form>

              <div className="flex items-center gap-3 mt-6">
                <div className="flex-1 h-px bg-white/[0.08]" />
                <span className="text-xs text-white/30">或者</span>
                <div className="flex-1 h-px bg-white/[0.08]" />
              </div>

              <button
                type="button"
                onClick={enterGuest}
                className="w-full mt-4 py-3 border border-white/[0.12] hover:border-indigo-400/40 bg-transparent hover:bg-indigo-500/10 text-white/70 hover:text-white font-medium rounded-xl transition-all text-[13px]"
              >
                游客模式进入
              </button>

              <p className="text-center text-[11px] text-white/30 mt-4">数据仅存储在本地浏览器，安全且私密</p>
            </div>
          </div>
        </div>
      </section>

      {/* 痛点 */}
      <section id="pain" className="bg-white border-t border-black/[0.04]">
        <div className="max-w-5xl mx-auto px-6 lg:px-10 py-16 lg:py-20">
          <div className="mb-12 max-w-xl">
            <p className="text-[#86868b] text-xs font-semibold tracking-[0.14em] uppercase mb-3">市调现场</p>
            <h2 className="font-display text-3xl lg:text-[2.2rem] text-[#1d1d1f] leading-tight">
              运营和产品经理最耗时的三件事
            </h2>
          </div>
          <div className="space-y-0 divide-y divide-black/[0.06] border-y border-black/[0.06]">
            {pains.map(({ icon: Icon, title, pain, solve }) => (
              <article key={title} className="py-8 lg:py-10 grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-4 lg:gap-10">
                <div className="flex gap-4">
                  <div className="mt-1 w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-[#1d1d1f] mb-2 leading-snug">{title}</h3>
                    <p className="text-[#86868b] text-[14px] leading-relaxed">{pain}</p>
                  </div>
                </div>
                <p className="text-[14px] leading-relaxed text-[#424245] lg:pt-1 border-l-0 lg:border-l border-indigo-100 lg:pl-6">
                  <span className="text-indigo-600 text-xs font-semibold uppercase tracking-wider block mb-1.5">AmzDev 怎么解</span>
                  {solve}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 工作流 */}
      <section className="bg-[#f5f5f7]">
        <div className="max-w-5xl mx-auto px-6 lg:px-10 py-16 lg:py-20">
          <div className="mb-12 max-w-2xl">
            <p className="text-indigo-600 text-xs font-semibold tracking-[0.14em] uppercase mb-3">工作流</p>
            <h2 className="font-display text-3xl lg:text-[2.2rem] text-[#1d1d1f] leading-tight mb-3">
              从数据源到诊断分析
            </h2>
            <p className="text-[#86868b] text-sm leading-relaxed">
              不是再做一个看板，而是：多源数据 → 结构化整理 → 诊断提问 → 报告与动作。
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {flow.map(({ icon: Icon, title, desc }, idx) => (
              <div key={title} className="relative bg-white rounded-2xl border border-black/[0.05] p-5">
                <div className="text-[11px] font-semibold text-indigo-500 mb-3">步骤 {idx + 1}</div>
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

      {/* 四大模块深讲 */}
      <section className="bg-white">
        <div className="max-w-5xl mx-auto px-6 lg:px-10 py-16 lg:py-20">
          <div className="mb-12 max-w-2xl">
            <p className="text-[#86868b] text-xs font-semibold tracking-[0.14em] uppercase mb-3">能力深讲</p>
            <h2 className="font-display text-3xl lg:text-[2.2rem] text-[#1d1d1f] leading-tight mb-3">
              四个模块，对应开会时真正要回答的问题
            </h2>
            <p className="text-[#86868b] text-sm">每块都能单独出报告；串起来就是完整市调闭环。</p>
          </div>
          <div className="grid md:grid-cols-2 gap-5">
            {modules.map(({ icon: Icon, title, q, points }) => (
              <div key={title} className="rounded-2xl border border-black/[0.06] bg-[#fafafa] p-6 hover:border-indigo-200 hover:bg-white transition-colors">
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center">
                    <Icon className="w-4 h-4 text-indigo-600" />
                  </div>
                  <h3 className="font-semibold text-[#1d1d1f] text-[16px]">{title}</h3>
                </div>
                <p className="text-sm text-indigo-600/90 font-medium mb-4">{q}</p>
                <ul className="space-y-2">
                  {points.map((p) => (
                    <li key={p} className="flex items-start gap-2 text-[13px] text-[#424245]">
                      <CheckCircle2 className="w-3.5 h-3.5 text-indigo-500 mt-0.5 shrink-0" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 示例洞察预览 */}
      <section className="bg-[#f5f5f7] border-y border-black/[0.04]">
        <div className="max-w-5xl mx-auto px-6 lg:px-10 py-16 lg:py-20">
          <div className="mb-10 max-w-2xl">
            <p className="text-indigo-600 text-xs font-semibold tracking-[0.14em] uppercase mb-3">示例洞察长什么样</p>
            <h2 className="font-display text-3xl text-[#1d1d1f] leading-tight mb-3">
              游客进入后，这类结论已经预置好
            </h2>
            <p className="text-[#86868b] text-sm">基于美国站薄枕头示例包——方便你判断「报告是否对业务有用」。</p>
          </div>
          <div className="space-y-3">
            {sampleInsights.map(({ tag, text }) => (
              <div key={tag} className="flex gap-4 items-start bg-white rounded-2xl border border-black/[0.05] px-5 py-4">
                <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-100">
                  {tag}
                </span>
                <p className="text-[14px] text-[#424245] leading-relaxed pt-0.5">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 接入什么 */}
      <section className="bg-white">
        <div className="max-w-5xl mx-auto px-6 lg:px-10 py-16 lg:py-20">
          <div className="mb-10 flex flex-col sm:flex-row sm:items-end gap-4 justify-between">
            <div className="max-w-xl">
              <p className="text-[#86868b] text-xs font-semibold tracking-[0.14em] uppercase mb-3 flex items-center gap-2">
                <Plug className="w-3.5 h-3.5" /> 你需要接入什么
              </p>
              <h2 className="font-display text-3xl text-[#1d1d1f] leading-tight">
                按目标选配，不必一次配齐
              </h2>
            </div>
            <p className="text-xs text-[#aeaeb2] max-w-xs sm:text-right">密钥只存在本机浏览器，不进我们的业务服务器。</p>
          </div>
          <div className="overflow-hidden rounded-2xl border border-black/[0.06]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#f5f5f7] text-left text-xs text-[#86868b] uppercase tracking-wider">
                  <th className="px-5 py-3 font-semibold">你想做的事</th>
                  <th className="px-5 py-3 font-semibold">最少需要</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.05]">
                {connectItems.map((row) => (
                  <tr key={row.need} className="bg-white">
                    <td className="px-5 py-3.5 text-[#1d1d1f] font-medium">{row.need}</td>
                    <td className="px-5 py-3.5 text-[#86868b]">{row.has}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 页脚：不再重复登录/游客按钮，只留品牌与导航 */}
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
