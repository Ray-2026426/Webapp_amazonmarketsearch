// 品牌多值 + 品牌次级页（PRD §15.23，用户诉求）：
//   ①「品牌应该可以添加多个」；
//   ②「品牌点进去还有次级页面，可以设置品牌的相关资产和信息」。
//
// 本套件守四件事：
//   A. 品牌是**多值**的，而且是**同一份存储**（存在背景信息里，与设置页/看自己读的是同一份数据）；
//   B. 品牌次级页的字段**齐全**（用户点名的身份/资产/策略三组），每个字段都有"它影响哪个判断"；
//   C. **不许复制两份实现**：品牌资产区块一个组件两种形态（inline + sheet），全屏页复用 L3 页壳；
//   D. 品牌数据同样**不参与任何评分公式**（与背景信息同一条铁律）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BrandDetailSheet, BrandListEditor } from '../src/components/BrandDetailSheet';

import {
  BRAND_FIELDS,
  BRAND_GROUPS,
  BRAND_FIELD_KEYS,
  MAX_BRANDS,
  addBrand,
  buildBrandPromptLines,
  computeBrandCompleteness,
  defaultBrand,
  emptyBrand,
  getBrandFieldValue,
  isBrandFieldFilled,
  normalizeBrandName,
  normalizeBrands,
  removeBrand,
  renameBrand,
  setBrandFieldValue,
  setDefaultBrand,
  summarizeBrand,
  syncBrandNames,
  toggleBrandMultiValue,
  withSingleDefault,
  type BrandProfile,
} from '../src/utils/brandStore';
import {
  BACKGROUND_FIELDS,
  BACKGROUND_GROUPS,
  EMPTY_USER_BACKGROUND,
  buildUserBackgroundSystemPrompt,
  getBackgroundFieldValue,
  isBackgroundFieldFilled,
  loadUserBackgroundById,
  normalizeUserBackground,
  saveUserBackground,
  setBackgroundFieldValue,
  summarizeBackground,
  type UserBackgroundProfile,
} from '../src/utils/userBackground';
import { brandPageInfo } from '../src/components/BrandDetailSheet';
import type { SessionUser } from '../src/utils/auth';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log('  OK ' + name);
  } catch (e) {
    failed++;
    console.error('  FAIL ' + name);
    console.error('    ' + (e instanceof Error ? e.message : String(e)));
  }
}

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function profile(over: Partial<UserBackgroundProfile> = {}): UserBackgroundProfile {
  return { ...EMPTY_USER_BACKGROUND, fields: {}, notes: {}, brands: [], ...over };
}

console.log('brand store：多值 + 归一化');

test('A. 品牌可多值：添加多个、去重、设默认、删除，且"有且只有一个默认品牌"', () => {
  let brands: BrandProfile[] = [];
  brands = addBrand(brands, 'BrandA').brands;
  const second = addBrand(brands, 'BrandB');
  brands = second.brands;
  assert.equal(brands.length, 2, '必须能加多个品牌');
  assert.equal(brands[0].default, true, '第一个品牌自动成为默认');
  assert.equal(brands[1].default, false);

  // 重名不重复添加（不静默产生两个同名品牌）
  const dup = addBrand(brands, ' branda ');
  assert.equal(dup.brands.length, 2);
  assert.equal(dup.added, null);
  // 空名不算品牌
  assert.equal(addBrand(brands, '   ').brands.length, 2);

  brands = setDefaultBrand(brands, brands[1].id);
  assert.equal(brands[1].default, true);
  assert.equal(brands[0].default, false);
  assert.equal(withSingleDefault(brands).filter((b) => b.default).length, 1);

  brands = removeBrand(brands, brands[1].id);
  assert.equal(brands.length, 1);
  assert.equal(brands[0].default, true, '删掉默认品牌后默认位顺延');
  assert.equal(defaultBrand(brands)!.name, 'BrandA');

  assert.equal(atBrandLimit(addBrand, MAX_BRANDS), true, `最多 ${MAX_BRANDS} 个品牌（超出的直接不加）`);
});

/** 辅助：加到上限后不能再加 */
function atBrandLimit(
  add: (b: BrandProfile[], n: string) => { brands: BrandProfile[] },
  limit: number
): boolean {
  let list: BrandProfile[] = [];
  for (let i = 0; i < limit + 3; i++) list = add(list, `Brand${i}`).brands;
  return list.length === limit;
}

