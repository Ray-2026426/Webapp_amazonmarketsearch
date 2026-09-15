import React, { useState } from 'react';
import { Plus, Star, Trash2, ChevronDown, ChevronUp, Maximize2, X, Layers } from 'lucide-react';
import { cn } from './ui/Card';
import { Select, MultiSelectChips } from './ui/Select';
import { L3Sheet, type L3BlockVariant, type L3SheetPageInfo } from './L3Sheet';
import {
  BRAND_GROUPS,
  MAX_BRANDS,
  MAX_BRAND_FIELD_ITEMS,
  addBrand,
  computeBrandCompleteness,
  defaultBrand,
  getBrandFieldValue,
  isBrandFieldFilled,
  normalizeBrandName,
  removeBrand,
  renameBrand,
  setBrandFieldValue,
  setDefaultBrand,
  summarizeBrand,
  type BrandField,
  type BrandProfile,
} from '../utils/brandStore';

/**
 * 品牌多值 + 品牌次级页（用户诉求：「品牌应该可以添加多个」「品牌点进去还有次级页面，可以设置品牌的相关资产和信息」）。
 *
 * 形态（沿用本项目的二级页约定，**不许复制两份实现**，由 tests/brandAssets.test.ts 守）：
 * - `BrandAssetsBlock` 一个组件，两种形态：`variant="inline"`（在设置页里就地展开）与 `variant="sheet"`（全屏二级页正文）；
 * - 全屏页复用 `L3Sheet`（同一个页壳：返回 / Escape / 四句契约），不另写一份页壳；
 * - 品牌数据由外层传入的 `brands` + `onChange` 提供（**存在背景信息里**，与设置页同一份存储）。
 *
 * 视觉沿用 indigo/白卡/圆角（docs/product-charter.md），不换皮。
 */

/** 品牌次级页的页面契约（复用 L3Sheet 的结构化页信息，页壳不认得"品牌"这个概念） */
export function brandPageInfo(brand: BrandProfile | null): L3SheetPageInfo {
  const name = brand?.name || '（未命名品牌）';
  return {
    badge: 'B',
    badgeLabel: '品牌资产页',
    look: 'self',
    title: `品牌资产与信息：${name}`,
    problem:
      '品牌不只是"一个名字"：商标状态、备案、A+、旗舰店、评分与评论量、价格带定位，决定了这个品牌能不能承接新品类、以及新品要从哪里起步。',
    entry: '设置 → 背景信息 →「品牌」列表里点某个品牌（或点它右侧的「全屏」）。',
    backTo: '返回设置 → 背景信息，保留品牌列表与滚动位置；品牌数据随背景信息一起保存。',
    depends:
      '看自己：背景信息里的品牌档案（与「看自己」读的是同一份数据，存本机浏览器、按账号隔离）；商标/备案/Listing/评分等属于人工填写的事实，不依赖 MCP。',
    deviation:
      '线框图与 PRD 原文里没有「品牌资产页」这一屏（原来只有一个"品牌名"文本框）。2026-09 用户明确要求"品牌应该可以添加多个，点进去还有次级页面，可以设置品牌的相关资产和信息"，因此本页是**按用户指示新增**的，不属于线框图编号页。',
  };
}

/** 品牌数据里"自由多值"字段（竞品品牌）的输入控件：回车/逗号添加，点 × 删除 */
function MultiTextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const name = draft.trim();
    setDraft('');
    if (!name) return;
    if (value.some((v) => v.toLowerCase() === name.toLowerCase())) return;
    if (value.length >= MAX_BRAND_FIELD_ITEMS) return;
    onChange([...value, name]);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((v) => (
        <span
          key={v}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[11px] font-semibold"
        >
          {v}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== v))} className="hover:text-rose-600">
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commit();
          }
        }}
        placeholder={placeholder ?? '输入后回车添加'}
        className="min-w-[8rem] flex-1 px-2.5 py-1 bg-[#f5f5f7] border border-black/5 rounded-xl text-[12px] focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
      />
    </div>
  );
}

