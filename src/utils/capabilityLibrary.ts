// M3⑤ · 账号级能力库（PRD §6.4-1）。**V3 起：这里的条目是"推导 + 人工覆盖"的解析结果，不再是一张手填的四态表。**
//
// 演变（用户诉求："有了背景信息，还要我确认 20 项四态，很奇怪"）：
// - V2：20 个能力项，每项手点"已具备/部分具备/不具备/待确认"（相当于又一张 20 题的卷子）；
// - V3：20+ 项由**背景信息确定性推导**（见 capabilityDerivation.ts），用户只需要在需要时**逐条覆盖**；
//   本文件只负责：① 能力项词表（下游用它做前置资源缺口/硬约束）；② 覆盖的存取；
//   ③ 硬约束候选（财务红线 / 合规 / MOQ 里"不具备"的项 → 关联机会不能"直接进入"）。
//
// 存储：账号级（跨项目复用），按 userId 存 localStorage（与 userBackground 同构，便于后续一起迁移）。
// 完整度不再在这里算：背景信息完整度在 userBackground.computeBackgroundCompleteness（口径唯一）。

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

/**
 * 能力项词表（§6.4 六维度口径）。
 * V3 新增 `product_def` / `rnd` / `ads` / `after_sales`：背景信息里本来就有这四项能力输入，
 * 不给它们词汇就只能挂在"团队"这个黑盒里，前置资源缺口会说不清缺什么。
 */
export const CAPABILITY_ITEMS: { dimension: CapabilityDimension; key: string; label: string; hint?: string }[] = [
  { dimension: 'funding', key: 'startup_capital', label: '启动资金', hint: '能投入这个品类的现金规模' },
  { dimension: 'funding', key: 'ad_budget', label: '广告预算', hint: '验证期每月的广告投入上限' },
  { dimension: 'funding', key: 'loss_tolerance', label: '可承受亏损周期', hint: '能扛几个月不赚钱' },
  { dimension: 'supply', key: 'factory', label: '工厂资源', hint: '是否已有可用的合作工厂' },
  { dimension: 'supply', key: 'moq', label: 'MOQ', hint: '最小起订量是否在预算内' },
  { dimension: 'supply', key: 'payment_terms', label: '账期', hint: '是否有账期支持现金流' },
  { dimension: 'supply', key: 'lead_time', label: '交付周期', hint: '从下单到可发货的天数' },
  { dimension: 'category_team', key: 'category_exp', label: '类目经验', hint: '是否做过这个类目' },
  { dimension: 'category_team', key: 'product_def', label: '产品定义', hint: '能不能把需求翻译成产品方案' },
  { dimension: 'category_team', key: 'rnd', label: '研发设计', hint: '能不能做结构/功能实现' },
  { dimension: 'category_team', key: 'design', label: '设计能力', hint: '是否能做图/A+/视觉差异化' },
  { dimension: 'category_team', key: 'ads', label: '广告能力', hint: '能不能自己投广告并控 ACOS' },
  { dimension: 'category_team', key: 'ops', label: '运营能力', hint: '是否能自己操盘 Listing/广告' },
  { dimension: 'category_team', key: 'after_sales', label: '售后能力', hint: '差评/退货/客服是否有人接' },
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

export const CAPABILITY_ITEM_KEYS: string[] = CAPABILITY_ITEMS.map((i) => i.key);

export interface CapabilityEntry {
  status: SelfStatus;
  note?: string;
  /**
   * 结论来源：`manual` = 用户逐条覆盖（必须显式标记；**AI 不得改写**）；
   * `derived` = 由背景信息推导（解析结果里会带上）。
   */
  source?: 'manual' | 'derived';
  /** 推导规则编号（可复核） */
  ruleId?: string;
  /** 这条是怎么推出来的 / 被覆盖成了什么 */
  reason?: string;
}

export interface CapabilityLibrary {
  /** key → 结论；这里的 entries 是**解析结果**（推导 + 覆盖），缺 key 视为"背景信息判断不了" */
  entries: Record<string, CapabilityEntry>;
  updatedAt: string;
}

export const ENTRY_STATUSES: SelfStatus[] = ['have', 'partial', 'lack', 'unknown'];

export function defaultCapabilityLibrary(): CapabilityLibrary {
  return { entries: {}, updatedAt: '' };
}

const KEY_PREFIX = 'kairo_capability_library:';

function storageKey(userId: string): string {
  return `${KEY_PREFIX}${userId || 'anonymous'}`;
}

/**
 * 读取持久化的**人工覆盖**（V2 时代手填的条目不丢：它们会被当成用户显式覆盖保留下来）。
 * 状态非法的条目丢弃（不猜用户意图）。
 */
export function loadCapabilityLibrary(userId: string): CapabilityLibrary {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return defaultCapabilityLibrary();
    const parsed = JSON.parse(raw) as Partial<CapabilityLibrary>;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.entries !== 'object' || parsed.entries === null) {
      return defaultCapabilityLibrary();
    }
    const entries: Record<string, CapabilityEntry> = {};
    for (const [k, v] of Object.entries(parsed.entries as Record<string, CapabilityEntry>)) {
      if (!v || !ENTRY_STATUSES.includes(v.status)) continue;
      if (v.status === 'unknown') continue; // "待确认"不是覆盖，等于没覆盖
      entries[k] = {
        status: v.status,
        note: typeof v.note === 'string' ? v.note : undefined,
        source: 'manual',
        ruleId: v.ruleId,
        reason: v.reason,
      };
    }
    return { entries, updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '' };
  } catch {
    return defaultCapabilityLibrary();
  }
}

