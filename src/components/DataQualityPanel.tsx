import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Database, Info } from 'lucide-react';
import type { MarketDataQuality } from '../utils/dataQuality';

const STYLE = {
  good: { text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-100', icon: CheckCircle2 },
  warn: { text: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-100', icon: AlertTriangle },
  bad: { text: 'text-rose-700', bg: 'bg-rose-50', border: 'border-rose-100', icon: AlertTriangle },
} as const;

export function DataQualityPanel({ quality }: { quality: MarketDataQuality }) {
  const [open, setOpen] = useState(false);
  const overall = quality.score >= 80 ? STYLE.good : quality.score >= 60 ? STYLE.warn : STYLE.bad;
  const OverallIcon = overall.icon;

  return (
    <div className={`rounded-2xl border ${overall.border} ${overall.bg} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-5 py-3 flex items-center justify-between gap-4 text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-9 h-9 rounded-xl bg-white/80 flex items-center justify-center ${overall.text}`}>
            <OverallIcon className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-[#1d1d1f]">数据质量审计</span>
              <span className={`text-xs font-semibold ${overall.text}`}>{quality.score} 分</span>
              <span className="text-xs text-[#86868b]">{quality.summary}</span>
            </div>
            {quality.issues[0] && (
              <p className={`text-xs mt-0.5 ${overall.text} truncate`}>{quality.issues[0].message}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="hidden sm:inline text-[11px] text-[#86868b]">
            {quality.issues.length ? `${quality.issues.length} 个注意项` : '无明显缺口'}
          </span>
          {open ? <ChevronUp className="w-4 h-4 text-[#86868b]" /> : <ChevronDown className="w-4 h-4 text-[#86868b]" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-black/5 bg-white/70 px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {quality.metrics.map((m) => {
              const s = STYLE[m.level];
              const Icon = s.icon;
              return (
                <div key={m.label} className={`rounded-xl border ${s.border} bg-white p-3`}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[11px] text-[#86868b]">{m.label}</span>
                    <Icon className={`w-3.5 h-3.5 ${s.text}`} />
                  </div>
                  <div className={`text-lg font-bold ${s.text}`}>{m.value}</div>
                  <div className="text-[10px] text-[#86868b] mt-0.5">{m.note}</div>
                </div>
              );
            })}
          </div>

          <div className="rounded-xl bg-[#f8f9fb] border border-black/5 p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#1d1d1f] mb-2">
              <Database className="w-3.5 h-3.5 text-indigo-500" />
              对洞察的影响
            </div>
            {quality.issues.length ? (
              <ul className="space-y-1.5">
                {quality.issues.map((issue, i) => (
                  <li key={`${issue.message}-${i}`} className="flex items-start gap-2 text-xs text-[#424245]">
                    <AlertTriangle className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${issue.level === 'bad' ? 'text-rose-500' : 'text-amber-500'}`} />
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex items-start gap-2 text-xs text-[#424245]">
                <Info className="w-3.5 h-3.5 mt-0.5 text-emerald-500 shrink-0" />
                <span>关键字段覆盖较好，评分和 AI 报告可以作为主要决策参考。</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
