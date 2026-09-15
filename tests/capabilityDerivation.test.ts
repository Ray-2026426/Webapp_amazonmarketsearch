// 「看自己」V3 · 背景信息 → 能力推导 + 背景信息字段注册表 + 端到端硬约束链路。
//
// 本套件守四件事（对应本轮用户诉求：「背景设置的问题，我觉得不符合亚马逊卖家的普遍特征」）：
// ① 背景信息字段是**亚马逊卖家普遍特征**（经营模式/配送/品牌备案/测评资源/图片能力/广告预算/店铺矩阵…），
//    每一项都是下拉/多选/列表 + 允许留空，自由文本**不超过 3 个**（数据层 + 设置页源码级双证）；
// ② 每个字段都必须能回答"它改变五看里的哪个判断"，而且**必须被至少一条推导规则用到**
//    （不许有"填了也白填"的字段；备注类要显式声明豁免）；
// ③ 背景信息 → 能力推导是**纯函数、可复现**（同输入同输出），用户覆盖优先于推导；
// ④ **硬约束 ⇒ 不可直接进入** 的链路仍然成立（从背景信息一路走到 decideWinningPath.canEnterDirectly）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  BACKGROUND_ADVISORY_FIELDS,
  BACKGROUND_FIELDS,
  BACKGROUND_GROUPS,
  BACKGROUND_LIST_FIELD_KEYS,
  BACKGROUND_TEXT_FIELD_KEYS,
  MAX_BACKGROUND_TEXT_FIELDS,
  applyBackgroundMultiChange,
  computeBackgroundCompleteness,
  describeBackgroundCompleteness,
  getBackgroundFieldValue,
  loadUserBackgroundById,
  setBackgroundFieldValue,
  summarizeBackground,
  toggleBackgroundMultiValue,
  weakestBackgroundGroup,
  type UserBackgroundProfile,
} from '../src/utils/userBackground';
import {
  CAPABILITY_RULES,
  RULE_INPUT_FIELDS,
  deriveCapabilities,
  deriveCapabilitiesForPrompt,
  resolveCapabilities,
  resolveCapabilityLibrary,
  summarizeDerivation,
} from '../src/utils/capabilityDerivation';
import { CAPABILITY_ITEMS, capabilityHardConstraints, defaultCapabilityLibrary, setCapabilityEntry } from '../src/utils/capabilityLibrary';
import { buildHardConstraintVerdict, buildFitAnswers, computeFitScore } from '../src/utils/ourCapability';
import { buildDecisionQuestions, boundaryItemsFromQuiz, ensureSeedQuestions, defaultQuizData, setAnswer, setAnswerMulti } from '../src/utils/categoryQuiz';
import { SELF_DECISION_QUESTION_COUNT } from '../src/utils/selfAssessment';
import { SCORE_WEIGHTS } from '../src/utils/opportunityScoreV2';
import { buildSatisfactionMatrix, decideWinningPath } from '../src/utils/competitorAnalysis';
import { AccountBackgroundBlock, CategoryQuizBlock } from '../src/components/SelfReadinessPanel';
import { computeQuizProgress, toOurCapabilityFromQuiz } from '../src/utils/categoryQuiz';
import type { UnmetNeedCandidate } from '../src/utils/userLook';
import type { Product } from '../src/utils/parser';

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

function bg(fields: Record<string, string | string[]> = {}, notes: Record<string, string> = {}): UserBackgroundProfile {
  return { fields: { ...fields }, notes: { ...notes }, brands: [], legacyNotes: '', updatedAt: '' };
}

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

/**
 * 去掉 JSX/JS 注释：文案守卫只该盯"渲染出来的字"，注释里留档"当初删了什么"是好事，
 * 不该因此被判为文案回流（否则等于逼着后来的人把历史抹掉）。
 */
function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

let seq = 0;
function need(over: Partial<UnmetNeedCandidate> = {}): UnmetNeedCandidate {
  seq += 1;
  return {
    id: `n${seq}`,
    targetUser: '',
    scenario: '',
    jobToBeDone: '',
    needStatement: 'need',
    currentAlternative: '',
    evidenceStrength: 'medium',
    ...over,
  };
}

function product(asin: string): Product {
  seq += 1;
  return {
    asin,
    sku: '',
    brand: 'B',
    title: 'Pillow',
    image: '',
    monthlySales: 10,
    monthlyRevenue: 1000,
    price: 30,
    rating: 4,
    reviewCount: 10,
    reviewGrowth: 0,
    sellerCount: 1,
    weight: 0,
    volume: 0,
    launchDate: '',
    daysSinceLaunch: 100,
    buyBoxType: '',
    sellerLocation: '',
    fbaFee: 0,
    subBsr: 0,
    subCategory: '',
  };
}

console.log('background registry（亚马逊卖家特征；下拉/选项为主，自由文本 ≤ 3）');

test('① 每个字段都有 kind 与"影响哪个判断"；选择题必须有选项；所有字段都允许留空（渐进式）', () => {
  assert.ok(BACKGROUND_GROUPS.length >= 6, '至少 6 组');
  for (const g of BACKGROUND_GROUPS) {
    assert.ok(g.id.length > 0);
    assert.ok(g.title.trim().length >= 2, `${g.id} 组要有标题`);
    // 每一组必须写清"它影响五看里的哪一个判断"
    assert.ok(g.affects.trim().length >= 12, `${g.id} 的 affects 太短：${g.affects}`);
    assert.ok(g.affects.includes('影响'), `${g.id} 的 affects 必须说明影响什么：${g.affects}`);
    assert.ok(g.fields.length > 0, `${g.id} 组不能是空的`);
  }
  for (const f of BACKGROUND_FIELDS) {
    assert.ok(['select', 'multi', 'text', 'list'].includes(f.kind), `${f.key} 的 kind 非法`);
    assert.equal(f.optional, true, `${f.key} 必须允许留空（渐进式是产品约束）`);
    // 字段级"影响哪个判断"：不能是空话，必须点名五看里的判断
    assert.ok(f.affects.trim().length >= 10, `${f.key} 的 affects 太短：${f.affects}`);
    assert.ok(f.affects.includes('影响'), `${f.key} 的 affects 必须说明影响什么：${f.affects}`);
    if (f.kind === 'select' || f.kind === 'multi') {
      assert.ok((f.options ?? []).length >= 2, `${f.key} 是选择题，必须有 2 个以上选项`);
    }
  }
});

