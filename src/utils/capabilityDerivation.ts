// 「看自己」V3 · 背景信息 → 能力推导（PRD §6.4）。
//
// 为什么要这一层（用户诉求："有了背景信息，还要我确认这么多东西，很奇怪"）：
// 背景信息（设置 → 背景信息）已经是**选择题**，它本身就足以确定大部分能力结论；
// 再让用户逐条点"已具备/部分具备/不具备/待确认"是重复劳动。于是：
//   1. 能力/资源/经验/约束这些维度**全部由背景信息推导**（本文件的规则表，确定性、可复现、无 AI 参与）；
//   2. 每条结论都能展开看到"这条是怎么推出来的"（`reason` 人话 + `ruleId` 规则编号，可复核）；
//   3. 背景信息**判断不了**的（商标/专利/类目准入/售价/毛利红线……）诚实地给 `unknown`，不猜；
//   4. 用户仍可**逐条覆盖**：覆盖存进 CapabilityLibrary（`source: 'manual'` 显式标记），
//      **覆盖优先于推导，且 AI 永远不得改写**（mergeSelfAi 只写 aiDraft，不碰 entries）。
//
// 铁律：本文件只影响**判断输入**，不影响任何评分公式（机会卡权重固定 25/25/25/15/10，PRD §8.1）。

import {
  getBackgroundMultiValue,
  getBackgroundSingleValue,
  isBackgroundFieldFilled,
  BACKGROUND_FIELDS,
  type UserBackgroundProfile,
} from './userBackground';
import {
  CAPABILITY_ITEMS,
  CAPABILITY_ITEM_KEYS,
  type CapabilityDimension,
  type CapabilityEntry,
  type CapabilityLibrary,
} from './capabilityLibrary';
import { SELF_STATUS_LABELS, type SelfStatus } from './selfAssessment';

export interface DerivedCapability {
  key: string;
  label: string;
  dimension: CapabilityDimension;
  status: SelfStatus;
  /** derived = 由背景信息推出；manual = 用户逐条覆盖（覆盖显式标记，AI 不得改） */
  source: 'derived' | 'manual';
  /** 规则编号（可复核、可测试） */
  ruleId: string;
  /** 这条是怎么推出来的（人话，含具体输入值） */
  reason: string;
  /** 用户覆盖时的备注 */
  note?: string;
}

function labelOf(key: string): string {
  return CAPABILITY_ITEMS.find((i) => i.key === key)?.label ?? key;
}

function fieldLabel(key: string): string {
  return BACKGROUND_FIELDS.find((f) => f.key === key)?.label ?? key;
}

/** 取值并给"人话标签"，供 reason 里引用具体输入 */
function pick(bg: UserBackgroundProfile | null | undefined, key: string): { value: string; label: string; filled: boolean } {
  const v = getBackgroundSingleValue(bg, key);
  const options = BACKGROUND_FIELDS.find((f) => f.key === key)?.options ?? [];
  return {
    value: v,
    label: options.find((o) => o.value === v)?.label ?? v,
    filled: isBackgroundFieldFilled(bg, key),
  };
}

function pickMulti(bg: UserBackgroundProfile | null | undefined, key: string): { values: string[]; labels: string[] } {
  const values = getBackgroundMultiValue(bg, key);
  const options = BACKGROUND_FIELDS.find((f) => f.key === key)?.options ?? [];
  return { values, labels: values.map((v) => options.find((o) => o.value === v)?.label ?? v) };
}

function unknown(key: string, ruleId: string, reason: string): { status: SelfStatus; ruleId: string; reason: string } {
  return { status: 'unknown', ruleId, reason };
}

