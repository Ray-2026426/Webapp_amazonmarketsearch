/**
 * 线框图 ⏳3 回归：①②③④⑪⑫⑬⑭ 必须是"真正的独立 L3 全屏页"，而且**不许复制第二份实现**。
 *
 * 背景：这 8 屏在线框图（docs/ui-wireframes-l3.html）里是独立二级页，实现上原本只是
 * 「看用户 / 看自己 / 看机会」主屏里的内联区块。⏳3 的做法是：把每个内联区块抽成一个组件
 * （多一个 `variant`），同一个组件既内联渲染、又作为全屏页正文 —— 所以本测试守两件事：
 *   ① 注册表（src/utils/l3Pages.ts）与线框图 note 的四句契约（解决什么问题/从哪进入/返回去哪/依赖哪些数据）；
 *   ② "同一份实现"不被破坏：8 个区块组件必须同时出现在内联与二级页两处，且都有 variant='sheet'。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { L3_PAGES, L3_LOOK_LABELS, l3Page, type L3Id } from '../src/utils/l3Pages';

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

/** 线框图顺序：①②③④⑪⑫⑬⑭ */
const EXPECTED: { id: L3Id; badge: string; look: 'user' | 'self' | 'opportunity' }[] = [
  { id: '1', badge: '①', look: 'user' },
  { id: '2', badge: '②', look: 'user' },
  { id: '3', badge: '③', look: 'user' },
  { id: '4', badge: '④', look: 'user' },
  { id: '11', badge: '⑪', look: 'self' },
  { id: '12', badge: '⑫', look: 'self' },
  { id: '13', badge: '⑬', look: 'opportunity' },
  { id: '14', badge: '⑭', look: 'opportunity' },
];

/** 每一页的正文由哪个区块组件提供、在哪个文件里（内联与二级页共用同一个组件） */
const BLOCKS: { id: L3Id; component: string; file: string; sheetUsages: number }[] = [
  { id: '1', component: 'SearchPathDetailBlock', file: 'src/components/UserLookView.tsx', sheetUsages: 4 },
  { id: '2', component: 'SearchPreferenceDetailBlock', file: 'src/components/UserLookView.tsx', sheetUsages: 4 },
  { id: '3', component: 'NeedTreeDetailBlock', file: 'src/components/UserLookView.tsx', sheetUsages: 4 },
  { id: '4', component: 'SegmentStandardBlock', file: 'src/components/UserLookView.tsx', sheetUsages: 4 },
  { id: '11', component: 'AccountBackgroundBlock', file: 'src/components/SelfReadinessPanel.tsx', sheetUsages: 2 },
  { id: '12', component: 'CategoryQuizBlock', file: 'src/components/SelfReadinessPanel.tsx', sheetUsages: 2 },
  { id: '13', component: 'OpportunityEvidenceChain', file: 'src/components/OpportunityDecisionBoard.tsx', sheetUsages: 2 },
  { id: '14', component: 'OpportunityRoadmapBlock', file: 'src/components/OpportunityDecisionBoard.tsx', sheetUsages: 2 },
];

console.log('l3Pages：二级页注册表 + 全屏页壳 + 同一份实现');

test('注册表正好 8 页，编号/圈号/归属的看在线上框图的顺序上', () => {
  assert(L3_PAGES.length === 8, `应为 8 页，实际 ${L3_PAGES.length}`);
  const ids = L3_PAGES.map((p) => p.id);
  assert(
    JSON.stringify(ids) === JSON.stringify(EXPECTED.map((e) => e.id)),
    `编号顺序不对：${ids.join(',')}`
  );
  const badges = L3_PAGES.map((p) => p.badge);
  assert(
    JSON.stringify(badges) === JSON.stringify(EXPECTED.map((e) => e.badge)),
    `圈号顺序不对：${badges.join('')}`
  );
  for (const e of EXPECTED) {
    const page = l3Page(e.id);
    assert(page.look === e.look, `二级页${page.badge} 的 look 应为 ${e.look}，实际 ${page.look}`);
    assert(page.title.trim().length >= 4, `二级页${page.badge} 的标题太短：${page.title}`);
  }
});

test('每页的四句契约都非空，且写明属于哪一看（线框图 note 口径）', () => {
  for (const page of L3_PAGES) {
    const lookLabel = L3_LOOK_LABELS[page.look];
    for (const key of ['problem', 'entry', 'backTo', 'depends'] as const) {
      const value = page[key];
      assert(typeof value === 'string' && value.trim().length >= 8, `二级页${page.badge} 的 ${key} 太短/为空：${value}`);
      assert(value.includes(lookLabel), `二级页${page.badge} 的 ${key} 没有写明「${lookLabel}」：${value}`);
    }
    assert(page.entry.includes('看'), `二级页${page.badge} 的 entry 必须写清入口：${page.entry}`);
    assert(page.backTo.startsWith('返回'), `二级页${page.badge} 的 backTo 必须以"返回"开头：${page.backTo}`);
  }
});

test('未知编号直接抛错（宁可在开发时报错，也不静默渲染空页）', () => {
  let threw = false;
  try {
    l3Page('nope' as never);
  } catch {
    threw = true;
  }
  assert(threw, 'l3Page(未知) 应抛错');
  let threw99 = false;
  try {
    l3Page('99' as never);
  } catch {
    threw99 = true;
  }
  assert(threw99, 'l3Page(未实现的编号) 也应抛错');
});

