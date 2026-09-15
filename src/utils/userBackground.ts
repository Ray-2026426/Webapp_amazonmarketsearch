import { getCurrentUser, isAdminSession, type SessionUser } from './auth';

/**
 * 使用者背景信息（设置 → 背景信息）：让 AI 更懂「谁在用这个 App」，也是「看自己」的**唯一输入源**。
 *
 * 本轮改造（用户诉求：填空题太多，要有逻辑和依据）：
 * 1. **字段成组、有依据**：每一组都写明"它影响五看里的哪一个判断"（`BackgroundGroup.affects`，直接显示在 UI 上）；
 * 2. **以选择题/下拉为主**：所有字段都是 `select` / `multi` / `text`，其中自由文本**恰好 3 个**
 *    （`brandName` 品牌名 / `asinNote` 现有 ASIN·链接 / `freeNote` 一句话备注），由
 *    `BACKGROUND_TEXT_FIELD_KEYS` 单一来源定义，并有源码级守卫（tests/capabilityDerivation.test.ts）；
 * 3. **渐进式**：所有字段都允许留空（`optional: true`），随时能补；完整度只影响**可信度**，不阻塞分析；
 * 4. **只影响判断输入，不影响评分公式**：这里没有任何权重字段；机会卡五维权重固定 25/25/25/15/10
 *    （PRD §8.1）。背景完整度只作为 §6.4 已有的「适配度 = 相关题均分 × 背景完整度」修正项使用。
 *
 * 旧版（11 个自由文本框）的填写内容**不会被丢掉**：结构化不了的部分存进 `legacyNotes`，
 * 仍然进入 AI 上下文，但不再渲染成一张长表单（避免信息爆炸）。
 */

/* ────────────────────────────── 字段模型 ────────────────────────────── */

export type BackgroundFieldKind = 'select' | 'multi' | 'text';

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
  /** 一句话：这项具体在影响什么（UI 上的短提示） */
  hint?: string;
  /** 允许留空：全部字段都是 true —— 「渐进式」是产品约束，不是可选项 */
  optional: true;
  /** 多选里"互斥"的选项值（如「暂无」）：选了它就清掉其它，选其它就清掉它 */
  exclusiveValue?: string;
}

export interface BackgroundGroup {
  id: string;
  title: string;
  /** 一句话：这一组影响五看里的哪一个判断（必须有依据，UI 直接展示） */
  affects: string;
  fields: BackgroundField[];
}

