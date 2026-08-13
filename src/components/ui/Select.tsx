import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from './Card';

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type SelectGroup = {
  label: string;
  options: SelectOption[];
};

type SelectSize = 'sm' | 'md';

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options?: SelectOption[];
  groups?: SelectGroup[];
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  size?: SelectSize;
  disabled?: boolean;
  /** 紧凑嵌入工具栏时用 */
  variant?: 'default' | 'ghost' | 'soft';
  'aria-label'?: string;
}

function flatten(options?: SelectOption[], groups?: SelectGroup[]): SelectOption[] {
  const list = [...(options || [])];
  (groups || []).forEach((g) => list.push(...g.options));
  return list;
}

/**
 * 自定义下拉：统一圆角、阴影、靛蓝选中态，避免系统原生 select 的「素白方框」。
 */
export function Select({
  value,
  onChange,
  options,
  groups,
  placeholder = '请选择',
  className,
  triggerClassName,
  size = 'sm',
  disabled = false,
  variant = 'soft',
  'aria-label': ariaLabel,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const listId = useId();
  const flat = useMemo(() => flatten(options, groups), [options, groups]);
  const selected = flat.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const maxH = Math.min(320, window.innerHeight - rect.bottom - 12);
    const openUp = maxH < 160 && rect.top > 200;
    setMenuStyle({
      position: 'fixed',
      left: rect.left,
      width: Math.max(rect.width, 160),
      zIndex: 80,
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + 6, maxHeight: Math.min(320, rect.top - 12) }
        : { top: rect.bottom + 6, maxHeight: Math.max(120, maxH) }),
    });
  }, [open]);

  const sizeCls = size === 'md' ? 'text-sm px-3.5 py-2.5' : 'text-xs px-3 py-1.5';
  const variantCls =
    variant === 'ghost'
      ? 'bg-transparent border-transparent shadow-none hover:bg-black/[0.03]'
      : variant === 'default'
        ? 'bg-white border-black/10 shadow-sm'
        : 'bg-gradient-to-b from-white to-[#f8f9fb] border-black/[0.07] shadow-[0_1px_2px_rgba(0,0,0,0.04)]';

  const renderItem = (opt: SelectOption) => {
    const active = opt.value === value;
    return (
      <button
        key={opt.value}
        type="button"
        disabled={opt.disabled}
        role="option"
        aria-selected={active}
        onClick={() => {
          if (opt.disabled) return;
          onChange(opt.value);
          setOpen(false);
        }}
        className={cn(
          'w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-[13px] transition-colors rounded-xl',
          opt.disabled && 'opacity-40 cursor-not-allowed',
          active
            ? 'bg-indigo-50 text-indigo-700 font-semibold'
            : 'text-[#1d1d1f] hover:bg-[#f5f5f7]'
        )}
      >
        <span className="truncate">{opt.label}</span>
        {active && <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
      </button>
    );
  };

  return (
    <div ref={rootRef} className={cn('relative inline-block min-w-0', className)}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={cn(
          'group w-full inline-flex items-center justify-between gap-2 rounded-xl border font-medium text-[#1d1d1f]',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30 focus-visible:border-indigo-300',
          'disabled:opacity-50 disabled:cursor-not-allowed transition-all',
          sizeCls,
          variantCls,
          open && 'border-indigo-300 ring-2 ring-indigo-500/15',
          triggerClassName
        )}
      >
        <span className={cn('truncate', !selected && 'text-[#aeaeb2]')}>
          {selected?.label || placeholder}
        </span>
        <ChevronDown
          className={cn(
            'w-3.5 h-3.5 text-[#86868b] shrink-0 transition-transform duration-200',
            open && 'rotate-180 text-indigo-500'
          )}
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={listId}
            role="listbox"
            style={menuStyle}
            className="overflow-auto rounded-2xl border border-black/8 bg-white/95 backdrop-blur-xl p-1.5 shadow-[0_12px_40px_rgba(15,23,42,0.14)] animate-in fade-in zoom-in-95 duration-150"
          >
            {groups?.map((g) => (
              <div key={g.label} className="mb-1 last:mb-0">
                <div className="px-2.5 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#aeaeb2]">
                  {g.label}
                </div>
                {g.options.map(renderItem)}
              </div>
            ))}
            {(options || []).map(renderItem)}
            {!flat.length && (
              <div className="px-3 py-4 text-center text-xs text-[#aeaeb2]">暂无选项</div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}

/** 多选：芯片式开关，适合「选哪些细分进图」 */
export function MultiSelectChips({
  options,
  value,
  onChange,
  className,
}: {
  options: SelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  className?: string;
}) {
  const set = new Set(value);
  const toggle = (v: string) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange([...next]);
  };

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {options.map((opt) => {
        const on = set.has(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => toggle(opt.value)}
            className={cn(
              'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all',
              on
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-200'
                : 'bg-white text-[#86868b] border-black/8 hover:border-indigo-200 hover:text-indigo-600'
            )}
          >
            {on && <Check className="w-3 h-3" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
