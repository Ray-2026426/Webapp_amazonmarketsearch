import { getCurrentUser, isAdminSession, type SessionUser } from './auth';
import {
  brandNamesOf,
  buildBrandPromptLines,
  emptyBrand,
  normalizeBrands,
  syncBrandNames,
  withSingleDefault,
  type BrandProfile,
} from './brandStore';

/**
 * 使用者背景信息（设置 → 背景信息）：让 AI 更懂「谁在用这个 App」，也是「看自己」的**唯一输入源**。
 *
 * 本轮改造（用户诉求：「背景设置的问题，我觉得不符合亚马逊卖家的普遍特征，你可以先去了解一下，再来设置问题」）：
 * 1. **字段改成"亚马逊卖家普遍特征"**：经营模式（精品/精铺/铺货/代发/跟卖/收购）、配送方式（FBA/FBM/海外仓）、
 *    品牌与商标备案、测评与评论资源、图片与内容能力、单链接广告预算、店铺矩阵、选品来源、能否开模定制、目标站点……
 *    删掉了"年营收量级"这类大企业刻度与咨询报告味的目标字段（依据见 PRD §15.23 的调研结论）；
 * 2. **每个字段都要能回答"它改变五看里的哪个判断"**：`BackgroundField.affects` 是必填，
 *    并有守卫断言"每个字段要么被至少一条推导规则用到、要么在 `BACKGROUND_ADVISORY_FIELDS` 里显式声明为不参与推导"；
 * 3. **以选择题/多选/下拉为主**：自由文本**恰好 2 个**（`existingAsin` / `freeNote`），上限 `MAX_BACKGROUND_TEXT_FIELDS = 3`；
 *    品牌名是**多值列表**（`kind: 'list'`），由 `brandStore` 承载，不占自由文本预算；
 * 4. **渐进式**：所有字段都允许留空（`optional: true`），随时能补；完整度只影响**可信度**，不阻塞分析；
 * 5. **只影响判断输入，不影响评分公式**：这里没有任何权重字段；机会卡五维权重固定 25/25/25/15/10（PRD §8.1）。
 *
 * 旧版（11 个自由文本框）的填写内容**不会被丢掉**：结构化不了的部分存进 `legacyNotes`，
 * 仍然进入 AI 上下文，但不再渲染成一张长表单（避免信息爆炸）。
 */

/* ────────────────────────────── 字段模型 ────────────────────────────── */

/**
 * `list` = 多值自由输入（品牌名可添加多个），它**不是**"自由文本字段"：
 * 一个组件管一串品牌，不计入 `MAX_BACKGROUND_TEXT_FIELDS`。
 */
export type BackgroundFieldKind = 'select' | 'multi' | 'text' | 'list';

export interface BackgroundOption {
  value: string;
  label: string;
}

export interface BackgroundField {
  key: string;
  label: string;
  kind: BackgroundFieldKind;
  options?: BackgroundOption[];
  placeholder?: string;
  /** 一句话：这项具体在影响什么（UI 上的短提示 / 角标） */
  hint?: string;
  /** 一句话：它改变五看里的哪一个判断（**必填**，守卫断言非空且提到"影响"） */
  affects: string;
  /** 允许留空：全部字段都是 true —— 「渐进式」是产品约束，不是可选项 */
  optional: true;
  /** 多选里"互斥"的选项值（如「暂无」「混合」）：选了它就清掉其它，选其它就清掉它 */
  exclusiveValue?: string;
}

export interface BackgroundGroup {
  id: string;
  title: string;
  /** 一句话：这一组影响五看里的哪一个判断（UI 上收进角标，不再平铺成长段） */
  affects: string;
  fields: BackgroundField[];
}

/**
 * 六个结构化字段组 + 一个「表达与备注」组（全部字段都可留空）。
 *
 * 分组依据（PRD §15.23 的卖家画像调研）：亚马逊卖家的真实差异集中在
 * **经营模式 / 配送方式 / 品牌与合规 / 供应链与备货 / 资金与广告 / 团队与能力**，
 * 而不是"企业规模"这种传统企业刻度。
 */