test('A. 归一化：非法项丢弃、坏数据不炸、改名不丢资产、字段白名单生效', () => {
  const raw = [
    { name: '  BrandA  ', fields: { trademarkStatus: 'registered', trademarkNo: '123', bogusKey: 'x' } },
    { name: '' }, // 没名字 → 丢掉
    'nope',
    { name: 'BrandA' }, // 重名 id → 丢掉
    { name: 'BrandB', fields: { trademarkStatus: '不存在的值', priceBand: 'low', sellingPoints: ['feature', 'bogus'] } },
  ];
  const brands = normalizeBrands(raw);
  assert.deepEqual(brands.map((b) => b.name), ['BrandA', 'BrandB']);
  assert.equal(brands[0].fields.trademarkNo, '123');
  assert.equal(brands[0].fields.bogusKey, undefined, '注册表里没有的字段丢弃');
  assert.equal(brands[1].fields.trademarkStatus, undefined, '非法选项值丢弃（不猜）');
  assert.equal(brands[1].fields.priceBand, 'low');
  assert.deepEqual(brands[1].fields.sellingPoints, ['feature'], '多选按白名单过滤');

  assert.deepEqual(normalizeBrands(null), []);
  assert.deepEqual(normalizeBrands({ nope: 1 }), []);
  assert.equal(normalizeBrandName('  A   B '), 'A B');
  assert.equal(normalizeBrandName(''), '');

  // 改名保留资产；改名撞车则不生效
  const renamed = renameBrand(brands, brands[0].id, 'BrandA2');
  assert.equal(renamed[0].name, 'BrandA2');
  assert.equal(renamed[0].fields.trademarkNo, '123', '改名不能丢资产');
  assert.equal(renameBrand(brands, brands[0].id, 'BrandB')[0].name, 'BrandA', '重名时保持原样');
  assert.equal(renameBrand(brands, brands[0].id, '')[0].name, 'BrandA', '空名不允许');
});

test('A. 品牌字段读写是纯函数（多值切换 / 空值清除）', () => {
  let brands = addBrand([], 'BrandA').brands;
  const id = brands[0].id;
  brands = setBrandFieldValue(brands, id, 'priceBand', 'mid_value');
  assert.equal(getBrandFieldValue(brands[0], 'priceBand'), 'mid_value');
  brands = setBrandFieldValue(brands, id, 'priceBand', '');
  assert.equal(getBrandFieldValue(brands[0], 'priceBand'), '', '空值 = 清除');
  brands = toggleBrandMultiValue(brands, id, 'sellingPoints', 'feature');
  brands = toggleBrandMultiValue(brands, id, 'sellingPoints', 'design');
  assert.deepEqual(brands[0].fields.sellingPoints, ['feature', 'design']);
  brands = toggleBrandMultiValue(brands, id, 'sellingPoints', 'feature');
  assert.deepEqual(brands[0].fields.sellingPoints, ['design']);
  assert.equal(setBrandFieldValue(brands, 'no-such-id', 'priceBand', 'low').length, 1, '未知品牌 id 不新建记录');

  // 完整度与摘要：分母 = 字段总数，摘要只列已填项且带"影响什么"
  const report = computeBrandCompleteness(brands[0]);
  assert.equal(report.total, BRAND_FIELDS.length);
  assert.equal(report.filled, 2, 'name + sellingPoints');
  const summary = summarizeBrand(brands[0]);
  assert.equal(summary.find((i) => i.key === 'sellingPoints')!.value, '外观设计', '选项值翻成人话');
  assert.ok(summary.every((i) => i.affects.length > 0));
  assert.equal(computeBrandCompleteness(emptyBrand('')).filled, 0);
});

test('A. 品牌名列表写回：保留已有品牌资产，只补新增、只删移除（不是删了重建）', () => {
  let brands = addBrand([], 'BrandA').brands;
  brands = setBrandFieldValue(brands, brands[0].id, 'trademarkNo', 'TM-1');
  const synced = syncBrandNames(brands, ['BrandA', 'BrandC']);
  assert.deepEqual(synced.map((b) => b.name), ['BrandA', 'BrandC']);
  assert.equal(synced[0].fields.trademarkNo, 'TM-1', '同步名字不能丢资产');
  const removed = syncBrandNames(synced, ['BrandC']);
  assert.deepEqual(removed.map((b) => b.name), ['BrandC']);
});

console.log('品牌次级页：字段齐全 + 与背景信息同一份存储');

