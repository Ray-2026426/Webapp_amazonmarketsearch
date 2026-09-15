// 品牌档案（品牌资产与信息）—— 纯数据层，不含任何 React，也不碰 localStorage。
//
// 为什么单独一个文件（用户诉求：「品牌应该可以添加多个」+「品牌点进去还有次级页面，可以设置品牌的相关资产和信息」）：
// 1. 一个卖家往往同时持有多个品牌（多站点/多类目/收购来的品牌），原来只有一个「品牌名」文本框，表达不了；
// 2. 品牌是有**次级页**的对象：商标号、备案状态、A+ 状态、评分/评论量、价格带定位……这些都不是"背景信息的一句话"；
// 3. 品牌档案**存在背景信息里**（同一个 localStorage 键、同一个账号级口径、同一个更新事件），
//    所以本文件只提供**纯函数**：模型 + 校验 + 汇总，读写仍然归 userBackground.ts —— 避免出现两份存储。
//
// 铁律（与 userBackground 一致）：只影响判断输入，不影响任何评分公式（机会卡权重固定 25/25/25/15/10）。

/** 品牌档案（一个品牌一条记录；`id` 用于稳定引用，改品牌名不会丢资产） */
export interface BrandProfile {
  id: string;
  name: string;
  /** 默认品牌：设置页/看自己优先展示它（不改变任何判断规则，只是展示与填表的默认对象） */
  default?: boolean;
  /** 身份 / 资产 / 策略：字段 key → 值（多选为数组） */
  fields: Record<string, string | string[]>;
  updatedAt: string;
}

export type BrandFieldKind = 'text' | 'select' | 'multi';

export interface BrandFieldOption {
  value: string;
  label: string;
}

export interface BrandField {
  key: string;
  label: string;
  kind: BrandFieldKind;
  options?: BrandFieldOption[];
  placeholder?: string;
  /** 一句话：这一项在影响五看里的哪个判断（UI 上的角标/短提示；测试断言非空） */
  affects: string;
}

export interface BrandFieldGroup {
  id: string;
  title: string;
  /** 一句话：这一组影响哪个判断 */
  affects: string;
  fields: BrandField[];
}

/**
 * 品牌次级页的字段表（三组：身份 / 资产 / 策略）。
 * 每一组、每一个字段都必须能回答「它改变五看里的哪个判断」——这是本项目对"字段"的硬要求。
 */
