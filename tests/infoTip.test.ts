// 角标（InfoTip）守卫 · PRD §15.24
//
// 为什么要有这个套件：用户明确要求「需要大篇幅说明的地方，不要占用地方，做成角标来，
// 鼠标悬浮或者点击到角标才会显示」。这条要求在实现上最容易走偏的三件事，正好就是本套件守的三件事：
//   ① 图省事用原生 title 属性糊弄（不能换行、不能点固定、键盘/触屏用户看不到）；
//   ② 把"硬约束 / 合规 / 会改变判断的口径"也一起藏进角标 —— 那等于把关键信息删掉；
//   ③ 每个页面各写一份手搓 tooltip，行为不一致（这个仓库里曾经真的有三份）。
//
// 断言分五组：
//   A. 组件能力：悬浮 + 点击固定（可再点关闭）+ Esc + 键盘聚焦 + 点击外部 + aria/role。
//   B. 不是原生 title 实现（触发按钮上不许有 title= 属性）。
//   C. 用户点名的那一处（团队空间「角色与权限口径」）确实收进了角标，正文只剩短摘要。
//   D. 改造面：>= 6 个不同文件使用 InfoTip，且清单文件逐一可查。
//   E. 反向守卫：角标文案里不许出现硬约束/合规/不可直接进入这类关键词。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InfoTip } from '../src/components/ui/InfoTip';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log('  OK  ' + name);
  } catch (e) {
    failed++;
    console.error('  FAIL ' + name);
    console.error('    ' + (e instanceof Error ? e.message : String(e)));
  }
}

function read(rel: string): string {
  return fs.readFileSync(rel, 'utf8');
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p.replace(/\\/g, '/'));
  }
  return out;
}

/** 抽出源码里所有 <InfoTip ... />（或带 children 的 <InfoTip>…</InfoTip>）用法 */
function infoTipUsages(src: string): string[] {
  const out: string[] = [];
  const re = /<InfoTip\b[\s\S]*?(?:\/>|<\/InfoTip>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[0]);
  return out;
}

/**
 * 角标内容可能写成 content={SOME_CONST}：把同文件里该标识符对应的字面量也拉进来一起检查，
 * 否则"把关键口径塞进常量再传给角标"就能绕过反向守卫。
 */
function expandRefs(fileSrc: string, usage: string): string {
  let extra = '';
  const ids = usage.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  for (const id of new Set(ids)) {
    const m = fileSrc.match(new RegExp(`(?:const|let)\\s+${id}\\s*=\\s*([\\s\\S]*?);\\r?\\n`));
    if (m) extra += '\n' + m[1];
  }
  return usage + extra;
}

const INFO_TIP = 'src/components/ui/InfoTip.tsx';

/**
 * 已改造清单（PRD §15.24）：文件 → 至少几处角标。
 * 其中 BrandLeaderboard / MetricCard / MarketConcentrationChart / KeywordAnalysisView 是
 * "把原有的手搓 tooltip 换成唯一实现"，其余是"把平铺长说明收起来"。
 */
const ADOPTED: { file: string; min: number }[] = [
  { file: 'src/components/TeamSettingsPanel.tsx', min: 1 },
  { file: 'src/components/AiSettingsPanel.tsx', min: 1 },
  { file: 'src/components/SelfReadinessPanel.tsx', min: 3 },
  { file: 'src/components/SelfAssessmentView.tsx', min: 1 },
  { file: 'src/components/OpportunityDecisionBoard.tsx', min: 3 },
  { file: 'src/components/MarketLookView.tsx', min: 1 },
  { file: 'src/components/CompetitorHub.tsx', min: 9 },
  { file: 'src/components/UserInsights.tsx', min: 2 },
  { file: 'src/components/MarketConcentrationChart.tsx', min: 1 },
  { file: 'src/components/KeywordAnalysisView.tsx', min: 1 },
  { file: 'src/components/MetricCard.tsx', min: 2 },
  { file: 'src/components/BrandLeaderboard.tsx', min: 1 },
];