function BrandFieldRow({
  brand,
  field,
  onChange,
}: {
  brand: BrandProfile;
  field: BrandField;
  onChange: (key: string, value: string | string[]) => void;
}) {
  const raw = getBrandFieldValue(brand, field.key);
  return (
    <div className={cn('space-y-1', (field.kind === 'multi' && (field.options ?? []).length > 0) && 'sm:col-span-2')}>
      <div className="flex flex-wrap items-baseline gap-1.5">
        <label className="text-xs font-semibold text-[#86868b]">{field.label}</label>
        {/* 「影响哪个判断」收进角标：默认只占一行小字，点开才展开，不平铺成长段（用户明确要求） */}
        <details className="inline-block align-baseline">
          <summary className="cursor-pointer list-none rounded-full bg-[#f5f5f7] px-1.5 py-0.5 text-[10px] font-semibold text-[#86868b] hover:text-indigo-700">
            影响
          </summary>
          <p className="mt-1 text-[11px] text-indigo-700/80 leading-relaxed">{field.affects}</p>
        </details>
      </div>
      {field.key === 'competitorBrands' ? (
        <MultiTextInput
          value={Array.isArray(raw) ? raw : []}
          onChange={(next) => onChange(field.key, next)}
          placeholder="输入竞品品牌名后回车"
        />
      ) : field.kind === 'select' ? (
        <Select
          value={String(raw ?? '')}
          onChange={(v) => onChange(field.key, v)}
          options={[{ value: '', label: '未填（可留空）' }, ...(field.options ?? [])]}
          className="w-full"
          triggerClassName="w-full"
          aria-label={field.label}
        />
      ) : field.kind === 'multi' ? (
        <MultiSelectChips
          options={field.options ?? []}
          value={Array.isArray(raw) ? raw : []}
          onChange={(next) => onChange(field.key, next)}
        />
      ) : (
        <input
          type="text"
          value={String(raw ?? '')}
          onChange={(e) => onChange(field.key, e.target.value)}
          placeholder={field.placeholder}
          className="w-full px-3 py-2 bg-[#f5f5f7] border border-black/5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
        />
      )}
    </div>
  );
}

/**
 * 品牌资产区块：**同一份实现**服务内联与全屏二级页两种形态。
 * `variant` 只影响外壳文案与密度，字段渲染逻辑一行都不重复（守卫断言 `BRAND_GROUPS.map` 只出现一次）。
 */
