// M2 · 五看 AI 失败归类测试。
// 回归目标：用户点「开始分析」看到"四步都被跳过"时，必须能分清
// 「没配模型 Key」（去设置）与「没数据」（去取数）——旧逻辑把两者混为一谈。
import assert from 'node:assert/strict';

import {
  classifyLookFailure,
  describeBlockReason,
  isSkipKind,
  LOOK_FAIL_LABELS,
  type LookAiFailKind,
} from '../src/utils/lookAiFailure';

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

console.log('look ai failure');

test('显式 reason 优先于文案', () => {
  assert.equal(classifyLookFailure({ reason: 'no-data', error: '未配置 AI 模型 Key' }), 'no-data');
});

test('回归：缺模型 Key 绝不能被判成"跳过"', () => {
  const kind = classifyLookFailure({ error: '尚未配置 AI 模型 Key，请先到「设置 → API 与模型」填写。' });
  assert.equal(kind, 'no-key');
  assert.equal(isSkipKind(kind), false, '缺配置不是跳过');
});

test('缺数据 → no-data（唯一算"跳过"的一类）', () => {
  for (const msg of [
    '尚未加载任何市场数据，请先到「市场大盘」上传 Excel 或加载示例数据。',
    '尚未加载评论或关键词数据，请先到「关键词分析」或「评论/VOC」加载。',
    '尚未选择竞品 ASIN，请先到「竞品对比」添加竞品。',
    '请先回答几个引导问题（目标/预算/供应链/毛利要求等），AI 才能判断自身适配度。',
  ]) {
    assert.equal(classifyLookFailure({ error: msg }), 'no-data', msg);
  }
  assert.equal(isSkipKind('no-data'), true);
});

test('解析失败 → parse，未知错误 → other', () => {
  assert.equal(classifyLookFailure({ error: 'AI 返回格式无法解析，请重试。' }), 'parse');
  assert.equal(classifyLookFailure({ error: '网络超时' }), 'other');
  assert.equal(classifyLookFailure({}), 'other');
});

test('每类都有中文标签，且只有 no-data 是跳过', () => {
  const kinds: LookAiFailKind[] = ['no-key', 'no-data', 'parse', 'other'];
  for (const k of kinds) assert.ok(LOOK_FAIL_LABELS[k] && LOOK_FAIL_LABELS[k].length > 0, k);
  assert.deepEqual(kinds.filter(isSkipKind), ['no-data']);
});

test('describeBlockReason：缺 Key 的话术必须点明"这不是跳过"', () => {
  const key = describeBlockReason('no-key');
  assert.ok(key, '缺 Key 必须给出人话结论');
  assert.ok(key!.startsWith('四步都没跑'), '必须是阻断性结论：四步都没跑');
  assert.ok(key!.includes('AI 模型 Key'), '要点明缺的是什么');
  assert.ok(key!.includes('跳过'), '要明确区分"跳过"与"没配置"');
  assert.ok(key!.includes('开始分析'), '要告诉用户下一步做什么');
  assert.ok((describeBlockReason('no-data') || '').includes('还没有数据'));
  assert.equal(describeBlockReason(null), null);
});

test('describeBlockReason：其他类不给"阻断性"结论（避免误导用户以为流程坏了）', () => {
  assert.equal(describeBlockReason('other'), null);
  assert.equal(describeBlockReason('parse'), null);
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
