import type { ReactNode } from 'react';
import { CheckCircle2, Circle, AlertTriangle, Wrench } from 'lucide-react';
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

export interface FiveLookBoardColumn {
  title: string;
  subtitle?: string;
  items: string[];
  emptyText: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'brand';
}

export interface FiveLookFlowStep {
  label: string;
  value: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'brand';
}

export interface FiveLookBarItem {
  label: string;
  value: number;
  detail?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'brand';
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

const boardTone: Record<NonNullable<FiveLookBoardColumn['tone']>, string> = {
  neutral: 'border-black/5 bg-white',
  good: 'border-emerald-100 bg-emerald-50/50',
  warn: 'border-amber-100 bg-amber-50/50',
  bad: 'border-rose-100 bg-rose-50/50',
  brand: 'border-indigo-100 bg-indigo-50/50',
};

const chipTone: Record<NonNullable<FiveLookFlowStep['tone']>, string> = {
  neutral: 'border-black/8 bg-white text-[#424245]',
  good: 'border-emerald-100 bg-emerald-50 text-emerald-700',
  warn: 'border-amber-100 bg-amber-50 text-amber-700',
  bad: 'border-rose-100 bg-rose-50 text-rose-700',
  brand: 'border-indigo-100 bg-indigo-50 text-indigo-700',
};

export function FiveLookSummaryShell({
  eyebrow,
  title,
  judgement,
  description,
  statusBadge,
  metrics,
  sections,
  visual,
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
  visual?: ReactNode;
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

        {visual && (
          <div className="rounded-[24px] border border-black/5 bg-[#f8f9fb] p-3 sm:p-4">
            {visual}
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

        {children}
      </div>
    </Card>
  );
}

export function FiveLookPresentationBoard({
  title,
  subtitle,
  columns,
}: {
  title: string;
  subtitle?: string;
  columns: FiveLookBoardColumn[];
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-[#1d1d1f]">{title}</p>
          {subtitle && <p className="mt-0.5 text-xs text-[#86868b]">{subtitle}</p>}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {columns.map((column) => {
          const items = column.items.map((item) => item.trim()).filter(Boolean);
          return (
            <div key={column.title} className={cn('rounded-2xl border p-4 min-h-[150px]', boardTone[column.tone ?? 'neutral'])}>
              <p className="text-sm font-semibold text-[#1d1d1f]">{column.title}</p>
              {column.subtitle && <p className="mt-0.5 text-[11px] text-[#86868b]">{column.subtitle}</p>}
              <div className="mt-3 space-y-2">
                {items.length === 0 ? (
                  <p className="text-sm text-[#aeaeb2] leading-relaxed">{column.emptyText}</p>
                ) : (
                  items.slice(0, 4).map((item, index) => (
                    <div key={`${item}-${index}`} className="rounded-xl bg-white/75 border border-white/80 px-3 py-2 text-sm text-[#424245] leading-relaxed shadow-sm">
                      {item}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function FiveLookSignalFlow({
  title,
  steps,
}: {
  title: string;
  steps: FiveLookFlowStep[];
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-[#86868b]">{title}</p>
      <div className="flex flex-col md:flex-row gap-2">
        {steps.map((step, index) => (
          <div key={`${step.label}-${index}`} className="flex-1 min-w-0">
            <div className={cn('h-full rounded-2xl border px-3 py-3', chipTone[step.tone ?? 'neutral'])}>
              <p className="text-[11px] font-semibold opacity-80">{step.label}</p>
              <p className="mt-1 text-sm font-semibold leading-snug truncate">{step.value || '待补充'}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FiveLookQuadrantBoard({
  title,
  xLeft,
  xRight,
  yTop,
  yBottom,
  focusLabel,
  items,
}: {
  title: string;
  xLeft: string;
  xRight: string;
  yTop: string;
  yBottom: string;
  focusLabel: string;
  items: { label: string; meta?: string; tone?: 'good' | 'warn' | 'bad' | 'brand' }[];
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-bold text-[#1d1d1f]">{title}</p>
      <div className="grid grid-cols-[auto_1fr] gap-2 items-stretch">
        <div className="flex flex-col items-center justify-between py-2 text-[11px] text-[#86868b]">
          <span>{yTop}</span>
          <span className="[writing-mode:vertical-rl] rotate-180">需求强度</span>
          <span>{yBottom}</span>
        </div>
        <div className="relative min-h-[220px] rounded-2xl border border-black/5 bg-white overflow-hidden">
          <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
            <div className="border-r border-b border-black/5 bg-emerald-50/55" />
            <div className="border-b border-black/5 bg-amber-50/55" />
            <div className="border-r border-black/5 bg-[#f5f5f7]" />
            <div className="bg-rose-50/45" />
          </div>
          <div className="absolute left-4 top-4 text-xs font-semibold text-emerald-700">{focusLabel}</div>
          <div className="relative z-10 grid grid-cols-1 sm:grid-cols-2 gap-2 p-4 pt-10">
            {items.length === 0 ? (
              <p className="text-sm text-[#aeaeb2]">暂无细分评分，先到市场工具补数据。</p>
            ) : (
              items.slice(0, 4).map((item, index) => (
                <div key={`${item.label}-${index}`} className={cn('rounded-xl border bg-white/90 px-3 py-2 shadow-sm', chipTone[item.tone ?? 'brand'])}>
                  <p className="text-sm font-semibold truncate">{item.label}</p>
                  {item.meta && <p className="mt-0.5 text-[11px] opacity-75">{item.meta}</p>}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      <div className="flex justify-between px-8 text-[11px] text-[#86868b]">
        <span>{xLeft}</span>
        <span>{xRight}</span>
      </div>
    </div>
  );
}

export function FiveLookBarList({ title, items }: { title: string; items: FiveLookBarItem[] }) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-bold text-[#1d1d1f]">{title}</p>
      <div className="rounded-2xl border border-black/5 bg-white p-4 space-y-3">
        {items.map((item) => (
          <div key={item.label}>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-semibold text-[#424245]">{item.label}</span>
              <span className={cn('font-semibold', toneText[item.tone ?? 'neutral'])}>{item.detail ?? `${item.value}%`}</span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-[#f5f5f7] overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full',
                  item.tone === 'good' ? 'bg-emerald-500' : item.tone === 'warn' ? 'bg-amber-500' : item.tone === 'bad' ? 'bg-rose-500' : 'bg-indigo-500'
                )}
                style={{ width: `${Math.max(0, Math.min(100, item.value))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
