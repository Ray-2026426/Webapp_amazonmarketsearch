// 「看自己」V3 · 背景信息 → 能力推导（PRD §6.4）。
//
// 为什么要这一层（用户诉求："有了背景信息，还要我确认这么多东西，很奇怪"）：
// 背景信息（设置 → 背景信息）已经是**选择题**，它本身就足以确定大部分能力结论；
// 再让用户逐条点"已具备/部分具备/不具备/待确认"是重复劳动。于是：
//   1. 能力/资源/经验/约束这些维度**全部由背景信息推导**（本文件的规则表，确定性、可复现、无 AI 参与）；
//   2. 每条结论都能展开看到"这条是怎么推出来的"（`reason` 人话 + `ruleId` 规则编号，可复核）；
//   3. 背景信息**判断不了**的（专利/类目准入/售价/毛利红线……）诚实地给 `unknown`，不猜；
//   4. 用户仍可**逐条覆盖**：覆盖存进 CapabilityLibrary（`source: 'manual'` 显式标记），
//      **覆盖优先于推导，且 AI 永远不得改写**（mergeSelfAi 只写 aiDraft，不碰 entries）。
//
// 铁律：本文件只影响**判断输入**，不影响任何评分公式（机会卡权重固定 25/25/25/15/10，PRD §8.1）。
//
// 2026-09 本轮（PRD §15.23）：字段集换成"亚马逊卖家普遍特征"后，规则表同步重写。
// **字段与规则必须严格对得上**（tests/capabilityDerivation.test.ts 守）：
//   ① 每条规则引用的字段都必须在注册表里存在（不许引用幽灵字段）；
//   ② 每个非备注字段都必须被至少一条规则用到（不许有"填了也白填"的字段）。
// 因此本文件里出现了几处**组合规则**（经营模式影响备货风险、配送方式影响交付与售后、
// 品牌备案影响内容能力…），它们不是装饰：每一条都是卖家真实链路里的因果关系。

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
const UP: Record<SelfStatus, SelfStatus> = { have: 'have', partial: 'have', lack: 'partial', unknown: 'unknown' };

/* ────────────────────────────── 规则表（确定性） ────────────────────────────── */

type RuleResult = { status: SelfStatus; ruleId: string; reason: string };
type Rule = (bg: UserBackgroundProfile | null | undefined) => RuleResult;

/**
 * 推导规则表：**每个能力项一条规则**，规则编号即 UI 上"这条是怎么推出来的"里的 `ruleId`。
 * 覆盖度由测试断言（tests/capabilityDerivation.test.ts）：每一项都必须有规则；规则是纯函数；
 * 而且规则引用的字段必须真实存在、每个非备注字段必须被规则用到。
 */
