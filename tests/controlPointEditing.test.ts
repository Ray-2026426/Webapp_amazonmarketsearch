/**
 * 线框图 ⏳3 残留 3（二级页⑭ 标「可编辑」）：控制点阈值可编辑 + 三条残留的源码级守卫。
 *
 * 红线（这个文件就是在守它们）：
 *   1. 阈值改成什么就是什么（只 trim），**不改任何数字、不补默认值、不出现编出来的数**；
 *   2. 阈值一改，之前的「已确认」作废（用户确认的是那个数字，数字变了要重新拍板）；
 *   3. 空 / 纯空白输入一律拒绝，界面靠 `canEditThreshold()` 禁用「保存」；
 *   4. 重算决策包时，人工改过的阈值**不能被静默覆盖**（那是人的决定，不是派生物的附属品）。
 * 另外三条残留的源码守卫也放这里：① 层筛选存在、⑬ 标题可点、⑭ 阈值输入框只在 sheet 形态且仍是同一个组件。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ControlPoint } from '../src/types/opportunity';
import type { OpportunityCard } from '../src/types/researchProject';
import { computeSearchPathFlow, type SearchPathLayerId } from '../src/utils/userLook';
import { SearchPathDetailBlock } from '../src/components/UserLookView';
import { OpportunityRoadmapBlock } from '../src/components/OpportunityDecisionBoard';
import { buildControlPoints, buildDecisionPackage } from '../src/utils/opportunityPlan';
import {
  canEditThreshold,
  controlPointIdentity,
  countEditedThresholds,
  editControlPointThreshold,
  mergeControlPointsPreservingEdits,
  resetControlPointThreshold,
} from '../src/utils/controlPointEditing';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  OK  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${(err as Error).message}`);
  }
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function read(rel: string) {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

function count(haystack: string, needle: string) {
  return haystack.split(needle).length - 1;
}

/** 固定输入，保证"派生默认值"每次一致（确定性优先） */
const PROFIT = { price: 45, cost: 12, cpc: 1.2 };

function points(): ControlPoint[] {
  return [
    { id: 'cp1', kind: 'entry', label: '准入：转化率达到门槛才放量', metric: 'CVR', threshold: '≥8%', confirmed: false },
    { id: 'cp2', kind: 'stop', label: '止损：广告效率', metric: 'ACOS', threshold: '14 天 ACOS > 106%', confirmed: false },
  ];
}

console.log('controlPointEditing：阈值可编辑（不编数据 / 改了就要重新拍板）');

test('改阈值：写入新值 + thresholdEdited=true + **confirmed 作废**', () => {
  const before = points().map((p, i) => (i === 1 ? { ...p, confirmed: true } : p)); // 先让这条是"已确认"
  const after = editControlPointThreshold(before, 'cp2', '14 天 ACOS > 30%');
  const cp = after.find((p) => p.id === 'cp2')!;
  assert(cp.threshold === '14 天 ACOS > 30%', `阈值应为新输入，实际：${cp.threshold}`);
  assert(cp.thresholdEdited === true, '必须标成人工修改');
  assert(cp.confirmed === false, '阈值一改，之前的"已确认"必须作废（确认的是那个数字）');
  // 返回新数组、且不改动入参（React 里要靠新引用触发重渲染）
  assert(after !== before, '必须返回新数组');
  assert(before.find((p) => p.id === 'cp2')!.threshold === '14 天 ACOS > 106%', '入参不得被就地改写');
  // 其它点原样
  assert(after.find((p) => p.id === 'cp1')!.threshold === '≥8%', '不相关的控制点不能被顺手动到');
});

test('改阈值：只 trim，不做任何"智能化"加工', () => {
  const after = editControlPointThreshold(points(), 'cp1', '  ≥9.5%（人工口径）  ');
  assert(after.find((p) => p.id === 'cp1')!.threshold === '≥9.5%（人工口径）', '只应去掉首尾空白');
});