test('① 字段集必须覆盖"亚马逊特有"维度（用户点名的那些，一个都不能少）', () => {
  const keys = new Set(BACKGROUND_FIELDS.map((f) => f.key));
  for (const [key, why] of [
    ['businessModel', '经营模式：精品深耕/精铺/铺货/代发/批发跟卖/品牌收购'],
    ['fulfillment', '配送方式：FBA/FBM/海外仓/混合'],
    ['brandRegistry', '品牌状态：已备案 Brand Registry / 申请中 / 无品牌'],
    ['trademarkStatus', '商标与备案要能分开填'],
    ['reviewResource', '测评与评论资源'],
    ['contentAbility', '图片与内容能力'],
    ['adBudgetPerListing', '广告预算量级（按链接/月）'],
    ['storeCount', '多店铺/账号矩阵'],
    ['sourcingChannel', '选品来源：1688/工厂直供/展会/竞品跟卖/自有研发'],
    ['customization', '是否可以开模定制'],
    ['marketplaces', '目标站点（EU 会带出 CE/EPR/欧代约束）'],
    ['budgetPerProject', '保留：备货资金'],
    ['riskAppetite', '保留：风险偏好'],
    ['supplyType', '保留：供应链类型'],
    ['categoryYears', '保留：类目经验'],
    ['leadTimeRange', '保留：交期'],
    ['moqRange', '保留：MOQ'],
    ['paymentTerms', '保留：账期'],
    ['certifications', '保留：合规认证'],
    ['teamSize', '保留：团队规模'],
  ] as const) {
    assert.ok(keys.has(key), `缺少亚马逊特有维度「${key}」（${why}）`);
  }
  // 经营模式的选项要覆盖中国跨境卖家圈的真实分类
  const model = BACKGROUND_FIELDS.find((f) => f.key === 'businessModel')!;
  const modelValues = (model.options ?? []).map((o) => o.value);
  for (const v of ['boutique', 'refined_spread', 'broad_spread', 'dropship', 'wholesale_follow', 'aggregator']) {
    assert.ok(modelValues.includes(v), `经营模式缺少选项 ${v}`);
  }
  assert.ok(
    (model.options ?? []).some((o) => o.label.includes('精品')) &&
      (model.options ?? []).some((o) => o.label.includes('精铺')) &&
      (model.options ?? []).some((o) => o.label.includes('铺货')),
    '经营模式必须写清 精品/精铺/铺货（中文跨境圈的通行说法）'
  );
  // 卖家类型的选项要覆盖 工厂型/贸易型/品牌型/服务商
  const seller = BACKGROUND_FIELDS.find((f) => f.key === 'sellerType')!;
  assert.deepEqual((seller.options ?? []).map((o) => o.value), ['factory', 'trader', 'brand', 'service']);
});

test('① 不接地气的大企业刻度与无依据字段已删除（不是改个名字藏起来）', () => {
  const keys = BACKGROUND_FIELDS.map((f) => f.key);
  for (const gone of [
    'revenueTier', // 年营收量级（1 亿以上）—— 大企业刻度，亚马逊中小卖家填不了
    'qcMethod', // 质量管控方式 —— 没有一条规则用它，也没有一个判断依赖它
    'hasMold', // 与「能否开模定制」重复
    'hasAsset', // 与品牌状态/现有 ASIN 重复
    'hasFeedbackChannel', // 并入「测评与评论资源」
    'sellerTypeProfession', // 岗位角色这类咨询味字段
    'analysisStyle', // 只影响口吻，却占一个下拉
    'legalSupport', // 法务支持：没有规则用它 → 按"填了也白填"的字段删除
  ]) {
    assert.ok(!keys.includes(gone), `字段「${gone}」不该回来（本轮明确删除/合并）`);
  }
  // 年营收的刻度不许以任何形式回流到**字段选项**里
  // （注意：`RETIRED_STRUCTURED_FIELDS` 里保留"1000 万-1 亿"是为了给旧值留档时翻成人话，
  //   那是"把删掉的东西记下来"，不是"又让用户填一遍"，所以守卫只扫字段注册表）
  for (const f of BACKGROUND_FIELDS) {
    for (const o of f.options ?? []) {
      assert.ok(!/亿/.test(o.label), `${f.key} 的选项「${o.label}」把大企业刻度带回来了`);
    }
  }
  const src = read('src/utils/userBackground.ts');
  assert.ok(!src.includes('战略意义'), '背景信息里不得出现"战略意义"这类咨询味字段');
  assert.ok(
    src.includes('RETIRED_STRUCTURED_FIELDS'),
    '被删字段的旧值必须留档（字段可以下线，用户填过的东西不丢）'
  );
});

test('① 自由文本 ≤ 3（恰好 2 个），品牌名是多值列表、不占自由文本预算', () => {
  const textFields = BACKGROUND_FIELDS.filter((f) => f.kind === 'text').map((f) => f.key);
  assert.deepEqual(textFields, [...BACKGROUND_TEXT_FIELD_KEYS]);
  assert.ok(textFields.length <= MAX_BACKGROUND_TEXT_FIELDS, `自由文本必须 ≤ ${MAX_BACKGROUND_TEXT_FIELDS}`);
  assert.ok(textFields.length >= 1, '至少要留一个自由文本（现有 ASIN / 备注），否则用户没地方写关键事实');
  assert.deepEqual(BACKGROUND_LIST_FIELD_KEYS, ['brandNames']);
  const listFields = BACKGROUND_FIELDS.filter((f) => f.kind === 'list').map((f) => f.key);
  assert.deepEqual(listFields, [...BACKGROUND_LIST_FIELD_KEYS], '品牌名必须是多值列表');
  assert.ok(!(textFields as string[]).includes('brandNames'), '品牌名不算自由文本上限里那个"备注"');
  const keys = BACKGROUND_FIELDS.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length, '字段 key 不能重复');
  assert.ok(keys.length >= 20 && keys.length <= 30, `字段总数必须在 20-30 之间，实际 ${keys.length}`);
});

