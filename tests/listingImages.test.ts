// M6 · 竞品明细抓图口径（PRD §15.25）：**默认整套图**（Listing 图库第 1-N 张 = 主图 + 附图），
// **默认排除 A+ 模块图**；上限必须存在且如实记数。
//
// 为什么要有这套测试：这个口径以前只活在注释和"接口返回什么就用什么"里，
// 用户看到的是"竞品明细只抓了首图"。把口径写成常量 + 纯函数之后，这里把三件事钉死：
//   ① 默认口径 = gallery 且不含 A+（源码级 + 数据层）；
//   ② 张数有硬上限（LISTING_IMAGE_MAX），超出的截断并且记数；
//   ③ 计划层与装配层真的按这个口径走（args 进缓存键、A+ 不进图库数组）。
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  LISTING_IMAGE_MAX,
  LISTING_IMAGE_SCOPE,
  LISTING_IMAGE_INCLUDE_APLUS_DEFAULT,
  LISTING_IMAGE_POLICY,
  describeListingImageScope,
  extractListingImages,
  listingImageFetchArgs,
} from '../src/utils/listingImages';
import { planListingFetch, assembleListingDetails } from '../src/utils/listingFetchPlan';
import { LISTING_FIELDS, readFieldValue, type ComparisonInput } from '../src/utils/listingFields';
import { asinGalleryUrls } from '../src/utils/sellerspriteApi';

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

const read = (p: string) => fs.readFileSync(p, 'utf8');

console.log('listing images：默认整套图（除 A+）');

test('默认口径 = 整套图（gallery），且默认不含 A+', () => {
  assert.equal(LISTING_IMAGE_SCOPE, 'gallery', '默认口径必须是 Listing 图库（整套图），不是单张首图');
  assert.equal(LISTING_IMAGE_INCLUDE_APLUS_DEFAULT, false, 'A+ 模块图默认必须不抓');
  assert.equal(LISTING_IMAGE_POLICY.scope, 'gallery');
  assert.equal(LISTING_IMAGE_POLICY.includeAplus, false);
  assert.equal(LISTING_IMAGE_POLICY.maxImages, LISTING_IMAGE_MAX);
  const text = describeListingImageScope();
  assert.ok(text.includes('整套图'), `口径说明要说人话：${text}`);
  assert.ok(text.includes('A+ 模块图默认不抓'), `口径说明必须写明 A+ 默认不抓：${text}`);
});

test('抓图数量有上限：超过上限截断，并如实记数（不静默丢）', () => {
  assert.ok(Number.isInteger(LISTING_IMAGE_MAX) && LISTING_IMAGE_MAX > 0, '上限必须是正整数常量');
  assert.equal(LISTING_IMAGE_MAX, 9, 'Amazon 详情页图库图位上限 9 张（A+ 不计入）');
  const many = Array.from({ length: 20 }, (_, i) => `https://img/${i}.jpg`);
  const out = extractListingImages({ images: many });
  assert.equal(out.images.length, LISTING_IMAGE_MAX);
  assert.equal(out.truncated, 20 - LISTING_IMAGE_MAX, '截断张数要能对上（供界面说明"接口混进了图库以外的图"）');
});

test('整套图：数组字段优先、去重、顺序稳定', () => {
  const out = extractListingImages({ images: ['main.jpg', 'main.jpg', 'b.jpg', 'c.jpg', '  '] });
  assert.deepEqual(out.images, ['main.jpg', 'b.jpg', 'c.jpg']);
  assert.equal(out.truncated, 0);
  // 不同 provider 的字段名都要认
  assert.deepEqual(extractListingImages({ imageUrls: ['x', 'y'] }).images, ['x', 'y']);
  assert.deepEqual(extractListingImages({ galleryImages: ['g1'] }).images, ['g1']);
});

test('A+ 默认排除；显式开启才读，且永远不混进图库数组', () => {
  const payload = { images: ['m1', 'm2', 'm3'], aplusImages: ['a1', 'a2'] };
  const byDefault = extractListingImages(payload);
  assert.deepEqual(byDefault.images, ['m1', 'm2', 'm3'], '图库里只能有图库的图');
  assert.deepEqual(byDefault.aplusImages, [], '默认口径下 A+ 必须为空');
  assert.equal(byDefault.aplusSuppressed, 2, '被默认口径排除的 A+ 张数要能说清（界面提示"需要时单独开"）');

  const optedIn = extractListingImages(payload, { includeAplus: true });
  assert.deepEqual(optedIn.aplusImages, ['a1', 'a2'], '显式开启后才读 A+');
  assert.deepEqual(optedIn.images, ['m1', 'm2', 'm3'], 'A+ 不能混进图库（否则"第 N 张对第 N 张"就不可比了）');
  const args = listingImageFetchArgs({ includeAplus: true });
  assert.equal(args.includeAplusImages, true);
  assert.equal(listingImageFetchArgs().includeAplusImages, false, '不传参就是默认关');
});

test('接口只给单图时退回首图，不编造缺失的附图', () => {
  const out = extractListingImages({ zoomImageUrl: 'https://img/cover.jpg' });
  assert.deepEqual(out.images, ['https://img/cover.jpg']);
  assert.equal(out.truncated, 0);
  assert.deepEqual(extractListingImages({}).images, []);
});

console.log('listing images：数据层与抓取计划');