export function BrandAssetsBlock({
  brand,
  brands,
  onChange,
  variant = 'inline',
}: {
  brand: BrandProfile;
  /** 全量品牌列表：改品牌名时要检查重名，所以这里要拿到兄弟品牌 */
  brands: BrandProfile[];
  onChange: (next: BrandProfile[]) => void;
  variant?: L3BlockVariant;
}) {
  const sheet = variant === 'sheet';
  const report = computeBrandCompleteness(brand);
  const picked = summarizeBrand(brand);

  const setField = (key: string, value: string | string[]) => {
    if (key === 'name') {
      onChange(renameBrand(brands, brand.id, Array.isArray(value) ? value[0] ?? '' : value));
      return;
    }
    onChange(setBrandFieldValue(brands, brand.id, key, value));
  };

  return (
    <div className={cn('rounded-2xl border border-black/8 bg-white', sheet ? 'p-4' : 'p-3')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Layers className="w-4 h-4 text-indigo-600 shrink-0" />
          <p className="text-sm font-semibold text-[#1d1d1f] truncate">{brand.name || '（未命名品牌）'}</p>
          {brand.default && (
            <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-semibold text-white">默认</span>
          )}
        </div>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-semibold',
            report.fraction >= 0.8 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          )}
        >
          品牌资产完整度 {report.filled}/{report.total}
        </span>
      </div>

      {picked.length === 0 && (
        <p className="mt-1 text-[11px] text-[#86868b] leading-relaxed">
          还没填{sheet ? '这个品牌的' : '品牌的'}资产 → 下面三组按需补，留空不影响分析。
        </p>
      )}

      <div className="mt-3 space-y-3">
        {BRAND_GROUPS.map((g) => (
          <div key={g.id} className="rounded-xl border border-black/8 bg-[#fafafc] p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold text-[#1d1d1f]">{g.title}</p>
              <span className="text-[10px] text-[#86868b]">
                {g.fields.filter((f) => isBrandFieldFilled(brand, f.key)).length}/{g.fields.length} 已填
              </span>
            </div>
            <details>
              <summary className="cursor-pointer list-none text-[10px] font-semibold text-indigo-600 hover:text-indigo-800">
                这一组影响哪个判断
              </summary>
              <p className="mt-1 text-[11px] text-indigo-700/80 leading-relaxed">{g.affects}</p>
            </details>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {g.fields.map((f) => (
                <BrandFieldRow key={f.key} brand={brand} field={f} onChange={setField} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(setDefaultBrand(brands, brand.id))}
          disabled={brand.default}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all',
            brand.default
              ? 'border-black/8 bg-[#f5f5f7] text-[#aeaeb2] cursor-not-allowed'
              : 'border-indigo-100 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
          )}
        >
          <Star className="w-3.5 h-3.5" /> {brand.default ? '已是默认品牌' : '设为默认品牌'}
        </button>
        <button
          type="button"
          onClick={() => onChange(removeBrand(brands, brand.id))}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-100 bg-rose-50 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-all"
        >
          <Trash2 className="w-3.5 h-3.5" /> 删除这个品牌
        </button>
      </div>
    </div>
  );
}

/** 品牌次级页（全屏）：页壳用 L3Sheet，正文用同一个 `BrandAssetsBlock`（variant="sheet"） */
export function BrandDetailSheet({
  brand,
  brands,
  onChange,
  onClose,
}: {
  brand: BrandProfile;
  brands: BrandProfile[];
  onChange: (next: BrandProfile[]) => void;
  onClose: () => void;
}) {
  return (
    <L3Sheet page={brandPageInfo(brand)} onClose={onClose}>
      <BrandAssetsBlock brand={brand} brands={brands} onChange={onChange} variant="sheet" />
    </L3Sheet>
  );
}

/**
 * 品牌列表编辑器（背景信息里的「品牌名」字段）：添加 / 删除 / 设默认 / 点开看资产。
 * 就地展开用 `BrandAssetsBlock variant="inline"`，全屏页用 `BrandDetailSheet`（同一个区块组件）。
 */
export function BrandListEditor({
  brands,
  onChange,
  onOpenSheet,
  openBrandId,
  onToggleOpen,
}: {
  brands: BrandProfile[];
  onChange: (next: BrandProfile[]) => void;
  /** 打开全屏品牌资产页（由设置页控制，因为它要盖在整个弹窗之上） */
  onOpenSheet?: (brandId: string) => void;
  openBrandId?: string | null;
  onToggleOpen?: (brandId: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const openBrand = brands.find((b) => b.id === openBrandId) ?? null;
  const fallback = defaultBrand(brands);

  const commit = () => {
    const name = normalizeBrandName(draft);
    setDraft('');
    if (!name) return;
    if (brands.length >= MAX_BRANDS) {
      setError(`最多 ${MAX_BRANDS} 个品牌，先删掉不用的再加`);
      return;
    }
    if (brands.some((b) => b.name.toLowerCase() === name.toLowerCase())) {
      setError(`已经有「${name}」了`);
      return;
    }
    setError('');
    onChange(addBrand(brands, name).brands);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          placeholder="添加品牌名后回车（可添加多个）"
          className="min-w-[10rem] flex-1 px-3 py-2 bg-[#f5f5f7] border border-black/5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
        />
        <button
          type="button"
          onClick={commit}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-indigo-100 bg-indigo-50 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition-all active:scale-[0.98]"
        >
          <Plus className="w-3.5 h-3.5" /> 添加品牌
        </button>
      </div>
      {error && <p className="text-[11px] text-rose-600">{error}</p>}

      {brands.length === 0 ? (
        <p className="text-[11px] text-[#86868b] leading-relaxed">
          还没有品牌 → 有品牌就加上（可以加多个）；一个品牌都没填也能继续用，只是品牌相关的判断只能给"判断不了"。
        </p>
      ) : (
        <div className="space-y-1.5">
          {brands.map((b) => {
            const open = openBrandId === b.id;
            const report = computeBrandCompleteness(b);
            return (
              <div key={b.id} className="rounded-xl border border-black/8 bg-white">
                <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onToggleOpen?.(b.id)}
                    className="min-w-0 flex-1 flex items-center gap-2 text-left"
                    aria-expanded={open}
                  >
                    {open ? (
                      <ChevronUp className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-[#86868b] shrink-0" />
                    )}
                    <span className="text-sm font-semibold text-[#1d1d1f] truncate">{b.name}</span>
                    {b.default && (
                      <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-semibold text-white shrink-0">
                        默认
                      </span>
                    )}
                  </button>
                  <span className="text-[10px] text-[#86868b] shrink-0">
                    资产 {report.filled}/{report.total}
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenSheet?.(b.id)}
                    title="全屏打开品牌资产页"
                    className="inline-flex items-center gap-1 rounded-lg border border-indigo-100 bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100 transition-all shrink-0"
                  >
                    <Maximize2 className="w-3 h-3" /> 全屏
                  </button>
                  {!b.default && (
                    <button
                      type="button"
                      onClick={() => onChange(setDefaultBrand(brands, b.id))}
                      title="设为默认品牌"
                      className="inline-flex items-center gap-1 rounded-lg border border-black/8 bg-white px-2 py-1 text-[10px] font-semibold text-[#86868b] hover:text-indigo-700 hover:border-indigo-200 transition-all shrink-0"
                    >
                      <Star className="w-3 h-3" /> 设默认
                    </button>
                  )}
                </div>
                {open && (
                  <div className="px-3 pb-3">
                    <BrandAssetsBlock brand={b} brands={brands} onChange={onChange} variant="inline" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {fallback && brands.length > 1 && (
        <p className="text-[11px] text-[#86868b] leading-relaxed">
          默认品牌是「{fallback.name}」—— AI 与「看自己」在没有指定品牌时按它理解你的口径。
        </p>
      )}
    </div>
  );
}