export const BACKGROUND_GROUPS: BackgroundGroup[] = [
  {
    id: 'model',
    title: '经营模式与站点',
    affects: '影响「看市场 → 这个品类值不值得进」与「赢的路径」里你能用的打法',
    fields: [
      {
        key: 'businessModel',
        label: '经营模式',
        kind: 'select',
        optional: true,
        hint: '精品/精铺/铺货/代发/跟卖/收购，打法完全不同',
        affects: '影响「看机会 → 先做什么」与备货风险：铺货与代发不压货，精品深耕要一次备足',
        options: [
          { value: 'boutique', label: '精品深耕（少量链接重投入）' },
          { value: 'refined_spread', label: '精铺（一批 SKU 小步试）' },
          { value: 'broad_spread', label: '铺货（大量 SKU 泛铺）' },
          { value: 'dropship', label: '一件代发（不压库存）' },
          { value: 'wholesale_follow', label: '批发跟卖（跟现成品牌/链接）' },
          { value: 'aggregator', label: '品牌收购（买现成品牌）' },
        ],
      },
      {
        key: 'sellerType',
        label: '卖家类型',
        kind: 'select',
        optional: true,
        hint: '工厂型 / 贸易型 / 品牌型 / 服务商',
        affects: '影响「看自己 → 能不能交付」：工厂型的成本与产线控制力天然更强',
        options: [
          { value: 'factory', label: '工厂型' },
          { value: 'trader', label: '贸易型' },
          { value: 'brand', label: '品牌型' },
          { value: 'service', label: '服务商（代运营/供应链服务）' },
        ],
      },
      {
        key: 'fulfillment',
        label: '配送方式',
        kind: 'multi',
        optional: true,
        exclusiveValue: 'mixed',
        hint: 'FBA 才有 Prime 标与 Buy Box 优势；FBM 靠货期换成本',
        affects: '影响「看自己 → 交付与售后」：FBA/海外仓决定到货速度，并且由亚马逊承接客服与退货',
        options: [
          { value: 'fba', label: 'FBA' },
          { value: 'fbm', label: 'FBM 自发货' },
          { value: 'overseas_wh', label: '海外仓' },
          { value: 'mixed', label: '混合（多条腿走）' },
        ],
      },
      {
        key: 'storeCount',
        label: '店铺 / 账号矩阵',
        kind: 'select',
        optional: true,
        hint: '多店是铺货模式的前提，也是抗封号的现实手段',
        affects: '影响「看机会 → 风险怎么摊」：单店被封等于全盘停摆，多店能把备货与风险分散开',
        options: [
          { value: 'single', label: '单店' },
          { value: 's2_5', label: '2-5 家店' },
          { value: 's5p', label: '5 家店以上' },
        ],
      },
      {
        key: 'marketplaces',
        label: '目标站点',
        kind: 'multi',
        optional: true,
        hint: 'EU 会带出 CE/EPR/欧代等合规约束',
        affects: '影响硬约束：站点决定哪些认证（CE/FCC/FDA/CPC）是必须的',
        options: [
          { value: 'US', label: 'US' },
          { value: 'EU', label: 'EU' },
          { value: 'JP', label: 'JP' },
          { value: 'OTHER', label: '其他' },
        ],
      },
      {
        key: 'brandNames',
        label: '品牌名',
        kind: 'list',
        optional: true,
        hint: '可添加多个品牌；点开某个品牌能填它的商标、备案与品牌资产',
        affects: '影响「看竞对 → 品牌壁垒」与品牌资产管理：有多个品牌时，新品可以复用到已有备案与旗舰店',
      },
    ],
  },
  {
    id: 'brand_compliance',
    title: '品牌备案与合规',
    affects: '影响硬约束：无认证 / 无商标 ⇒ 机会不能「直接进入」（最高「验证后进入」）',
    fields: [
      {
        key: 'trademarkStatus',
        label: '商标状态（主力品牌）',
        kind: 'select',
        optional: true,
        hint: '每个品牌的商标号与注册类目在「品牌资产」里逐个填',
        affects: '影响硬约束（商标）：没有商标就拿不到品牌保护与备案',
        options: [
          { value: 'registered', label: '已注册（R 标）' },
          { value: 'pending', label: '申请中（TM）' },
          { value: 'none', label: '没有商标' },
          { value: 'licensed', label: '用别人的授权' },
        ],
      },
      {
        key: 'brandRegistry',
        label: '品牌备案（Brand Registry）',
        kind: 'select',
        optional: true,
        affects: '影响「赢的路径」：没备案就用不了 A+、品牌旗舰店与品牌广告，内容能力要按缺口算',
        options: [
          { value: 'registered', label: '已备案' },
          { value: 'in_progress', label: '备案中' },
          { value: 'none', label: '没备案' },
          { value: 'not_planned', label: '不打算做品牌' },
        ],
      },
      {
        key: 'certifications',
        label: '已有认证',
        kind: 'multi',
        optional: true,
        exclusiveValue: 'NONE',
        hint: '选「暂无」表示现在没有认证',
        affects: '影响硬约束：主战场站点要求的认证缺失时，机会不能「直接进入」',
        options: [
          { value: 'CE', label: 'CE' },
          { value: 'FCC', label: 'FCC' },
          { value: 'FDA', label: 'FDA' },
          { value: 'CPC', label: 'CPC' },
          { value: 'EPR', label: 'EPR / 包装法' },
          { value: 'NONE', label: '暂无' },
        ],
      },
    ],
  },
  {
    id: 'supply',
    title: '供应链与备货',
    affects: '影响「看自己 → 能不能交付」与「人优我廉」的成本判断',
    fields: [
      {
        key: 'supplyType',
        label: '供应链类型',
        kind: 'select',
        optional: true,
        hint: '有没有工厂，直接决定交付与成本',
        affects: '影响「看自己 → 工厂资源」：有没有可控产线决定能不能真的交付',
        options: [
          { value: 'own_factory', label: '自有工厂' },
          { value: 'partner_factory', label: '长期合作工厂' },
          { value: 'trading', label: '贸易商 / 中间商' },
          { value: 'no_stable', label: '还没有稳定供应链' },
        ],
      },
      {
        key: 'sourcingChannel',
        label: '选品来源',
        kind: 'multi',
        optional: true,
        hint: '货源从哪来，决定你比对手快还是慢',
        affects: '影响「看自己 → 工厂资源」与「看竞对 → 缝隙能不能抢到」：工厂直供代表源头可控，竞品跟卖代表只能拼运营',
        options: [
          { value: '1688', label: '1688 选品' },
          { value: 'factory_direct', label: '工厂直供' },
          { value: 'trade_show', label: '展会' },
          { value: 'competitor_follow', label: '跟卖现成爆款' },
          { value: 'own_rnd', label: '自有研发' },
        ],
      },
      {
        key: 'customization',
        label: '能否开模定制',
        kind: 'select',
        optional: true,
        hint: '能不能改结构/开私模，是"人无我有"的前提',
        affects: '影响「看机会 → 人无我有」：只能贴牌时，差异化只能靠包装、套装与内容',
        options: [
          { value: 'mold_ok', label: '可以开模' },
          { value: 'oem_only', label: '只能贴牌 / 改包装' },
          { value: 'none', label: '都不行（只能拿现货）' },
          { value: 'unknown', label: '还没问过供应商' },
        ],
      },
      {
        key: 'moqRange',
        label: '可接受 MOQ',
        kind: 'select',
        optional: true,
        hint: 'MOQ 超标属于硬约束',
        affects: '影响硬约束（MOQ）与首批现金流：一次压多少货直接吃掉预算',
        options: [
          { value: 'lte500', label: '500 件以内' },
          { value: 'm500_1000', label: '500-1000 件' },
          { value: 'm1000_3000', label: '1000-3000 件' },
          { value: 'gt3000', label: '3000 件以上' },
        ],
      },
      {
        key: 'leadTimeRange',
        label: '典型交期',
        kind: 'select',
        optional: true,
        affects: '影响「看机会 → 窗口期」：交期超过 60 天通常错过旺季与新品窗口',
        options: [
          { value: 'lte15', label: '15 天内' },
          { value: 'd15_30', label: '15-30 天' },
          { value: 'd30_60', label: '30-60 天' },
          { value: 'gt60', label: '60 天以上' },
        ],
      },
      {
        key: 'paymentTerms',
        label: '账期能力',
        kind: 'select',
        optional: true,
        hint: '有没有账期，决定首批备货能不能扛',
        affects: '影响「看自己 → 现金流」与库存风险：没有账期时首批备货全额吃自己的现金',
        options: [
          { value: 'yes', label: '有' },
          { value: 'partial', label: '部分有' },
          { value: 'no', label: '没有' },
        ],
      },
    ],
  },
  {
    id: 'capital',
    title: '资金与广告',
    affects: '影响「看机会 → 先做什么」与机会卡的前置资金缺口',
    fields: [
      {
        key: 'budgetPerProject',
        label: '单项目可投入备货资金',
        kind: 'select',
        optional: true,
        hint: '只算这个项目的备货与推广，不含公司其他开销',
        affects: '影响「看自己 → 启动资金」与前置资源缺口：预算直接决定首批备货与验证动作的上限',
        options: [
          { value: 'lt5w', label: '5 万以内' },
          { value: 'w5_20', label: '5-20 万' },
          { value: 'w20_50', label: '20-50 万' },
          { value: 'g50w', label: '50 万以上' },
        ],
      },
      {
        key: 'adBudgetPerListing',
        label: '单链接月广告预算',
        kind: 'select',
        optional: true,
        hint: '美国站精准长尾词 CPC 常在 $1.5-3，点十下就是 15-30 美金',
        affects: '影响「看自己 → 广告预算」：广告盘子决定能不能靠付费把自然位冲出来',
        options: [
          { value: 'none', label: '不投广告' },
          { value: 'lt500', label: '低于 $500' },
          { value: 'x500_2000', label: '$500-2000' },
          { value: 'x2000_10000', label: '$2000-1 万' },
          { value: 'gt10000', label: '1 万以上' },
        ],
      },
      {
        key: 'validationCycle',
        label: '可接受最长验证周期',
        kind: 'select',
        optional: true,
        affects: '影响「看自己 → 可承受亏损周期」：能给的验证时间越短，可选路径越少',
        options: [
          { value: 'lte1m', label: '1 个月内' },
          { value: 'm1_3', label: '1-3 个月' },
          { value: 'm3_6', label: '3-6 个月' },
          { value: 'gt6m', label: '6 个月以上' },
        ],
      },
      {
        key: 'riskAppetite',
        label: '风险偏好',
        kind: 'select',
        optional: true,
        affects: '影响「看自己 → 库存风险与亏损承受」：保守的人不该被推去压一批重货',
        options: [
          { value: 'conservative', label: '保守' },
          { value: 'balanced', label: '稳健' },
          { value: 'aggressive', label: '进取' },
        ],
      },
    ],
  },
  {
    id: 'team',
    title: '团队与能力',
    affects: '影响「看自己 → 适配度」与「赢的路径」能不能接住需求',
    fields: [
      {
        key: 'teamSize',
        label: '团队规模',
        kind: 'select',
        optional: true,
        hint: '人少时广告/运营只能靠外包',
        affects: '影响「看自己 → 运营与广告能力」：1-2 人团队做不了需要日盯的品类',
        options: [
          { value: 's1_2', label: '1-2 人' },
          { value: 's3_9', label: '3-9 人' },
          { value: 's10_49', label: '10-49 人' },
          { value: 's50p', label: '50 人以上' },
        ],
      },
      { key: 'productDef', label: '产品定义', kind: 'select', optional: true, affects: '影响「看机会 → 需求能不能翻成产品方案」', options: ABILITY_OPTIONS() },
      { key: 'rnd', label: '研发设计 / 开模', kind: 'select', optional: true, affects: '影响「看机会 → 人无我有」：功能与结构差异靠它落地', options: ABILITY_OPTIONS() },
      {
        key: 'contentAbility',
        label: '图片与内容能力',
        kind: 'select',
        optional: true,
        hint: '亚马逊成败关键：主图/A+/视频决定点击与转化',
        affects: '影响「看竞对 → 转化力」与「看自己 → 设计能力」：只有基础图时打不了视觉差异化',
        options: [
          { value: 'in_house', label: '自建摄影设计' },
          { value: 'outsourced_ok', label: '外包可控' },
          { value: 'basic_only', label: '只有基础图（供应商图修一修）' },
          { value: 'none', label: '没有' },
        ],
      },
      { key: 'ads', label: '广告投放', kind: 'select', optional: true, affects: '影响「看机会 → 能不能靠付费起量」', options: ABILITY_OPTIONS() },
      { key: 'ops', label: '运营（Listing / 活动 / 库存）', kind: 'select', optional: true, affects: '影响「看自己 → 适配度」：没人操盘时任何机会都落不了地', options: ABILITY_OPTIONS() },
      {
        key: 'reviewResource',
        label: '测评与评论资源',
        kind: 'select',
        optional: true,
        hint: '真实约束：新品前 20 条评论拿不到，广告再猛也起不来',
        affects: '影响「看机会 → 冷启动路径」与「看自己 → 评论资源」：没有测评资源时，新品只能靠 Vine 与站内合规手段慢慢攒',
        options: [
          { value: 'stable', label: '有稳定的合规测评渠道（Vine / 站外真人）' },
          { value: 'few_customers', label: '只有少量真实客户' },
          { value: 'none', label: '完全没有' },
        ],
      },
    ],
  },
  {
    id: 'experience',
    title: '经验与备注',
    affects: '影响「看自己 → 适配度」与机会卡的证据可信度',
    fields: [
      {
        key: 'categoryYears',
        label: '类目经验年限',
        kind: 'select',
        optional: true,
        affects: '影响「看自己 → 类目经验」：没做过的类目踩坑成本明显更高',
        options: [
          { value: 'none', label: '没做过' },
          { value: 'lt1', label: '不到 1 年' },
          { value: 'y1_3', label: '1-3 年' },
          { value: 'y3_5', label: '3-5 年' },
          { value: 'gt5', label: '5 年以上' },
        ],
      },
      {
        key: 'existingAsin',
        label: '现有 ASIN / 链接',
        kind: 'text',
        optional: true,
        placeholder: '例如：B0XXXXXXXX（没有就留空）',
        affects: '影响「看自己 → 类目经验与链接资产」：有在售链接说明你真在这个平台做过，也说明有老品可以改',
      },
      {
        key: 'freeNote',
        label: '一句话备注',
        kind: 'text',
        optional: true,
        placeholder: '任何希望 AI 记住的业务偏好或禁区',
        affects: '影响 AI 怎么说话（不参与任何推导与打分）',
      },
    ],
  },
];

