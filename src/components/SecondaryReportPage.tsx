import React from 'react';
import { X, Loader2 } from 'lucide-react';

interface SecondaryReportPageProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  onClose: () => void;
  onRegenerate?: () => void;
  regenerating?: boolean;
  children: React.ReactNode;
  /** 顶部右侧额外操作 */
  extraActions?: React.ReactNode;
}

/**
 * 白/紫风格独立阅读页（非悬浮弹层）：铺满主工作区视觉，无背景虚化。
 */
export function SecondaryReportPage({
  title,
  subtitle,
  icon,
  onClose,
  onRegenerate,
  regenerating,
  children,
  extraActions,
}: SecondaryReportPageProps) {
  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-[#f7f5ff]">
      <header className="shrink-0 border-b border-indigo-100/80 bg-white px-5 sm:px-8 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {icon ? (
              <div className="shrink-0 w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shadow-sm shadow-indigo-200">
                {icon}
              </div>
            ) : null}
            <div className="min-w-0">
              <h2 className="text-[20px] sm:text-[22px] font-semibold tracking-tight text-[#1d1d1f] truncate">
                {title}
              </h2>
              {subtitle ? <p className="text-xs text-[#86868b] mt-0.5 truncate">{subtitle}</p> : null}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {extraActions}
            {onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                disabled={regenerating}
                className="px-3 py-2 rounded-full border border-indigo-100 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
              >
                {regenerating ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> 生成中
                  </span>
                ) : (
                  '重新生成'
                )}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 shadow-sm shadow-indigo-200"
            >
              <X className="w-4 h-4" />
              关闭
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8 sm:py-10">
          <article className="bg-white rounded-[28px] border border-indigo-50 shadow-[0_20px_50px_-28px_rgba(79,70,229,0.35)] px-6 sm:px-10 py-8 sm:py-11">
            {children}
          </article>
        </div>
      </div>
    </div>
  );
}
