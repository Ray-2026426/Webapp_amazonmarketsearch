// 「看自己」V3 · 背景信息 → 能力推导 + 背景信息字段注册表 + 端到端硬约束链路。
//
// 本套件守四件事（对应本轮用户诉求）：
// ① 背景信息**每一项都是下拉/选项 + 允许留空**，自由文本**不超过 3 个**（数据层 + 设置页源码级双证）；
// ② 「看自己」**确实只有 3 个问题**（数据层 + 源码级双证），42 项四态模板已被删除；
// ③ 背景信息 → 能力推导是**纯函数、可复现**（同输入同输出），用户覆盖优先于推导；
// ④ **硬约束 ⇒ 不可直接进入** 的链路仍然成立（从背景信息一路走到 decideWinningPath.canEnterDirectly）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  BACKGROUND_FIELDS,
  BACKGROUND_GROUPS,
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
  return { fields: { ...fields }, notes: { ...notes }, legacyNotes: '', updatedAt: '' };
}

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
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

console.log('background registry（下拉/选项为主，自由文本 ≤ 3）');

test('① 每个字段都有 kind，选择题必须有选项；所有字段都允许留空（渐进式）', () => {
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
    assert.ok(['select', 'multi', 'text'].includes(f.kind), `${f.key} 的 kind 非法`);
    assert.equal(f.optional, true, `${f.key} 必须允许留空（渐进式是产品约束）`);
    if (f.kind === 'select' || f.kind === 'multi') {
      assert.ok((f.options ?? []).length >= 2, `${f.key} 是选择题，必须有 2 个以上选项`);
    }
  }
});

test('① 自由文本恰好 3 个，且与注册表完全一致（key 唯一、无重复）', () => {
  const textFields = BACKGROUND_FIELDS.filter((f) => f.kind === 'text').map((f) => f.key);
  assert.deepEqual(textFields, [...BACKGROUND_TEXT_FIELD_KEYS]);
  assert.equal(textFields.length, MAX_BACKGROUND_TEXT_FIELDS);
  assert.equal(textFields.length, 3);
  const keys = BACKGROUND_FIELDS.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length, '字段 key 不能重复');
});

test('① 源码级：设置页 profile tab 的文本输入不超过 3 个（且真的只有 1 个输入框）', () => {
  const src = read('src/components/AiSettingsPanel.tsx');
  const start = src.indexOf("{tab === 'profile' && (");
  const end = src.indexOf("{tab === 'mcp' && (");
  assert.ok(start > 0 && end > start, '必须能从源码里切出 profile tab 区块');
  const profileTab = src.slice(start, end);
  const inputs = (profileTab.match(/<input/g) ?? []).length;
  const textareas = (profileTab.match(/<textarea/g) ?? []).length;
  assert.ok(
    inputs + textareas <= MAX_BACKGROUND_TEXT_FIELDS,
    `设置页背景信息 tab 的自由文本框必须 ≤ 3，实际 <input>=${inputs} <textarea>=${textareas}`
  );
  assert.ok(profileTab.includes('Select'), '选择题必须用统一的下拉组件');
  assert.ok(profileTab.includes('MultiSelectChips'), '多选必须用芯片式多选');
  assert.ok(profileTab.includes('BACKGROUND_GROUPS'), '字段必须来自注册表（不许再手写清单）');
  assert.ok(profileTab.includes('g.affects'), '每一组必须把"影响哪个判断"显示出来');
  // 旧版的 11 个自由文本框不许回流
  for (const legacy of ['displayName', 'constraints', 'analysisGoals']) {
    assert.ok(!profileTab.includes(legacy), `旧版自由文本字段 ${legacy} 不得回到设置页`);
  }
});