export const BRAND_GROUPS: BrandFieldGroup[] = [
  {
    id: 'identity',
    title: '品牌身份',
    affects: '影响硬约束：没有商标/备案 ⇒ 拿不到 A+、品牌旗舰店与品牌广告，「看自己」按缺口处理',
    fields: [
      { key: 'name', label: '品牌名', kind: 'text', placeholder: '例如：Kairo', affects: '影响「看竞对」里"品牌壁垒"是否与你有关，也决定下面所有资产挂在谁名下' },
      {
        key: 'trademarkStatus',
        label: '商标状态',
        kind: 'select',
        affects: '影响硬约束（商标）：只有"已注册/申请中"才谈得上备案与品牌保护',
        options: [
          { value: 'registered', label: '已注册（R 标）' },
          { value: 'pending', label: '申请中（TM）' },
          { value: 'none', label: '没有商标' },
          { value: 'licensed', label: '用别人的授权' },
        ],
      },
      { key: 'trademarkNo', label: '商标号', kind: 'text', placeholder: '例如：12345678 / 马德里号', affects: '影响备案能否一次过：备案要商标号与主体一致' },
      { key: 'trademarkClass', label: '注册类目（尼斯分类）', kind: 'text', placeholder: '例如：第 21 类 / 第 20 类', affects: '影响硬约束：商标类目与本项目品类不符时，备案保护不到这个品类' },
      {
        key: 'registryStatus',
        label: '品牌备案（Brand Registry）',
        kind: 'select',
        affects: '影响「赢的路径」：备案是 A+、品牌旗舰店、品牌广告与透明计划的前置条件',
        options: [
          { value: 'registered', label: '已备案' },
          { value: 'in_progress', label: '备案中' },
          { value: 'none', label: '没备案' },
          { value: 'not_planned', label: '不打算备案' },
        ],
      },
      { key: 'companyEntity', label: '所属公司主体', kind: 'text', placeholder: '例如：深圳某某科技有限公司', affects: '影响合规与备案：主体必须与商标持有人、店铺主体一致' },
    ],
  },
  {
    id: 'assets',
    title: '品牌资产',
    affects: '影响「看竞对 → 我们能不能正面打」与机会卡的证据可信度（有现成资产 ⇒ 起量更快）',
    fields: [
      { key: 'storefrontUrl', label: '品牌旗舰店链接', kind: 'text', placeholder: 'https://www.amazon.com/stores/...', affects: '影响「看机会 → 先做什么」：已有旗舰店就能直接承接流量' },
      {
        key: 'aplusStatus',
        label: 'A+ 页面状态',
        kind: 'select',
        affects: '影响「看竞对 → 转化能力」：A+ 是亚马逊转化的主要杠杆之一',
        options: [
          { value: 'done', label: '已做（含品牌故事）' },
          { value: 'partial', label: '只做了基础 A+' },
          { value: 'not_yet', label: '还没做' },
        ],
      },
      { key: 'brandStory', label: '品牌故事', kind: 'text', placeholder: '一句话讲清品牌主张', affects: '影响内容能力判断与 AI 写 Listing 的口径' },
      {
        key: 'visualAsset',
        label: '主视觉 / logo',
        kind: 'select',
        affects: '影响「看自己 → 图片与内容能力」，也决定新品能不能立刻铺视觉差异化',
        options: [
          { value: 'full_vi', label: '有完整 VI（logo + 视觉规范）' },
          { value: 'logo_only', label: '只有 logo' },
          { value: 'none', label: '还没有' },
        ],
      },
      {
        key: 'listingCount',
        label: '已有 Listing 数',
        kind: 'select',
        affects: '影响「看自己 → 现有链接资产」：老链接数量决定能不能"先改老品再开新品"',
        options: [
          { value: '0', label: '0 条' },
          { value: '1_5', label: '1-5 条' },
          { value: '6_20', label: '6-20 条' },
          { value: 'gt20', label: '20 条以上' },
        ],
      },
      {
        key: 'avgRating',
        label: '平均评分',
        kind: 'select',
        affects: '影响「看竞对 → 口碑起点」：低分品牌进新品类前要先修老品',
        options: [
          { value: 'none', label: '还没有评分' },
          { value: 'lt4', label: '低于 4.0' },
          { value: 'r4_43', label: '4.0-4.3' },
          { value: 'r43_46', label: '4.3-4.6' },
          { value: 'gt46', label: '4.6 以上' },
        ],
      },
      {
        key: 'reviewTotal',
        label: '累计评论数',
        kind: 'select',
        affects: '影响评论资源的判断：老评论是可复用的冷启动资产',
        options: [
          { value: '0', label: '0 条' },
          { value: 'lt50', label: '50 条以内' },
          { value: 'r50_500', label: '50-500 条' },
          { value: 'r500_5000', label: '500-5000 条' },
          { value: 'gt5000', label: '5000 条以上' },
        ],
      },
      {
        key: 'brandSearchVolume',
        label: '品牌搜索量（若已知）',
        kind: 'select',
        affects: '影响「看市场 → 值不值得进」：有品牌搜索量说明需求已经被你自己的品牌接住过',
        options: [
          { value: 'unknown', label: '不知道' },
          { value: 'lt10k', label: '1 万/月以内' },
          { value: 'r10k_100k', label: '1-10 万/月' },
          { value: 'gt100k', label: '10 万/月以上' },
        ],
      },
      {
        key: 'linkedStores',
        label: '关联店铺 / 账号',
        kind: 'multi',
        affects: '影响「看机会 → 谁能承接」：品牌挂在哪些站点店铺上，决定新品能复用到哪个账号',
        options: [
          { value: 'US', label: '美国店' },
          { value: 'EU', label: '欧洲店' },
          { value: 'JP', label: '日本店' },
          { value: 'OTHER', label: '其他站点店' },
        ],
      },
    ],
  },
  {
    id: 'strategy',
    title: '品牌策略',
    affects: '影响「看机会 → 这个品类适不适合你」与赢的路径（价格带与卖点决定能不能"人优我廉"）',
    fields: [
      {
        key: 'priceBand',
        label: '价格带定位',
        kind: 'select',
        affects: '影响「人优我廉」：低价走量 vs 高溢价，对成本与广告的要求完全不同',
        options: [
          { value: 'low', label: '低价走量' },
          { value: 'mid_value', label: '中价性价比' },
          { value: 'mid_premium', label: '中高价（品质）' },
          { value: 'premium', label: '高价（品牌溢价）' },
        ],
      },
      {
        key: 'sellingPoints',
        label: '主打卖点',
        kind: 'multi',
        affects: '影响「看竞对 → 可攻击缝隙」：卖点决定你要抢的是功能、视觉还是服务差异',
        options: [
          { value: 'feature', label: '功能差异' },
          { value: 'material', label: '材质工艺' },
          { value: 'design', label: '外观设计' },
          { value: 'bundle', label: '套装组合' },
          { value: 'compliance', label: '认证合规' },
          { value: 'service', label: '服务承诺' },
        ],
      },
      { key: 'targetAudience', label: '目标人群', kind: 'text', placeholder: '例如：租房党 / 宝妈 / 户外露营人群', affects: '影响「看用户 → 需求分类」能不能直接复用你的既有客群' },
      {
        key: 'competitorBrands',
        label: '竞品品牌（可多值）',
        kind: 'multi',
        affects: '影响「看竞对」的取样：你已经在盯的品牌应该先进样本，而不是 AI 随便挑',
        options: [],
      },
      { key: 'nextStep', label: '下一步计划', kind: 'text', placeholder: '例如：Q3 拓 2 条新品 / 先补齐 A+', affects: '影响「看机会 → 先做什么」的排序（时间窗口与动作优先级）' },
    ],
  },
];