export function saveCapabilityLibrary(userId: string, lib: CapabilityLibrary): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify({ ...lib, updatedAt: new Date().toISOString() }));
  } catch {
    /* 存不进去就算了：能力覆盖不是关键路径，不能因此挡住分析 */
  }
}

/** 逐条覆盖（显式标记 manual；传 'unknown' 等价于取消覆盖） */
export function setCapabilityEntry(
  lib: CapabilityLibrary,
  key: string,
  status: SelfStatus,
  note?: string
): CapabilityLibrary {
  const entries = { ...lib.entries };
  if (status === 'unknown') {
    delete entries[key];
  } else {
    entries[key] = { status, note, source: 'manual', reason: `用户逐条覆盖为「${SELF_STATUS_LABELS[status]}」` };
  }
  return { ...lib, entries, updatedAt: new Date().toISOString() };
}

/** 取消某一条的人工覆盖，回到"由背景信息推导" */
export function clearCapabilityOverride(lib: CapabilityLibrary, key: string): CapabilityLibrary {
  const entries = { ...lib.entries };
  delete entries[key];
  return { ...lib, entries, updatedAt: new Date().toISOString() };
}

export function manualOverrideCount(lib: CapabilityLibrary | undefined): number {
  return Object.values(lib?.entries ?? {}).filter((e) => e.source === 'manual').length;
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

/** 警戒（不是否决）：同一条边界上"部分具备"的项（例：认证只有 CE，美国站可能要 FCC） */
export function capabilityBoundaryWarnings(lib: CapabilityLibrary | undefined): string[] {
  const entries = lib?.entries ?? {};
  const out: string[] = [];
  for (const item of CAPABILITY_ITEMS) {
    const e = entries[item.key];
    if (!e) continue;
    const isBoundary = item.dimension === 'finance' || item.dimension === 'compliance' || item.key === 'moq';
    if (isBoundary && e.status === 'partial') {
      out.push(`${CAPABILITY_DIMENSION_LABELS[item.dimension]}「${item.label}」仅部分具备${e.note ? `（${e.note}）` : ''}`);
    }
  }
  return out;
}

/** 状态标签（复用看自己的四态文案，保证全站口径一致） */
export const CAPABILITY_STATUS_LABELS = SELF_STATUS_LABELS;