test('B. 品牌次级页三组字段齐全（用户点名的身份/资产/策略都在），每个字段都有"影响哪个判断"', () => {
  assert.deepEqual(BRAND_GROUPS.map((g) => g.id), ['identity', 'assets', 'strategy']);
  for (const g of BRAND_GROUPS) {
    assert.ok(g.title.trim().length >= 2, `${g.id} 要有标题`);
    assert.ok(g.affects.includes('影响'), `${g.id} 的 affects 必须说明影响什么：${g.affects}`);
    assert.ok(g.fields.length >= 5, `${g.id} 字段太少：${g.fields.length}`);
  }
  for (const f of BRAND_FIELDS) {
    assert.ok(f.affects.trim().length >= 10, `${f.key} 的 affects 太短：${f.affects}`);
    assert.ok(f.affects.includes('影响'), `${f.key} 的 affects 必须说明影响什么`);
    if (f.kind === 'select' || (f.kind === 'multi' && f.key !== 'competitorBrands')) {
      assert.ok((f.options ?? []).length >= 2, `${f.key} 是选择题，必须有 2 个以上选项`);
    }
  }
  // 用户点名的字段一个都不能少
  for (const key of [
    'name',
    'trademarkStatus',
    'trademarkNo',
    'trademarkClass',
    'registryStatus',
    'companyEntity',
    'storefrontUrl',
    'aplusStatus',
    'brandStory',
    'visualAsset',
    'listingCount',
    'avgRating',
    'reviewTotal',
    'brandSearchVolume',
    'linkedStores',
    'priceBand',
    'sellingPoints',
    'targetAudience',
    'competitorBrands',
    'nextStep',
  ]) {
    assert.ok(BRAND_FIELD_KEYS.includes(key), `品牌次级页缺少用户点名的字段：${key}`);
  }
  assert.equal(new Set(BRAND_FIELD_KEYS).size, BRAND_FIELD_KEYS.length, '字段 key 不能重复');
});

test('B. 品牌存在于背景信息里（同一份存储）：`brandNames` 字段的值就是品牌列表', () => {
  const brandNamesField = BACKGROUND_FIELDS.find((f) => f.key === 'brandNames')!;
  assert.equal(brandNamesField.kind, 'list', '品牌名必须是多值（list），不是单值文本框');

  let p = profile();
  assert.deepEqual(getBackgroundFieldValue(p, 'brandNames'), [], '没品牌时是空数组');
  assert.equal(isBackgroundFieldFilled(p, 'brandNames'), false);

  // 走背景信息的写入口径 → 落到 profile.brands（不是 fields 里的第二份数据）
  p = setBackgroundFieldValue(p, 'brandNames', ['BrandA']);
  assert.equal(p.brands.length, 1);
  assert.equal(p.fields.brandNames, undefined, '品牌名不得同时写进 fields（杜绝两份存储）');
  p = setBackgroundFieldValue(p, 'brandNames', ['BrandA', 'BrandB']);
  assert.deepEqual(getBackgroundFieldValue(p, 'brandNames'), ['BrandA', 'BrandB']);
  assert.equal(isBackgroundFieldFilled(p, 'brandNames'), true);

  // 完整度/摘要把品牌算成一项（否则"有品牌"这件事在完整度里看不见）
  const summary = summarizeBackground(p);
  assert.equal(summary.find((i) => i.key === 'brandNames')!.value, 'BrandA / BrandB');
  // 品牌资产进 AI 上下文
  const prompt = buildUserBackgroundSystemPrompt(p);
  assert.ok(prompt.includes('BrandA'), '品牌必须进 AI 上下文');
  assert.ok(buildBrandPromptLines(p.brands).join('\n').includes('BrandB'));
});

test('B. localStorage 往返：品牌与背景信息一起存、一起读；旧版"品牌名"文本框迁移成 1 个品牌', () => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;

  // 坏数据不炸
  store.set('amzdev_user_background:u1', '{ 这不是 JSON');
  assert.equal(loadUserBackgroundById('u1').brands.length, 0);

  // 新版：brands 一起存取
  let p = loadUserBackgroundById('u1');
  p = setBackgroundFieldValue(p, 'brandNames', ['BrandA', 'BrandB']);
  p = { ...p, brands: setBrandFieldValue(p.brands, p.brands[0].id, 'trademarkNo', 'TM-9') };
  saveUserBackground(p, { id: 'u1' } as SessionUser);
  const reloaded = loadUserBackgroundById('u1');
  assert.deepEqual(reloaded.brands.map((b) => b.name), ['BrandA', 'BrandB']);
  assert.equal(reloaded.brands[0].fields.trademarkNo, 'TM-9');
  assert.equal(reloaded.brands[0].default, true);
  assert.ok(reloaded.updatedAt.length > 0);

  // 旧版：只有一个「品牌名」文本框 → 迁移成 1 个品牌，不丢用户填过的东西
  store.set(
    'amzdev_user_background:u2',
    JSON.stringify({ fields: {}, notes: { brandName: '老品牌' }, legacyNotes: '' })
  );
  const migrated = loadUserBackgroundById('u2');
  assert.deepEqual(migrated.brands.map((b) => b.name), ['老品牌'], '旧版品牌名必须迁移成品牌记录');
  assert.equal(migrated.brands[0].default, true);

  // 归一化入口：brands 非数组也不炸
  assert.deepEqual(normalizeUserBackground({ brands: 'oops' }, EMPTY_USER_BACKGROUND).brands, []);
});

