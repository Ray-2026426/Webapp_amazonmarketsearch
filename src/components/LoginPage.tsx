import React, { useState, useEffect, useRef } from 'react';
import { Eye, EyeOff, User, Lock, BarChart3, Search, Zap, Shield, Sparkles, TrendingUp, X, MessageCircle, QrCode } from 'lucide-react';
import { login, register, saveCreds, loadCreds, clearCreds } from '../utils/auth';
import { toast } from 'sonner';

interface LoginPageProps { onLoginSuccess: () => void; }
interface MenuItem { id: string; label: string; }
const MENU: MenuItem[] = [
  { id: 'docs', label: '帮助文档' },
  { id: 'about', label: '关于我们' },
  { id: 'contact', label: '联系我们' },
];

const Nav: React.FC<{ a: string | null; on: (id: string) => void }> = ({ a, on }) => (
  <nav className="sticky top-0 z-50 flex items-center justify-between px-6 lg:px-10 h-14 border-b border-white/[0.06] bg-[#070b16]/75 backdrop-blur-xl">
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
        <BarChart3 className="w-4 h-4 text-white" />
      </div>
      <span className="text-white font-semibold text-[15px] tracking-tight">AmzDev Tool</span>
    </div>
    <div className="flex items-center gap-1">
      {MENU.map((m) => (
        <button key={m.id} onClick={() => on(m.id)} className={`px-3.5 py-2 rounded-lg text-[13px] font-medium transition-all ${a === m.id ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'}`}>{m.label}</button>
      ))}
    </div>
  </nav>
);

const About: React.FC<{ c: () => void }> = ({ c }) => (
  <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#070b16]/80 backdrop-blur-sm p-4" onClick={(e) => { if (e.target === e.currentTarget) c(); }}>
    <div className="bg-[#0f1424] border border-white/[0.08] w-full max-w-lg rounded-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-200">
      <div className="p-5 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center"><BarChart3 className="w-[18px] h-[18px] text-white" /></div>
          <div><h3 className="text-white font-semibold">关于 AmzDev Tool</h3><p className="text-xs text-slate-400">Amazon Market Research Platform</p></div>
        </div>
        <button onClick={c} className="p-1.5 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-6 space-y-5 text-sm text-slate-300">
        <p><strong className="text-white">AmzDev Tool</strong> 是一款面向亚马逊卖家的智能化市场洞察平台。整合了卖家精灵与领星等多源数据，结合 AI 驱动的分析与可视化图表，帮助卖家快速完成市场调研、竞品分析、用户洞察与利润测算。</p>
        <div className="space-y-3">
          <h4 className="text-white font-semibold text-sm">核心能力</h4>
          {[{ i: Search, lb: '多源数据聚合', ds: '卖家精灵 + 领星双 MCP 引擎，一键抓取关键词、评论、市场数据' }, { i: Sparkles, lb: 'AI 智能洞察', ds: 'JTBD 用户任务分析、购买意图分层、场景人群交叉洞察' }, { i: TrendingUp, lb: '可视化报告', ds: '交互式图表 + 可导出 Excel 报告，支撑选品与运营决策' }, { i: Shield, lb: '隐私安全', ds: '数据仅存在于您的本地浏览器，无需上传服务器' }].map(({ i: I, lb, ds }) => (
            <div key={lb} className="flex gap-3"><div className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0"><I className="w-4 h-4 text-indigo-400" /></div><div><div className="text-white font-medium text-[13px]">{lb}</div><div className="text-xs text-slate-400 mt-0.5">{ds}</div></div></div>
          ))}
        </div>
        <p className="text-xs text-slate-500 pt-1">Version 2.0 · Built for Amazon sellers</p>
      </div>
    </div>
  </div>
);

const Contact: React.FC<{ c: () => void }> = ({ c }) => (
  <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#070b16]/80 backdrop-blur-sm p-4" onClick={(e) => { if (e.target === e.currentTarget) c(); }}>
    <div className="bg-[#0f1424] border border-white/[0.08] w-full max-w-sm rounded-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-200">
      <div className="p-5 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2.5"><div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center"><MessageCircle className="w-[18px] h-[18px] text-amber-400" /></div><div><h3 className="text-white font-semibold">联系我们</h3><p className="text-xs text-slate-400">扫码添加，获取支持</p></div></div>
        <button onClick={c} className="p-1.5 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-6 flex flex-col items-center gap-4">
        <div className="w-44 h-44 rounded-2xl bg-white/[0.03] border border-white/[0.08] border-dashed flex flex-col items-center justify-center text-slate-500 gap-2">
          <QrCode className="w-10 h-10" /><span className="text-xs">二维码占位</span><span className="text-[10px] text-slate-600">后续替换为实际二维码</span>
        </div>
        <p className="text-xs text-slate-400 text-center">使用微信或其他扫码工具<br />扫描上方二维码联系我们</p>
      </div>
    </div>
  </div>
);