test('空 / 纯空白输入被拒绝：原样返回入参（不产生半成品状态）', () => {
  const before = points();
  assert(editControlPointThreshold(before, 'cp1', '') === before, '空字符串必须被拒绝');
  assert(editControlPointThreshold(before, 'cp1', '   ') === before, '纯空白必须被拒绝');
  assert(editControlPointThreshold(before, 'cp1', '\n\t ') === before, '换行/制表符也算空白');
  assert(canEditThreshold('≥8%') === true && canEditThreshold(' ') === false, 'canEditThreshold 是保存按钮的唯一判据');
  assert(canEditThreshold(undefined) === false && canEditThreshold(null) === false, 'undefined/null 一律不可保存');
});

test('改不存在的控制点：原样返回入参（不新建、不猜）', () => {
  const before = points();
  assert(editControlPointThreshold(before, 'nope', '≥8%') === before, 'cpId 找不到就不该动数据');
});

test('恢复默认：回到派生值、清掉标记、同样需要重新确认', () => {
  const edited = editControlPointThreshold(points(), 'cp2', '14 天 ACOS > 30%');
  const restored = resetControlPointThreshold(edited, 'cp2', '14 天 ACOS > 106%');
  const cp = restored.find((p) => p.id === 'cp2')!;
  assert(cp.threshold === '14 天 ACOS > 106%', `应回到派生默认值，实际：${cp.threshold}`);
  assert(!cp.thresholdEdited, 'thresholdEdited 必须被清掉');
  assert(cp.confirmed === false, '数字变回默认值也是一次变动，同样要重新拍板');
  assert(countEditedThresholds(restored) === 0, '恢复后不应再算作"已人工修改"');
});

test('恢复默认：拿不到派生值（空）时不动数据，不假装恢复成功', () => {
  const edited = editControlPointThreshold(points(), 'cp2', '14 天 ACOS > 30%');
  assert(resetControlPointThreshold(edited, 'cp2', '') === edited, '空默认值必须被拒绝');
  assert(resetControlPointThreshold(edited, 'cp2', '   ') === edited, '纯空白默认值必须被拒绝');
});

test('countEditedThresholds：只数 thresholdEdited===true 的点', () => {
  const base = points();
  assert(countEditedThresholds(base) === 0, '默认 0 条');
  const one = editControlPointThreshold(base, 'cp1', '≥10%');
  assert(countEditedThresholds(one) === 1, '改了 1 条就是 1');
  const two = editControlPointThreshold(one, 'cp2', '14 天 ACOS > 30%');
  assert(countEditedThresholds(two) === 2, '改了 2 条就是 2');
  assert(countEditedThresholds([]) === 0, '空清单是 0');
  // 手工构造一个"AI 瞎标"的点：没有真实编辑就不该被算进去
  assert(countEditedThresholds([{ ...base[0], thresholdEdited: undefined }]) === 0, 'undefined 不算');
});

test('重算决策包：人工改过的阈值按身份对齐后保留（id 每次重算都会变）', () => {
  const derived = buildControlPoints({ profit: PROFIT });
  const acos = derived.find((c) => c.metric === 'ACOS')!;
  // 确定性规则推导出来的原值（保本 71% × 1.5）
  assert(acos.threshold.includes('106'), `派生默认值应含 106，实际：${acos.threshold}`);
  const edited = editControlPointThreshold(derived, acos.id, '14 天 ACOS > 25%（人工收紧）');

  const regenerated = buildDecisionPackage({ profit: PROFIT, previousControlPoints: edited });
  const back = regenerated.controlPoints.find((c) => c.metric === 'ACOS')!;
  assert(back.threshold === '14 天 ACOS > 25%（人工收紧）', `人工阈值被重算覆盖了：${back.threshold}`);
  assert(back.thresholdEdited === true, '保留阈值的同时必须保留"人工改过"的标记');
  assert(back.confirmed === false, '重算出来的清单仍然是待确认状态（系统不代替用户拍板）');
  assert(back.id !== acos.id, '重算会生成新 id —— 所以对齐只能靠身份，不能只靠 id');
  // 反证：不做合并的话，重算会把人手写的数字丢掉
  const raw = buildControlPoints({ profit: PROFIT }).find((c) => c.metric === 'ACOS')!;
  assert(raw.threshold !== back.threshold, '这正是"不合并就会静默覆盖"的场景');
});

