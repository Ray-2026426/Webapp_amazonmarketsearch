import { useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from './ui/Card';
import { loadSupabaseConfig, saveSupabaseConfig, validateSupabaseConfig } from '../utils/supabaseConfig';
import { resetSupabaseClient } from '../utils/supabaseClient';

export function CloudSettingsModal({ onClose }: { onClose: () => void }) {
  const existing = loadSupabaseConfig();
  const [url, setUrl] = useState(existing?.url ?? '');
  const [key, setKey] = useState(existing?.key ?? '');
  const [saving, setSaving] = useState(false);

  const canSave = url.trim().length > 0 && key.trim().length > 0;

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
    toast.success('云端配置已保存');
    onClose();
  };

  const clear = () => {
    saveSupabaseConfig(null);
    resetSupabaseClient();
    toast.success('云端配置已清除');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-[32px] shadow-[0_12px_40px_rgba(15,23,42,0.14)] border border-black/8 p-7">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-xl font-bold text-[#1d1d1f]">云端同步设置</h3>
            <p className="text-sm text-[#86868b] mt-0.5">配置保存在当前浏览器；匿名模式暂不支持跨设备身份同步</p>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full hover:bg-[#f5f5f7] flex items-center justify-center text-[#86868b]"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-4">
          <Field label="Supabase URL">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" className={inputCls} />
          </Field>
          <Field label="Publishable Key">
            <textarea value={key} onChange={(e) => setKey(e.target.value)} rows={3} placeholder="sb_publishable_..." className={cn(inputCls, 'resize-none font-mono text-xs')} />
          </Field>
        </div>

        <div className="flex items-center justify-between mt-6">
          <button type="button" onClick={clear} className="text-xs text-[#aeaeb2] hover:text-rose-500 transition-colors">清除配置</button>
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