/** 按选项值映射四态的小工具（未填 → unknown） */
function byOption(
  bg: UserBackgroundProfile | null | undefined,
  field: string,
  ruleId: string,
  table: Record<string, SelfStatus>,
  note?: string
): { status: SelfStatus; ruleId: string; reason: string } {
  const p = pick(bg, field);
  if (!p.filled) return unknown('', ruleId, `还没填「${fieldLabel(field)}」→ ${note ?? '判断不了'}`);
  const status = table[p.value];
  if (!status) return unknown('', ruleId, `「${fieldLabel(field)}」的值无法识别 → 判断不了`);
  return {
    status,
    ruleId,
    reason: `背景信息「${fieldLabel(field)}」= ${p.label}${note ? ` → ${note}` : ''}`,
  };
}

const DOWN: Record<SelfStatus, SelfStatus> = { have: 'partial', partial: 'lack', lack: 'lack', unknown: 'unknown' };

/* ────────────────────────────── 规则表（确定性） ────────────────────────────── */

type RuleResult = { status: SelfStatus; ruleId: string; reason: string };
type Rule = (bg: UserBackgroundProfile | null | undefined) => RuleResult;

/**
 * 推导规则表：**每个能力项一条规则**，规则编号即 UI 上"这条是怎么推出来的"里的 `ruleId`。
 * 覆盖度由测试断言（tests/capabilityDerivation.test.ts）：每一项都必须有规则，且规则是纯函数。
 */