export const BRAND_FIELDS: BrandField[] = BRAND_GROUPS.flatMap((g) => g.fields);

export const BRAND_FIELD_KEYS: string[] = BRAND_FIELDS.map((f) => f.key);

/** 品牌名的最大长度与单账号品牌数量上限（防止把设置页撑爆，也防止脏数据） */
export const MAX_BRANDS = 20;
export const MAX_BRAND_NAME_LENGTH = 60;
/** 单个多值字段（如竞品品牌）最多记多少项 */
export const MAX_BRAND_FIELD_ITEMS = 20;

/** 一个品牌的资产字段里，"多值自由文本"的字段（竞品品牌）：选项由用户自己填，不从白名单校验 */
export const BRAND_FREETEXT_MULTI_KEYS = ['competitorBrands'] as const;

export function emptyBrand(name = ''): BrandProfile {
  return { id: brandId(name), name, fields: {}, updatedAt: '' };
}

/** 稳定的品牌 id：同名品牌多次生成得到同一个 id（迁移/去重都靠它），不含随机数 */
export function brandId(name: string): string {
  const slug = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `brand:${slug || 'unnamed'}`;
}

/** 品牌名校验：去空白、截断超长、空名不算品牌（返回 '' 表示非法） */
export function normalizeBrandName(raw: unknown): string {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return '';
  return name.slice(0, MAX_BRAND_NAME_LENGTH);
}

function allowedValues(key: string): string[] | null {
  const field = BRAND_FIELDS.find((f) => f.key === key);
  if (!field || field.kind === 'text') return null;
  const opts = field.options ?? [];
  // 允许自由填写的多值字段（竞品品牌）不设白名单：它本来就是用户自己的品牌名
  if (opts.length === 0 && (BRAND_FREETEXT_MULTI_KEYS as readonly string[]).includes(key)) return null;
  return opts.map((o) => o.value);
}

/** 归一化一个品牌的字段：非法值一律丢弃（不猜用户意图），与背景信息同一套口径 */
export function normalizeBrandFields(raw: unknown): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const input = raw as Record<string, unknown>;
  for (const field of BRAND_FIELDS) {
    if (field.key === 'name') continue; // 名字在 BrandProfile.name 上
    const v = input[field.key];
    const allowed = allowedValues(field.key);
    if (field.kind === 'multi') {
      const list = Array.isArray(v)
        ? v.map((x) => String(x ?? '').trim()).filter(Boolean)
        : typeof v === 'string' && v.trim()
          ? [v.trim()]
          : [];
      const kept = (allowed ? list.filter((x) => allowed.includes(x)) : list).slice(0, MAX_BRAND_FIELD_ITEMS);
      if (kept.length > 0) out[field.key] = [...new Set(kept)];
    } else if (typeof v === 'string' && v.trim()) {
      const value = v.trim();
      if (!allowed || allowed.includes(value)) out[field.key] = value;
    }
  }
  return out;
}

/**
 * 归一化品牌列表：丢非法项、按名字去重、保证「有且只有一个默认品牌」。
 * 完全不猜用户意图：没有名字的条目直接丢掉。
 */