/** 六个结构化字段组 + 一个「表达与备注」组（全部字段都可留空） */
export const BACKGROUND_GROUPS: BackgroundGroup[] = [
  {
    id: 'entity',
    title: '主体与规模',
    affects: '影响「看自己 → 能不能交付」与「赢的路径」里的成本判断',
    fields: [
      {
        key: 'sellerType',
        label: '卖家类型',
        kind: 'select',
        optional: true,
        hint: '决定成本结构与可用的赢法',
        options: [
          { value: 'factory', label: '工厂' },
          { value: 'trader', label: '贸易商' },
          { value: 'brand', label: '品牌方' },
          { value: 'service', label: '服务商' },
        ],
      },
      {
        key: 'teamSize',
        label: '团队规模',
        kind: 'select',
        optional: true,
        hint: '人少时广告/运营只能靠外包',
        options: [
          { value: 's1_2', label: '1-2 人' },
          { value: 's3_9', label: '3-9 人' },
          { value: 's10_49', label: '10-49 人' },
          { value: 's50p', label: '50 人以上' },
        ],
      },
      {
        key: 'revenueTier',
        label: '年营收量级',
        kind: 'select',
        optional: true,
        options: [
          { value: 'lt1m', label: '不到 100 万' },
          { value: 'm1_10', label: '100-1000 万' },
          { value: 'm10_100', label: '1000 万-1 亿' },
          { value: 'g100m', label: '1 亿以上' },
        ],
      },
      {
        key: 'marketplaces',
        label: '主战场站点',
        kind: 'multi',
        optional: true,
        hint: '决定合规哪些认证是硬约束',
        options: [
          { value: 'US', label: 'US' },
          { value: 'EU', label: 'EU' },
          { value: 'JP', label: 'JP' },
          { value: 'OTHER', label: '其他' },
        ],
      },
      {
        key: 'brandName',
        label: '品牌名',
        kind: 'text',
        optional: true,
        placeholder: '例如：BrandA（没有就留空）',
      },
    ],
  },
  {
    id: 'capital',
    title: '资金与风险',
    affects: '影响「看机会 → 先做什么」与机会卡的前置资金缺口',
    fields: [
      {
        key: 'budgetPerProject',
        label: '单项目可投入预算',
        kind: 'select',
        optional: true,
        hint: '推导启动资金与广告预算',
        options: [
          { value: 'lt5w', label: '5 万以内' },
          { value: 'w5_20', label: '5-20 万' },
          { value: 'w20_100', label: '20-100 万' },
          { value: 'g100w', label: '100 万以上' },
        ],
      },
      {
        key: 'validationCycle',
        label: '可接受最长验证周期',
        kind: 'select',
        optional: true,
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
        options: [
          { value: 'conservative', label: '保守' },
          { value: 'balanced', label: '稳健' },
          { value: 'aggressive', label: '进取' },
        ],
      },
      {
        key: 'paymentTerms',
        label: '账期能力',
        kind: 'select',
        optional: true,
        hint: '有没有账期，决定首批备货能不能扛',
        options: [
          { value: 'yes', label: '有' },
          { value: 'partial', label: '部分有' },
          { value: 'no', label: '没有' },
        ],
      },
    ],
  },
  {
    id: 'supply',
    title: '供应链与产品',
    affects: '影响「看自己 → 能否交付」与「人优我廉」的成本判断',
    fields: [
      {
        key: 'supplyType',
        label: '供应链类型',
        kind: 'select',
        optional: true,
        hint: '有没有工厂，直接决定交付与成本',
        options: [
          { value: 'own_factory', label: '自有工厂' },
          { value: 'partner_factory', label: '长期合作工厂' },
          { value: 'trading', label: '贸易商 / 中间商' },
          { value: 'no_stable', label: '还没有稳定供应链' },
        ],
      },
      {
        key: 'hasMold',
        label: '是否自有模具',
        kind: 'select',
        optional: true,
        options: [
          { value: 'yes', label: '有自有模具' },
          { value: 'partial', label: '可共用现有模具' },
          { value: 'no', label: '没有' },
        ],
      },
      {
        key: 'moqRange',
        label: '可接受 MOQ',
        kind: 'select',
        optional: true,
        hint: 'MOQ 超标属于硬约束',
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
        options: [
          { value: 'lte15', label: '15 天内' },
          { value: 'd15_30', label: '15-30 天' },
          { value: 'd30_60', label: '30-60 天' },
          { value: 'gt60', label: '60 天以上' },
        ],
      },
      {
        key: 'qcMethod',
        label: '质量管控方式',
        kind: 'select',
        optional: true,
        options: [
          { value: 'self', label: '自检' },
          { value: 'third_party', label: '第三方验货' },
          { value: 'none', label: '没有固定方式' },
        ],
      },
    ],
  },
  {
    id: 'compliance',
    title: '合规与资质',
    affects: '影响硬约束：认证缺失 ⇒ 机会不能「直接进入」（最高「验证后进入」）',
    fields: [
      {
        key: 'certifications',
        label: '已有认证',
        kind: 'multi',
        optional: true,
        exclusiveValue: 'NONE',
        hint: '选「暂无」表示现在没有认证',
        options: [
          { value: 'CE', label: 'CE' },
          { value: 'FCC', label: 'FCC' },
          { value: 'FDA', label: 'FDA' },
          { value: 'CPC', label: 'CPC' },
          { value: 'NONE', label: '暂无' },
        ],
      },
      {
        key: 'legalSupport',
        label: '法务 / 合规支持',
        kind: 'select',
        optional: true,
        options: [
          { value: 'in_house', label: '有专职' },
          { value: 'outsourced', label: '可外包' },
          { value: 'none', label: '没有' },
        ],
      },
    ],
  },
  {
    id: 'ability',
    title: '能力',
    affects: '影响「看自己 → 适配度」与「赢的路径」能不能接住需求',
    fields: [
      { key: 'productDef', label: '产品定义', kind: 'select', optional: true, options: ABILITY_OPTIONS() },
      { key: 'rnd', label: '研发设计', kind: 'select', optional: true, options: ABILITY_OPTIONS() },
      { key: 'content', label: '内容 / 素材', kind: 'select', optional: true, options: ABILITY_OPTIONS() },
      { key: 'ads', label: '广告投放', kind: 'select', optional: true, options: ABILITY_OPTIONS() },
      { key: 'ops', label: '运营', kind: 'select', optional: true, options: ABILITY_OPTIONS() },
      { key: 'afterSales', label: '售后', kind: 'select', optional: true, options: ABILITY_OPTIONS() },
    ],
  },
  {
    id: 'assets',
    title: '经验与资产',
    affects: '影响「看自己 → 适配度」与机会卡的证据可信度',
    fields: [
      {
        key: 'categoryYears',
        label: '类目经验年限',
        kind: 'select',
        optional: true,
        options: [
          { value: 'none', label: '没做过' },
          { value: 'lt1', label: '不到 1 年' },
          { value: 'y1_3', label: '1-3 年' },
          { value: 'y3_5', label: '3-5 年' },
          { value: 'gt5', label: '5 年以上' },
        ],
      },
      {
        key: 'hasSuccessProject',
        label: '是否有成功项目',
        kind: 'select',
        optional: true,
        options: [
          { value: 'yes', label: '有（做出过成绩）' },
          { value: 'no', label: '没有' },
        ],
      },
      {
        key: 'hasAsset',
        label: '现有 Listing / 品牌资产',
        kind: 'select',
        optional: true,
        options: [
          { value: 'both', label: 'Listing 与品牌都有' },
          { value: 'listing_only', label: '只有 Listing' },
          { value: 'brand_only', label: '只有品牌' },
          { value: 'none', label: '都没有' },
        ],
      },
      {
        key: 'hasFeedbackChannel',
        label: '客户反馈渠道',
        kind: 'select',
        optional: true,
        hint: '有没有稳定拿到用户反馈的渠道',
        options: [
          { value: 'yes', label: '有' },
          { value: 'no', label: '没有' },
        ],
      },
      {
        key: 'asinNote',
        label: '现有 ASIN / 链接',
        kind: 'text',
        optional: true,
        placeholder: '例如：B0XXXXXXXX（没有就留空）',
      },
    ],
  },
  {
    id: 'notes',
    title: '表达与备注',
    affects: '影响 AI 怎么说话与「机会卡」的落地说明（不参与任何打分）',
    fields: [
      {
        key: 'analysisStyle',
        label: '希望 AI 怎么说',
        kind: 'select',
        optional: true,
        options: [
          { value: 'conclusion_first', label: '结论先行' },
          { value: 'evidence_first', label: '先看证据' },
          { value: 'action_list', label: '给动作清单' },
        ],
      },
      {
        key: 'freeNote',
        label: '一句话备注',
        kind: 'text',
        optional: true,
        placeholder: '任何希望 AI 记住的业务偏好或禁区',
      },
    ],
  },
];