test('② 源码级：设置页 profile tab 不再有大段说明，且"影响哪个判断"是角标', () => {
  const src = read('src/components/AiSettingsPanel.tsx');
  const start = src.indexOf("{tab === 'profile' && (");
  const end = src.indexOf("{tab === 'mcp' && (");
  assert.ok(start > 0 && end > start, '必须能从源码里切出 profile tab 区块');
  const profileTab = src.slice(start, end);
  const inputs = (profileTab.match(/<input/g) ?? []).length;
  const textareas = (profileTab.match(/<textarea/g) ?? []).length;
  assert.ok(
    inputs + textareas <= MAX_BACKGROUND_TEXT_FIELDS,
    `设置页背景信息 tab 的自由文本框必须 ≤ ${MAX_BACKGROUND_TEXT_FIELDS}，实际 <input>=${inputs} <textarea>=${textareas}`
  );
  assert.ok(profileTab.includes('Select'), '选择题必须用统一的下拉组件');
  assert.ok(profileTab.includes('MultiSelectChips'), '多选必须用芯片式多选');
  assert.ok(profileTab.includes('BACKGROUND_GROUPS'), '字段必须来自注册表（不许再手写清单）');
  assert.ok(profileTab.includes('g.affects'), '每一组必须把"影响哪个判断"展示出来（收进角标）');
  assert.ok(profileTab.includes('<details'), '每一组的依据必须收进角标（<details>），不许平铺成长段');
  // "影响哪个判断"必须在 <details> 角标里（结构守卫：不是在页面上平铺的一段话）
  const affectsAt = profileTab.indexOf('{g.affects}');
  const detailsAt = profileTab.lastIndexOf('<details', affectsAt);
  assert.ok(affectsAt > 0 && detailsAt > 0, '必须能定位到角标里的 {g.affects}');
  assert.ok(affectsAt - detailsAt < 800, '「影响哪个判断」必须紧跟角标，不许被挪到显眼位置平铺');
  // 字段级的依据也要收进角标，而且**不许用原生 title 属性糊弄**
  // （不能换行、触屏/键盘用户看不到；另一个改动的 InfoTip 守卫已把这条列为反模式）
  assert.ok(profileTab.includes('{f.affects}'), '每个字段的"影响哪个判断"必须能查到');
  assert.ok(!profileTab.includes('title={f.affects}'), '字段依据不许塞进原生 title 属性');
  const fieldAffectsAt = profileTab.indexOf('{f.affects}');
  const fieldDetailsAt = profileTab.lastIndexOf('<details', fieldAffectsAt);
  assert.ok(fieldAffectsAt > 0 && fieldDetailsAt > 0, '字段级依据必须落在 <details> 角标里');
  // 用户点名要删的文案，一条都不许回来（只扫**渲染出来的代码**，注释里留档不算；
  // 留档的意义是"能查到当初删了什么"，所以守卫扫的是 JSX 文本）
  const code = stripComments(profileTab);
  for (const gone of [
    '谁在做判断',
    '自由文本只有 3 个',
    '填得越全',
    '信息只保存在本机浏览器',
    '已足够可信',
    '这一组对你当前的判断影响最大',
  ]) {
    assert.ok(!code.includes(gone), `用户点名删除的文案「${gone}」不得回到设置页`);
  }
  // 旧版的 11 个自由文本框不许回流
  for (const legacy of ['displayName', 'constraints', 'analysisGoals']) {
    assert.ok(!code.includes(legacy), `旧版自由文本字段 ${legacy} 不得回到设置页`);
  }
  // 品牌名走多值编辑器（可添加多个 + 次级页），不是单值文本框
  assert.ok(code.includes('<BrandListEditor'), '品牌名必须是可添加多个的品牌列表');
  assert.ok(code.includes('<BrandDetailSheet'), '品牌必须能进入次级页（资产与信息）');
});

test('① 取值/赋值/多选互斥都是纯函数（注册表驱动）', () => {
  let p = bg();
  assert.equal(getBackgroundFieldValue(p, 'businessModel'), undefined);
  p = setBackgroundFieldValue(p, 'businessModel', 'boutique');
  assert.equal(getBackgroundFieldValue(p, 'businessModel'), 'boutique');
  p = setBackgroundFieldValue(p, 'businessModel', '');
  assert.equal(getBackgroundFieldValue(p, 'businessModel'), undefined, '空值 = 清除，不是空字符串');

  p = setBackgroundFieldValue(p, 'certifications', ['CE']);
  p = toggleBackgroundMultiValue(p, 'certifications', 'NONE');
  assert.deepEqual(getBackgroundFieldValue(p, 'certifications'), ['NONE'], '"暂无"与其它认证互斥');
  p = toggleBackgroundMultiValue(p, 'certifications', 'FCC');
  assert.deepEqual(getBackgroundFieldValue(p, 'certifications'), ['FCC'], '选认证时清掉"暂无"');

  // 配送方式里"混合"与其它互斥（多选也能表达"多条腿走"）
  let f = setBackgroundFieldValue(bg(), 'fulfillment', ['fba']);
  f = toggleBackgroundMultiValue(f, 'fulfillment', 'mixed');
  assert.deepEqual(getBackgroundFieldValue(f, 'fulfillment'), ['mixed']);
  f = toggleBackgroundMultiValue(f, 'fulfillment', 'fbm');
  assert.deepEqual(getBackgroundFieldValue(f, 'fulfillment'), ['fbm']);

  // 芯片式多选的整组替换入口，同样遵守互斥规则
  let q = setBackgroundFieldValue(bg(), 'marketplaces', ['US']);
  q = applyBackgroundMultiChange(q, 'certifications', ['NONE', 'CE']);
  assert.deepEqual(getBackgroundFieldValue(q, 'certifications'), ['CE']);
  // 文本字段写在 notes 里，不在 fields 里
  const r = setBackgroundFieldValue(bg(), 'existingAsin', 'B0XXXXXXXX');
  assert.equal(r.fields.existingAsin, undefined);
  assert.equal(r.notes.existingAsin, 'B0XXXXXXXX');
});