const Docs: React.FC<{ c: () => void }> = ({ c }) => (
  <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#070b16]/80 backdrop-blur-sm p-4" onClick={(e) => { if (e.target === e.currentTarget) c(); }}>
    <div className="bg-[#0f1424] border border-white/[0.08] w-full max-w-lg rounded-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-200">
      <div className="p-5 border-b border-white/[0.06] flex items-center justify-between"><h3 className="text-white font-semibold">帮助文档</h3><button onClick={c} className="p-1.5 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white"><X className="w-4 h-4" /></button></div>
      <div className="p-6 space-y-4 text-sm text-slate-300">
        <div><h4 className="text-white font-semibold mb-2">快速入门</h4><ol className="list-decimal list-inside space-y-1.5 text-[13px] text-slate-400"><li>登录后进入"市场大盘"，导入 ASIN / 关键词数据</li><li>在"关键词分析"中输入种子词，一键 AI 用户洞察</li><li>在"竞品分析"中对比竞品 Listing 与流量结构</li><li>在"用户洞察"中查看评论分析与用户画像</li><li>在"利润计算器"中测算 FBA 利润模型</li></ol></div>
        <div><h4 className="text-white font-semibold mb-2">MCP 数据源配置</h4><p className="text-[13px] text-slate-400">进入"设置 → MCP 数据"添加卖家精灵或领星的密钥，即可在线抓取数据。密钥仅保存在浏览器本地。</p></div>
        <p className="text-xs text-slate-500 pt-2">更多问题请通过"联系我们"扫码咨询。</p>
      </div>
    </div>
  </div>
);

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const orbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const creds = loadCreds();
    if (creds) { setUsername(creds.username); setPassword(creds.password); setRememberMe(true); }
  }, []);

  useEffect(() => {
    let raf: number; let angle = 0;
    const o = orbRef.current; if (!o) return;
    const frame = () => {
      angle = (angle + 0.002) % (Math.PI * 2);
      o.style.background = `radial-gradient(circle at ${50 + Math.sin(angle) * 20}% ${50 + Math.cos(angle * 1.3) * 15}%, rgba(129,140,248,0.14) 0%, transparent 65%)`;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setIsLoading(true);
    try {
      if (mode === 'register') {
        if (password !== confirmPassword) { toast.error('两次密码输入不一致'); return; }
        const r = register(username, password);
        if (!r.success) { toast.error(r.error ?? '注册失败'); return; }
        toast.success('注册成功，正在登录...');
        const lr = login(username, password);
        if (lr.success) { if (rememberMe) saveCreds(username, password); else clearCreds(); onLoginSuccess(); }
        else toast.error(lr.error ?? '自动登录失败，请手动登录');
      } else {
        const r = login(username, password);
        if (!r.success) { toast.error(r.error ?? '登录失败'); return; }
        if (rememberMe) saveCreds(username, password); else clearCreds();
        toast.success(`欢迎回来，${r.user?.username}！`);
        onLoginSuccess();
      }
    } finally { setIsLoading(false); }
  };

  const feats = [
    { i: Search, lb: '多源数据引擎', ds: '卖家精灵 + 领星双 MCP，一键抓取 ABA 关键词、竞品流量词与评论' },
    { i: Sparkles, lb: 'AI 智能洞察', ds: 'JTBD 用户任务分析、购买意图分层、场景×人群交叉洞察' },
    { i: TrendingUp, lb: '可视化决策', ds: '交互式图表 + 可导出 Excel 报告，数据驱动选品与运营' },
    { i: Shield, lb: '隐私安全', ds: '数据仅保存在您的浏览器，无需上传' },
  ];

  return (
    <>
      <Nav a={menu} on={setMenu} />
      {menu === 'about' && <About c={() => setMenu(null)} />}
      {menu === 'contact' && <Contact c={() => setMenu(null)} />}
      {menu === 'docs' && <Docs c={() => setMenu(null)} />}

      <div className="flex min-h-[calc(100vh-3.5rem)] flex-col lg:flex-row bg-[#070b16]">
        {/* LEFT: Brand Intro */}
        <div className="relative flex-1 flex flex-col justify-center px-6 lg:px-14 py-10 lg:py-0 overflow-hidden order-2 lg:order-1">
          <div ref={orbRef} className="absolute inset-0 pointer-events-none transition-colors duration-[3000ms]" style={{ background: 'radial-gradient(circle at 50% 50%, rgba(129,140,248,0.12) 0%, transparent 60%)' }} />
          <div className="absolute inset-0 opacity-[0.025]" style={{ backgroundImage: 'linear-gradient(rgba(129,140,248,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(129,140,248,0.4) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />

          <div className="relative z-10 max-w-xl mx-auto lg:mx-0">
            <div className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium mb-6">
              <Zap className="w-3 h-3" /> 新版本 · 用户洞察引擎
            </div>

            <h1 className="text-4xl lg:text-5xl font-extrabold text-white tracking-tight leading-tight mb-4">
              {"把关键词"}<span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400"> 变成 </span>{"用户洞察"}
            </h1>

            <p className="text-slate-400 text-[15px] leading-relaxed max-w-md mb-8">
              不再只看搜索量和 CPC。AmzDev Tool 用 AI 从关键词中解读用户的购买意图、真实任务与潜在痛点，帮你做出更聪明的选品决策。
            </p>

            {/* Signature: pulsing data orb */}
            <div className="flex items-center gap-4 mb-8">
              <div className="relative">
                <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                  <BarChart3 className="w-6 h-6 text-indigo-400" />
                </div>
                <div className="absolute inset-0 rounded-2xl animate-ping bg-indigo-500/10" style={{ animationDuration: '3s' }} />
                <div className="absolute -inset-1 rounded-2xl animate-ping bg-indigo-500/5" style={{ animationDuration: '3s', animationDelay: '1s' }} />
              </div>
              <div>
                <div className="text-white font-bold text-lg">10,000+</div>
                <div className="text-xs text-slate-400">关键词 / 分钟 AI 分析</div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {feats.map(({ i: I, lb, ds }) => (
                <div key={lb} className="flex items-start gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05] hover:border-white/[0.1] transition-all group">
                  <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0 group-hover:bg-indigo-500/15 transition-colors"><I className="w-4 h-4 text-indigo-400" /></div>
                  <div className="min-w-0"><div className="text-white font-semibold text-[13px]">{lb}</div><div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{ds}</div></div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT: Login Card */}
        <div className="flex-1 flex items-center justify-center px-6 py-10 lg:py-0 order-1 lg:order-2 bg-white/[0.015] border-b lg:border-b-0 lg:border-l border-white/[0.04]">
          <div className="w-full max-w-[380px]">
            <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-7 shadow-[0_0_60px_-12px_rgba(99,102,241,0.1)]">
              <div className="flex bg-white/[0.04] rounded-xl p-1 mb-7">
                {(['login', 'register'] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setMode(m)} className={`flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-200 ${mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-white'}`}>
                    {m === 'login' ? '登录' : '注册'}
                  </button>
                ))}
              </div>

              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">用户名</label>
                  <div className="relative"><User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="请输入用户名" required className="w-full pl-10 pr-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/30 text-sm transition-all" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">密码</label>
                  <div className="relative"><Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'register' ? '至少 6 位' : '请输入密码'} required className="w-full pl-10 pr-12 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/30 text-sm transition-all" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {mode === 'register' && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">确认密码</label>
                    <div className="relative"><Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="再次输入密码" required className="w-full pl-10 pr-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/30 text-sm transition-all" />
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3 pt-1">
                  <button type="button" onClick={() => setRememberMe(!rememberMe)} className={`w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center transition-all ${rememberMe ? 'bg-indigo-500 border-indigo-500' : 'border-slate-600 bg-transparent'}`}>
                    {rememberMe && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                  </button>
                  <span className="text-[13px] text-slate-400 select-none">记住密码</span>
                </div>

                <button type="submit" disabled={isLoading} className="w-full py-3.5 mt-2 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-semibold rounded-xl transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed text-[14px] tracking-wide active:scale-[0.99]">
                  {isLoading ? '处理中...' : mode === 'login' ? '登录' : '创建账号'}
                </button>
              </form>

              <div className="flex items-center gap-3 mt-6"><div className="flex-1 h-px bg-white/[0.06]" /><span className="text-xs text-slate-600">或者</span><div className="flex-1 h-px bg-white/[0.06]" /></div>

              <button type="button" onClick={() => { sessionStorage.setItem('guest_mode', '1'); onLoginSuccess(); }} className="w-full mt-4 py-3 border border-white/[0.08] hover:border-white/[0.15] bg-white/[0.02] hover:bg-white/[0.04] text-slate-400 hover:text-white font-medium rounded-xl transition-all text-[13px]">
                游客模式进入
              </button>

              <p className="text-center text-[11px] text-slate-600 mt-4">数据仅存储在本地浏览器，安全且私密</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