/** 统一的能力档位（多项能力共用同一套下拉，避免每组一套说法） */
function ABILITY_OPTIONS(): BackgroundOption[] {
  return [
    { value: 'in_house', label: '自建团队' },
    { value: 'outsourced_ok', label: '外包可控' },
    { value: 'outsourced_risky', label: '外包不可控' },
    { value: 'none', label: '无' },
  ];
}

export const BACKGROUND_FIELDS: BackgroundField[] = BACKGROUND_GROUPS.flatMap((g) => g.fields);

export const BACKGROUND_FIELD_KEYS: string[] = BACKGROUND_FIELDS.map((f) => f.key);

export const BACKGROUND_GROUP_BY_FIELD: Record<string, BackgroundGroup> = {};
for (const g of BACKGROUND_GROUPS) {
  for (const f of g.fields) BACKGROUND_GROUP_BY_FIELD[f.key] = g;
}

/**
 * 自由文本字段的**唯一来源**：恰好 2 个（≤ 上限 3）。
 * 守卫（tests/capabilityDerivation.test.ts）会断言：
 * ① 数量 ≤ `MAX_BACKGROUND_TEXT_FIELDS`；② 注册表里 `kind === 'text'` 的字段与它完全一致；
 * ③ 设置页 profile tab 里的文本输入框数量不超过 3；
 * ④ 品牌名是 `kind: 'list'`（多值），**不算**自由文本预算。
 */
