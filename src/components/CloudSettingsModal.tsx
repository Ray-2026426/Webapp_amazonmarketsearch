import { useEffect, useState, type ReactNode } from 'react';
import { LogIn, LogOut, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from './ui/Card';
import { loadSupabaseConfig, saveSupabaseConfig, validateSupabaseConfig } from '../utils/supabaseConfig';
import { resetSupabaseClient } from '../utils/supabaseClient';
import {
  getCloudAuthState,
  signInCloudEmail,
  signOutCloud,
  signUpCloudEmail,
  connectBackendCloudSession,
  type CloudAuthState,
} from '../utils/cloudAuth';

export function CloudSettingsModal({ onClose }: { onClose: () => void }) {
  const existing = loadSupabaseConfig();
  const [url, setUrl] = useState(existing?.url ?? '');
  const [key, setKey] = useState(existing?.key ?? '');
  const [saving, setSaving] = useState(false);
  const [authState, setAuthState] = useState<CloudAuthState | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState<'login' | 'signup' | 'logout' | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [managedBusy, setManagedBusy] = useState(false);

  const canSave = url.trim().length > 0 && key.trim().length > 0;
  const canAuth = email.trim().length > 0 && password.length >= 6;

  const refreshAuth = async () => {
    try {
      setAuthState(await getCloudAuthState());
    } catch {
      setAuthState({ configured: true, user: null, isAnonymous: false, label: '云账号状态读取失败' });
    }
  };

  useEffect(() => {
    void refreshAuth();
  }, []);

  const connectManaged = async () => {
    setManagedBusy(true);
    try {
      const ok = await connectBackendCloudSession();
      await refreshAuth();
      if (ok) toast.success('云端存储已连接');
      else toast.error('后台云端存储未配置或连接失败');
    } finally {
      setManagedBusy(false);
    }
  };

  const submit = () => {
    if (!canSave) return;
    const config = { url: url.trim(), key: key.trim() };
    const validationError = validateSupabaseConfig(config);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setSaving(true);
    saveSupabaseConfig(config);
    resetSupabaseClient();
    void refreshAuth();
    setSaving(false);
    toast.success('云端配置已保存');
  };

  const clear = () => {
    saveSupabaseConfig(null);
    resetSupabaseClient();
    setAuthState({ configured: false, user: null, isAnonymous: false, label: '未配置云端' });
    toast.success('云端配置已清除');
  };

  const login = async () => {
    if (!canAuth) return;
    setAuthBusy('login');
    try {
      await signInCloudEmail(email.trim(), password);
      await refreshAuth();
      toast.success('云账号已登录');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '云账号登录失败');
    } finally {
      setAuthBusy(null);
    }
  };

  const signup = async () => {
    if (!canAuth) return;
    setAuthBusy('signup');
    try {
      await signUpCloudEmail(email.trim(), password);
      await refreshAuth();
      toast.success('云账号已创建，请按 Supabase 项目配置完成邮箱确认后登录');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '云账号注册失败');
    } finally {
      setAuthBusy(null);
    }
  };

  const logout = async () => {
    setAuthBusy('logout');
    try {
      await signOutCloud();
      await refreshAuth();
      toast.success('云账号已退出');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '退出失败');
    } finally {
      setAuthBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-[32px] shadow-[0_12px_40px_rgba(15,23,42,0.14)] border border-black/8 p-7">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-xl font-bold text-[#1d1d1f]">云端同步设置</h3>
            <p className="text-sm text-[#86868b] mt-0.5">云端存储由后台托管；普通用户无需配置</p>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full hover:bg-[#f5f5f7] flex items-center justify-center text-[#86868b]"><X className="w-4 h-4" /></button>
        </div>

        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 mb-5">
          <p className="text-sm font-semibold text-[#1d1d1f]">后台托管云端存储</p>
          <p className="text-xs text-[#86868b] mt-1">连接后，项目和报告会自动保存到服务器。本页面不会显示云账号密码。</p>
          <button
            type="button"
            onClick={connectManaged}
            disabled={managedBusy}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-all"
          >
            <LogIn className="w-3.5 h-3.5" />
            {managedBusy ? '连接中…' : '连接云端存储'}
          </button>
        </div>

        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="text-xs font-medium text-[#86868b] hover:text-indigo-600 transition-colors"
        >
          {advancedOpen ? '收起高级配置' : '高级配置'}
        </button>

        {advancedOpen && <div className="space-y-4 mt-3">
          <Field label="Supabase URL">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" className={inputCls} />
          </Field>
          <Field label="Publishable Key">
            <textarea value={key} onChange={(e) => setKey(e.target.value)} rows={3} placeholder="sb_publishable_..." className={cn(inputCls, 'resize-none font-mono text-xs')} />
          </Field>
        </div>}

        {advancedOpen && <div className="mt-5 rounded-2xl border border-black/5 bg-[#fafafa] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[#1d1d1f]">云账号</p>
              <p className="text-xs text-[#86868b] mt-0.5">
                当前：{authState?.label ?? '读取中…'}
              </p>
            </div>
            {authState?.user && (
              <button
                type="button"
                onClick={logout}
                disabled={authBusy !== null}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-black/8 bg-white text-xs font-medium text-[#424245] hover:bg-[#f5f5f7] disabled:opacity-50 transition-all"
              >
                <LogOut className="w-3.5 h-3.5" />
                退出
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 mt-4">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
              placeholder="邮箱"
              className={inputCls}
            />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
              placeholder="密码（至少 6 位）"
              className={inputCls}
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 mt-3">
            <button
              type="button"
              onClick={signup}
              disabled={!canAuth || authBusy !== null}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-indigo-100 bg-white text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <UserPlus className="w-3.5 h-3.5" />
              {authBusy === 'signup' ? '注册中…' : '注册云账号'}
            </button>
            <button
              type="button"
              onClick={login}
              disabled={!canAuth || authBusy !== null}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <LogIn className="w-3.5 h-3.5" />
              {authBusy === 'login' ? '登录中…' : '登录云账号'}
            </button>
          </div>
        </div>}

        <div className="flex items-center justify-between mt-6">
          <button type="button" onClick={clear} className="text-xs text-[#aeaeb2] hover:text-rose-500 transition-colors">清除本机云端会话</button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl border border-black/8 text-sm font-medium text-[#424245] hover:bg-[#f5f5f7] transition-all">取消</button>
            <button type="button" disabled={!canSave} onClick={submit} className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-sm font-semibold hover:from-indigo-600 hover:to-violet-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98]">
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-[#424245] mb-1.5">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'w-full px-3 py-2.5 rounded-xl border border-black/8 bg-gradient-to-b from-white to-[#f8f9fb] text-sm text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300 transition-all';