export const CAPABILITY_RULES: { key: string; ruleId: string; rule: Rule }[] = [
  {
    key: 'startup_capital',
    ruleId: 'funding.from_budget',
    rule: (bg) => byOption(bg, 'budgetPerProject', 'funding.from_budget', {
      lt5w: 'lack',
      w5_20: 'partial',
      w20_100: 'have',
      g100w: 'have',
    }, '预算越小，能支撑的首批备货与验证动作越少'),
  },
  {
    key: 'ad_budget',
    ruleId: 'funding.ad_from_budget',
    rule: (bg) => byOption(bg, 'budgetPerProject', 'funding.ad_from_budget', {
      lt5w: 'lack',
      w5_20: 'partial',
      w20_100: 'have',
      g100w: 'have',
    }, '广告预算按项目可投入预算推导'),
  },
  {
    key: 'loss_tolerance',
    ruleId: 'risk.loss_tolerance_from_cycle_and_appetite',
    rule: (bg) => {
      const cycle = pick(bg, 'validationCycle');
      const risk = pick(bg, 'riskAppetite');
      if (!cycle.filled) return unknown('', 'risk.loss_tolerance_from_cycle_and_appetite', '还没填「可接受最长验证周期」→ 判断不了能扛多久不赚钱');
      let status: SelfStatus =
        cycle.value === 'lte1m' ? 'lack' : cycle.value === 'm1_3' ? 'partial' : 'have';
      const downgraded = risk.filled && risk.value === 'conservative' && status !== 'lack';
      if (downgraded) status = DOWN[status];
      return {
        status,
        ruleId: 'risk.loss_tolerance_from_cycle_and_appetite',
        reason: `背景信息「可接受最长验证周期」= ${cycle.label}${risk.filled ? `，风险偏好 = ${risk.label}${downgraded ? '（保守 → 降一档）' : ''}` : ''}`,
      };
    },
  },
  {
    key: 'factory',
    ruleId: 'supply.factory_from_supply_type',
    rule: (bg) => byOption(bg, 'supplyType', 'supply.factory_from_supply_type', {
      own_factory: 'have',
      partner_factory: 'have',
      trading: 'partial',
      no_stable: 'lack',
    }, '有没有可控的产线，决定能不能真的交付'),
  },
  {
    key: 'moq',
    ruleId: 'supply.moq_from_range',
    rule: (bg) => byOption(bg, 'moqRange', 'supply.moq_from_range', {
      lte500: 'have',
      m500_1000: 'have',
      m1000_3000: 'partial',
      gt3000: 'lack',
    }, 'MOQ 超标属于硬约束（机会不能直接进入）'),
  },
  {
    key: 'payment_terms',
    ruleId: 'supply.payment_terms_from_answer',
    rule: (bg) => byOption(bg, 'paymentTerms', 'supply.payment_terms_from_answer', {
      yes: 'have',
      partial: 'partial',
      no: 'lack',
    }, '没有账期时首批备货全额吃现金流'),
  },
  {
    key: 'lead_time',
    ruleId: 'supply.lead_time_from_range_and_supply_type',
    rule: (bg) => {
      const lead = pick(bg, 'leadTimeRange');
      const supply = pick(bg, 'supplyType');
      if (!lead.filled) return unknown('', 'supply.lead_time_from_range_and_supply_type', '还没填「典型交期」→ 判断不了交付速度');
      if (supply.filled && supply.value === 'no_stable') {
        return {
          status: 'lack',
          ruleId: 'supply.lead_time_from_range_and_supply_type',
          reason: `背景信息「供应链类型」= ${supply.label} → 交期不可控（即使填了「${lead.label}」也不成立）`,
        };
      }
      const table: Record<string, SelfStatus> = { lte15: 'have', d15_30: 'have', d30_60: 'partial', gt60: 'lack' };
      const status = table[lead.value] ?? 'unknown';
      return {
        status,
        ruleId: 'supply.lead_time_from_range_and_supply_type',
        reason: `背景信息「典型交期」= ${lead.label}${supply.filled ? `，供应链类型 = ${supply.label}` : ''}`,
      };
    },
  },
  {
    key: 'category_exp',
    ruleId: 'team.category_years',
    rule: (bg) => byOption(bg, 'categoryYears', 'team.category_years', {
      none: 'lack',
      lt1: 'lack',
      y1_3: 'partial',
      y3_5: 'have',
      gt5: 'have',
    }, '类目经验决定踩坑成本'),
  },
  {
    key: 'product_def',
    ruleId: 'team.ability_product_def',
    rule: (bg) => abilityRule(bg, 'productDef', 'team.ability_product_def', '产品定义'),
  },
  {
    key: 'rnd',
    ruleId: 'team.ability_rnd',
    rule: (bg) => abilityRule(bg, 'rnd', 'team.ability_rnd', '研发设计'),
  },
  {
    key: 'design',
    ruleId: 'team.ability_content',
    rule: (bg) => abilityRule(bg, 'content', 'team.ability_content', '内容 / 素材'),
  },
  {
    key: 'ads',
    ruleId: 'team.ability_ads_with_team_size',
    rule: (bg) => {
      const base = abilityRule(bg, 'ads', 'team.ability_ads_with_team_size', '广告投放');
      if (base.status === 'unknown') return base;
      const team = pick(bg, 'teamSize');
      const raw = pick(bg, 'ads').value;
      // 只有"没人 + 没人管"才算不具备：团队 1-2 人 且 广告是"无/外包不可控"
      if (team.filled && team.value === 's1_2' && (raw === 'none' || raw === 'outsourced_risky')) {
        return {
          status: 'lack',
          ruleId: 'team.ability_ads_with_team_size',
          reason: `${base.reason}；且「${fieldLabel('teamSize')}」= ${team.label} → 广告没人做也没人盯，判定为「不具备」`,
        };
      }
      return base;
    },
  },
  {
    key: 'ops',
    ruleId: 'team.ability_ops_with_team_size',
    rule: (bg) => {
      const base = abilityRule(bg, 'ops', 'team.ability_ops_with_team_size', '运营');
      if (base.status === 'unknown') return base;
      const team = pick(bg, 'teamSize');
      const raw = pick(bg, 'ops').value;
      if (team.filled && team.value === 's1_2' && (raw === 'none' || raw === 'outsourced_risky')) {
        return {
          status: 'lack',
          ruleId: 'team.ability_ops_with_team_size',
          reason: `${base.reason}；且「${fieldLabel('teamSize')}」= ${team.label} → 判定为「不具备」`,
        };
      }
      return base;
    },
  },
  {
    key: 'after_sales',
    ruleId: 'team.ability_after_sales',
    rule: (bg) => {
      const base = abilityRule(bg, 'afterSales', 'team.ability_after_sales', '售后');
      if (base.status === 'unknown') return base;
      const channel = pick(bg, 'hasFeedbackChannel');
      if (channel.filled && channel.value === 'no' && base.status === 'have') {
        return {
          status: 'partial',
          ruleId: 'team.ability_after_sales',
          reason: `${base.reason}；但「${fieldLabel('hasFeedbackChannel')}」= ${channel.label} → 缺少稳定反馈渠道，降为「部分具备」`,
        };
      }
      return base;
    },
  },
  {
    key: 'certification',
    ruleId: 'compliance.certifications_vs_marketplaces',
    rule: (bg) => {
      const certs = pickMulti(bg, 'certifications');
      const markets = pickMulti(bg, 'marketplaces');
      if (certs.values.length === 0) {
        return unknown('', 'compliance.certifications_vs_marketplaces', '还没填「已有认证」→ 判断不了认证是否齐备');
      }
      const marketNote = markets.labels.length > 0 ? `，主战场站点 = ${markets.labels.join('/')}` : '';
      if (certs.values.includes('NONE')) {
        return {
          status: 'lack',
          ruleId: 'compliance.certifications_vs_marketplaces',
          reason: `背景信息「已有认证」= 暂无${marketNote} → 认证是硬约束（机会不能直接进入）`,
        };
      }
      if (markets.values.includes('EU') && !certs.values.includes('CE')) {
        return {
          status: 'lack',
          ruleId: 'compliance.certifications_vs_marketplaces',
          reason: `背景信息「已有认证」= ${certs.labels.join('/')}${marketNote} → 主战场含 EU 但没有 CE，属于硬约束`,
        };
      }
      if (markets.values.includes('US') && !certs.values.some((c) => ['FCC', 'FDA', 'CPC'].includes(c))) {
        return {
          status: 'partial',
          ruleId: 'compliance.certifications_vs_marketplaces',
          reason: `背景信息「已有认证」= ${certs.labels.join('/')}${marketNote} → 美国站是否需要 FCC/FDA/CPC 取决于品类，先按「部分具备」处理（需要你逐条覆盖）`,
        };
      }
      return {
        status: 'have',
        ruleId: 'compliance.certifications_vs_marketplaces',
        reason: `背景信息「已有认证」= ${certs.labels.join('/')}${marketNote}`,
      };
    },
  },
  {
    key: 'trademark',
    ruleId: 'compliance.no_field_trademark',
    rule: () => unknown('', 'compliance.no_field_trademark', '背景信息里没有商标字段 → 判断不了（需要商标时请逐条覆盖）'),
  },
  {
    key: 'patent',
    ruleId: 'compliance.no_field_patent',
    rule: () => unknown('', 'compliance.no_field_patent', '目标卖点是否踩专利要单独查 → 背景信息判断不了（请逐条覆盖或让 AI 增补问题）'),
  },
  {
    key: 'category_access',
    ruleId: 'compliance.no_field_category_access',
    rule: () => unknown('', 'compliance.no_field_category_access', '类目准入取决于具体品类的审核要求 → 背景信息判断不了（请逐条覆盖）'),
  },
  {
    key: 'target_price',
    ruleId: 'finance.target_price_is_project_level',
    rule: () => unknown('', 'finance.target_price_is_project_level', '目标售价是项目内的决策（利润计算器 / 机会卡利润假设）→ 背景信息不参与'),
  },
  {
    key: 'gross_margin',
    ruleId: 'finance.gross_margin_is_project_level',
    rule: () => unknown('', 'finance.gross_margin_is_project_level', '目标毛利率要在具体机会里算（利润计算器）→ 背景信息不参与'),
  },
  {
    key: 'net_margin_floor',
    ruleId: 'finance.margin_floor_from_decision_question',
    rule: () => unknown('', 'finance.margin_floor_from_decision_question', '毛利红线由「看自己」的第 1 个问题（最低毛利率）确定 → 背景信息给不了'),
  },
  {
    key: 'payback',
    ruleId: 'finance.payback_is_project_level',
    rule: () => unknown('', 'finance.payback_is_project_level', '回本周期要在具体机会里算 → 背景信息不参与'),
  },
  {
    key: 'validation_length',
    ruleId: 'risk.validation_length_from_cycle',
    rule: (bg) => byOption(bg, 'validationCycle', 'risk.validation_length_from_cycle', {
      lte1m: 'lack',
      m1_3: 'partial',
      m3_6: 'have',
      gt6m: 'have',
    }, '能给的验证时间越短，可选路径越少'),
  },
  {
    key: 'inventory_risk',
    ruleId: 'risk.inventory_from_appetite_and_terms',
    rule: (bg) => {
      const risk = pick(bg, 'riskAppetite');
      if (!risk.filled) return unknown('', 'risk.inventory_from_appetite_and_terms', '还没填「风险偏好」→ 判断不了能不能压货');
      let status: SelfStatus = risk.value === 'aggressive' ? 'have' : 'partial';
      const terms = pick(bg, 'paymentTerms');
      const budget = pick(bg, 'budgetPerProject');
      const notes: string[] = [`背景信息「风险偏好」= ${risk.label}`];
      if (terms.filled && terms.value === 'no') {
        status = DOWN[status];
        notes.push(`「${fieldLabel('paymentTerms')}」= ${terms.label} → 降一档`);
      }
      if (budget.filled && budget.value === 'lt5w') {
        status = DOWN[status];
        notes.push(`「${fieldLabel('budgetPerProject')}」= ${budget.label} → 再降一档`);
      }
      return { status, ruleId: 'risk.inventory_from_appetite_and_terms', reason: notes.join('，') };
    },
  },
];