test('C. 不许复制两份实现：品牌资产一个组件两种形态，全屏页复用 L3 页壳', () => {
  const src = read('src/components/BrandDetailSheet.tsx');
  // 只扫代码：注释里说明"有两种形态"不算复制实现
  const code = src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
  assert.ok(src.includes('export function BrandAssetsBlock('), 'BrandAssetsBlock 必须是导出组件');
  assert.ok(count(code, '<BrandAssetsBlock') >= 2, '同一份实现必须同时用于内联与全屏页');
  assert.equal(count(code, 'variant="sheet"'), 1, 'variant="sheet" 只应出现一次（全屏页那处）');
  assert.ok(count(code, 'variant="inline"') >= 1, '内联形态也要用同一个组件');
  assert.equal(count(code, 'BRAND_GROUPS.map'), 1, '字段渲染只能有一份（由注册表驱动）');
  assert.ok(src.includes("import { L3Sheet"), '全屏页必须复用 L3 页壳，不许另写一份');
  assert.ok(src.includes('<L3Sheet page={brandPageInfo(brand)}'), '页壳的页面信息来自品牌页契约函数');
  assert.ok(!/localStorage\.(get|set|remove)Item/.test(src), '品牌组件不许自己碰存储（存储归 userBackground）');

  // 设置页只使用导出的组件，不手写第二份品牌表单
  const panel = read('src/components/AiSettingsPanel.tsx');
  assert.equal(count(panel, '<BrandListEditor'), 1, '设置页只能通过 BrandListEditor 渲染品牌列表');
  assert.equal(count(panel, '<BrandDetailSheet'), 1, '设置页只能通过 BrandDetailSheet 打开全屏品牌页');
  assert.ok(!panel.includes('BRAND_GROUPS.map'), '设置页不许自己再渲染一遍品牌字段');

  // 品牌页的四句契约（与项目既有的二级页同一套口径）
  const page = brandPageInfo({ ...emptyBrand('BrandA'), default: true });
  for (const key of ['problem', 'entry', 'backTo', 'depends'] as const) {
    assert.ok(page[key].trim().length >= 8, `品牌页的 ${key} 太短：${page[key]}`);
  }
  assert.ok(page.depends.includes('看自己'), '品牌页必须写明它属于哪一看');
  assert.ok(page.backTo.startsWith('返回'), '品牌页的 backTo 必须以"返回"开头');
  assert.ok(page.entry.includes('品牌'), '品牌页要写清入口');
  assert.ok(page.title.includes('BrandA'), '页标题要带品牌名');
  assert.ok(page.deviation!.includes('线框图'), '非线框图页面必须如实声明偏离');
  assert.ok(/用户|指示|要求/.test(page.deviation!), '偏离说明要交代是谁要求的');
  assert.equal(brandPageInfo(null).title.includes('未命名'), true, '没有品牌时也不许渲染空标题');
});

test('C. 品牌页/品牌列表覆盖注册表里的每个字段（不许有"填了也白填"的字段）', () => {
  const src = read('src/components/BrandDetailSheet.tsx');
  // 字段渲染由 BRAND_GROUPS 驱动：注册表里加字段，界面自动出现
  assert.ok(src.includes('g.fields.map'), '品牌字段必须由注册表驱动渲染');
  for (const f of BRAND_FIELDS) {
    assert.ok(
      !src.includes(`'${f.key}': {`) && !src.includes(`"${f.key}": {`),
      `不许在组件里硬编码字段清单（${f.key}）`
    );
  }
  // 自由多值字段（竞品品牌）在字段表里没有预置选项，界面必须给它一个输入控件
  const competitors = BRAND_FIELDS.find((f) => f.key === 'competitorBrands')!;
  assert.equal((competitors.options ?? []).length, 0, '竞品品牌是自由多值：不该预设选项');
  assert.ok(src.includes('MultiTextInput'), '自由多值字段必须有输入控件');
});

