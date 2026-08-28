import type { ReactNode } from 'react';
import { ArrowRight, CheckCircle2, Circle, AlertTriangle, Wrench } from 'lucide-react';
import { Card, cn } from '../ui/Card';

export interface FiveLookSummaryMetric {
  label: string;
  value: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'brand';
}

export interface FiveLookSummarySection {
  title: string;
  items: string[];
  emptyText: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}

const toneText: Record<NonNullable<FiveLookSummaryMetric['tone']>, string> = {
  neutral: 'text-[#424245]',
  good: 'text-emerald-600',
  warn: 'text-amber-600',
  bad: 'text-rose-600',
  brand: 'text-indigo-600',
};

const sectionIcon: Record<NonNullable<FiveLookSummarySection['tone']>, typeof CheckCircle2> = {
  neutral: Circle,
  good: CheckCircle2,
  warn: AlertTriangle,
  bad: AlertTriangle,
};

const sectionIconCls: Record<NonNullable<FiveLookSummarySection['tone']>, string> = {
  neutral: 'text-[#c7c7cc]',
  good: 'text-emerald-500',
  warn: 'text-amber-500',
  bad: 'text-rose-500',
};

export function FiveLookSummaryShell({
  eyebrow,
  title,
  judgement,
  description,
  statusBadge,
  metrics,
  sections,
  nextAction,
  toolAction,
  children,
}: {
  eyebrow: string;
  title: string;
  judgement: string;
  description: string;
  statusBadge?: ReactNode;
  metrics?: FiveLookSummaryMetric[];
  sections: FiveLookSummarySection[];
  nextAction?: {
    label: string;
    description: string;
    onClick?: () => void;
  };
  toolAction?: {
    label: string;
    onClick: () => void;
  };
  children?: ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-indigo-600 uppercase tracking-normal">{eyebrow}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-bold text-[#1d1d1f]">{title}</h3>
              {statusBadge}
            </div>
            <p className="mt-2 text-base font-semibold text-[#1d1d1f] leading-snug">{judgement}</p>
            <p className="mt-1.5 text-sm text-[#86868b] leading-relaxed max-w-3xl">{description}</p>
          </div>

          <div className="flex flex-wrap gap-2 lg:justify-end shrink-0">
            {toolAction && (
              <button
                type="button"
                onClick={toolAction.onClick}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-black/8 bg-white text-xs font-semibold text-[#424245] hover:text-indigo-600 hover:border-indigo-200 transition-all active:scale-[0.98]"
              >
                <Wrench className="w-3.5 h-3.5" />
                {toolAction.label}
              </button>
            )}
            {nextAction && (
              <button
                type="button"
                onClick={nextAction.onClick}
                disabled={!nextAction.onClick}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-xs font-semibold hover:from-indigo-600 hover:to-violet-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
              >
                {nextAction.label}
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {metrics && metrics.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {metrics.map((m) => (
              <div key={m.label} className="rounded-2xl border border-black/5 bg-[#fafafa] px-3 py-3">
                <p className="text-[11px] text-[#86868b]">{m.label}</p>
                <p className={cn('mt-1 text-sm font-bold tabular-nums', toneText[m.tone ?? 'neutral'])}>{m.value}</p>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {sections.map((section) => {
            const tone = section.tone ?? 'neutral';
            const Icon = sectionIcon[tone];
            const items = section.items.map((item) => item.trim()).filter(Boolean);
            return (
              <div key={section.title} className="rounded-2xl border border-black/5 bg-white p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Icon className={cn('w-4 h-4 shrink-0', sectionIconCls[tone])} />
                  <p className="text-sm font-semibold text-[#1d1d1f]">{section.title}</p>
                </div>
                {items.length === 0 ? (
                  <p className="text-sm text-[#aeaeb2] leading-relaxed">{section.emptyText}</p>
                ) : (
                  <ul className="space-y-2">
                    {items.slice(0, 4).map((item, index) => (
                      <li key={`${item}-${index}`} className="flex items-start gap-2 text-sm text-[#424245] leading-relaxed">
                        <span className="mt-2 w-1 h-1 rounded-full bg-[#c7c7cc] shrink-0" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        {nextAction && (
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 px-4 py-3">
            <p className="text-xs font-semibold text-indigo-700">推荐下一步</p>
            <p className="mt-1 text-sm text-indigo-900/80 leading-relaxed">{nextAction.description}</p>
          </div>
        )}

        {children}
      </div>
    </Card>
  );
}