test('① 完整度：确定性、分母 = 字段总数、给出"最该先补"的一组与短话术', () => {
  const empty = computeBackgroundCompleteness(bg());
  assert.equal(empty.filled, 0);
  assert.equal(empty.total, BACKGROUND_FIELDS.length);
  assert.equal(empty.fraction, 0);
  assert.ok(describeBackgroundCompleteness(empty).includes('还没填'));
  assert.ok(describeBackgroundCompleteness(empty).includes('不阻塞分析'), '必须说清"留空不阻塞分析"');
  const weakAll = weakestBackgroundGroup(empty)!;
  assert.ok(weakAll.title.length > 0);

  const partial = computeBackgroundCompleteness(bg({ sellerType: 'factory', teamSize: 's1_2' }));
  assert.equal(partial.filled, 2);
  assert.equal(partial.byGroup.model.filled, 1);
  assert.equal(partial.byGroup.team.filled, 1);
  assert.equal(partial.fraction, 2 / BACKGROUND_FIELDS.length);
  assert.ok(describeBackgroundCompleteness(partial).includes('可随时补'));
  assert.ok(!describeBackgroundCompleteness(partial).includes('已够用'));

  // 全填（含多选、列表与文本）→ 100%
  const all: Record<string, string | string[]> = {};
  const allNotes: Record<string, string> = {};
  for (const f of BACKGROUND_FIELDS) {
    if (f.kind === 'multi') all[f.key] = [f.options![0].value];
    else if (f.kind === 'text') allNotes[f.key] = 'x';
    else if (f.kind === 'select') all[f.key] = f.options![0].value;
  }
  const fullProfile: UserBackgroundProfile = { ...bg(all, allNotes), brands: [{ id: 'brand:a', name: 'BrandA', default: true, fields: {}, updatedAt: '' }] };
  const full = computeBackgroundCompleteness(fullProfile);
  assert.equal(full.filled, full.total, '品牌名也算一项');
  assert.equal(full.fraction, 1);
  assert.ok(describeBackgroundCompleteness(full).includes('已够用'));
  assert.equal(weakestBackgroundGroup(full), null);
  // 用户点名删除的两句话，任何完整度下都不许回来
  for (const report of [empty, partial, full]) {
    const text = describeBackgroundCompleteness(report);
    assert.ok(!text.includes('已足够可信'), `「已足够可信」是用户点名删掉的文案：${text}`);
    assert.ok(!text.includes('问题就越少'), `「填得越全…问题就越少」既被点名删除、也是错的：${text}`);
    assert.ok(!/完整度/.test(text), `数字已经在徽章里，不要再说一遍「完整度」：${text}`);
  }
});

test('① 摘要只读口径：只列已填项，值用人话标签（多选拼起来）', () => {
  const s = summarizeBackground(bg({ marketplaces: ['US', 'EU'], certifications: ['CE', 'NONE'] }, { existingAsin: 'B0A' }));
  assert.equal(s.find((i) => i.key === 'marketplaces')!.value, 'US / EU');
  assert.equal(s.find((i) => i.key === 'existingAsin')!.value, 'B0A');
  assert.ok(s.every((i) => i.affects.length > 0), '每一项都要带"影响什么"');
  assert.equal(s.some((i) => i.key === 'sellerType'), false, '没填的项不显示');
});

console.log('background → capability（确定性推导）');

test('② 每一项能力都有推导规则（没有"未映射"的黑盒）', () => {
  const ruleKeys = CAPABILITY_RULES.map((r) => r.key);
  for (const item of CAPABILITY_ITEMS) {
    assert.ok(ruleKeys.includes(item.key), `能力项 ${item.key} 缺少推导规则`);
  }
  assert.equal(new Set(ruleKeys).size, ruleKeys.length, '规则 key 不能重复');
  const derived = deriveCapabilities(bg());
  assert.equal(derived.length, CAPABILITY_ITEMS.length);
  assert.ok(derived.every((d) => d.ruleId !== 'unmapped'), '不允许存在未映射的能力项');
  // 每个能力项都必须有明确的四态结论（含新的评论资源）
  assert.ok(CAPABILITY_ITEMS.some((i) => i.key === 'review_resource'), '必须有「评论资源」这一项');
});

test('②★ 规则与字段集一致：规则只引用存在的字段，且每个非备注字段都被规则用到（最有价值的一条）', () => {
  const src = read('src/utils/capabilityDerivation.ts');
  // ① 源码级扫描：规则里真正取了值的字段（字面量口径）
  const used = new Set<string>();
  for (const re of [/pick\(bg,\s*'([^']+)'/g, /pickMulti\(bg,\s*'([^']+)'/g, /byOption\(bg,\s*'([^']+)'/g, /abilityRule\(bg,\s*'([^']+)'/g]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) used.add(m[1]);
  }
  const known = new Set(BACKGROUND_FIELDS.map((f) => f.key));

  // ② 不许引用幽灵字段
  for (const key of used) {
    assert.ok(known.has(key), `推导规则引用了背景信息里不存在的字段：${key}`);
  }
  // ③ 声明的输入清单必须与源码扫出来的一致（防止有人加了用法忘了登记 / 登记了却没真用）
  assert.deepEqual(
    [...used].sort(),
    [...RULE_INPUT_FIELDS].sort(),
    'RULE_INPUT_FIELDS 必须与源码里真实用到的字段完全一致'
  );
  // ④ 每个非备注字段都必须被至少一条规则用到 —— 不许有"填了也白填"的字段
  const advisory = new Set(BACKGROUND_ADVISORY_FIELDS.map((a) => a.key));
  for (const f of BACKGROUND_FIELDS) {
    if (advisory.has(f.key)) continue;
    assert.ok(used.has(f.key), `字段「${f.key}」没有任何推导规则用它 → 它改变不了任何判断，不该留在表单里`);
  }
  // ⑤ 豁免清单只能装备注类，而且必须写明理由（不许拿它当后门藏字段）
  assert.ok(BACKGROUND_ADVISORY_FIELDS.length <= 2, '豁免字段最多 2 个');
  for (const a of BACKGROUND_ADVISORY_FIELDS) {
    assert.ok(known.has(a.key), `豁免字段 ${a.key} 不在注册表里`);
    assert.ok(a.why.trim().length >= 15, `豁免字段 ${a.key} 必须写清为什么不参与推导`);
  }
  for (const key of advisory) {
    const field = BACKGROUND_FIELDS.find((f) => f.key === key)!;
    assert.equal(field.kind, 'text', '只有备注类自由文本可以豁免推导');
  }
  // ⑥ 规则本身不许引用不存在的字段名（reason 里提到的字段标签也要能对上）
  for (const r of CAPABILITY_RULES) {
    assert.ok(r.ruleId.includes('.'), `${r.key} 的 ruleId 必须是「域.规则」格式`);
  }
});

test('③ 纯函数：同输入同输出、不被调用顺序影响、没有时间戳', () => {
  const input = bg(
    {
      businessModel: 'boutique',
      sellerType: 'factory',
      fulfillment: ['fbm'],
      storeCount: 'single',
      teamSize: 's1_2',
      budgetPerProject: 'w5_20',
      adBudgetPerListing: 'lt500',
      validationCycle: 'm1_3',
      riskAppetite: 'conservative',
      supplyType: 'own_factory',
      sourcingChannel: ['1688'],
      customization: 'oem_only',
      moqRange: 'm1000_3000',
      leadTimeRange: 'd30_60',
      certifications: ['CE'],
      marketplaces: ['EU'],
      ads: 'none',
      ops: 'outsourced_risky',
      categoryYears: 'y1_3',
    },
    { existingAsin: 'B0A' }
  );
  const a = deriveCapabilities(input);
  const b = deriveCapabilities(input);
  assert.deepEqual(a, b, '同输入必须同输出（可复现）');
  assert.deepEqual(JSON.stringify(a), JSON.stringify(deriveCapabilities(input)));
  for (const d of a) {
    assert.ok(d.reason.length > 5, `${d.key} 必须有"这条是怎么推出来的"`);
    assert.ok(d.ruleId.length > 3, `${d.key} 必须有规则编号`);
    assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(d.reason), '推导里不得出现时间戳');
  }
  // 推导顺序与词表一致（UI 展示稳定）
  assert.deepEqual(a.map((d) => d.key), CAPABILITY_ITEMS.map((i) => i.key));
});