test('重算决策包：没人改过阈值时，派生值原样出来（合并不引入任何新数字）', () => {
  const derived = buildControlPoints({ profit: PROFIT });
  const regenerated = buildDecisionPackage({ profit: PROFIT, previousControlPoints: derived });
  assert(
    JSON.stringify(regenerated.controlPoints.map((c) => c.threshold)) === JSON.stringify(derived.map((c) => c.threshold)),
    '默认路径下阈值必须逐条相同（不新增、不改写）'
  );
  assert(countEditedThresholds(regenerated.controlPoints) === 0, '没人改过就应当是 0 条人工修改');
});

test('重算决策包：数字没变时保留上次的确认；数字变了就回到待确认', () => {
  const derived = buildControlPoints({ profit: PROFIT });
  const confirmed = derived.map((c) => ({ ...c, confirmed: true }));
  const same = mergeControlPointsPreservingEdits(buildControlPoints({ profit: PROFIT }), confirmed);
  assert(same.every((c) => c.confirmed === true), '阈值一字不差 → 之前的拍板对这个数字仍然有效');

  const stricter = buildControlPoints({ profit: { price: 45, cost: 12, cpc: 3 } }); // 保本 ACOS 变了 → 止损阈值也变
  const changed = mergeControlPointsPreservingEdits(stricter, confirmed);
  const acos = changed.find((c) => c.metric === 'ACOS')!;
  assert(acos.confirmed === false, '推导出来的数字变了 → 必须回到待确认');
});

test('重算决策包：推导里已经没有的"人工修改点"也要留下（不许静默丢人的数字）', () => {
  const manual: ControlPoint = {
    id: 'cp_manual_1',
    kind: 'process',
    label: '过程：自加的仓储破损率',
    metric: '破损率',
    threshold: '<0.5%（人工加的控制点）',
    confirmed: false,
    thresholdEdited: true,
  };
  const merged = mergeControlPointsPreservingEdits(buildControlPoints({ profit: PROFIT }), [manual]);
  const kept = merged.find((c) => c.id === 'cp_manual_1');
  assert(kept !== undefined, '人工改过、但这次推导里没有的控制点必须被保留');
  assert(kept!.threshold === '<0.5%（人工加的控制点）', '保留的是人工阈值原文');
  assert(countEditedThresholds(merged) === 1, '它仍然算作"已人工修改"');
  // 没有人工修改时，合并不该凭空多出控制点
  const plain: ControlPoint = { ...manual, id: 'cp_plain', thresholdEdited: undefined };
  const merged2 = mergeControlPointsPreservingEdits(buildControlPoints({ profit: PROFIT }), [plain]);
  assert(merged2.every((c) => c.id !== 'cp_plain'), '没被人工改过的旧点不保留（否则会越重算越多）');
});

test('controlPointIdentity：同一条控制点的身份 = 类型 + 标签 + 指标（跨重算稳定）', () => {
  const a = buildControlPoints({ profit: PROFIT })[3];
  const b = buildControlPoints({ profit: PROFIT })[3];
  assert(a.id !== b.id, '重算后 id 不同');
  assert(controlPointIdentity(a) === controlPointIdentity(b), '身份必须相同，否则重算对不齐');
});

console.log('⏳3 残留：源码级守卫');