export const BACKGROUND_TEXT_FIELD_KEYS = ['existingAsin', 'freeNote'] as const;
export type BackgroundTextFieldKey = (typeof BACKGROUND_TEXT_FIELD_KEYS)[number];
export const MAX_BACKGROUND_TEXT_FIELDS = 3;

/** 多值自由输入的字段（品牌名可添加多个） */
export const BACKGROUND_LIST_FIELD_KEYS = ['brandNames'] as const;

/**
 * 显式声明"不参与推导"的字段（只有备注类）。
 *
 * 为什么需要它：用户要求"每个字段都要能回答它改变五看里的哪个判断"，反过来说
 * **不允许存在"填了也白填"的字段**。这条守卫会断言：每个非备注字段都必须被至少一条推导规则
 * （`capabilityDerivation.CAPABILITY_RULES`）用到。备注是唯一例外，且必须在这里写清理由。
 */
export const BACKGROUND_ADVISORY_FIELDS: { key: string; why: string }[] = [
  { key: 'freeNote', why: '这是写给 AI 的一句话备注（偏好/禁区），只影响表达口径，本就不参与推导与打分' },
];

/* ────────────────────────────── 数据结构 ────────────────────────────── */

export interface UserBackgroundProfile {
  /** 选择题 / 多选：字段 key → 值（多选为数组）。没填就是没有这个键 */
  fields: Record<string, string | string[]>;
  /** 自由文本（恰好 2 个，上限 3） */
  notes: Record<string, string>;
  /**
   * 品牌档案（可多个）。**故意放在背景信息里**：同一个 localStorage 键、同一个账号口径、
   * 同一个更新事件 —— 品牌次级页与设置页读写的必须是同一份数据，不允许出现第二份存储。
   */
  brands: BrandProfile[];
  /** 旧版自由文本背景：结构化不了的部分原样留档，仍然进 AI 上下文 */
  legacyNotes: string;
  updatedAt: string;
}

export const EMPTY_USER_BACKGROUND: UserBackgroundProfile = {
  fields: {},
  notes: {},
  brands: [],
  legacyNotes: '',
  updatedAt: '',
};

/** 旧版（11 个自由文本）字段名与标签，仅用于迁移留档 */
export const LEGACY_PROFILE_FIELDS: { key: string; label: string }[] = [
  { key: 'displayName', label: '称呼' },
  { key: 'role', label: '岗位角色' },
  { key: 'company', label: '公司或团队' },
  { key: 'brands', label: '负责品牌' },
  { key: 'categories', label: '常做品类' },
  { key: 'marketplaces', label: '主做站点' },
  { key: 'experience', label: '经验' },
  { key: 'goals', label: '近期目标' },
  { key: 'constraints', label: '约束条件' },
  { key: 'analysisStyle', label: '希望 AI 怎么说' },
  { key: 'extraNotes', label: '其他补充' },
];