console.log('品牌与评分公式的关系（同背景信息：只做判断输入）');

test('D. 品牌模块不出现任何权重/评分逻辑（机会卡权重固定 25/25/25/15/10）', () => {
  const brandSrc = read('src/utils/brandStore.ts');
  assert.ok(!/weight/i.test(brandSrc), '品牌模块不得出现权重');
  assert.ok(!/score/i.test(brandSrc), '品牌模块不得出现评分逻辑');
  assert.ok(!/localStorage\.(get|set|remove)Item/.test(brandSrc), '品牌模块是纯数据层：存储归 userBackground');
  const bgSrc = read('src/utils/userBackground.ts');
  assert.ok(bgSrc.includes("from './brandStore'"), '背景信息是品牌数据的唯一存储入口');
});

test('D. 品牌资产不影响背景信息完整度以外的任何东西：完整度只多算 1 项（品牌名）', () => {
  const empty = profile();
  const withBrand = setBackgroundFieldValue(empty, 'brandNames', ['BrandA']);
  const total = BACKGROUND_FIELDS.length;
  assert.equal(
    BACKGROUND_GROUPS.flatMap((g) => g.fields).filter((f) => f.key === 'brandNames').length,
    1,
    '品牌在背景信息里只算一项'
  );
  // 只有一个品牌的账号：品牌相关能力仍然由背景信息的品牌字段推导，不由资产条数决定
  assert.ok(total >= 20 && total <= 30, `字段总数应在 20-30，实际 ${total}`);
  assert.equal(withBrand.brands.length, 1);
});

test('E. 真渲染一次：品牌列表（内联）与品牌资产全屏页都能渲染出来，且角标是收起态', () => {
  const brands = withSingleDefault([
    {
      ...emptyBrand('BrandA'),
      default: true,
      fields: { trademarkStatus: 'registered', trademarkNo: 'TM-1', sellingPoints: ['feature', 'design'] },
    },
    emptyBrand('BrandB'),
  ]);

  // 品牌列表（设置页那一块）
  const listHtml = renderToStaticMarkup(
    createElement(BrandListEditor, {
      brands,
      onChange: () => {},
      openBrandId: brands[0].id,
      onToggleOpen: () => {},
      onOpenSheet: () => {},
    })
  );
  assert.ok(listHtml.includes('BrandA') && listHtml.includes('BrandB'), '多个品牌都要渲染出来');
  assert.ok(listHtml.includes('添加品牌'), '要有"添加品牌"入口');
  assert.ok(listHtml.includes('默认'), '要标出默认品牌');
  const first = computeBrandCompleteness(brands[0]);
  assert.ok(
    listHtml.includes(`资产 ${first.filled}/${first.total}`),
    `内联展开时要显示资产完整度 ${first.filled}/${first.total}`
  );

  // 品牌资产全屏页（复用 L3 页壳）
  const pageHtml = renderToStaticMarkup(
    createElement(BrandDetailSheet, { brand: brands[0], brands, onChange: () => {}, onClose: () => {} })
  );
  assert.ok(pageHtml.includes('返回'), '全屏页必须有返回（L3 页壳）');
  assert.ok(pageHtml.includes('品牌资产页'), '页头要写明这是品牌资产页');
  for (const group of ['品牌身份', '品牌资产', '品牌策略']) {
    assert.ok(pageHtml.includes(group), `全屏页必须有「${group}」这一组`);
  }
  for (const label of ['商标号', '品牌备案（Brand Registry）', 'A+ 页面状态', '价格带定位', '竞品品牌（可多值）']) {
    assert.ok(pageHtml.includes(label), `全屏页缺少字段：${label}`);
  }
  assert.ok(pageHtml.includes('TM-1'), '已填的字段值要渲染出来');
  // 角标默认是收起态：<details> 不带 open 属性（不占地方）
  const details = pageHtml.match(/<details[^>]*>/g) ?? [];
  assert.ok(details.length >= BRAND_FIELDS.length, `每个字段都要有角标，实际 ${details.length} 个`);
  assert.ok(details.every((d) => !/\sopen(=|>|\s)/.test(d)), '角标默认必须收起（不许一开始就把说明铺开）');
  assert.ok(!/\stitle="/.test(pageHtml), '不许用原生 title 属性糊弄（§15.24 已列为反模式）');
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