test('字段注册表的口径就是整套图（key 不变，含义与补数方式变了）', () => {
  const field = LISTING_FIELDS.find((f) => f.key === 'mainImages');
  assert.ok(field, 'mainImages 字段必须还在（既有报告/导出按这个 key 取值）');
  assert.ok(field.label.includes('主图') && field.label.includes('附图'), `label 要说清是整套图：${field.label}`);
  assert.ok(field.label.includes(String(LISTING_IMAGE_MAX)), 'label 要带上限，用户才知道最多几张');
  assert.ok(field.how.includes('整套图'), `how 必须写口径：${field.how}`);
  assert.ok(field.how.includes('A+'), `how 必须写清 A+ 默认不抓：${field.how}`);
});

test('展示格式兼容既有断言：整套图仍是"N 张"', () => {
  const input: ComparisonInput = { asins: ['B0AAA'], products: [], listing: { B0AAA: { images: ['1', '2', '3'] } } };
  assert.equal(readFieldValue('mainImages', 'B0AAA', input), '3 张');
});

test('抓取计划：listing 步骤带上整套图口径（进 args → 也进缓存键，口径变了缓存自然失效）', () => {
  const plan = planListingFetch({ asins: ['B0AAA'], marketplace: 'US' });
  const step = plan.find((s) => s.id === 'listing:B0AAA');
  assert.ok(step, '要有 Listing 步骤');
  assert.equal(step.args.imageScope, 'gallery');
  assert.equal(step.args.includeAplusImages, false, '默认计划不得带 A+');
  assert.equal(step.args.maxImages, LISTING_IMAGE_MAX);
  assert.ok(String(step.label).includes('整套图'), `计划要显示"正在抓什么"：${step.label}`);
  // 成本口径：整套图来自**同一次** asin_listing 调用，不是"每张图一次调用"
  assert.equal(step.calls, 1, '整套图不额外增加调用次数');
  assert.equal(plan.filter((s) => s.type === 'listing').length, 1, '一个 ASIN 只规划一次 Listing 抓取');
});

test('装配：整套图落进 listingDetails；A+ 默认不落，显式开启才落（且不混入图库）', () => {
  const fourteen = Array.from({ length: 14 }, (_, i) => `https://img/${i}.jpg`);
  const payload = { content: [{ text: JSON.stringify({ images: fourteen, aplusImages: ['ap1', 'ap2'] }) }] };

  const byDefault = assembleListingDetails(
    planListingFetch({ asins: ['B0AAA'], marketplace: 'US' }),
    planListingFetch({ asins: ['B0AAA'], marketplace: 'US' }).map((s) => ({ stepId: s.id, ok: true, data: s.type === 'listing' ? payload : {} }))
  );
  const l = byDefault.listing.B0AAA;
  assert.equal(l.images?.length, LISTING_IMAGE_MAX, '整套图要按上限截断');
  assert.equal(l.imagesTruncatedByCap, 14 - LISTING_IMAGE_MAX, '截断张数要记下来');
  assert.equal(l.aplusImages, undefined, '默认口径下不得落 A+ 图');

  const planWithAplus = planListingFetch({ asins: ['B0AAA'], marketplace: 'US', includeAplusImages: true });
  assert.equal(planWithAplus.find((s) => s.id === 'listing:B0AAA')?.args.includeAplusImages, true);
  const opted = assembleListingDetails(
    planWithAplus,
    planWithAplus.map((s) => ({ stepId: s.id, ok: true, data: s.type === 'listing' ? payload : {} }))
  );
  assert.equal(opted.listing.B0AAA.aplusImages?.length, 2, '显式开启后才落 A+');
  assert.equal(opted.listing.B0AAA.images?.length, LISTING_IMAGE_MAX, 'A+ 不得挤进图库数组');
});

test('数据层：ASIN 快照能给出整套图（老快照退回首图，不返回空）', () => {
  assert.deepEqual(
    asinGalleryUrls({ imageUrls: ['1', '2', '3'], imageUrl: '1', zoomImageUrl: '1' } as never),
    ['1', '2', '3']
  );
  assert.deepEqual(asinGalleryUrls({ zoomImageUrl: 'cover' } as never), ['cover'], '老快照没有数组时退回首图');
  assert.deepEqual(asinGalleryUrls(null), []);
});

test('源码级：抓图口径只有一处权威定义，取数层与计划层都复用它', () => {
  const policy = read('src/utils/listingImages.ts');
  assert.ok(/LISTING_IMAGE_MAX\s*=\s*9/.test(policy), '上限常量必须存在且写明数值');
  assert.ok(policy.includes('A+ 模块图是否默认抓'), '默认不抓 A+ 的口径必须写在源码里（可复核）');
  assert.ok(policy.includes('LISTING_IMAGE_INCLUDE_APLUS_DEFAULT = false'), '默认值必须是 false');

  const api = read('src/utils/sellerspriteApi.ts');
  assert.ok(api.includes('extractListingImages'), '取数层必须复用同一套抓图口径');
  assert.ok(api.includes('listingImageFetchArgs'), '取数调用要带上口径参数（默认不含 A+）');

  const plan = read('src/utils/listingFetchPlan.ts');
  assert.ok(plan.includes('整套图'), '抓取计划的人话说明必须写明整套图');
  assert.ok(plan.includes('includeAplusImages'), '计划层要有 A+ 开关（默认关）');
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