/**
 * **上一版字段集里本轮被删掉的结构化字段**。
 *
 * 为什么要留着这张表：字段被删掉之后，`normalizeUserBackground` 不会再读它们，
 * 用户以前填过的值会在下一次保存时静默消失 —— 那是丢数据。这里把它们**转成 legacyNotes 留档**
 * （legacyNotes 本来就进 AI 上下文），做到"字段可以下线，用户填过的东西不丢"。
 */
export const RETIRED_STRUCTURED_FIELDS: { key: string; label: string; labels?: Record<string, string> }[] = [
  {
    key: 'revenueTier',
    label: '年营收量级（旧字段）',
    labels: { lt1m: '不到 100 万', m1_10: '100-1000 万', m10_100: '1000 万-1 亿', g100m: '1 亿以上' },
  },
  {
    key: 'qcMethod',
    label: '质量管控方式（旧字段）',
    labels: { self: '自检', third_party: '第三方验货', none: '没有固定方式' },
  },
  {
    key: 'hasMold',
    label: '是否自有模具（旧字段）',
    labels: { yes: '有自有模具', partial: '可共用现有模具', no: '没有' },
  },
  {
    key: 'hasAsset',
    label: '现有 Listing / 品牌资产（旧字段）',
    labels: { both: 'Listing 与品牌都有', listing_only: '只有 Listing', brand_only: '只有品牌', none: '都没有' },
  },
  { key: 'hasFeedbackChannel', label: '客户反馈渠道（旧字段）', labels: { yes: '有', no: '没有' } },
  {
    key: 'legalSupport',
    label: '法务 / 合规支持（旧字段）',
    labels: { in_house: '有专职', outsourced: '可外包', none: '没有' },
  },
  {
    key: 'analysisStyle',
    label: '希望 AI 怎么说（旧字段）',
    labels: { conclusion_first: '结论先行', evidence_first: '先看证据', action_list: '给动作清单' },
  },
  { key: 'hasSuccessProject', label: '是否有成功项目（旧字段）', labels: { yes: '有（做出过成绩）', no: '没有' } },
];

export const ADMIN_DEFAULT_USER_BACKGROUND: UserBackgroundProfile = {
  fields: {
    businessModel: 'refined_spread',
    sellerType: 'brand',
    fulfillment: ['fba', 'overseas_wh'],
    storeCount: 's2_5',
    marketplaces: ['US', 'EU'],
    trademarkStatus: 'registered',
    brandRegistry: 'registered',
    certifications: ['CE', 'FCC'],
    supplyType: 'partner_factory',
    sourcingChannel: ['1688', 'factory_direct'],
    customization: 'mold_ok',
    moqRange: 'm500_1000',
    leadTimeRange: 'd15_30',
    paymentTerms: 'partial',
    budgetPerProject: 'w20_50',
    adBudgetPerListing: 'x2000_10000',
    validationCycle: 'm1_3',
    riskAppetite: 'balanced',
    teamSize: 's3_9',
    productDef: 'in_house',
    rnd: 'outsourced_ok',
    contentAbility: 'outsourced_ok',
    ads: 'outsourced_ok',
    ops: 'in_house',
    reviewResource: 'few_customers',
    categoryYears: 'y3_5',
  },
  notes: {
    existingAsin: '',
    freeNote: '结论必须有数据证据和置信度说明；避免空泛建议；优先复用现有供应链与可执行动作。',
  },
  brands: [
    {
      ...emptyBrand('Kairo 示例品牌'),
      default: true,
      fields: {
        trademarkStatus: 'registered',
        registryStatus: 'registered',
        trademarkClass: '第 21 类',
        aplusStatus: 'done',
        visualAsset: 'full_vi',
        listingCount: '1_5',
        priceBand: 'mid_value',
        sellingPoints: ['feature', 'design'],
        linkedStores: ['US'],
      },
    },
  ],
  legacyNotes:
    '角色：项目负责人 / 亚马逊市场调研与选品决策负责人；团队：OG 项目组 / 跨境电商团队；' +
    '经验：持续搭建亚马逊市场调研 Web App，关注选品判断、用户洞察、竞对拆解、数据抓取与 AI 报告质量；' +
    '近期目标：把 Kairo 打造成更好用、更准确的亚马逊市场调研和选品决策工作台，支持新品机会判断、老品改版、关键词机会和评论洞察。',
  updatedAt: '',
};

/* ────────────────────────────── 读取 / 写入 ────────────────────────────── */

const LEGACY_PROFILE_KEY = 'amzdev_user_background';
const PROFILE_KEY_PREFIX = 'amzdev_user_background:';

function readRaw(key: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 旧版自由文本 → legacyNotes（只做留档，不猜结构化选项） */
export function legacyNotesFromRaw(raw: Record<string, unknown> | null | undefined): string {
  if (!raw) return '';
  const lines: string[] = [];
  for (const f of LEGACY_PROFILE_FIELDS) {
    const v = raw[f.key];
    if (typeof v === 'string' && v.trim()) lines.push(`${f.label}：${v.trim()}`);
  }
  return lines.join('\n');
}

/**
 * 被删掉的旧结构化字段 → legacyNotes 留档（字段可以下线，用户填过的东西不丢）。
 * 旧值是机器码（如 `m10_100`），这里翻成人话再留档，否则留了也读不懂。
 */
export function retiredStructuredNotes(
  rawFields: Record<string, unknown> | null | undefined,
  oldFields: { key: string; label: string; labels?: Record<string, string> }[] = RETIRED_STRUCTURED_FIELDS
): string {
  if (!rawFields || typeof rawFields !== 'object') return '';
  const lines: string[] = [];
  for (const f of oldFields) {
    const v = rawFields[f.key];
    const list = Array.isArray(v) ? v.map((x) => String(x ?? '')) : typeof v === 'string' ? [v] : [];
    const text = list
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => f.labels?.[x] ?? x)
      .join(' / ');
    if (text) lines.push(`${f.label}：${text}`);
  }
  return lines.join('\n');
}