test('③ 背景信息不填 → 诚实地说"判断不了"，绝不当作"不具备"', () => {
  const derived = deriveCapabilities(bg());
  const s = summarizeDerivation(derived);
  assert.equal(s.lack, 0, '没填背景信息时不能得出任何"不具备"');
  assert.equal(s.have, 0);
  assert.ok(s.unknown >= 20, `判断不了的项应占多数，实际 ${s.unknown}`);
  assert.ok(derived.every((d) => d.status === 'unknown'));
  assert.ok(deriveCapabilitiesForPrompt(derived).includes('判断不了'));
});

test('③ 关键推导规则（含用户举的例子：团队 1-2 人 + 广告=无 ⇒ 广告能力弱）', () => {
  const table = deriveCapabilities(
    bg({
      teamSize: 's1_2',
      ads: 'none',
      ops: 'outsourced_ok',
      supplyType: 'trading',
      moqRange: 'gt3000',
      leadTimeRange: 'gt60',
      budgetPerProject: 'lt5w',
      adBudgetPerListing: 'none',
      validationCycle: 'lte1m',
      categoryYears: 'none',
      productDef: 'in_house',
      contentAbility: 'outsourced_ok',
      reviewResource: 'none',
      fulfillment: ['fbm'],
      businessModel: 'boutique',
      storeCount: 'single',
      trademarkStatus: 'none',
      brandRegistry: 'none',
      paymentTerms: 'no',
      riskAppetite: 'conservative',
      certifications: ['NONE'],
      marketplaces: ['EU'],
    })
  );
  const of = (k: string) => table.find((d) => d.key === k)!;
  assert.equal(of('ads').status, 'lack');
  assert.ok(of('ads').ruleId === 'team.ability_ads_with_team_size_and_budget');
  assert.ok(of('ads').reason.includes('1-2 人') && of('ads').reason.includes('广告'), '推导依据要能看到两条输入');
  assert.equal(of('ops').status, 'partial', '外包可控 = 部分具备（团队人少但有人管外包）');
  assert.equal(of('factory').status, 'partial', '贸易商 = 部分具备');
  assert.equal(of('moq').status, 'lack', 'MOQ >3000 = 不具备（硬约束）');
  assert.equal(of('lead_time').status, 'lack');
  assert.equal(of('startup_capital').status, 'lack');
  assert.equal(of('ad_budget').status, 'lack', '不投广告 = 广告预算不具备');
  assert.equal(of('loss_tolerance').status, 'lack', '1 个月验证 + 保守 → 扛不住亏损周期');
  assert.equal(of('net_margin_floor').status, 'unknown', '毛利红线由第 1 个拍板问题给，背景信息不参与');
  assert.equal(of('certification').status, 'lack', '"暂无认证" + 目标站点 EU → 缺 CE，硬约束');
  assert.equal(of('category_exp').status, 'lack');
  assert.equal(of('product_def').status, 'have');
  assert.equal(of('design').status, 'lack', '外包可控(部分) + 未备案(降一档) → 不具备');
  assert.equal(of('review_resource').status, 'lack', '完全没有评论资源 = 不具备（新品冷启动的真实约束）');
  assert.equal(of('trademark').status, 'lack', '没有商标 = 不具备（硬约束），这一项本轮之前永远是"判断不了"');
  assert.equal(of('after_sales').status, 'lack', 'FBM 自发货 + 1-2 人 → 客服/退货扛不住');
  assert.equal(of('inventory_risk').status, 'lack', '保守 + 无账期 + 预算<5万 + 精品深耕 → 连续降档');
});