test('① 二级页的层筛选真的存在：全部 / 四层、共享状态、空层有话说、证据列没被筛掉', () => {
  const user = read('src/components/UserLookView.tsx');
  assert(count(user, 'export function SearchPathDetailBlock(') === 1, '① 仍然是同一个导出组件');
  assert(user.includes('SEARCH_PATH_LAYER_FILTERS'), '① 必须有层筛选选项表');
  assert(user.includes("{ key: 'all', label: '全部' }"), '① 默认项必须是「全部」');
  assert(user.includes('SEARCH_PATH_LAYER_ORDER.map'), '层选项必须来自唯一顺序来源（不另抄一遍四层）');
  // 筛选状态由 UserLookView 持有（内联与二级页① 共享同一份状态），且必须在组件级早退之前
  assert(user.includes("useState<'all' | SearchPathLayerId>('all')"), '① 层筛选默认「全部」');
  const stateAt = user.indexOf("useState<'all' | SearchPathLayerId>('all')");
  const earlyReturnAt = user.indexOf('if (!data) {');
  assert(stateAt > 0 && earlyReturnAt > stateAt, '① 层筛选的 useState 必须在 `if (!data)` 早退之前（防 React #310）');
  assert(count(user, 'layerFilter={searchLayerFilter}') === 2, '① 内联与二级页① 必须共用同一份筛选状态');
  assert(count(user, 'onLayerFilterChange={setSearchLayerFilter}') === 2, '① 两个形态都要能改这份状态');
  assert(count(user, 'searchLayerFilter,') === 1 && user.includes('onRegisterL3Bodies, data, searchLayerFilter'), '① 筛选变了要重新注册二级页正文，否则页面上点了不生效');
  assert(user.includes('onLayerFilterChange(f.key)'), '① 筛选按钮必须真的切状态');
  assert(user.includes('aria-pressed={layerFilter === f.key}'), '① 选中态不能只靠颜色');
  assert(user.includes('该层暂无关键词证据'), '① 空层必须写明白，不能给一个空盒子');
  // 筛选只筛行、不重算：三个确定性证据列必须还在
  for (const col of ['占比 ', '月搜索量 ', '本层合计 ']) {
    assert(user.includes(col), `① 证据列「${col.trim()}」不能被筛选逻辑藏掉`);
  }
  assert(
    !/computeSearchPathFlow\([^)]*[Ll]ayerFilter/.test(user),
    '① 层筛选不得进入流向计算（流向必须保持确定性口径）'
  );
  assert(user.includes('不支持拖动排序'), '① 线框图「拖动结果」必须写明是故意不做的');
});

test('⑬ 点卡片标题也能进详情，且右下「查看详情」还在', () => {
  const board = read('src/components/OpportunityDecisionBoard.tsx');
  assert(count(board, "onOpenL3?.('13', card.id)") === 2, `标题 + 「查看详情」应恰好 2 个入口，实际 ${count(board, "onOpenL3?.('13', card.id)")}`);
  const anchor = board.indexOf('title="打开二级页⑬：机会卡详情（证据 / 推理 / 反证）"');
  assert(anchor > 0, '标题按钮必须有 title 提示');
  const open = board.lastIndexOf('<button', anchor);
  const close = board.indexOf('</button>', anchor);
  assert(open > 0 && close > open, '标题必须是一个真正的 button');
  const inner = board.slice(open, close);
  assert(inner.includes('{card.title}'), '标题按钮渲染的必须是卡片标题本身');
  assert(!inner.includes('<button', 1) && !inner.includes('<a '), '标题按钮内不得再嵌套可交互元素');
  assert(board.includes('focus-visible:ring-2'), '标题必须能被 Tab 聚焦并看见焦点（键盘可用）');
});