/** 必须留在正文、绝不许收进角标的关键口径关键词（PRD §15.24「什么内容绝对不能被藏起来」） */
const MUST_STAY_IN_BODY = [
  '硬约束',
  '合规',
  '违法',
  '法律',
  '免责',
  '不得直接进入',
  '不可直接进入',
  '验证后进入',
  '不能推荐',
  '密钥',
  '安全隐患',
  '禁止进入',
];

console.log('InfoTip：全站唯一的角标实现');

// ── A. 组件能力 ──────────────────────────────────────────────
test('InfoTip 支持悬浮显示（onMouseEnter / onMouseLeave）', () => {
  const src = read(INFO_TIP);
  assert(src.includes('onMouseEnter'), '必须有悬浮触发');
  assert(src.includes('onMouseLeave'), '必须有离开收起');
  assert(
    /const open = \(hovered && !dismissed\) \|\| focused \|\| pinned;/.test(src),
    '显示条件应合并悬浮/聚焦/点击固定三种来源（并带"点击关闭"的抑制位）'
  );
});

test('InfoTip 支持点击固定，且再次点击关闭', () => {
  const src = read(INFO_TIP);
  assert(/if \(pinned\) \{/.test(src), '点击处理必须区分"已固定 → 关闭"与"未固定 → 固定"');
  assert(src.includes('setPinned(false)') && src.includes('setPinned(true)'), '再次点击必须能关闭');
  assert(src.includes('setDismissed(true)'), '点击关闭要记抑制位，否则鼠标还悬着会立刻被 hover 重新打开');
});

test('InfoTip 支持 Esc 关闭', () => {
  const src = read(INFO_TIP);
  assert(src.includes("event.key !== 'Escape'"), '必须监听 Escape');
  assert(src.includes('setPinned(false)'), 'Esc 之后要真的收起');
});

test('InfoTip 可键盘聚焦（tabIndex=0 + onFocus + focus-visible 焦点环）', () => {
  const src = read(INFO_TIP);
  assert(src.includes('tabIndex={0}'), '角标必须可 Tab 聚焦');
  assert(src.includes('onFocus={() => setFocused(true)}'), '聚焦时要能看说明（不能只有鼠标用户能看）');
  assert(src.includes('focus-visible:ring'), '必须有可见焦点环');
});

test('InfoTip 点击外部关闭', () => {
  const src = read(INFO_TIP);
  assert(src.includes("document.addEventListener('mousedown'"), '必须监听文档级 mousedown 做"点击外部关闭"');
  assert(src.includes('wrapRef.current?.contains'), '内部点击不能误关');
});

test('InfoTip 的可访问性：role="tooltip" + aria-describedby + aria-expanded', () => {
  const src = read(INFO_TIP);
  assert(src.includes('role="tooltip"'), '浮层必须是 role="tooltip"');
  assert(src.includes('aria-describedby={open ? panelId : undefined}'), '触发按钮要用 aria-describedby 关联浮层');
  assert(src.includes('aria-expanded={open}'), '展开态要暴露给辅助技术');
  assert(src.includes('aria-label={label}'), '图标按钮必须有可读名称');
  assert(src.includes('<Info className="w-3.5 h-3.5"'), '图标必须是 Info，且尺寸为 w-3.5 h-3.5');
});

test('InfoTip 默认不占位、且能在窄容器里用（inline-flex align-middle + fixed 浮层 + 视口夹取）', () => {
  const src = read(INFO_TIP);
  assert(src.includes("'relative inline-flex align-middle'"), '外层必须是内联锚点，不占整行');
  assert(src.includes('fixed z-50'), '浮层用 fixed：祖先 overflow-hidden（表格/卡片）不会把角标裁掉');
  assert(src.includes('vw - p.width'), '水平方向要夹取到视口内，窄容器里不许溢出');
  assert(src.includes('max-w-xs'), '默认宽度上限 max-w-xs');
  assert(src.includes('max-w-sm'), '长内容可用 max-w-sm');
  assert(src.includes('rounded-xl border border-black/8 bg-white shadow-lg'), '视觉沿用既有白卡圆角风格');
});

test('InfoTip 支持多段内容（title + paragraphs 数组，或 children）', () => {
  const src = read(INFO_TIP);
  assert(src.includes('paragraphs?: string[]'), '必须支持正文段落数组');
  assert(src.includes('children?: ReactNode'), '必须支持 children 自定义内容');
  assert(src.includes('paragraphs.map('), '多段要真的渲染成多个段落（不是拼成一个字符串）');
});

// ── B. 不是原生 title ───────────────────────────────────────
test('InfoTip 不是用原生 title 属性实现的（原生 tooltip 不能换行、不能点击）', () => {
  const src = read(INFO_TIP);
  const trigger = src.slice(src.indexOf('<button'), src.indexOf('</button>'));
  assert(trigger.length > 0, '应能定位到触发按钮');
  assert(!/\btitle=/.test(trigger), '触发按钮上不许出现原生 title 属性');
  assert(!/\btitle=/.test(src.slice(src.indexOf('{open && ('))), '浮层元素上不许出现原生 title 属性');
  assert(src.includes('title &&'), 'title 必须是渲染成浮层内的标题段落，而不是属性');
});

test('全站不再有第二套手搓 tooltip（曾经的 4 份已统一）', () => {
  const metric = read('src/components/MetricCard.tsx');
  const brand = read('src/components/BrandLeaderboard.tsx');
  const chart = read('src/components/MarketConcentrationChart.tsx');
  const hub = read('src/components/CompetitorHub.tsx');
  // 只看"定义与调用"，不看注释：注释里保留这些历史名字是为了说明"为什么统一"，属于有意为之
  assert(!/function TooltipIcon\(/.test(metric) && !metric.includes('<TooltipIcon'), 'MetricCard 里手搓的 tooltip 组件必须已删');
  assert(
    !/function ColumnHeaderHint\(/.test(brand) && !brand.includes('<ColumnHeaderHint'),
    'BrandLeaderboard 里手搓的表头角标必须已删'
  );
  assert(!/const \[showHint/.test(chart) && !chart.includes('setShowHint'), 'MarketConcentrationChart 里手搓的浮层 state 必须已删');
  assert(!/function Tip\(/.test(hub) && !hub.includes('<Tip '), 'CompetitorHub 里手搓的 Tip（还带原生 title）必须已删');

  // 通用守卫：局部组件名带 Hint/Tip/Help/Tooltip，且自己管悬浮状态 + 自绘白卡 ⇒ 手搓角标
  const offenders: string[] = [];
  for (const f of walk('src/components')) {
    if (f.endsWith('ui/InfoTip.tsx')) continue; // 唯一实现本身
    const src = fs.readFileSync(f, 'utf8');
    const re = /function\s+([A-Za-z0-9_]+)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      if (!/(Hint|Tip|Help)/i.test(m[1])) continue;
      const body = src.slice(m.index, src.indexOf('\n}', m.index) + 2);
      if (/onMouseEnter|onClick/.test(body) && /rounded-(lg|xl|2xl)/.test(body) && /bg-white|bg-\[#1d1d1f\]/.test(body)) {
        offenders.push(`${f}: 局部组件 ${m[1]}() 仍是手搓角标`);
      }
    }
  }
  assert.deepEqual(offenders, [], `这些地方还在自己写角标浮层，应改用 InfoTip：\n${offenders.join('\n')}`);
});

// ── C. 用户点名的那一处 ──────────────────────────────────────
test('团队空间的「角色与权限口径」已收进角标，正文只剩一句 ≤10 字摘要', () => {
  const src = read('src/components/TeamSettingsPanel.tsx');
  const usages = infoTipUsages(src);
  assert(usages.length >= 1, 'TeamSettingsPanel 必须有 InfoTip 角标');
  const roleTip = usages.find((u) => u.includes('角色与权限口径'));
  assert(roleTip, '角标的标题必须是「角色与权限口径」');
  assert(roleTip!.includes('describeRoleMapping'), '四行角色映射必须由 describeRoleMapping 逐行给出（口径原文不丢）');
  assert(
    roleTip!.includes('项目里能不能改内容，一律看该项目的成员角色'),
    '「项目内权限一律以该项目成员角色为准」这句关键口径必须逐字留在角标里'
  );

  // 正文不再有整段
  assert(!src.includes('· {describeRoleMapping(r)}'), '原来的平铺 <li> 列表必须已删除');
  assert(!src.includes('说明：团队角色只决定"能不能管理团队"'), '原来的整段说明必须已删除');
  const hint = src.match(/>角色口径</);
  assert(hint, '正文应保留「角色口径」这句短提示');
  const bodyHintChars = '角色口径'.length;
  assert(bodyHintChars <= 10, `正文摘要必须 ≤10 字，实际 ${bodyHintChars} 字`);
});

// ── D. 改造面 ───────────────────────────────────────────────
test('被收起来的地方不少于 6 处：改造清单逐文件可查', () => {
  assert(ADOPTED.length >= 6, `清单至少要 6 处，实际 ${ADOPTED.length}`);
  const problems: string[] = [];
  for (const { file, min } of ADOPTED) {
    if (!fs.existsSync(file)) {
      problems.push(`${file}: 文件不存在`);
      continue;
    }
    const src = read(file);
    if (!src.includes("from './ui/InfoTip'")) problems.push(`${file}: 没有 import InfoTip`);
    const n = infoTipUsages(src).length;
    if (n < min) problems.push(`${file}: 角标用法应为 >= ${min} 处，实际 ${n}`);
  }
  assert.deepEqual(problems, [], `改造清单未落实：\n${problems.join('\n')}`);
});

test('InfoTip 至少被 8 个不同文件 import（唯一实现，不许各写各的）', () => {
  const importers = walk('src').filter((f) => fs.readFileSync(f, 'utf8').includes("from './ui/InfoTip'") || fs.readFileSync(f, 'utf8').includes("from '../ui/InfoTip'"));
  assert(importers.length >= 8, `至少要有 8 个文件使用 InfoTip，实际 ${importers.length}：${importers.join(', ')}`);
  assert(importers.includes(INFO_TIP) === false, '组件自己不应该 import 自己');
});

// ── E. 反向守卫：关键口径不许藏进角标 ────────────────────────
test('反向守卫：硬约束 / 合规 / 不可直接进入这类关键词不许出现在角标文案里', () => {
  const offenders: string[] = [];
  for (const f of walk('src')) {
    const src = fs.readFileSync(f, 'utf8');
    for (const usage of infoTipUsages(src)) {
      const text = expandRefs(src, usage);
      for (const w of MUST_STAY_IN_BODY) {
        if (text.includes(w)) offenders.push(`${f}: 角标文案里出现「${w}」（关键口径不许藏进角标，必须留在正文）`);
      }
    }
  }
  assert.deepEqual(offenders, [], `关键口径不许藏进角标：\n${offenders.join('\n')}`);
});

test('反向守卫本身有效：故意写错的样例必须被检出', () => {
  const sample = `<InfoTip content="不满足硬约束时最高只能验证后进入" />`;
  const hits = MUST_STAY_IN_BODY.filter((w) => sample.includes(w));
  assert(hits.length >= 2, `样例应命中至少 2 个关键词，实际 ${hits.length}`);
  assert(infoTipUsages(sample).length === 1, '样例抽段必须能抽到 1 段');
});

// ── F. 真渲染（不是只看源码文本）────────────────────────────
test('SSR 渲染：关闭态只有 ⓘ 按钮（tabIndex/aria 齐备），不占位、无原生 title、无浮层', () => {
  const markup = renderToStaticMarkup(React.createElement(InfoTip, { paragraphs: ['示例①', '示例②'] }));
  assert(markup.includes('<button'), '应渲染出按钮');
  assert(/tabindex="0"/.test(markup), '按钮必须可 Tab 聚焦');
  assert(markup.includes('aria-label="查看说明"'), '默认无障碍名称应为「查看说明」');
  assert(markup.includes('aria-expanded="false"'), '关闭态应暴露 aria-expanded=false');
  assert(!/\stitle="/.test(markup), '输出里不许出现原生 title 属性');
  assert(!markup.includes('role="tooltip"'), '关闭态不该渲染浮层（默认不占地方）');
  assert(markup.includes('relative inline-flex align-middle'), '外层必须是内联锚点');
  assert(markup.includes('lucide-info'), '图标必须是 lucide 的 Info');
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