export function normalizeBrands(raw: unknown): BrandProfile[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: BrandProfile[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const name = normalizeBrandName(rec.name);
    if (!name) continue;
    const id = typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim() : brandId(name);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name,
      default: rec.default === true,
      fields: normalizeBrandFields(rec.fields),
      updatedAt: typeof rec.updatedAt === 'string' ? rec.updatedAt : '',
    });
    if (out.length >= MAX_BRANDS) break;
  }
  return withSingleDefault(out);
}

/** 有且只有一个默认品牌：显式标了默认就用它，否则用第一个 */
export function withSingleDefault(brands: BrandProfile[]): BrandProfile[] {
  if (brands.length === 0) return [];
  const idx = brands.findIndex((b) => b.default);
  const keep = idx >= 0 ? idx : 0;
  return brands.map((b, i) => ({ ...b, default: i === keep }));
}

export function defaultBrand(brands: BrandProfile[] | null | undefined): BrandProfile | null {
  const list = brands ?? [];
  if (list.length === 0) return null;
  return list.find((b) => b.default) ?? list[0];
}

/** 品牌名列表（背景信息里 `brandNames` 字段的唯一取值口径） */
export function brandNamesOf(brands: BrandProfile[] | null | undefined): string[] {
  return (brands ?? []).map((b) => b.name).filter(Boolean);
}

export function findBrandByName(brands: BrandProfile[] | null | undefined, name: string): BrandProfile | null {
  const target = normalizeBrandName(name).toLowerCase();
  if (!target) return null;
  return (brands ?? []).find((b) => b.name.toLowerCase() === target) ?? null;
}

/** 添加一个品牌（重名不重复添加，直接返回原列表 —— 不静默产生两个同名品牌） */
export function addBrand(brands: BrandProfile[], name: string): { brands: BrandProfile[]; added: BrandProfile | null } {
  const clean = normalizeBrandName(name);
  if (!clean) return { brands, added: null };
  if (findBrandByName(brands, clean)) return { brands, added: null };
  if (brands.length >= MAX_BRANDS) return { brands, added: null };
  const added = emptyBrand(clean);
  return { brands: withSingleDefault([...brands, added]), added };
}

/** 删除品牌（删掉默认品牌时，默认位顺延给第一个；空列表就是空列表） */
export function removeBrand(brands: BrandProfile[], id: string): BrandProfile[] {
  return withSingleDefault(brands.filter((b) => b.id !== id));
}

/** 设为默认品牌 */
export function setDefaultBrand(brands: BrandProfile[], id: string): BrandProfile[] {
  if (!brands.some((b) => b.id === id)) return brands;
  return brands.map((b) => ({ ...b, default: b.id === id }));
}

/** 改品牌名（同名冲突时不动，避免两个品牌重名） */
export function renameBrand(brands: BrandProfile[], id: string, name: string): BrandProfile[] {
  const clean = normalizeBrandName(name);
  const target = brands.find((b) => b.id === id);
  if (!target) return brands;
  if (!clean) return brands; // 空名不允许：品牌名是这条记录的标识
  const clash = brands.find((b) => b.id !== id && b.name.toLowerCase() === clean.toLowerCase());
  if (clash) return brands;
  return brands.map((b) => (b.id === id ? { ...b, name: clean } : b));
}

/** 写一个品牌字段（空值即清除；与背景信息的 setBackgroundFieldValue 同一套语义） */
export function setBrandFieldValue(
  brands: BrandProfile[],
  id: string,
  key: string,
  value: string | string[]
): BrandProfile[] {
  const field = BRAND_FIELDS.find((f) => f.key === key);
  if (!field) return brands;
  // 文本与单选都存成字符串；只有多选存成数组（与背景信息的 kind 语义一致）
  if (field.kind !== 'multi') {
    const v = Array.isArray(value) ? value[0] ?? '' : value;
    return brands.map((b) => {
      if (b.id !== id) return b;
      const fields = { ...b.fields };
      if (!v.trim()) delete fields[key];
      else fields[key] = v;
      return { ...b, fields };
    });
  }
  return brands.map((b) => {
    if (b.id !== id) return b;
    const fields = { ...b.fields };
    const list = (Array.isArray(value) ? value : value ? [value] : []).map((x) => String(x ?? '').trim()).filter(Boolean);
    if (list.length === 0) delete fields[key];
    else fields[key] = [...new Set(list)];
    return { ...b, fields };
  });
}