test('⑭ 阈值编辑：sheet 形态有输入框 + 保存 / 恢复默认；inline 形态仍是只读 + 查看详情', () => {
  const board = read('src/components/OpportunityDecisionBoard.tsx');
  const sheetMark = board.indexOf('⑭-sheet-阈值编辑');
  const inlineMark = board.indexOf('⑭-inline-只读');
  assert(sheetMark > 0 && inlineMark > sheetMark, '两个形态的标记必须都在，且 sheet 在前');
  const sheetSeg = board.slice(sheetMark, inlineMark);
  const inlineSeg = board.slice(inlineMark, board.indexOf('if (!sheet) return body;', inlineMark));
  assert(count(sheetSeg, 'data-control-point-threshold-input') === 1, 'sheet 形态必须有且只有一个阈值输入框');
  assert(count(board, 'data-control-point-threshold-input') === 1, '阈值输入框全文件只应有一处（唯一实现）');
  assert(sheetSeg.includes('保存') && sheetSeg.includes('恢复默认'), 'sheet 形态要有「保存」与「恢复默认」');
  assert(sheetSeg.includes('canEditThreshold('), '「保存」按钮必须用 canEditThreshold 判空');
  assert(sheetSeg.includes('派生默认值'), 'sheet 形态必须把派生默认值显示出来');
  assert(sheetSeg.includes('已人工修改'), '改过的阈值必须有可见标记');
  assert(count(inlineSeg, '<input') === 0, 'inline 形态不得出现输入框');
  assert(inlineSeg.includes('onToggleControlPoint(c.id)'), 'inline 形态保留"点一下即确认"');
  assert(inlineSeg.includes("（待确认）"), 'inline 形态保留（待确认）的提示');
  assert(board.includes('title="打开二级页⑭：执行路线图与控制点详情"'), 'inline 形态保留「查看详情」入口');
  assert(!board.includes('改动作/阈值请回到看机会主屏'), 'sheet 的说明不能再声称"阈值改不了"');
});

test('⑭ 仍然是带 variant 的同一个组件（没有第二份实现）', () => {
  const board = read('src/components/OpportunityDecisionBoard.tsx');
  assert(count(board, 'export function OpportunityRoadmapBlock(') === 1, '只应有一个导出组件');
  assert(count(board, '<OpportunityRoadmapBlock') === 2, `应恰好两处使用（内联 + 二级页⑭），实际 ${count(board, '<OpportunityRoadmapBlock')}`);
  assert(count(board, 'variant="sheet"') === 2, '二级页正文靠 variant="sheet" 渲染');
  assert(board.includes('variant?: L3BlockVariant'), '组件必须带 variant 属性');
  assert(count(board, 'CONTROL_POINT_LABELS[kind]') === 1, '控制点只能在 .map 里渲染一次（否则就是复制 markup）');
  assert(board.includes('onEditControlPointThreshold'), 'sheet 形态的编辑回调必须由外层注入');
  assert(board.includes('persistCards(next,') && board.includes('changeControlPointThreshold'), '编辑必须走同一条持久化路径');
});

console.log('⏳3 残留：真实渲染冒烟（不只是 grep 源码）');

/** ① 用的最小搜索路径数据：只有认知层与决策层，故意**没有**场景层（用来验证空层提示） */
const SMOKE_SEARCH_PATH = {
  summary: '先用大词搜，再加限定词',
  layers: [
    { layer: 'awareness' as const, words: [{ word: 'cervical pillow', volume: 12000, share: 0.6 }] },
    { layer: 'decision' as const, words: [{ word: 'adjustable height pillow', volume: 3000, share: 0.25 }] },
  ],
};

/** ⑭ 用的最小机会卡：一条人工改过的控制点 + 一条 AI 自造（对不上派生默认值）的控制点 */
const SMOKE_CARD = {
  id: 'o1',
  projectId: 'p1',
  unmetNeedId: 'n1',
  title: '可调高度颈椎枕',
  needStatement: '侧睡需要可调高度的颈椎支撑',
  currentAlternative: '',
  currentAlternativeCost: '',
  solutionHypothesis: '',
  marketEvidenceIds: [],
  userEvidenceIds: [],
  competitorEvidenceIds: [],
  selfAssessmentId: '',
  profitScenarioIds: [],
  profitAssumption: { price: 45, cost: 12, cpc: 1.2 },
  risks: [],
  validationActions: [],
  score: 0,
  coverage: 0,
  decision: 'undecided' as const,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  decisionPackage: {
    roadmap: [{ id: 'rm1', phase: 'now' as const, action: '送检 3 家工厂打样', cost: 1500 }],
    resources: [],
    controlPoints: [
      {
        id: 'cpAcos',
        kind: 'stop' as const,
        label: '止损：广告效率',
        metric: 'ACOS',
        threshold: '14 天 ACOS > 25%',
        confirmed: false,
        thresholdEdited: true,
      },
      { id: 'cpAi', kind: 'entry' as const, label: 'AI 自造控制点', metric: '自定义指标', threshold: '随便', confirmed: false },
    ],
  },
} as unknown as OpportunityCard;