/** 六项统一档位（自建团队 / 外包可控 / 外包不可控 / 无）共用同一条映射 */
function abilityRule(
  bg: UserBackgroundProfile | null | undefined,
  field: string,
  ruleId: string,
  what: string
): RuleResult {
  const p = pick(bg, field);
  if (!p.filled) return unknown('', ruleId, `还没填「${fieldLabel(field)}」→ 判断不了${what}能力`);
  const table: Record<string, SelfStatus> = {
    in_house: 'have',
    outsourced_ok: 'partial',
    outsourced_risky: 'partial',
    none: 'lack',
  };
  const status = table[p.value];
  if (!status) return unknown('', ruleId, `「${fieldLabel(field)}」的值无法识别 → 判断不了`);
  const tail =
    p.value === 'in_house'
      ? '自建团队，可自主排期'
      : p.value === 'outsourced_ok'
        ? '外包但可控，需要管理成本'
        : p.value === 'outsourced_risky'
          ? '外包且不可控，属于缺口'
          : '完全没有这块能力';
  return { status, ruleId, reason: `背景信息「${fieldLabel(field)}」= ${p.label} → ${what}：${tail}` };
}

const RULE_BY_KEY = new Map(CAPABILITY_RULES.map((r) => [r.key, r]));

/**
 * 背景信息 → 能力结论（**纯函数**：同输入必同输出，无时间戳、无随机、无 AI）。
 * 列表顺序与 CAPABILITY_ITEMS 一致；`unknown` 表示背景信息判断不了（不是"不具备"）。
 */