test('① 取值/赋值/多选互斥都是纯函数（注册表驱动）', () => {
  let p = bg();
  assert.equal(getBackgroundFieldValue(p, 'sellerType'), undefined);
  p = setBackgroundFieldValue(p, 'sellerType', 'factory');
  assert.equal(getBackgroundFieldValue(p, 'sellerType'), 'factory');
  p = setBackgroundFieldValue(p, 'sellerType', '');
  assert.equal(getBackgroundFieldValue(p, 'sellerType'), undefined, '空值 = 清除，不是空字符串');

  p = setBackgroundFieldValue(p, 'certifications', ['CE']);
  p = toggleBackgroundMultiValue(p, 'certifications', 'NONE');
  assert.deepEqual(getBackgroundFieldValue(p, 'certifications'), ['NONE'], '"暂无"与其它认证互斥');
  p = toggleBackgroundMultiValue(p, 'certifications', 'FCC');
  assert.deepEqual(getBackgroundFieldValue(p, 'certifications'), ['FCC'], '选认证时清掉"暂无"');

  // 芯片式多选的整组替换入口，同样遵守互斥规则
  let q = setBackgroundFieldValue(bg(), 'marketplaces', ['US']);
  q = applyBackgroundMultiChange(q, 'certifications', ['NONE', 'CE']);
  assert.deepEqual(getBackgroundFieldValue(q, 'certifications'), ['CE']);
  // 文本字段写在 notes 里，不在 fields 里
  const r = setBackgroundFieldValue(bg(), 'brandName', 'BrandA');
  assert.equal(r.fields.brandName, undefined);
  assert.equal(r.notes.brandName, 'BrandA');
});

test('① 完整度：确定性、分母 = 字段总数、给出"最该先补"的一组与话术', () => {
  const empty = computeBackgroundCompleteness(bg());
  assert.equal(empty.filled, 0);
  assert.equal(empty.total, BACKGROUND_FIELDS.length);
  assert.equal(empty.fraction, 0);
  assert.ok(describeBackgroundCompleteness(empty).includes('还没填'));
  assert.ok(describeBackgroundCompleteness(empty).includes('看自己'), '话术要说明"填得越全，看自己的问题越少"');
  const weakAll = weakestBackgroundGroup(empty)!;
  assert.ok(weakAll.title.length > 0);

  const partial = computeBackgroundCompleteness(bg({ sellerType: 'factory', teamSize: 's1_2' }));
  assert.equal(partial.filled, 2);
  assert.equal(partial.byGroup.entity.filled, 2);
  assert.equal(partial.fraction, 2 / BACKGROUND_FIELDS.length);
  assert.ok(describeBackgroundCompleteness(partial).includes('可随时补'));
  assert.ok(!describeBackgroundCompleteness(partial).includes('已足够可信'));

  // 全填（含多选与文本）→ 100%
  const all: Record<string, string | string[]> = {};
  const allNotes: Record<string, string> = {};
  for (const f of BACKGROUND_FIELDS) {
    if (f.kind === 'multi') all[f.key] = [f.options![0].value];
    else if (f.kind === 'text') allNotes[f.key] = 'x';
    else all[f.key] = f.options![0].value;
  }
  const full = computeBackgroundCompleteness(bg(all, allNotes));
  assert.equal(full.filled, full.total);
  assert.equal(full.fraction, 1);
  assert.ok(describeBackgroundCompleteness(full).includes('已足够可信'));
  assert.equal(weakestBackgroundGroup(full), null);
});

test('① 摘要只读口径：只列已填项，值用人话标签（多选拼起来）', () => {
  const s = summarizeBackground(bg({ marketplaces: ['US', 'EU'], certifications: ['CE', 'NONE'] }, { brandName: 'BrandA' }));
  assert.equal(s.find((i) => i.key === 'marketplaces')!.value, 'US / EU');
  assert.equal(s.find((i) => i.key === 'brandName')!.value, 'BrandA');
  assert.ok(s.every((i) => i.affects.length > 0), '每一项都要带"影响什么"');
  assert.equal(s.some((i) => i.key === 'sellerType'), false, '没填的项不显示');
});

console.log('background → capability（确定性推导）');