test('① 层筛选真的筛掉了行（用 react-dom/server 真渲染一次）', () => {
  const flow = computeSearchPathFlow(SMOKE_SEARCH_PATH);
  const html = (layerFilter: 'all' | SearchPathLayerId) =>
    renderToStaticMarkup(
      createElement(SearchPathDetailBlock, { searchPath: SMOKE_SEARCH_PATH, flow, layerFilter, onLayerFilterChange: () => {} })
    );
  const all = html('all');
  assert(all.includes('cervical pillow') && all.includes('adjustable height pillow'), '全部：两层词都要在');
  assert(all.includes('占比 60%') && all.includes('月搜索量 12,000') && all.includes('本层合计'), '全部：证据列必须在');
  const decision = html('decision');
  assert(decision.includes('adjustable height pillow'), '选中决策层：该层的词要在');
  assert(!decision.includes('cervical pillow'), '选中决策层：认知层的词必须被筛掉');
  assert(decision.includes('本层合计'), '筛选不得顺手把本层合计藏掉');
  assert(decision.includes('不支持拖动排序'), '① 必须写明不做拖动');
});

test('① 层里没有词时渲染「该层暂无关键词证据」，不是空盒子', () => {
  const flow = computeSearchPathFlow(SMOKE_SEARCH_PATH);
  const sheet = renderToStaticMarkup(
    createElement(SearchPathDetailBlock, {
      searchPath: SMOKE_SEARCH_PATH,
      flow,
      layerFilter: 'scenario', // 数据里根本没有场景层
      onLayerFilterChange: () => {},
      variant: 'sheet',
    })
  );
  assert(sheet.includes('该层暂无关键词证据'), '空层必须写明白');
  assert(sheet.includes('场景层'), '空态里仍然要写清是哪一层');
  assert(!sheet.includes('cervical pillow'), '筛选到空层时不该漏出别的层的词');
});

test('⑭ 真实渲染：sheet 形态有阈值输入与「已人工修改」，inline 形态没有输入框', () => {
  const inline = renderToStaticMarkup(
    createElement(OpportunityRoadmapBlock, { card: SMOKE_CARD, onToggleControlPoint: () => {} })
  );
  const sheet = renderToStaticMarkup(
    createElement(OpportunityRoadmapBlock, {
      card: SMOKE_CARD,
      onToggleControlPoint: () => {},
      onEditControlPointThreshold: () => {},
      onResetControlPointThreshold: () => {},
      variant: 'sheet',
    })
  );
  assert(!inline.includes('data-control-point-threshold-input'), 'inline 形态不得有阈值输入框');
  assert(inline.includes('查看详情'), 'inline 形态保留「查看详情」入口');
  assert(inline.includes('已人工修改'), 'inline 形态也要标出人工改过的阈值');
  assert(sheet.includes('data-control-point-threshold-input'), 'sheet 形态必须有阈值输入框');
  assert(sheet.includes('value="14 天 ACOS &gt; 25%"'), 'sheet 的输入框要显示人工改过的值');
  assert(sheet.includes('保存') && sheet.includes('恢复默认'), 'sheet 必须有保存与恢复默认');
  assert(sheet.includes('派生默认值'), 'sheet 必须说明默认值是哪来的');
  assert(sheet.includes('106'), '派生默认值应当是真算出来的那条（106）');
  assert(sheet.includes('未提供'), '对不上派生规则的控制点必须显示「未提供」，不编一个默认值');
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