export function deriveCapabilities(bg: UserBackgroundProfile | null | undefined): DerivedCapability[] {
  return CAPABILITY_ITEMS.map((item) => {
    const rule = RULE_BY_KEY.get(item.key);
    const r = rule
      ? rule.rule(bg)
      : unknown(item.key, 'unmapped', '这一项还没有推导规则（请逐条覆盖）');
    return {
      key: item.key,
      label: item.label,
      dimension: item.dimension,
      status: r.status,
      source: 'derived' as const,
      ruleId: r.ruleId,
      reason: r.reason,
    };
  });
}

/** 单条推导（UI 上"为什么"用得到） */
export function deriveCapability(key: string, bg: UserBackgroundProfile | null | undefined): DerivedCapability {
  const all = deriveCapabilities(bg);
  return (
    all.find((c) => c.key === key) ?? {
      key,
      label: labelOf(key),
      dimension: 'risk',
      status: 'unknown',
      source: 'derived',
      ruleId: 'unmapped',
      reason: '未知能力项',
    }
  );
}

/**
 * 合并「推导 + 人工覆盖」：**覆盖优先，且显式标记 `source: 'manual'`**。
 * 旧版手填的背景库条目（loadCapabilityLibrary 读到的东西）也会被当成人工覆盖保留下来，不静默丢掉。
 */