export const CAPABILITY_RULES: { key: string; ruleId: string; rule: Rule }[] = [
  {
    key: 'startup_capital',
    ruleId: 'funding.from_budget',
    rule: (bg) => byOption(bg, 'budgetPerProject', 'funding.from_budget', {
      lt5w: 'lack',
      w5_20: 'partial',
      w20_50: 'have',
      g50w: 'have',
    }, '预算越小，能支撑的首批备货与验证动作越少'),
  },
  {
    key: 'ad_budget',
    ruleId: 'funding.ad_from_listing_budget',
    rule: (bg) => {
      const ad = pick(bg, 'adBudgetPerListing');
      if (!ad.filled) {
        return unknown('', 'funding.ad_from_listing_budget', '还没填「单链接月广告预算」→ 判断不了付费起量的空间（这一项问的是每条链接每月真实能烧多少广告费）');
      }
      const table: Record<string, SelfStatus> = {
        none: 'lack',
        lt500: 'partial',
        x500_2000: 'have',
        x2000_10000: 'have',
        gt10000: 'have',
      };
      const status = table[ad.value] ?? 'unknown';
      return {
        status,
        ruleId: 'funding.ad_from_listing_budget',
        reason: `背景信息「${fieldLabel('adBudgetPerListing')}」= ${ad.label} → 这是每条链接每月的广告盘子，直接决定能不能靠付费把自然位冲出来`,
      };
    },
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
    ruleId: 'supply.factory_from_supply_type_and_sourcing',
    rule: (bg) => {
      const supply = pick(bg, 'supplyType');
      const sourcing = pickMulti(bg, 'sourcingChannel');
      const seller = pick(bg, 'sellerType');
      // 工厂直供 / 自有研发 = 源头可控，至少按"长期合作工厂"处理
      const sourceControlled = sourcing.values.includes('factory_direct') || sourcing.values.includes('own_rnd');
      if (!supply.filled && !sourceControlled) {
        // 工厂型卖家即使没填供应链类型，也说明产线在自己手上（这是"卖家类型"这一项存在的意义）
        if (seller.filled && seller.value === 'factory') {
          return {
            status: 'have',
            ruleId: 'supply.factory_from_supply_type_and_sourcing',
            reason: `背景信息「${fieldLabel('sellerType')}」= ${seller.label} → 产线在你自己手上（「${fieldLabel('supplyType')}」还没填，但工厂型足以判定工厂资源具备）`,
          };
        }
        return unknown('', 'supply.factory_from_supply_type_and_sourcing', '还没填「供应链类型」与「选品来源」→ 判断不了有没有可控产线');
      }
      const table: Record<string, SelfStatus> = {
        own_factory: 'have',
        partner_factory: 'have',
        trading: 'partial',
        no_stable: 'lack',
      };
      let status: SelfStatus = supply.filled ? table[supply.value] ?? 'unknown' : 'partial';
      const notes: string[] = [];
      if (supply.filled) notes.push(`背景信息「${fieldLabel('supplyType')}」= ${supply.label}`);
      if (sourceControlled) {
        const before = status;
        status = UP[status];
        notes.push(
          `「${fieldLabel('sourcingChannel')}」= ${sourcing.labels.join('/')} → 源头可控${before !== status ? '，升一档' : ''}`
        );
      } else if (sourcing.values.length > 0) {
        notes.push(`「${fieldLabel('sourcingChannel')}」= ${sourcing.labels.join('/')}`);
      }
      return {
        status,
        ruleId: 'supply.factory_from_supply_type_and_sourcing',
        reason: `${notes.join('，')} → 有没有可控的产线，决定能不能真的交付`,
      };
    },
  },
  {
    key: 'moq',
    ruleId: 'supply.moq_from_range_and_business_model',
    rule: (bg) => {
      const base = byOption(bg, 'moqRange', 'supply.moq_from_range_and_business_model', {
        lte500: 'have',
        m500_1000: 'have',
        m1000_3000: 'partial',
        gt3000: 'lack',
      }, 'MOQ 超标属于硬约束（机会不能直接进入）');
      if (base.status === 'unknown') return base;
      // 经营模式决定"一次压多少货"的容忍度：铺货/代发怕压货（**只允许更保守，不允许放宽**——
      // MOQ 是硬约束，不能因为"你是精品卖家"就把它判成可用，否则会静默解锁"直接进入"）。
      const model = pick(bg, 'businessModel');
      if (!model.filled) return base;
      if (model.value === 'dropship' || model.value === 'broad_spread') {
        const next = DOWN[base.status];
        return {
          status: next,
          ruleId: 'supply.moq_from_range_and_business_model',
          reason: `${base.reason}；且「${fieldLabel('businessModel')}」= ${model.label} → 不压货的打法下，MOQ 超预算的杀伤更大${next !== base.status ? '，降一档' : ''}`,
        };
      }
      return {
        ...base,
        reason: `${base.reason}；「${fieldLabel('businessModel')}」= ${model.label} → 精品/收购本来就要一次备足，但 MOQ 仍是硬约束（不放宽）`,
      };
    },
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
    ruleId: 'supply.lead_time_from_range_type_and_fulfillment',
    rule: (bg) => {
      const lead = pick(bg, 'leadTimeRange');
      const supply = pick(bg, 'supplyType');
      const fulfill = pickMulti(bg, 'fulfillment');
      if (!lead.filled) return unknown('', 'supply.lead_time_from_range_type_and_fulfillment', '还没填「典型交期」→ 判断不了交付速度');
      if (supply.filled && supply.value === 'no_stable') {
        return {
          status: 'lack',
          ruleId: 'supply.lead_time_from_range_type_and_fulfillment',
          reason: `背景信息「${fieldLabel('supplyType')}」= ${supply.label} → 交期不可控（即使填了「${lead.label}」也不成立）`,
        };
      }
      const table: Record<string, SelfStatus> = { lte15: 'have', d15_30: 'have', d30_60: 'partial', gt60: 'lack' };
      let status = table[lead.value] ?? 'unknown';
      const notes = [`背景信息「${fieldLabel('leadTimeRange')}」= ${lead.label}`];
      if (supply.filled) notes.push(`供应链类型 = ${supply.label}`);
      // 海外仓/FBA 把"到买家手上"这一段压缩了：工厂交期长一点也能接受
      if (status !== 'unknown' && (fulfill.values.includes('overseas_wh') || fulfill.values.includes('fba'))) {
        const before = status;
        status = UP[status];
        notes.push(`「${fieldLabel('fulfillment')}」= ${fulfill.labels.join('/')} → 尾程已在目的地仓${before !== status ? '，升一档' : ''}`);
      }
      return { status, ruleId: 'supply.lead_time_from_range_type_and_fulfillment', reason: notes.join('，') };
    },
  },
  {
    key: 'category_exp',
    ruleId: 'team.category_years_with_existing_listing',
    rule: (bg) => {
      const years = pick(bg, 'categoryYears');
      const asin = pick(bg, 'existingAsin');
      if (!years.filled) {
        if (asin.filled) {
          return {
            status: 'partial',
            ruleId: 'team.category_years_with_existing_listing',
            reason: `「${fieldLabel('categoryYears')}」还没填，但你填了现有 ASIN（${asin.label}）→ 已经在平台上真做过，至少按「部分具备」处理`,
          };
        }
        return unknown('', 'team.category_years_with_existing_listing', '还没填「类目经验年限」→ 判断不了踩坑成本');
      }
      const table: Record<string, SelfStatus> = { none: 'lack', lt1: 'lack', y1_3: 'partial', y3_5: 'have', gt5: 'have' };
      const status = table[years.value] ?? 'unknown';
      const tail = asin.filled ? `；已有在售链接（${asin.label}）` : '';
      return {
        status,
        ruleId: 'team.category_years_with_existing_listing',
        reason: `背景信息「${fieldLabel('categoryYears')}」= ${years.label}${tail} → 类目经验决定踩坑成本`,
      };
    },
  },
  {
    key: 'product_def',
    ruleId: 'team.ability_product_def',
    rule: (bg) => abilityRule(bg, 'productDef', 'team.ability_product_def', '产品定义'),
  },
  {
    key: 'rnd',
    ruleId: 'team.ability_rnd_with_customization',
    rule: (bg) => {
      const base = abilityRule(bg, 'rnd', 'team.ability_rnd_with_customization', '研发设计');
      if (base.status === 'unknown') return base;
      const mold = pick(bg, 'customization');
      if (!mold.filled) return base;
      if (mold.value === 'mold_ok') {
        const next = UP[base.status];
        return {
          status: next,
          ruleId: 'team.ability_rnd_with_customization',
          reason: `${base.reason}；且「${fieldLabel('customization')}」= ${mold.label} → 能改结构/开私模，「人无我有」有落地通道${next !== base.status ? '，升一档' : ''}`,
        };
      }
      if (mold.value === 'none') {
        return {
          status: DOWN[base.status],
          ruleId: 'team.ability_rnd_with_customization',
          reason: `${base.reason}；但「${fieldLabel('customization')}」= ${mold.label} → 只能拿现货，差异化的实现手段被卡住`,
        };
      }
      return { ...base, reason: `${base.reason}；「${fieldLabel('customization')}」= ${mold.label}` };
    },
  },
  {
    key: 'design',
    ruleId: 'team.ability_content_with_brand_registry',
    rule: (bg) => {
      const p = pick(bg, 'contentAbility');
      if (!p.filled) return unknown('', 'team.ability_content_with_brand_registry', `还没填「${fieldLabel('contentAbility')}」→ 判断不了图片与内容能力`);
      const table: Record<string, SelfStatus> = {
        in_house: 'have',
        outsourced_ok: 'partial',
        basic_only: 'partial',
        none: 'lack',
      };
      let status = table[p.value] ?? 'unknown';
      const notes = [`背景信息「${fieldLabel('contentAbility')}」= ${p.label}`];
      // 没备案 ⇒ 用不了 A+ 与品牌旗舰店，视觉差异化手段直接少一半
      const registry = pick(bg, 'brandRegistry');
      if (registry.filled && (registry.value === 'none' || registry.value === 'not_planned') && status !== 'unknown') {
        const before = status;
        status = DOWN[status];
        notes.push(`「${fieldLabel('brandRegistry')}」= ${registry.label} → 用不了 A+ 与品牌旗舰店${before !== status ? '，降一档' : ''}`);
      } else if (registry.filled) {
        notes.push(`「${fieldLabel('brandRegistry')}」= ${registry.label}`);
      }
      return { status, ruleId: 'team.ability_content_with_brand_registry', reason: notes.join('，') };
    },
  },
  {
    key: 'ads',
    ruleId: 'team.ability_ads_with_team_size_and_budget',
    rule: (bg) => {
      const base = abilityRule(bg, 'ads', 'team.ability_ads_with_team_size_and_budget', '广告投放');
      if (base.status === 'unknown') return base;
      const team = pick(bg, 'teamSize');
      const raw = pick(bg, 'ads').value;
      const notes = [base.reason];
      let status = base.status;
      // 只有"没人 + 没人管"才算不具备：团队 1-2 人 且 广告是"无/外包不可控"
      if (team.filled && team.value === 's1_2' && (raw === 'none' || raw === 'outsourced_risky')) {
        status = 'lack';
        notes.push(`「${fieldLabel('teamSize')}」= ${team.label} → 广告没人做也没人盯，判定为「不具备」`);
      } else if (team.filled) {
        notes.push(`「${fieldLabel('teamSize')}」= ${team.label}`);
      }
      // 预算与能力是两件事，但"完全不投广告"时广告能力再强也没有载体
      const budget = pick(bg, 'adBudgetPerListing');
      if (budget.filled && budget.value === 'none' && status === 'have') {
        status = 'partial';
        notes.push(`「${fieldLabel('adBudgetPerListing')}」= ${budget.label} → 有投放能力但不打算投，降为「部分具备」`);
      } else if (budget.filled) {
        notes.push(`「${fieldLabel('adBudgetPerListing')}」= ${budget.label}`);
      }
      return { status, ruleId: 'team.ability_ads_with_team_size_and_budget', reason: notes.join('；') };
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
    ruleId: 'team.after_sales_from_fulfillment_and_team',
    rule: (bg) => {
      const fulfill = pickMulti(bg, 'fulfillment');
      const team = pick(bg, 'teamSize');
      if (fulfill.values.length === 0 && !team.filled) {
        return unknown('', 'team.after_sales_from_fulfillment_and_team', `还没填「${fieldLabel('fulfillment')}」与「团队规模」→ 判断不了谁来接差评/退货/客服`);
      }
      // FBA / 海外仓：客服与退货由亚马逊/当地仓承接，售后压力显著降低
      if (fulfill.values.includes('fba')) {
        return {
          status: 'have',
          ruleId: 'team.after_sales_from_fulfillment_and_team',
          reason: `背景信息「${fieldLabel('fulfillment')}」= ${fulfill.labels.join('/')} → 客服与退货由 FBA 承接，售后有人接`,
        };
      }
      if (fulfill.values.includes('overseas_wh')) {
        return {
          status: 'partial',
          ruleId: 'team.after_sales_from_fulfillment_and_team',
          reason: `背景信息「${fieldLabel('fulfillment')}」= ${fulfill.labels.join('/')} → 退货能回当地仓，但客服仍要自己接`,
        };
      }
      if (fulfill.values.includes('fbm')) {
        if (team.filled && team.value === 's1_2') {
          return {
            status: 'lack',
            ruleId: 'team.after_sales_from_fulfillment_and_team',
            reason: `背景信息「${fieldLabel('fulfillment')}」= ${fulfill.labels.join('/')}，且「${fieldLabel('teamSize')}」= ${team.label} → 自发货的客服/退货全要自己扛，1-2 人扛不住`,
          };
        }
        return {
          status: 'partial',
          ruleId: 'team.after_sales_from_fulfillment_and_team',
          reason: `背景信息「${fieldLabel('fulfillment')}」= ${fulfill.labels.join('/')}${team.filled ? `，团队 = ${team.label}` : ''} → 自发货要自建客服与退货流程`,
        };
      }
      return unknown('', 'team.after_sales_from_fulfillment_and_team', '配送方式里没有可判定的项（FBA / FBM / 海外仓）→ 判断不了售后由谁承接');
    },
  },
  {
    key: 'review_resource',
    ruleId: 'team.review_resource_from_channel',
    rule: (bg) => byOption(bg, 'reviewResource', 'team.review_resource_from_channel', {
      stable: 'have',
      few_customers: 'partial',
      none: 'lack',
    }, '新品前 20 条评论拿不到时，广告再猛也起不来（这是卖家的真实约束）'),
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
      const marketNote = markets.labels.length > 0 ? `，目标站点 = ${markets.labels.join('/')}` : '';
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
          reason: `背景信息「已有认证」= ${certs.labels.join('/')}${marketNote} → 目标站点含 EU 但没有 CE，属于硬约束`,
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
    // 上一版这一项永远是 unknown（背景信息里根本没有商标字段）。本轮补上字段后，它变成了一条真规则。
    key: 'trademark',
    ruleId: 'compliance.trademark_from_status_and_registry',
    rule: (bg) => {
      const tm = pick(bg, 'trademarkStatus');
      const registry = pick(bg, 'brandRegistry');
      const brandCount = pickMulti(bg, 'brandNames').values.length;
      const brandNote = brandCount > 0 ? `（已登记 ${brandCount} 个品牌）` : '';
      if (!tm.filled) {
        return unknown('', 'compliance.trademark_from_status_and_registry', `还没填「${fieldLabel('trademarkStatus')}」→ 判断不了商标是否可用${brandNote}`);
      }
      const table: Record<string, SelfStatus> = {
        registered: 'have',
        pending: 'partial',
        licensed: 'partial',
        none: 'lack',
      };
      const status = table[tm.value] ?? 'unknown';
      const notes = [`背景信息「${fieldLabel('trademarkStatus')}」= ${tm.label}${brandNote}`];
      if (registry.filled) notes.push(`「${fieldLabel('brandRegistry')}」= ${registry.label}`);
      if (tm.value === 'none') notes.push('没有商标 ⇒ 品牌保护与备案都无从谈起（硬约束）');
      return { status, ruleId: 'compliance.trademark_from_status_and_registry', reason: notes.join('，') };
    },
  },
  {
    key: 'patent',
    ruleId: 'compliance.no_field_patent',
    rule: (bg) => {
      const mold = pick(bg, 'customization');
      const tail = mold.filled && mold.value === 'mold_ok' ? '；你选了「可以开模」→ 结构与外观专利要单独检索（开模品踩专利的概率更高）' : '';
      return unknown('', 'compliance.no_field_patent', `目标卖点是否踩专利要单独查 → 背景信息判断不了（请逐条覆盖或让 AI 增补问题）${tail}`);
    },
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
    ruleId: 'risk.inventory_from_model_appetite_terms_and_stores',
    rule: (bg) => {
      const risk = pick(bg, 'riskAppetite');
      const model = pick(bg, 'businessModel');
      if (!risk.filled && !model.filled) {
        return unknown('', 'risk.inventory_from_model_appetite_terms_and_stores', `还没填「${fieldLabel('riskAppetite')}」与「${fieldLabel('businessModel')}」→ 判断不了能不能压货`);
      }
      let status: SelfStatus = risk.filled
        ? risk.value === 'aggressive'
          ? 'have'
          : 'partial'
        : 'partial';
      const notes: string[] = [];
      if (risk.filled) notes.push(`背景信息「${fieldLabel('riskAppetite')}」= ${risk.label}`);
      if (model.filled) {
        notes.push(`「${fieldLabel('businessModel')}」= ${model.label}`);
        // 代发不压货；铺货单 SKU 备货也轻 → 压货风险天然低
        if (model.value === 'dropship' || model.value === 'broad_spread') {
          status = UP[status];
          notes.push('不压货/轻备货的打法 → 升一档');
        } else if (model.value === 'boutique' || model.value === 'aggregator') {
          status = DOWN[status];
          notes.push('精品/收购要一次备足 → 降一档');
        }
      }
      const terms = pick(bg, 'paymentTerms');
      if (terms.filled && terms.value === 'no') {
        status = DOWN[status];
        notes.push(`「${fieldLabel('paymentTerms')}」= ${terms.label} → 降一档`);
      }
      const budget = pick(bg, 'budgetPerProject');
      if (budget.filled && budget.value === 'lt5w') {
        status = DOWN[status];
        notes.push(`「${fieldLabel('budgetPerProject')}」= ${budget.label} → 再降一档`);
      }
      // 多店 = 备货与风险可以在店铺之间摊开
      const stores = pick(bg, 'storeCount');
      if (stores.filled && (stores.value === 's2_5' || stores.value === 's5p')) {
        const before = status;
        status = UP[status];
        notes.push(`「${fieldLabel('storeCount')}」= ${stores.label} → 备货与风险能分散${before !== status ? '，升一档' : ''}`);
      } else if (stores.filled) {
        notes.push(`「${fieldLabel('storeCount')}」= ${stores.label} → 单店风险集中`);
      }
      return { status, ruleId: 'risk.inventory_from_model_appetite_terms_and_stores', reason: notes.join('，') };
    },
  },
];

/** 统一档位（自建团队 / 外包可控 / 外包不可控 / 无）共用同一条映射 */
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

/**
 * 规则表直接引用到的背景信息字段 key 全集（**一致性守卫的单一来源**）。
 *
 * 用法：源码级扫描本文件的取值调用（取单值 / 取多值 / 按选项映射 / 能力档位映射四种），
 * 只能拿到"字面量"那一部分，而组合规则里有些字段是通过参数传进去的；
 * 所以这里把「规则 → 字段」的关系**显式声明**出来，测试同时校验三件事：
 *   ① 这里列的字段都在注册表里（不许引用幽灵字段）；
 *   ② 注册表里每个非备注字段都在这里（不许有"填了也白填"的字段）；
 *   ③ 源码里出现但没在这里声明的字段 → 也报错（防止有人加了用法忘了登记）。
 */
export const RULE_INPUT_FIELDS: string[] = [
  'businessModel',
  'sellerType',
  'fulfillment',
  'storeCount',
  'marketplaces',
  'brandNames',
  'trademarkStatus',
  'brandRegistry',
  'certifications',
  'supplyType',
  'sourcingChannel',
  'customization',
  'moqRange',
  'leadTimeRange',
  'paymentTerms',
  'budgetPerProject',
  'adBudgetPerListing',
  'validationCycle',
  'riskAppetite',
  'teamSize',
  'productDef',
  'rnd',
  'contentAbility',
  'ads',
  'ops',
  'reviewResource',
  'categoryYears',
  'existingAsin',
];