/** 多选切换（竞品品牌这类自由多值字段用它） */
export function toggleBrandMultiValue(brands: BrandProfile[], id: string, key: string, value: string): BrandProfile[] {
  const brand = brands.find((b) => b.id === id);
  if (!brand) return brands;
  const current = Array.isArray(brand.fields[key]) ? (brand.fields[key] as string[]) : [];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  return setBrandFieldValue(brands, id, key, next);
}

/**
 * 按品牌名列表同步品牌记录（多值输入框的写回口径）：
 * 保留已有品牌的资产（按名字匹配），只补新增、只删被移除的。**改名的语义是"删旧增新"**，
 * 所以品牌编辑区用的是 renameBrand（不丢资产）——这里只服务"从名字列表整体写回"的场景。
 */
export function syncBrandNames(brands: BrandProfile[], names: string[]): BrandProfile[] {
  const wanted = names.map(normalizeBrandName).filter(Boolean);
  const kept = brands.filter((b) => wanted.some((n) => n.toLowerCase() === b.name.toLowerCase()));
  let out = kept;
  for (const name of wanted) {
    if (!findBrandByName(out, name)) out = addBrand(out, name).brands;
  }
  return withSingleDefault(out);
}

/* ────────────────────────────── 取值 / 摘要 / 完整度 ────────────────────────────── */

export function getBrandFieldValue(brand: BrandProfile | null | undefined, key: string): string | string[] {
  if (!brand) return '';
  if (key === 'name') return brand.name;
  const v = brand.fields[key];
  if (Array.isArray(v)) return v;
  return typeof v === 'string' ? v : '';
}

export function isBrandFieldFilled(brand: BrandProfile | null | undefined, key: string): boolean {
  const v = getBrandFieldValue(brand, key);
  return Array.isArray(v) ? v.length > 0 : String(v ?? '').trim().length > 0;
}

export function brandLabelOf(key: string, value: string): string {
  const field = BRAND_FIELDS.find((f) => f.key === key);
  return field?.options?.find((o) => o.value === value)?.label ?? value;
}

export interface BrandCompleteness {
  filled: number;
  total: number;
  percent: number;
  fraction: number;
  emptyItems: { key: string; label: string; affects: string }[];
}

/** 品牌资产完整度（确定性；只表示"填了多少"，不参与任何评分） */
export function computeBrandCompleteness(brand: BrandProfile | null | undefined): BrandCompleteness {
  let filled = 0;
  const emptyItems: BrandCompleteness['emptyItems'] = [];
  for (const f of BRAND_FIELDS) {
    if (isBrandFieldFilled(brand, f.key)) filled += 1;
    else emptyItems.push({ key: f.key, label: f.label, affects: f.affects });
  }
  const total = BRAND_FIELDS.length;
  return {
    filled,
    total,
    percent: total > 0 ? Math.round((filled / total) * 100) : 0,
    fraction: total > 0 ? filled / total : 0,
    emptyItems,
  };
}

export interface BrandSummaryItem {
  key: string;
  label: string;
  value: string;
  affects: string;
}

/** 已填项摘要（只读展示 + AI 上下文共用同一口径） */
export function summarizeBrand(brand: BrandProfile | null | undefined): BrandSummaryItem[] {
  if (!brand) return [];
  const out: BrandSummaryItem[] = [];
  for (const f of BRAND_FIELDS) {
    const raw = getBrandFieldValue(brand, f.key);
    const list = Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? [raw] : [];
    if (list.length === 0) continue;
    out.push({
      key: f.key,
      label: f.label,
      value: list.map((v) => (f.kind === 'text' ? v : brandLabelOf(f.key, v))).join(' / '),
      affects: f.affects,
    });
  }
  return out;
}

/** 给 AI 上下文用的品牌段落（无品牌则返回空数组） */
export function buildBrandPromptLines(brands: BrandProfile[] | null | undefined): string[] {
  const list = brands ?? [];
  if (list.length === 0) return [];
  const lines: string[] = [`- 品牌档案（共 ${list.length} 个品牌，默认：${defaultBrand(list)?.name ?? '-'}）：`];
  for (const b of list) {
    const items = summarizeBrand(b);
    lines.push(`  · ${b.name}${b.default ? '（默认）' : ''}：${items.map((i) => `${i.label}=${i.value}`).join('；') || '还没填资产'}`);
  }
  return lines;
}
