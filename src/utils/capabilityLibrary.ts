// M3⑤ · 账号级「背景库」（PRD §6.4-1）。
//
// 设计要点（针对两个缺陷："42 题太重" 与 "适配度=完成度"）：
// 1. 六维度全量保留，但**每项都是四态 + 备注**（已具备/部分具备/不具备/待确认），不强迫一次填完；
// 2. 只做"渐进完善"：随时能补，完整度随时可见，缺项只影响**可信度**，不阻塞流程；
// 3. 完整度（填了多少）与适配度（答得多好）**彻底分离**：这里只算完整度。
//
// 存储：账号级（跨项目复用），按 userId 存 localStorage（与 userBackground 同构，便于后续一起迁移）。

import { SELF_STATUS_LABELS, type SelfStatus } from './selfAssessment';

export type CapabilityDimension =
  | 'funding'
  | 'supply'
  | 'category_team'
  | 'compliance'
  | 'finance'
  | 'risk';

export const CAPABILITY_DIMENSION_ORDER: CapabilityDimension[] = [
  'funding',
  'supply',
  'category_team',
  'compliance',
  'finance',
  'risk',
];

export const CAPABILITY_DIMENSION_LABELS: Record<CapabilityDimension, string> = {
  funding: '资金与预算',
  supply: '供应链',
  category_team: '类目经验与团队',
  compliance: '合规资质',
  finance: '目标财务',
  risk: '风险偏好',
};

/** 每维度的项目清单（§6.4 原文口径；保持精简，避免又变成"42 题太重"） */
export const CAPABILITY_ITEMS: { dimension: CapabilityDimension; key: string; label: string; hint?: string }[] = [
  { dimension: 'funding', key: 'startup_capital', label: '启动资金', hint: '能投入这个品类的现金规模' },
  { dimension: 'funding', key: 'ad_budget', label: '广告预算', hint: '验证期每月的广告投入上限' },
  { dimension: 'funding', key: 'loss_tolerance', label: '可承受亏损周期', hint: '能扛几个月不赚钱' },
  { dimension: 'supply', key: 'factory', label: '工厂资源', hint: '是否已有可用的合作工厂' },
  { dimension: 'supply', key: 'moq', label: 'MOQ', hint: '最小起订量是否在预算内' },
  { dimension: 'supply', key: 'payment_terms', label: '账期', hint: '是否有账期支持现金流' },
  { dimension: 'supply', key: 'lead_time', label: '交付周期', hint: '从下单到可发货的天数' },
  { dimension: 'category_team', key: 'category_exp', label: '类目经验', hint: '是否做过这个类目' },
  { dimension: 'category_team', key: 'ops', label: '运营能力', hint: '是否能自己操盘 Listing/广告' },
  { dimension: 'category_team', key: 'design', label: '设计能力', hint: '是否能做图/A+/视觉差异化' },
  { dimension: 'compliance', key: 'certification', label: '认证', hint: '目标站点要求的认证是否齐备' },
  { dimension: 'compliance', key: 'trademark', label: '商标', hint: '是否已注册商标/能否授权' },
  { dimension: 'compliance', key: 'patent', label: '专利风险', hint: '目标卖点是否可能踩专利' },
  { dimension: 'compliance', key: 'category_access', label: '品类准入', hint: '是否需要类目审核/资质' },
  { dimension: 'finance', key: 'target_price', label: '目标售价' },
  { dimension: 'finance', key: 'gross_margin', label: '目标毛利率' },
  { dimension: 'finance', key: 'net_margin_floor', label: '净利率红线', hint: '低于这条就不做' },
  { dimension: 'finance', key: 'payback', label: '回本周期', hint: '能接受的回本时间' },
  { dimension: 'risk', key: 'validation_length', label: '验证期长度', hint: '愿意花多久验证' },
  { dimension: 'risk', key: 'inventory_risk', label: '库存风险承受', hint: '能否承受一批货压手里' },
];

export interface CapabilityEntry {
  status: SelfStatus;
  note?: string;
}

export interface CapabilityLibrary {
  /** key → 四态 + 备注；缺 key 视为未填（不是"不具备"） */
  entries: Record<string, CapabilityEntry>;
  updatedAt: string;
}

export const ENTRY_STATUSES: SelfStatus[] = ['have', 'partial', 'lack', 'unknown'];

export function defaultCapabilityLibrary(): CapabilityLibrary {
  return { entries: {}, updatedAt: new Date().toISOString() };
}

const KEY_PREFIX = 'kairo_capability_library:';

function storageKey(userId: string): string {
  return `${KEY_PREFIX}${userId || 'anonymous'}`;
}

export function loadCapabilityLibrary(userId: string): CapabilityLibrary {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return defaultCapabilityLibrary();
    const parsed = JSON.parse(raw) as Partial<CapabilityLibrary>;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.entries !== 'object' || parsed.entries === null) {
      return defaultCapabilityLibrary();
    }
    // 归一化：状态非法的条目丢弃（不猜用户意图）
    const entries: Record<string, CapabilityEntry> = {};
    for (const [k, v] of Object.entries(parsed.entries as Record<string, CapabilityEntry>)) {
      if (!v || !ENTRY_STATUSES.includes(v.status)) continue;
      entries[k] = { status: v.status, note: typeof v.note === 'string' ? v.note : undefined };
    }
    return { entries, updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString() };
  } catch {
    return defaultCapabilityLibrary();
  }
}