test('③ 每一项能力都有推导规则（没有"未映射"的黑盒）', () => {
  const ruleKeys = CAPABILITY_RULES.map((r) => r.key);
  for (const item of CAPABILITY_ITEMS) {
    assert.ok(ruleKeys.includes(item.key), `能力项 ${item.key} 缺少推导规则`);
  }
  assert.equal(new Set(ruleKeys).size, ruleKeys.length, '规则 key 不能重复');
  const derived = deriveCapabilities(bg());
  assert.equal(derived.length, CAPABILITY_ITEMS.length);
  assert.ok(derived.every((d) => d.ruleId !== 'unmapped'), '不允许存在未映射的能力项');
});

test('③ 纯函数：同输入同输出、不被调用顺序影响、没有时间戳', () => {
  const input = bg(
    {
      sellerType: 'factory',
      teamSize: 's1_2',
      budgetPerProject: 'w5_20',
      validationCycle: 'm1_3',
      riskAppetite: 'conservative',
      supplyType: 'own_factory',
      moqRange: 'm1000_3000',
      leadTimeRange: 'd30_60',
      certifications: ['CE'],
      marketplaces: ['EU'],
      ads: 'none',
      ops: 'outsourced_risky',
      categoryYears: 'y1_3',
    },
    { brandName: 'BrandA' }
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
      validationCycle: 'lte1m',
      categoryYears: 'none',
      productDef: 'in_house',
      content: 'outsourced_ok',
      hasFeedbackChannel: 'no',
      paymentTerms: 'no',
      riskAppetite: 'conservative',
      certifications: ['NONE'],
      marketplaces: ['EU'],
    })
  );
  const of = (k: string) => table.find((d) => d.key === k)!;
  assert.equal(of('ads').status, 'lack');
  assert.ok(of('ads').ruleId === 'team.ability_ads_with_team_size');
  assert.ok(of('ads').reason.includes('1-2 人') && of('ads').reason.includes('广告'), '推导依据要能看到两条输入');
  assert.equal(of('ops').status, 'partial', '外包可控 = 部分具备（团队人少但有人管外包）');
  assert.equal(of('factory').status, 'partial', '贸易商 = 部分具备');
  assert.equal(of('moq').status, 'lack', 'MOQ >3000 = 不具备（硬约束）');
  assert.equal(of('lead_time').status, 'lack');
  assert.equal(of('startup_capital').status, 'lack');
  assert.equal(of('loss_tolerance').status, 'lack', '1 个月验证 + 保守 → 扛不住亏损周期');
  assert.equal(of('net_margin_floor').status, 'unknown', '毛利红线由第 1 个拍板问题给，背景信息不参与');
  assert.equal(of('certification').status, 'lack', '"暂无认证" + 主战场 EU → 缺 CE，硬约束');
  assert.equal(of('category_exp').status, 'lack');
  assert.equal(of('product_def').status, 'have');
  assert.equal(of('design').status, 'partial');
  assert.equal(of('after_sales').status, 'unknown', '售后=无？这里没填 afterSales → 判断不了');
  assert.equal(of('inventory_risk').status, 'lack', '保守 + 无账期 + 预算 <5 万 → 连续降两档');
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
      fields: { sellerType: 'brand', teamSize: 'bogus', marketplaces: ['US', 'XX'] },
      notes: { brandName: 'BrandA' },
    })
  );
  const p = loadUserBackgroundById('u9');
  assert.equal(p.fields.sellerType, 'brand');
  assert.equal(p.fields.teamSize, undefined, '非法选项值丢弃（不猜）');
  assert.deepEqual(p.fields.marketplaces, ['US'], '非法多选值丢弃');
  assert.equal(p.notes.brandName, 'BrandA');
  assert.ok(p.legacyNotes.includes('称呼：Ray'));
  assert.ok(p.legacyNotes.includes('近期目标：找 2 个可测款'), '旧版自由文本必须留档（仍然进 AI 上下文）');
});

test('⑤ 两个区块真渲染一次（内联形态）：只读摘要 + 推导 + 3 个问题 + 适配度/硬约束都在', () => {
  const background = bg(
    { sellerType: 'factory', teamSize: 's1_2', ads: 'none', certifications: ['NONE'], marketplaces: ['EU'] },
    { brandName: 'BrandA' }
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
