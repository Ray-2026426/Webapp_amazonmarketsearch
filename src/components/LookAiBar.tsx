import { useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { runLookAnalysis } from '../utils/lookAi';

/**
 * M1：五看「AI 起草」共享操作条。
 *
 * 断链修复：`lookAi.runLookAnalysis` 此前**写了但零调用**（PRD §2.3-1），
 * 导致"AI 驱动五看"从未生效、五看全靠手填。所有看统一挂本组件即可接线。
 *
 * 约束：AI 产物只用于**填空**，绝不覆盖人工已填内容（由 lookAiMerge 保证）；
 * onApply 返回本次「新增了什么 / 保留了什么」，用于给用户明确反馈。
 */
export type LookAiKey = 'market' | 'user' | 'competitor' | 'self';

export interface LookAiApplyOutcome {
  filled: string[];
  skipped: string[];
}

export function LookAiBar({
  look,
  extra,
  hint,
  disabled,
  onApply,
}: {
  look: LookAiKey;
  /** 传给 AI 的附加数据（如「看自己」的引导问题回答） */
  extra?: Record<string, unknown>;
  hint?: string;
  disabled?: boolean;
  onApply: (data: Record<string, unknown>) => LookAiApplyOutcome;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await runLookAnalysis(look, extra);
      if (!res.ok || !res.data) {
        const msg = res.error || 'AI 分析失败';
        setError(msg);
        toast.error(msg);
        return;
      }
      const outcome = onApply(res.data);
      if (outcome.filled.length === 0) {
        toast.info(
          outcome.skipped.length
            ? `AI 已完成分析，但你已填写的字段全部保留（未覆盖）：${outcome.skipped.slice(0, 4).join('、')}${outcome.skipped.length > 4 ? '…' : ''}`
            : 'AI 已完成分析，但没有可回填的新内容。'
        );
      } else {
        toast.success(
          `AI 已起草：${outcome.filled.join('、')}` +
            (outcome.skipped.length
              ? `；保留你已填的：${outcome.skipped.slice(0, 3).join('、')}${outcome.skipped.length > 3 ? '…' : ''}`
              : '')
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'AI 分析失败';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 px-4 py-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" />
          <span className="text-xs text-[#424245]">
            AI 起草：读取已加载的数据生成结论，<b>只填空字段，不覆盖你已填的内容</b>
          </span>
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || disabled}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:pointer-events-none"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {busy ? 'AI 分析中…' : 'AI 生成 / 重跑这一步'}
        </button>
      </div>
      {hint && <p className="text-[11px] text-[#86868b] mt-1.5 leading-relaxed">{hint}</p>}
      {error && (
        <p className="text-[11px] text-rose-600 mt-1.5 flex items-start gap-1.5">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