test('页壳只渲染一次，且在项目壳里（右侧决策草稿不会被拆掉）', () => {
  const ws = read('src/components/ProjectWorkspace.tsx');
  assert(count(ws, '<L3Sheet') === 1, `ProjectWorkspace 里 <L3Sheet 应恰好 1 处，实际 ${count(ws, '<L3Sheet')}`);
  assert(ws.includes('l3Page(l3)'), '页壳的页面信息必须来自共享注册表 l3Page()');
  assert(ws.includes('<DecisionDraftRail'), '右侧决策草稿必须仍然常驻（页壳是覆盖层，不是替换页面）');
  assert(ws.includes('const [l3, setL3] = useState<L3Id | null>(null)'), '应使用 l3 state 控制页壳开关');
  assert(ws.includes('onRegisterL3Bodies={registerL3Bodies}'), '项目壳必须把正文注册回调传下去');
});

test('8 个页面在源码里都有 onOpenL3 入口（编号逐一可查）', () => {
  const files = [
    'src/components/UserLookView.tsx',
    'src/components/SelfReadinessPanel.tsx',
    'src/components/OpportunityDecisionBoard.tsx',
  ].map(read);
  const all = files.join('\n');
  for (const e of EXPECTED) {
    assert(
      all.includes(`onOpenL3?.('${e.id}'`),
      `缺少二级页${e.badge}（id='${e.id}'）的入口：源码里应有 onOpenL3?.('${e.id}')`
    );
  }
});

test('页壳：Escape 关闭、role/aria 齐备、返回按钮的 aria-label 是「返回」、children 透传', () => {
  const sheet = read('src/components/L3Sheet.tsx');
  assert(sheet.includes("event.key === 'Escape'"), '页壳必须支持 Escape 关闭');
  assert(sheet.includes('role="dialog"'), '页壳必须是 role="dialog"');
  assert(sheet.includes('aria-modal="true"'), '页壳必须声明 aria-modal');
  assert(sheet.includes('aria-label="返回"'), '返回按钮必须有 aria-label="返回"');
  assert(sheet.includes('> 返回</button>') || sheet.includes('返回\n          </button>') || sheet.includes('返回'), '页壳必须有「返回」按钮');
  assert(sheet.includes('onClick={onClose}'), '返回按钮必须调用 onClose');
  assert(sheet.includes('{children}'), '页壳必须透传 children（正文）');
  assert(sheet.includes('fixed inset-0 z-50'), '页壳必须是覆盖整个视口的全屏层');
  assert(sheet.includes("document.body.style.overflow = 'hidden'"), '页壳打开时应锁住背后页面的滚动');
  for (const label of ['这个页面解决什么问题', '从哪进入', '返回去哪', '依赖哪些数据']) {
    assert(sheet.includes(label), `页壳必须渲染线框图契约「${label}」`);
  }
});

test('同一份实现：8 个区块组件既内联渲染、也作为二级页正文（variant="sheet"）', () => {
  const cache = new Map<string, string>();
  for (const b of BLOCKS) {
    if (!cache.has(b.file)) cache.set(b.file, read(b.file));
    const src = cache.get(b.file)!;
    assert(src.includes(`export function ${b.component}(`), `${b.component} 必须是导出的组件（${b.file}）`);
    const usages = count(src, `<${b.component}`);
    assert(usages >= 2, `${b.component} 必须同时用于内联与二级页，实际只出现 ${usages} 次（${b.file}）`);
    assert(src.includes(`variant="sheet"`), `${b.file} 必须用 variant="sheet" 渲染二级页正文`);
  }
});

test('二级页正文的 variant 数量与页面数一致（没有多写一份标记）', () => {
  for (const b of BLOCKS) {
    const src = read(b.file);
    assert(
      count(src, 'variant="sheet"') === b.sheetUsages,
      `${b.file} 的 variant="sheet" 应为 ${b.sheetUsages} 处，实际 ${count(src, 'variant="sheet"')}`
    );
  }
});

test('代码里没有为二级页另写一份区块标记（同一段标记只渲染一次）', () => {
  const user = read('src/components/UserLookView.tsx');
  // 抽出组件后，这些"标记级"片段在整份文件里只能出现一次：它同时服务内联与二级页
  for (const [fragment, label] of [
    ['认知 → 考虑 → 决策 → 场景', '搜索路径图的四层副标题'],
    ['describeSearchPathFlow(flow)', '流向文案'],
    ['决策焦点（买家下单前对比什么）', '决策焦点标签'],
    ['细分标准下的需求明细（二级页④）', '④ 需求明细'],
    ['尚未添加未满足需求候选', '③ 空态'],
  ] as const) {
    assert(count(user, fragment) === 1, `「${label}」应只渲染一次，实际 ${count(user, fragment)} 次`);
  }

  const board = read('src/components/OpportunityDecisionBoard.tsx');
  assert(count(board, 'CONTROL_POINT_LABELS[kind]') === 1, '控制点是同一份实现（不许复制到二级页另写一遍）');
  assert(count(board, 'reasoningSteps!.map') === 1, '推理链是同一份实现');
  assert(count(board, '反证 / 还缺什么') === 1, '反证栏是同一份实现');

  const self = read('src/components/SelfReadinessPanel.tsx');
  assert(count(self, '为什么问：{q.basis}') === 1, '⑫ 的"为什么问"是同一份实现');
  assert(count(self, '适配度：') === 1, '⑫ 的适配度口径是同一份实现');
});

test('文档口径已更新：⏳3 标为已修', () => {
  const doc = read('docs/ui-conformance-audit.md');
  assert(doc.includes('⏳3'), '审计文档里必须仍然能找到 ⏳3');
  assert(/⏳3[^\n]*已修/.test(doc), '⏳3 一节必须标为已修');
  for (const badge of ['①', '②', '③', '④', '⑪', '⑫', '⑬', '⑭']) {
    assert(doc.includes(`| ${badge} |`), `审计文档的表格里必须有 ${badge} 一行`);
  }
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