/** 归一化：结构非法一律丢弃（不猜用户意图）；旧记录迁移进 legacyNotes */
export function normalizeUserBackground(
  raw: Record<string, unknown> | null | undefined,
  defaults: UserBackgroundProfile
): UserBackgroundProfile {
  if (!raw) {
    return {
      ...defaults,
      fields: { ...defaults.fields },
      notes: { ...defaults.notes },
      brands: defaults.brands.map((b) => ({ ...b, fields: { ...b.fields } })),
    };
  }

  const fields: Record<string, string | string[]> = {};
  const rawFields = raw.fields;
  if (rawFields && typeof rawFields === 'object' && !Array.isArray(rawFields)) {
    for (const field of BACKGROUND_FIELDS) {
      if (field.kind === 'list') continue; // 品牌名的口径在 brands 上，不从 fields 读
      const v = (rawFields as Record<string, unknown>)[field.key];
      if (field.kind === 'multi') {
        const allowed = new Set((field.options ?? []).map((o) => o.value));
        if (Array.isArray(v)) {
          const list = v.map((x) => String(x ?? '').trim()).filter((x) => x.length > 0 && allowed.has(x));
          if (list.length > 0) fields[field.key] = [...new Set(list)];
        }
      } else if (typeof v === 'string' && v.trim()) {
        // 选择题必须命中选项白名单（不猜用户意图；非法值直接丢弃）
        const allowed = new Set((field.options ?? []).map((o) => o.value));
        if (allowed.has(v.trim())) fields[field.key] = v.trim();
      }
    }
  }

  const notes: Record<string, string> = {};
  const rawNotes = raw.notes;
  for (const key of BACKGROUND_TEXT_FIELD_KEYS) {
    const v = rawNotes && typeof rawNotes === 'object' ? (rawNotes as Record<string, unknown>)[key] : undefined;
    notes[key] = typeof v === 'string' ? v : '';
  }

  // 品牌：新版读 brands；旧版（只有一个「品牌名」文本框）迁移成 1 条品牌，不丢用户填过的东西
  let brands = normalizeBrands(raw.brands);
  if (brands.length === 0) {
    const legacyRaw2 = rawNotes && typeof rawNotes === 'object' ? (rawNotes as Record<string, unknown>).brandName : undefined;
    const legacyName = typeof legacyRaw2 === 'string' ? legacyRaw2 : '';
    if (legacyName.trim()) brands = normalizeBrands([{ name: legacyName, default: true }]);
  }

  const legacyNotes =
    (typeof raw.legacyNotes === 'string' && raw.legacyNotes.trim() ? raw.legacyNotes.trim() : '') ||
    legacyNotesFromRaw(raw);
  // 被删掉的旧结构化字段（如"年营收量级"）转成留档，避免静默丢数据
  const retired = retiredStructuredNotes(
    rawFields && typeof rawFields === 'object' && !Array.isArray(rawFields)
      ? (rawFields as Record<string, unknown>)
      : null
  );
  const mergedLegacy = [legacyNotes, retired].filter((s) => s.trim()).join('\n');

  return {
    fields,
    notes,
    brands,
    legacyNotes: mergedLegacy || defaults.legacyNotes,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : defaults.updatedAt,
  };
}

function profileStorageKey(user?: SessionUser | null): string {
  const u = user ?? getCurrentUser();
  return u?.id ? `${PROFILE_KEY_PREFIX}${u.id}` : LEGACY_PROFILE_KEY;
}

function defaultProfileFor(user?: SessionUser | null): UserBackgroundProfile {
  const base = isAdminSession(user ?? getCurrentUser()) ? ADMIN_DEFAULT_USER_BACKGROUND : EMPTY_USER_BACKGROUND;
  return {
    ...base,
    fields: { ...base.fields },
    notes: { ...base.notes },
    brands: base.brands.map((b) => ({ ...b, fields: { ...b.fields } })),
  };
}

export function loadUserBackground(user?: SessionUser | null): UserBackgroundProfile {
  const defaults = defaultProfileFor(user);
  try {
    const key = profileStorageKey(user);
    const accountRaw = readRaw(key);
    if (accountRaw) return normalizeUserBackground(accountRaw, defaults);

    const legacyRaw = readRaw(LEGACY_PROFILE_KEY);
    if (legacyRaw) {
      const migrated = normalizeUserBackground(legacyRaw, defaults);
      if (key !== LEGACY_PROFILE_KEY) localStorage.setItem(key, JSON.stringify(migrated));
      return migrated;
    }
    return defaults;
  } catch {
    return defaults;
  }
}

/** 按 userId 读取（给服务端数据组装/报告这类只拿到 userId 的调用方用，避免猜当前会话） */
export function loadUserBackgroundById(userId: string): UserBackgroundProfile {
  const empty = defaultProfileFor({ id: userId } as SessionUser);
  try {
    const raw = readRaw(userId ? `${PROFILE_KEY_PREFIX}${userId}` : LEGACY_PROFILE_KEY);
    return raw ? normalizeUserBackground(raw, empty) : empty;
  } catch {
    return empty;
  }
}