test('③ 新增的亚马逊特有规则：配送方式/经营模式/开模/店铺矩阵真的会改变结论', () => {
  const base = {
    leadTimeRange: 'd30_60',
    supplyType: 'partner_factory',
    moqRange: 'm1000_3000',
    riskAppetite: 'balanced',
    paymentTerms: 'yes',
    budgetPerProject: 'w5_20',
    rnd: 'outsourced_ok',
    contentAbility: 'outsourced_ok',
    brandRegistry: 'registered',
  };
  const pick = (over: Record<string, string | string[]>) => {
    const t = deriveCapabilities(bg({ ...base, ...over }));
    const of = (k: string) => t.find((d) => d.key === k)!;
    return { of };
  };

  // 配送方式：FBA 让交付与售后都变好（同一条交期，结论不同）
  const fbm = pick({ fulfillment: ['fbm'], teamSize: 's10_49' });
  const fba = pick({ fulfillment: ['fba'], teamSize: 's10_49' });
  assert.equal(fbm.of('after_sales').status, 'partial');
  assert.equal(fba.of('after_sales').status, 'have');
  assert.notEqual(fbm.of('after_sales').ruleId, '');
  const longLeadFbm = pick({ fulfillment: ['fbm'], leadTimeRange: 'gt60' });
  const longLeadFba = pick({ fulfillment: ['fba'], leadTimeRange: 'gt60' });
  assert.equal(longLeadFbm.of('lead_time').status, 'lack');
  assert.equal(longLeadFba.of('lead_time').status, 'partial', '有 FBA/海外仓时，工厂交期长一点还能接受（尾程已在目的地仓）');

  // 经营模式：精品深耕 vs 一件代发 → 压货风险结论相反
  const boutique = pick({ businessModel: 'boutique', storeCount: 'single' });
  const dropship = pick({ businessModel: 'dropship', storeCount: 's2_5' });
  assert.equal(boutique.of('inventory_risk').status, 'lack');
  assert.equal(dropship.of('inventory_risk').status, 'have');
  assert.ok(boutique.of('inventory_risk').reason.includes('精品'));

  // MOQ：同一条 MOQ，铺货/代发更怕压货；但精品深耕**不放宽**（MOQ 是硬约束，不能因为"你是精品卖家"就解锁）
  const moqSpread = pick({ businessModel: 'broad_spread', moqRange: 'm1000_3000' });
  const moqBoutique = pick({ businessModel: 'boutique', moqRange: 'm1000_3000' });
  assert.equal(moqSpread.of('moq').status, 'lack');
  assert.equal(moqBoutique.of('moq').status, 'partial', '经营模式只允许让结论更保守，不允许放宽硬约束');
  assert.equal(pick({ businessModel: 'boutique', moqRange: 'gt3000' }).of('moq').status, 'lack', 'MOQ >3000 仍是硬约束');
  assert.ok(
    capabilityHardConstraints(
      resolveCapabilityLibrary(bg({ moqRange: 'gt3000', businessModel: 'boutique' }), defaultCapabilityLibrary())
    ).some((h) => h.includes('MOQ')),
    'MOQ 超标的硬约束不许被经营模式静默放行'
  );

  // 能否开模：可以开模 → 研发设计升一档；只能拿现货 → 降一档
  const moldOk = pick({ customization: 'mold_ok', rnd: 'outsourced_ok' });
  const noMold = pick({ customization: 'none', rnd: 'in_house' });
  assert.equal(moldOk.of('rnd').status, 'have');
  assert.equal(noMold.of('rnd').status, 'partial');
  assert.ok(noMold.of('rnd').reason.includes('只能拿现货'));

  // 品牌备案：没备案 ⇒ 用不了 A+ 与品牌旗舰店 ⇒ 内容能力降档
  const registered = pick({ brandRegistry: 'registered', contentAbility: 'outsourced_ok' });
  const notRegistered = pick({ brandRegistry: 'none', contentAbility: 'outsourced_ok' });
  assert.equal(registered.of('design').status, 'partial');
  assert.equal(notRegistered.of('design').status, 'lack');
  assert.ok(notRegistered.of('design').reason.includes('A+'));

  // 选品来源：工厂直供 = 源头可控（即使供应链类型只填了贸易商也能升一档）
  const tradingOnly = pick({ supplyType: 'trading', sourcingChannel: ['1688'] });
  const factoryDirect = pick({ supplyType: 'trading', sourcingChannel: ['factory_direct'] });
  assert.equal(tradingOnly.of('factory').status, 'partial');
  assert.equal(factoryDirect.of('factory').status, 'have');

  // 卖家类型：工厂型哪怕没填供应链类型，也能判定工厂资源具备
  const factorySeller = deriveCapabilities(bg({ sellerType: 'factory' })).find((d) => d.key === 'factory')!;
  assert.equal(factorySeller.status, 'have');
  assert.ok(factorySeller.reason.includes('产线在你自己手上'));
});

test('③ 覆盖优先于推导，且必须显式标记；取消覆盖回到推导', () => {
  const input = bg({ ads: 'none', teamSize: 's1_2' });
  const derivedOnly = resolveCapabilities(input, defaultCapabilityLibrary());
  assert.equal(derivedOnly.find((d) => d.key === 'ads')!.source, 'derived');
  assert.equal(derivedOnly.find((d) => d.key === 'ads')!.status, 'lack');

  let lib = defaultCapabilityLibrary();
  lib = setCapabilityEntry(lib, 'ads', 'have', '我们有 2 个投手');
  const overridden = resolveCapabilities(input, lib);
  const ads = overridden.find((d) => d.key === 'ads')!;
  assert.equal(ads.status, 'have', '覆盖优先于推导');
  assert.equal(ads.source, 'manual');
  assert.ok(ads.reason.includes('用户逐条覆盖'));
  assert.ok(ads.reason.includes('推导原本是'), '覆盖也要能看到原推导（可复核）');

  // 其他项仍然是推导
  assert.equal(overridden.find((d) => d.key === 'moq')!.source, 'derived');
  assert.equal(summarizeDerivation(overridden).manual, 1);
});

test('③ 解析成能力库：形状与下游一致（前置资源缺口 / 硬约束都用它）', () => {
  const lib = resolveCapabilityLibrary(bg({ certifications: ['NONE'], moqRange: 'gt3000' }), defaultCapabilityLibrary());
  assert.deepEqual(Object.keys(lib.entries).sort(), CAPABILITY_ITEMS.map((i) => i.key).sort());
  assert.equal(lib.entries.certification.status, 'lack');
  assert.equal(lib.entries.certification.source, 'derived');
  assert.ok((lib.entries.certification.reason ?? '').length > 0);
  const hard = capabilityHardConstraints(lib);
  assert.equal(hard.length, 2, `MOQ 与认证都该进硬约束，实际：${hard.join('|')}`);
});

console.log('end-to-end：背景信息 ⇒ 硬约束 ⇒ 不可直接进入');