/** 统一的能力档位（六项能力共用同一套下拉，避免每组一套说法） */
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
 * 自由文本字段的**唯一来源**：恰好 3 个。
 * 守卫（tests/capabilityDerivation.test.ts）会断言：① 数量 = 3；② 注册表里 `kind === 'text'` 的字段与它完全一致；
 * ③ 设置页 profile tab 里的文本输入框数量不超过 3。
 */
export const BACKGROUND_TEXT_FIELD_KEYS = ['brandName', 'asinNote', 'freeNote'] as const;
export type BackgroundTextFieldKey = (typeof BACKGROUND_TEXT_FIELD_KEYS)[number];
export const MAX_BACKGROUND_TEXT_FIELDS = 3;

/* ────────────────────────────── 数据结构 ────────────────────────────── */

export interface UserBackgroundProfile {
  /** 选择题 / 多选：字段 key → 值（多选为数组）。没填就是没有这个键 */
  fields: Record<string, string | string[]>;
  /** 自由文本（仅 3 个） */
  notes: Record<string, string>;
  /** 旧版自由文本背景：结构化不了的部分原样留档，仍然进 AI 上下文 */
  legacyNotes: string;
  updatedAt: string;
}

export const EMPTY_USER_BACKGROUND: UserBackgroundProfile = {
  fields: {},
  notes: {},
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

export const ADMIN_DEFAULT_USER_BACKGROUND: UserBackgroundProfile = {
  fields: {
    sellerType: 'brand',
    teamSize: 's3_9',
    revenueTier: 'm1_10',
    marketplaces: ['US', 'EU'],
    budgetPerProject: 'w20_100',
    validationCycle: 'm1_3',
    riskAppetite: 'balanced',
    paymentTerms: 'partial',
    supplyType: 'partner_factory',
    hasMold: 'partial',
    moqRange: 'm500_1000',
    leadTimeRange: 'd15_30',
    qcMethod: 'third_party',
    certifications: ['CE', 'FCC'],
    legalSupport: 'outsourced',
    productDef: 'in_house',
    rnd: 'outsourced_ok',
    content: 'outsourced_ok',
    ads: 'outsourced_ok',
    ops: 'in_house',
    afterSales: 'in_house',
    categoryYears: 'y3_5',
    hasSuccessProject: 'yes',
    hasAsset: 'listing_only',
    hasFeedbackChannel: 'yes',
    analysisStyle: 'conclusion_first',
  },
  notes: {
    brandName: 'OG 项目组、Kairo 市场调研工具',
    asinNote: '',
    freeNote: '结论必须有数据证据和置信度说明；避免空泛建议；优先复用现有供应链与可执行动作。',
  },
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

/** 归一化：结构非法一律丢弃（不猜用户意图）；旧记录迁移进 legacyNotes */
export function normalizeUserBackground(
  raw: Record<string, unknown> | null | undefined,
  defaults: UserBackgroundProfile
): UserBackgroundProfile {
  if (!raw) return { ...defaults, fields: { ...defaults.fields }, notes: { ...defaults.notes } };

  const fields: Record<string, string | string[]> = {};
  const rawFields = raw.fields;
  if (rawFields && typeof rawFields === 'object' && !Array.isArray(rawFields)) {
    for (const field of BACKGROUND_FIELDS) {
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

  const legacyNotes =
    (typeof raw.legacyNotes === 'string' && raw.legacyNotes.trim() ? raw.legacyNotes.trim() : '') ||
    legacyNotesFromRaw(raw);

  return {
    fields,
    notes,
    legacyNotes: legacyNotes || defaults.legacyNotes,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : defaults.updatedAt,
  };
}

function profileStorageKey(user?: SessionUser | null): string {
  const u = user ?? getCurrentUser();
  return u?.id ? `${PROFILE_KEY_PREFIX}${u.id}` : LEGACY_PROFILE_KEY;
}

function defaultProfileFor(user?: SessionUser | null): UserBackgroundProfile {
  const base = isAdminSession(user ?? getCurrentUser()) ? ADMIN_DEFAULT_USER_BACKGROUND : EMPTY_USER_BACKGROUND;
  return { ...base, fields: { ...base.fields }, notes: { ...base.notes } };
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
  const next: UserBackgroundProfile = { ...profile, updatedAt: new Date().toISOString() };
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
 * - `exclusiveValue`（如认证里的「暂无」）与其它选项互斥：选中它清掉其它，选其它清掉它；
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
  /** 已填字段数（多选只要选了至少一个就算填了） */
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

/** 完整度人话（明确说清"影响的是可信度，不阻塞流程"，并说明"填得越全，看自己的问题就越少"） */
export function describeBackgroundCompleteness(report: BackgroundCompleteness): string {
  if (report.filled === 0) {
    return `背景信息完整度 0/${report.total}：还没填（只会降低适配度可信度，不阻塞分析；填得越全，「看自己」的问题就越少）`;
  }
  if (report.fraction >= 0.8) return `背景信息完整度 ${report.filled}/${report.total}：已足够可信`;
  return `背景信息完整度 ${report.filled}/${report.total}：将影响适配度可信度，可随时补（填得越全，「看自己」的问题就越少）`;
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
      const value = f.kind === 'select' || (list.length === 1 && f.options)
        ? list
            .map((v) => f.options?.find((o) => o.value === v)?.label ?? v)
            .join(' / ')
        : list.join(' / ');
      out.push({ key: f.key, label: f.label, group: g.id, groupTitle: g.title, value, affects: g.affects });
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
  for (const g of BACKGROUND_GROUPS) {
    const items = summarizeBackground(p).filter((i) => i.group === g.id);
    if (items.length === 0) continue;
    lines.push(`- ${g.title}（${g.affects}）：${items.map((i) => `${i.label}=${i.value}`).join('；')}`);
  }
  if (String(p.legacyNotes || '').trim()) {
    lines.push(`- 历史填写（旧版自由文本，未结构化）：${p.legacyNotes.trim().replace(/\n/g, '；')}`);
  }
  return lines.join('\n');
}