export function resolveCapabilities(
  bg: UserBackgroundProfile | null | undefined,
  lib?: CapabilityLibrary | null
): DerivedCapability[] {
  const entries = lib?.entries ?? {};
  return deriveCapabilities(bg).map((d) => {
    const override = entries[d.key];
    if (!override || !override.status || override.status === 'unknown') return d;
    return {
      ...d,
      status: override.status,
      source: 'manual' as const,
      reason: `用户逐条覆盖为「${SELF_STATUS_LABELS[override.status]}」${override.note ? `（${override.note}）` : ''}；推导原本是：${d.reason}`,
      note: override.note,
    };
  });
}

/**
 * 解析成「已解析的能力库」：下游（前置资源缺口 `opportunityPlan.gapOf`、硬约束 `capabilityHardConstraints`）
 * 只需要 entries 这个形状，不必知道它是推导来的还是人工覆盖的。
 */
export function resolveCapabilityLibrary(
  bg: UserBackgroundProfile | null | undefined,
  lib?: CapabilityLibrary | null
): CapabilityLibrary {
  const entries: Record<string, CapabilityEntry> = {};
  for (const c of resolveCapabilities(bg, lib)) {
    entries[c.key] = {
      status: c.status,
      source: c.source,
      ruleId: c.ruleId,
      reason: c.reason,
      note: c.note,
    };
  }
  return { entries, updatedAt: lib?.updatedAt ?? '' };
}

export interface DerivationSummary {
  have: number;
  partial: number;
  lack: number;
  unknown: number;
  manual: number;
  total: number;
}

export function summarizeDerivation(entries: DerivedCapability[]): DerivationSummary {
  const out: DerivationSummary = { have: 0, partial: 0, lack: 0, unknown: 0, manual: 0, total: entries.length };
  for (const e of entries) {
    out[e.status] += 1;
    if (e.source === 'manual') out.manual += 1;
  }
  return out;
}

/** 给 AI 上下文用的一句话概括（AI 只能解释，不能改这些结论） */
export function deriveCapabilitiesForPrompt(entries: DerivedCapability[]): string {
  const s = summarizeDerivation(entries);
  const lines = [
    `【自身能力（确定性推导，AI 不得改写）】已具备 ${s.have} / 部分具备 ${s.partial} / 不具备 ${s.lack} / 判断不了 ${s.unknown}（共 ${s.total} 项${s.manual > 0 ? `，其中用户逐条覆盖 ${s.manual} 项` : ''}）`,
  ];
  for (const e of entries) {
    if (e.status === 'unknown') continue;
    lines.push(`- ${e.label}：${e.status}（${e.reason}）`);
  }
  const unknownKeys = entries.filter((e) => e.status === 'unknown').map((e) => e.label);
  if (unknownKeys.length > 0) lines.push(`- 判断不了（背景信息不足，不是"不具备"）：${unknownKeys.join('、')}`);
  return lines.join('\n');
}

/** 导出的能力项 key 全集（守卫用） */
export const DERIVED_CAPABILITY_KEYS: string[] = CAPABILITY_ITEM_KEYS;