test('④ 硬约束链路：背景信息(无认证) + 拍板选"认证齐备" ⇒ blocked ⇒ canEnterDirectly=false', () => {
  const background = bg({ certifications: ['NONE'], marketplaces: ['US'], supplyType: 'partner_factory' });
  const questions = buildDecisionQuestions({ background });
  const q3 = questions.find((q) => q.id === 'decision:entry_conditions')!;
  const certIdx = q3.options.findIndex((o) => o.conditionKey === 'cert_ready');
  const quiz = setAnswerMulti(ensureSeedQuestions(defaultQuizData(), questions), q3.id, [certIdx]);

  // 1) 答案 → 决策边界项（decision boundary，status=lack）
  const items = boundaryItemsFromQuiz(quiz);
  const certItem = items.find((i) => i.id === 'boundary:entry_conditions')!;
  assert.equal(certItem.category, 'boundary');
  assert.equal(certItem.status, 'lack');

  // 2) 决策边界项 + 背景信息推导的库 → 硬约束结论
  const verdict = buildHardConstraintVerdict({
    items,
    libraryNotes: capabilityHardConstraints(resolveCapabilityLibrary(background, defaultCapabilityLibrary())),
  });
  assert.equal(verdict.blocked, true);
  assert.ok(verdict.notes.some((n) => n.includes('必须满足的进入条件')));
  assert.ok(verdict.notes.some((n) => n.includes('认证')));

  // 3) 真跑一次赢的路径：赢面成立，但硬约束触发 ⇒ 结论只能是"验证后进入"，不可"直接进入"
  const NEED = need({ id: 'need-x', category: '功能需求', needStatement: 'adjustable height' });
  const matrices = ['B0A1', 'B0A2', 'B0A3'].map((a) => buildSatisfactionMatrix(a, product(a), [], [NEED]));
  const decision = decideWinningPath({
    needs: [NEED],
    competitors: [{ asin: 'B0A1' }, { asin: 'B0A2' }, { asin: 'B0A3' }],
    matrices,
    // 能力来自背景信息推导（域级），硬约束来自上面的结论
    ours: {
      byDemandCategory: { 功能需求: 'have' },
      hardConstraintBlocked: verdict.blocked,
      hardConstraintNotes: verdict.notes,
    },
  });
  assert.equal(decision.path, 'unique', '三家都没满足 + 我们接得住 ⇒ 人无我有成立');
  assert.equal(decision.canEnterDirectly, false, '硬约束触发 ⇒ 不可直接进入');
  assert.ok(decision.blockers.some((b) => b.includes('硬约束否决')));
  assert.ok(decision.conclusion.includes('验证后进入'), `结论必须降级：${decision.conclusion}`);
});

test('④ 反向：背景信息补上认证 ⇒ 同一条进入条件变成具备 ⇒ 硬约束解除、允许直接进入', () => {
  const background = bg({ certifications: ['CE', 'FCC'], marketplaces: ['US'], supplyType: 'partner_factory' });
  const questions = buildDecisionQuestions({ background });
  const q3 = questions.find((q) => q.id === 'decision:entry_conditions')!;
  const certIdx = q3.options.findIndex((o) => o.conditionKey === 'cert_ready');
  assert.equal(q3.options[certIdx].status, 'have');
  const quiz = setAnswerMulti(ensureSeedQuestions(defaultQuizData(), questions), q3.id, [certIdx]);
  const items = boundaryItemsFromQuiz(quiz);
  assert.equal(items.find((i) => i.id === 'boundary:entry_conditions')!.status, 'have');
  const verdict = buildHardConstraintVerdict({
    items,
    libraryNotes: capabilityHardConstraints(resolveCapabilityLibrary(background, defaultCapabilityLibrary())),
  });
  assert.equal(verdict.blocked, false);
  assert.deepEqual(verdict.notes, []);
});

test('④ 新规：没有商标（背景信息）也参与硬约束判定', () => {
  const lib = resolveCapabilityLibrary(bg({ trademarkStatus: 'none' }), defaultCapabilityLibrary());
  assert.equal(lib.entries.trademark.status, 'lack');
  const hard = capabilityHardConstraints(lib);
  assert.ok(hard.some((h) => h.includes('商标')), `商标不该进硬约束时会被静默放行：${hard.join('|')}`);
});

test('④ 旧版 42 项迁移过来的决策边界记录，继续参与硬约束（不静默放行）', () => {
  const verdict = buildHardConstraintVerdict({
    items: [],
    legacyNotes: ['决策边界「最高投入」不具备（旧版 42 项记录）'],
  });
  assert.equal(verdict.blocked, true);
  assert.ok(verdict.notes.some((n) => n.includes('最高投入')));
});

test('④ 适配度输入把两个来源都算进去（3 个问题 + 背景推导的能力），完成度不参与', () => {
  const background = bg({ ads: 'none', teamSize: 's1_2', categoryYears: 'gt5' });
  const entries = resolveCapabilities(background, defaultCapabilityLibrary());
  const answers = buildFitAnswers({ decisionAnswers: { 'decision:margin_floor': 'have' }, capabilityEntries: entries });
  assert.ok(answers['q:decision:margin_floor'] === 'have');
  assert.ok(answers['cap:ads'] === 'lack', '背景推导的能力结论也进适配度（背景信息真的被用起来）');
  const full = computeFitScore({ answers, backgroundCompleteness: 1 });
  const scaled = computeFitScore({ answers, backgroundCompleteness: 0.5 });
  assert.ok(scaled.fitScore < full.fitScore, '背景信息填得越少，适配度越打折（这是 §6.4 已有的乘数修正）');
  assert.ok(scaled.note.includes('背景库完整度 50%'));
  // 未答的拍板问题（unknown）不进分母
  const partial = computeFitScore({ answers: { 'q:decision:stop_loss': 'unknown' }, backgroundCompleteness: 1 });
  assert.equal(partial.answered, 0);
});

