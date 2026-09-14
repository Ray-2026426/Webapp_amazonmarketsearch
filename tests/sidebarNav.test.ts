/**
 * 侧栏结构守卫。
 *
 * 背景（2026-09 用户明确要求）：「把原来这几个板块的东西，暂时先恢复，放到项目中心下面去，按这个顺序」
 * —— 市场大盘 → 竞品明细 → 用户洞察 → 关键词分析 → 利润计算器。
 *
 * ⚠️ 这与已批准的线框图第 1 屏**冲突**（线框图写的是"关键词 / VOC / 竞对降为明细层，不入顶级导航"，
 * 侧栏只保留 项目中心 / 利润计算器 / 市场大盘·全市场 / 设置）。本轮按用户指示临时回退，
 * 并把偏差记入 docs/ui-conformance-audit.md 与 PRD §15.18 —— 这条测试的作用是：
 * 让这个"临时状态"不会被后人当成 bug 顺手改掉，也不会被悄悄改回别的顺序。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');

/** 取侧栏 nav 区块（两个 <nav> 之间的内容只取第一个） */
function sidebarRegion(): string {
  const start = app.indexOf('<nav');
  const end = app.indexOf('</nav>', start);
  assert(start > 0 && end > start, '找不到侧栏 nav 区块');
  return app.slice(start, end);
}

const nav = sidebarRegion();

console.log('侧栏：顺序与最小结构');

test('项目中心之后，五个模块按指定顺序出现', () => {
  const order = ['项目中心', '市场大盘', '竞品明细', '用户洞察', '关键词分析', '利润计算器'];
  const positions = order.map((label) => {
    const i = nav.indexOf(`<span>${label}</span>`);
    assert(i > 0, `侧栏缺少「${label}」`);
    return i;
  });
  for (let i = 1; i < positions.length; i += 1) {
    assert(positions[i] > positions[i - 1], `「${order[i]}」应在「${order[i - 1]}」之后`);
  }
});

test('五个模块都真的会切到对应的视图（不是只画了个按钮）', () => {
  const expects: [string, string][] = [
    ['市场大盘', "setActiveView('market')"],
    ['竞品明细', "setActiveView('competitors')"],
    ['用户洞察', "setActiveView('insights')"],
    ['关键词分析', "setActiveView('keywords')"],
    ['利润计算器', "setActiveView('profit')"],
  ];
  for (const [label, call] of expects) {
    const spanIdx = nav.indexOf(`<span>${label}</span>`);
    const btnStart = nav.lastIndexOf('<button', spanIdx);
    const btn = nav.slice(btnStart, spanIdx);
    assert(btn.includes(call), `「${label}」按钮里没有 ${call}`);
  }
});

test('它们被放在「项目中心」下面（缩进的子分组），而不是和项目中心平级', () => {
  const groupIdx = nav.indexOf('border-l border-black/5');
  assert(groupIdx > 0, '找不到子分组容器（缩进 + 左边框）');
  const projectsIdx = nav.indexOf('<span>项目中心</span>');
  assert(groupIdx > projectsIdx, '子分组必须在项目中心之后');
  // 项目中心之后到 </nav> 之间不应再有与项目中心同级的独立按钮
  const afterGroup = nav.slice(nav.indexOf('</div>', groupIdx));
  for (const label of ['市场大盘', '竞品明细', '用户洞察', '关键词分析', '利润计算器']) {
    assert(!afterGroup.includes(`<span>${label}</span>`), `「${label}」不应出现在子分组之外`);
  }
});

test('视图切换后不会被"回到项目中心"的按钮吞掉（activeView 判断仍在）', () => {
  for (const view of ['market', 'competitors', 'insights', 'keywords', 'profit']) {
    assert(app.includes(`activeView === '${view}'`) || app.includes(`'${view}'`), `缺少 ${view} 视图的处理`);
  }
});

console.log('侧栏：偏差必须留痕');

test('源码里写明"与线框图冲突、属用户指示的临时回退"', () => {
  assert(/线框图第 1 屏/.test(nav), '注释里必须提到与线框图第 1 屏的冲突');
  assert(/临时回退/.test(nav), '必须写明这是临时回退');
  assert(/PRD §15\.18/.test(nav), '必须指向 PRD 的偏差记录');
});

test('术语仍然合规（禁用词不得因为这次改动回流）', () => {
  for (const banned of ['看竞品', '竞品分析', '竞品对比']) {
    assert(!app.includes(banned), `App.tsx 里出现了禁用词：${banned}`);
  }
  assert(nav.includes('<span>竞品明细</span>'), '工具层应叫「竞品明细」');
});

console.log('侧栏：底部动作没被挤掉');

test('底部仍保留 重新上传数据 / 设置（不能被这次新增顶掉）', () => {
  for (const label of ['重新上传数据', '设置']) {
    assert(app.includes(`<span>${label}</span>`), `底部缺少「${label}」`);
  }
  const navEnd = app.indexOf('</nav>');
  const footer = app.slice(navEnd, navEnd + 4000);
  assert(footer.includes('重新上传数据'), '重新上传数据应在 nav 之后的底部区域');
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
