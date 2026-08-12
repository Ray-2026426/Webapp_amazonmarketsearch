import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, User, Lock } from 'lucide-react';
import { login, register, saveCreds, loadCreds, clearCreds } from '../utils/auth';
import { toast } from 'sonner';

interface LoginPageProps {
  onLoginSuccess: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const creds = loadCreds();
    if (creds) {
      setUsername(creds.username);
      setPassword(creds.password);
      setRememberMe(true);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      if (mode === 'register') {
        if (password !== confirmPassword) {
          toast.error('两次密码输入不一致');
          return;
        }
        const result = register(username, password);
        if (!result.success) {
          toast.error(result.error ?? '注册失败');
          return;
        }
        toast.success('注册成功，正在登录...');
        const loginResult = login(username, password);
        if (loginResult.success) {
          if (rememberMe) saveCreds(username, password); else clearCreds();
          onLoginSuccess();
        } else {
          toast.error(loginResult.error ?? '注册已成功，但自动登录失败，请切换到「登录」手动进入');
        }
      } else {
        const result = login(username, password);
        if (!result.success) { toast.error(result.error ?? '登录失败'); return; }
        if (rememberMe) saveCreds(username, password); else clearCreds();
        toast.success(`欢迎回来，${result.user?.username}！`);
        onLoginSuccess();
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage:
            'linear-gradient(rgba(99,102,241,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.3) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-violet-600/20 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 mb-4">
            <img src="/logo.png?v=20260812" alt="AmzDev Tool" className="w-20 h-20 rounded-2xl object-contain drop-shadow-xl" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">AmzDev Tool</h1>
          <p className="text-indigo-300 text-sm mt-1">Amazon 市场洞察平台</p>
        </div>

        {/* Card */}
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8 shadow-2xl">
          {/* Tab Switch */}
          <div className="flex bg-white/10 rounded-2xl p-1 mb-8">
            <button
              onClick={() => setMode('login')}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                mode === 'login'
                  ? 'bg-white text-indigo-900 shadow-md'
                  : 'text-white/70 hover:text-white'
              }`}
            >
              登录
            </button>
            <button
              onClick={() => setMode('register')}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                mode === 'register'
                  ? 'bg-white text-indigo-900 shadow-md'
                  : 'text-white/70 hover:text-white'
              }`}
            >
              注册
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-indigo-200 uppercase tracking-wider">用户名</label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="请输入用户名"
                  required
                  className="w-full pl-10 pr-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-indigo-200 uppercase tracking-wider">密码</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? '至少 6 位' : '请输入密码'}
                  required
                  className="w-full pl-10 pr-12 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Confirm Password (Register only) */}
            {mode === 'register' && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-indigo-200 uppercase tracking-wider">确认密码</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="再次输入密码"
                    required
                    className="w-full pl-10 pr-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm transition-all"
                  />
                </div>
              </div>
            )}

            {/* Remember Me */}
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => setRememberMe(!rememberMe)}
                className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                  rememberMe ? 'bg-indigo-500 border-indigo-500' : 'border-white/30 bg-transparent'
                }`}
              >
                {rememberMe && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
              <span className="text-sm text-white/70">自动保存密码（下次自动填充）</span>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3.5 mt-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-500/30 disabled:opacity-50 disabled:cursor-not-allowed text-sm tracking-wide"
            >
              {isLoading ? '处理中...' : mode === 'login' ? '登录' : '注册账号'}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 mt-6">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-xs text-white/30">或者</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          {/* Guest Entry */}
          <button
            type="button"
            onClick={() => {
              // Set a guest session flag and proceed
              sessionStorage.setItem('guest_mode', '1');
              onLoginSuccess();
            }}
            className="w-full mt-4 py-3 border border-white/20 hover:border-white/40 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white font-medium rounded-xl transition-all text-sm"
          >
            游客模式进入（无需登录）
          </button>

          <p className="text-center text-xs text-white/40 mt-4">
            数据仅存储在您的本地浏览器中，安全可靠。
          </p>
        </div>
      </div>
    </div>
  );
};