export function saveCapabilityLibrary(userId: string, lib: CapabilityLibrary): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify({ ...lib, updatedAt: new Date().toISOString() }));
  } catch {
    /* 存不进去就算了：背景库不是关键路径，不能因此挡住分析 */
  }
}

export function setCapabilityEntry(
  lib: CapabilityLibrary,
  key: string,
  status: SelfStatus,
  note?: string
): CapabilityLibrary {
  return { ...lib, entries: { ...lib.entries, [key]: { status, note } }, updatedAt: new Date().toISOString() };
}

export interface CompletenessReport {
  /** 已明确（have/partial/lack）的条目数 */
  filled: number;
  /** "待确认"的条目数（不算填好） */
  unknown: number;
  total: number;
  /** 0-1：filled / total。**这是完整度，不是适配度** */
  completeness: number;
  byDimension: Record<CapabilityDimension, { filled: number; total: number }>;
  /** 还没填的条目（告诉用户"补这些能提升可信度"） */
  emptyItems: { key: string; label: string; dimension: CapabilityDimension }[];
}

/**
 * 完整度（确定性）：
 * - have/partial/lack 都算"已明确"；
 * - unknown（待确认）算**未完成**——它降低可信度而不是提供信息；
 * - 没填的条目同样算未完成，并在 emptyItems 里列出来（渐进完善的入口）。
 */
export function computeCompleteness(lib: CapabilityLibrary | undefined): CompletenessReport {
  const entries = lib?.entries ?? {};
  const byDimension = {} as Record<CapabilityDimension, { filled: number; total: number }>;
  for (const d of CAPABILITY_DIMENSION_ORDER) byDimension[d] = { filled: 0, total: 0 };

  let filled = 0;
  let unknown = 0;
  const emptyItems: CompletenessReport['emptyItems'] = [];

  for (const item of CAPABILITY_ITEMS) {
    byDimension[item.dimension].total += 1;
    const e = entries[item.key];
    if (!e) {
      emptyItems.push({ key: item.key, label: item.label, dimension: item.dimension });
      continue;
    }
    if (e.status === 'unknown') {
      unknown += 1;
      emptyItems.push({ key: item.key, label: item.label, dimension: item.dimension });
      continue;
    }
    filled += 1;
    byDimension[item.dimension].filled += 1;
  }

  const total = CAPABILITY_ITEMS.length;
  return {
    filled,
    unknown,
    total,
    completeness: total > 0 ? Math.round((filled / total) * 1000) / 1000 : 0,
    byDimension,
    emptyItems,
  };
}

/** 完整度人话（进项目时提示用；明确说清"影响的是可信度，不阻塞流程"） */
export function describeCompleteness(report: CompletenessReport): string {
  const pct = Math.round(report.completeness * 100);
  if (report.filled === 0) return `背景库完整度 ${pct}%：还没填（会降低适配度可信度，但不阻塞分析）`;
  if (report.completeness >= 0.8) return `背景库完整度 ${pct}%：已足够可信`;
  return `背景库完整度 ${pct}%（已明确 ${report.filled}/${report.total}${report.unknown > 0 ? `，待确认 ${report.unknown}` : ''}）：将影响适配度可信度，可随时补`;
}

/** 六维度里"最拖后腿"的维度（补齐优先级建议） */
export function weakestDimension(report: CompletenessReport): { dimension: CapabilityDimension; empty: number } | null {
  let worst: { dimension: CapabilityDimension; empty: number } | null = null;
  for (const d of CAPABILITY_DIMENSION_ORDER) {
    const empty = report.byDimension[d].total - report.byDimension[d].filled;
    if (empty <= 0) continue;
    if (!worst || empty > worst.empty) worst = { dimension: d, empty };
  }
  return worst;
}

/** 硬约束候选：财务红线与合规资质里"不具备"的项（供赢的路径/机会卡红条引用） */
export function capabilityHardConstraints(lib: CapabilityLibrary | undefined): string[] {
  const entries = lib?.entries ?? {};
  const out: string[] = [];
  for (const item of CAPABILITY_ITEMS) {
    const e = entries[item.key];
    if (!e) continue;
    const isBoundary = item.dimension === 'finance' || item.dimension === 'compliance' || item.key === 'moq';
    if (isBoundary && e.status === 'lack') {
      out.push(`${CAPABILITY_DIMENSION_LABELS[item.dimension]}「${item.label}」不具备${e.note ? `（${e.note}）` : ''}`);
    }
  }
  return out;
}

/** 状态标签（复用看自己的四态文案，保证全站口径一致） */
export const CAPABILITY_STATUS_LABELS = SELF_STATUS_LABELS;