export function saveUserBackground(profile: UserBackgroundProfile, user?: SessionUser | null): void {
  const next: UserBackgroundProfile = {
    ...profile,
    brands: withSingleDefault(normalizeBrands(profile.brands)),
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(profileStorageKey(user), JSON.stringify(next));
  // 广播给正在挂着的视图（「看自己」据此重新推导能力/刷新问题选项），避免"设置里补了背景，看自己还是旧结论"
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(BACKGROUND_UPDATED_EVENT));
  } catch {
    /* 事件只是刷新信号，发不出去不影响已保存的数据 */
  }
}

/** 背景信息已保存的事件名（设置页保存后广播，看自己监听） */
export const BACKGROUND_UPDATED_EVENT = 'kairo:user-background-updated';

export function hasUserBackground(profile?: UserBackgroundProfile | null): boolean {
  const p = profile ?? loadUserBackground();
  return (
    Object.values(p.fields ?? {}).some((v) => (Array.isArray(v) ? v.length > 0 : String(v || '').trim().length > 0)) ||
    Object.values(p.notes ?? {}).some((v) => String(v || '').trim().length > 0) ||
    (p.brands ?? []).length > 0 ||
    String(p.legacyNotes || '').trim().length > 0
  );
}

/* ────────────────────────────── 取值 / 赋值（纯函数） ────────────────────────────── */

export function getBackgroundFieldValue(
  profile: UserBackgroundProfile | null | undefined,
  key: string
): string | string[] | undefined {
  const p = profile ?? EMPTY_USER_BACKGROUND;
  const field = BACKGROUND_FIELDS.find((f) => f.key === key);
  if (!field) return undefined;
  if (field.kind === 'text') return (p.notes ?? {})[key] ?? '';
  if (field.kind === 'list') return brandNamesOf(p.brands);
  return (p.fields ?? {})[key];
}

/** 单值口径（多选取第一个，仅用于"填了没有"的判断，不用于展示全部） */
export function getBackgroundSingleValue(
  profile: UserBackgroundProfile | null | undefined,
  key: string
): string {
  const v = getBackgroundFieldValue(profile, key);
  if (Array.isArray(v)) return v[0] ?? '';
  return typeof v === 'string' ? v : '';
}

export function getBackgroundMultiValue(
  profile: UserBackgroundProfile | null | undefined,
  key: string
): string[] {
  const v = getBackgroundFieldValue(profile, key);
  if (Array.isArray(v)) return v;
  return typeof v === 'string' && v ? [v] : [];
}

export function isBackgroundFieldFilled(
  profile: UserBackgroundProfile | null | undefined,
  key: string
): boolean {
  const v = getBackgroundFieldValue(profile, key);
  return Array.isArray(v) ? v.length > 0 : String(v ?? '').trim().length > 0;
}

/** 设置一个字段（文本/单选传 string，多选传 string[]；空值即清除） */
export function setBackgroundFieldValue(
  profile: UserBackgroundProfile,
  key: string,
  value: string | string[]
): UserBackgroundProfile {
  const field = BACKGROUND_FIELDS.find((f) => f.key === key);
  if (!field) return profile;
  if (field.kind === 'text') {
    return { ...profile, notes: { ...profile.notes, [key]: Array.isArray(value) ? value.join('') : value } };
  }
  // 品牌名：写回品牌档案（保留已有品牌的资产），不让 fields 里出现第二份品牌数据
  if (field.kind === 'list') {
    const names = (Array.isArray(value) ? value : value ? [value] : []).map((v) => String(v ?? ''));
    return { ...profile, brands: syncBrandNames(profile.brands, names) };
  }
  const fields = { ...profile.fields };
  if (field.kind === 'multi') {
    const list = (Array.isArray(value) ? value : value ? [value] : []).filter(Boolean);
    if (list.length === 0) delete fields[key];
    else fields[key] = list;
  } else {
    const v = Array.isArray(value) ? value[0] ?? '' : value;
    if (!v.trim()) delete fields[key];
    else fields[key] = v;
  }
  return { ...profile, fields };
}

/**
 * 多选切换（纯函数，含互斥选项规则）：
 * - `exclusiveValue`（如认证里的「暂无」、配送里的「混合」）与其它选项互斥：选中它清掉其它，选其它清掉它；
 * - 其余按普通开关切换。规则来自字段注册表，不写死在组件里。
 */
export function toggleBackgroundMultiValue(
  profile: UserBackgroundProfile,
  key: string,
  value: string
): UserBackgroundProfile {
  const field = BACKGROUND_FIELDS.find((f) => f.key === key);
  if (!field || field.kind !== 'multi') return profile;
  const current = getBackgroundMultiValue(profile, key);
  const exclusive = field.exclusiveValue;
  let next: string[];
  if (current.includes(value)) {
    next = current.filter((v) => v !== value);
  } else if (exclusive && value === exclusive) {
    next = [exclusive];
  } else {
    next = [...current.filter((v) => v !== exclusive), value];
  }
  return setBackgroundFieldValue(profile, key, next);
}

/**
 * 多选"整组替换"入口（芯片式多选组件回调用）：在应用互斥规则后写回。
 * 组件只管"用户现在选了哪些"，互斥语义仍在数据层（UI 不重复实现规则）。
 */
export function applyBackgroundMultiChange(
  profile: UserBackgroundProfile,
  key: string,
  nextSelected: string[]
): UserBackgroundProfile {
  const field = BACKGROUND_FIELDS.find((f) => f.key === key);
  if (!field || field.kind !== 'multi') return profile;
  const exclusive = field.exclusiveValue;
  if (!exclusive) return setBackgroundFieldValue(profile, key, nextSelected);
  const prevList = getBackgroundMultiValue(profile, key);
  // "最后点的那一下说了算"：按数组顺序取最后一个新增项（芯片组件把新增项追加在末尾）
  const added = [...nextSelected].reverse().find((v) => !prevList.includes(v));
  if (added) return toggleBackgroundMultiValue(profile, key, added);
  const removed = prevList.find((v) => !nextSelected.includes(v));
  if (removed) return setBackgroundFieldValue(profile, key, prevList.filter((v) => v !== removed));
  return setBackgroundFieldValue(profile, key, nextSelected);
}