test('② 源码级：「看自己」只有 3 个问题，42 项四态模板已被删除', () => {
  assert.equal(SELF_DECISION_QUESTION_COUNT, 3);
  const selfSrc = read('src/utils/selfAssessment.ts');
  for (const legacyLabel of ['销量/收入/利润目标', '客户反馈', '模具/专利', '最大验证成本']) {
    assert.ok(!selfSrc.includes(legacyLabel), `42 项四态模板的项「${legacyLabel}」不得回流`);
  }
  assert.ok(!selfSrc.includes('const TEMPLATE'), '旧的项目模板必须删除');
  const viewSrc = read('src/components/SelfAssessmentView.tsx');
  assert.ok(!viewSrc.includes('SELF_CATEGORY_ORDER.map'), '42 项网格渲染必须删除');
  assert.ok(!viewSrc.includes('STATUS_ORDER'), '四态按钮组必须删除');
  assert.ok(viewSrc.includes('SELF_DECISION_QUESTION_COUNT'), '视图必须显示 3 个问题的进度');
  // 拍板题只有 3 道（源码里也不许多写）
  const quizSrc = read('src/utils/categoryQuiz.ts');
  assert.equal((quizSrc.match(/id: 'decision:/g) ?? []).length, 3, '拍板题必须恰好 3 道');
});

test('② 源码级：评分权重没有被这次改动碰过（背景信息只影响判断输入）', () => {
  assert.deepEqual(
    { ...SCORE_WEIGHTS },
    { demandStrength: 25, marketOpportunity: 25, competitorGap: 25, selfFit: 15, evidenceConfidence: 10 }
  );
  const bgSrc = read('src/utils/userBackground.ts');
  assert.ok(!/weight/i.test(bgSrc), '背景信息字段里不得出现任何权重（不许偷偷影响评分公式）');
  assert.ok(!/score/i.test(bgSrc), '背景信息模块不得出现评分逻辑');
});

test('① 持久化：坏数据不炸、旧版自由文本迁移进 legacyNotes（不丢用户填过的东西）', () => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;

  store.set('amzdev_user_background:u9', '{ 这不是 JSON');
  assert.equal(computeBackgroundCompleteness(loadUserBackgroundById('u9')).filled, 0);

  store.set(
    'amzdev_user_background:u9',
    JSON.stringify({
      displayName: 'Ray',
      role: '项目负责人',
      goals: '找 2 个可测款',
      fields: { sellerType: 'brand', teamSize: 'bogus', marketplaces: ['US', 'XX'], businessModel: 'nope' },
      notes: { existingAsin: 'B0A' },
    })
  );
  const p = loadUserBackgroundById('u9');
  assert.equal(p.fields.sellerType, 'brand');
  assert.equal(p.fields.teamSize, undefined, '非法选项值丢弃（不猜）');
  assert.deepEqual(p.fields.marketplaces, ['US'], '非法多选值丢弃');
  assert.equal(p.fields.businessModel, undefined, '新版字段的非法值同样丢弃');
  assert.equal(p.notes.existingAsin, 'B0A');
  assert.ok(p.legacyNotes.includes('称呼：Ray'));
  assert.ok(p.legacyNotes.includes('近期目标：找 2 个可测款'), '旧版自由文本必须留档（仍然进 AI 上下文）');

  // 被本轮删掉的旧结构化字段（如"年营收量级"）也要留档，不许静默丢数据
  store.set(
    'amzdev_user_background:u10',
    JSON.stringify({
      fields: { revenueTier: 'm10_100', qcMethod: 'third_party', certification: 'x', certifications: ['CE'] },
      notes: {},
    })
  );
  const old = loadUserBackgroundById('u10');
  assert.ok(old.legacyNotes.includes('年营收量级'), '被删字段的旧值必须转成留档');
  assert.ok(old.legacyNotes.includes('1000 万-1 亿'), '旧值本身要留着（不是只留个标签）');
  assert.ok(old.legacyNotes.includes('质量管控方式'));
  assert.deepEqual(old.fields.certifications, ['CE'], '还存在的字段照常读取');
  assert.equal(old.fields.revenueTier, undefined, '被删字段不再进字段表（但值已留档）');
});

test('⑤ 两个区块真渲染一次（内联形态）：只读摘要 + 推导 + 3 个问题 + 适配度/硬约束都在', () => {
  const background = bg(
    {
      sellerType: 'factory',
      teamSize: 's1_2',
      ads: 'none',
      fulfillment: ['fbm'],
      certifications: ['NONE'],
      marketplaces: ['EU'],
    },
    { existingAsin: 'B0A' }
  );
  const report = computeBackgroundCompleteness(background);
  const derived = resolveCapabilities(background, defaultCapabilityLibrary());

  const summaryHtml = renderToStaticMarkup(
    createElement(AccountBackgroundBlock, {
      background,
      report,
      derived,
      overrides: 0,
      showDerivation: false,
      openGroup: null,
      onToggleDerivation: () => {},
      onToggleGroup: () => {},
      onOverride: () => {},
      onClearOverride: () => {},
    })
  );
  assert.ok(summaryHtml.includes('背景信息完整度'));
  assert.ok(summaryHtml.includes('影响「看自己 → 能不能交付」'), '每一组必须把"影响哪个判断"显示出来');
  assert.ok(summaryHtml.includes('能力推导'));
  assert.ok(summaryHtml.includes('展开看每一条怎么推的'));
  assert.ok(!summaryHtml.includes('<input'), '只读摘要里不许有输入框（补全要去设置里做）');
  // 主屏必须"明显更短"：折叠态下按钮数只够「补全背景 + 7 个组 + 展开推导」
  const summaryButtons = (summaryHtml.match(/<button/g) ?? []).length;
  assert.ok(summaryButtons <= 12, `折叠态背景摘要的按钮应 ≤12 个（原 62 项四态网格是 200+ 个），实际 ${summaryButtons}`);

  const questions = buildDecisionQuestions({ background });
  let quiz = ensureSeedQuestions(defaultQuizData(), questions);
  const q1 = questions[0];
  const notSet = q1.options.findIndex((o) => o.status === 'lack');
  quiz = setAnswer(quiz, q1.id, notSet); // 选"还没定" ⇒ 决策边界不具备 ⇒ 硬约束
  const quizHtml = renderToStaticMarkup(
    createElement(CategoryQuizBlock, {
      quiz,
      progress: computeQuizProgress(quiz),
      quizCap: toOurCapabilityFromQuiz(quiz),
      fit: null,
      report,
      busy: false,
      hardFromOtherLooks: [],
      legacyBoundaryNotes: ['决策边界「最高投入」不具备（旧版 42 项记录）'],
      onAnswer: () => {},
      onToggleMulti: () => {},
      onNote: () => {},
    })
  );
  assert.ok(quizHtml.includes('拍板问题'));
  assert.equal((quizHtml.match(/为什么问：/g) ?? []).length, 3, '界面上必须只有 3 个问题（不是 5-8 题）');
  assert.ok(quizHtml.includes('适配度：'));
  assert.ok(quizHtml.includes('不可直接进入'), '硬约束必须显示红条结论');
  assert.ok(quizHtml.includes('旧版 42 项里的决策边界记录'), '迁移记录要如实展示');
  assert.ok(quizHtml.includes('你现在：'), 'Q3 每个条件都要显示由背景信息推出的满足情况');
  assert.ok(!quizHtml.includes('四态'), '不许再出现"四态确认"的说法');
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