/* ────────────────────────────── 完整度（确定性） ────────────────────────────── */

export interface BackgroundCompleteness {
  /** 已填字段数（多选只要选了至少一个就算填了；品牌名只要有一个品牌就算填了） */
  filled: number;
  total: number;
  /** 0-100 */
  percent: number;
  /** 0-1：给适配度公式用的修正系数 */
  fraction: number;
  byGroup: Record<string, { filled: number; total: number }>;
  /** 还没填的字段（告诉用户"补这些能提升可信度"） */
  emptyItems: { key: string; label: string; group: string; groupTitle: string }[];
}

export function computeBackgroundCompleteness(
  profile?: UserBackgroundProfile | null
): BackgroundCompleteness {
  const byGroup: BackgroundCompleteness['byGroup'] = {};
  for (const g of BACKGROUND_GROUPS) byGroup[g.id] = { filled: 0, total: 0 };
  let filled = 0;
  const emptyItems: BackgroundCompleteness['emptyItems'] = [];

  for (const g of BACKGROUND_GROUPS) {
    for (const f of g.fields) {
      byGroup[g.id].total += 1;
      if (isBackgroundFieldFilled(profile, f.key)) {
        filled += 1;
        byGroup[g.id].filled += 1;
      } else {
        emptyItems.push({ key: f.key, label: f.label, group: g.id, groupTitle: g.title });
      }
    }
  }

  const total = BACKGROUND_FIELDS.length;
  return {
    filled,
    total,
    percent: total > 0 ? Math.round((filled / total) * 100) : 0,
    /** 精确比例（不四舍五入：它是适配度公式的乘数，测试也要能精确复现） */
    fraction: total > 0 ? filled / total : 0,
    byGroup,
    emptyItems,
  };
}

/**
 * 完整度人话（**短**，且必须准确 —— 它只回答"够不够用"，不重复徽章上的数字）。
 *
 * 两处被用户点名删掉的东西，都不许回来：
 * ①「填得越全，「看自己」里要你回答的问题就越少」—— 本轮之后**是错的**：「看自己」固定只问 3 个拍板问题，
 *   背景信息填多填少都不会减少题量，它只影响**适配度的可信度**；
 * ②「背景信息完整度 27/29：已足够可信」—— 数字已经在徽章里了，句子再念一遍就是占地方。
 * 守卫（tests/capabilityDerivation.test.ts）断言这两句都不再出现。
 */
export function describeBackgroundCompleteness(report: BackgroundCompleteness): string {
  const missing = report.total - report.filled;
  if (report.filled === 0) return '还没填（不阻塞分析）';
  if (report.fraction >= 0.8) return '已够用';
  return `可随时补（还差 ${missing} 项），只影响适配度可信度`;
}

/** 最该先补的一组（补齐优先级建议） */
export function weakestBackgroundGroup(
  report: BackgroundCompleteness
): { group: string; title: string; empty: number } | null {
  let worst: { group: string; title: string; empty: number } | null = null;
  for (const g of BACKGROUND_GROUPS) {
    const stat = report.byGroup[g.id];
    const empty = stat.total - stat.filled;
    if (empty <= 0) continue;
    if (!worst || empty > worst.empty) worst = { group: g.id, title: g.title, empty };
  }
  return worst;
}

/** 已填项摘要（只读展示 + AI 上下文 + 推导依据都用它，保证口径一致） */
export interface BackgroundSummaryItem {
  key: string;
  label: string;
  group: string;
  groupTitle: string;
  /** 人话值（多选用 / 连接） */
  value: string;
  affects: string;
}

export function summarizeBackground(profile?: UserBackgroundProfile | null): BackgroundSummaryItem[] {
  const p = profile ?? EMPTY_USER_BACKGROUND;
  const out: BackgroundSummaryItem[] = [];
  for (const g of BACKGROUND_GROUPS) {
    for (const f of g.fields) {
      const raw = getBackgroundFieldValue(p, f.key);
      const list = Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? [raw] : [];
      if (list.length === 0) continue;
      const value =
        f.kind === 'select' || (list.length === 1 && f.options)
          ? list.map((v) => f.options?.find((o) => o.value === v)?.label ?? v).join(' / ')
          : list.join(' / ');
      out.push({ key: f.key, label: f.label, group: g.id, groupTitle: g.title, value, affects: f.affects });
    }
  }
  return out;
}

/* ────────────────────────────── AI 上下文 ────────────────────────────── */

/** 拼成给 AI 的系统提示片段（无内容则返回空串）。 */
export function buildUserBackgroundSystemPrompt(profile?: UserBackgroundProfile | null): string {
  const p = profile ?? loadUserBackground();
  if (!hasUserBackground(p)) return '';

  const lines: string[] = [
    '【使用者背景】以下信息描述正在使用本亚马逊市场调研工具的人。请据此调整分析视角、术语深度与建议可执行性；不要复述整段背景，除非对结论有直接帮助。',
  ];
  const summary = summarizeBackground(p);
  for (const g of BACKGROUND_GROUPS) {
    const items = summary.filter((i) => i.group === g.id);
    if (items.length === 0) continue;
    lines.push(`- ${g.title}（${g.affects}）：${items.map((i) => `${i.label}=${i.value}`).join('；')}`);
  }
  const brandLines = buildBrandPromptLines(p.brands);
  lines.push(...brandLines);
  if (String(p.legacyNotes || '').trim()) {
    lines.push(`- 历史填写（旧版自由文本，未结构化）：${p.legacyNotes.trim().replace(/\n/g, '；')}`);
  }
  return lines.join('\n');
}
