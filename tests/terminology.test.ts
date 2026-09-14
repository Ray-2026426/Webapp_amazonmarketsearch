// M3⑥ · 术语守卫（PRD §5.4 术语表）。
//
// 为什么要有这个测试：术语混用（看竞品/竞品分析/竞品对比/看竞对）是 PRD 断链 #10 的原样复现，
// 靠"记得改"是不可能守住的。这里直接扫源码，禁止禁用词回流。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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

/** AI 提示词模板是用户可编辑资产，不在术语统一范围内 */
const ALLOWLIST = new Set(['AiPromptManager.tsx']);

/**
 * 已存在的 BOM（历史遗留，纯外观问题，与本次批量改字无关）：
 * 这里只拦"新引入的"编码损坏——批量脚本误用 GBK 读写会把中文写成乱码/BOM，这才是要防的事故。
 */
const KNOWN_BOM = new Set([
  'src\\components\\ProjectOverview.tsx',
  'src\\utils\\legacyData.ts',
  'src\\utils\\supabaseConfig.ts',
]);

/** §5.4 禁用词（项目语境） */
const BANNED = ['看竞品', '竞品分析', '竞品对比'];

function walkTs(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkTs(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !ALLOWLIST.has(e.name)) out.push(p);
  }
  return out;
}

console.log('terminology guard');

test('源码里不再出现禁用词：看竞品 / 竞品分析 / 竞品对比', () => {
  const offenders: string[] = [];
  for (const file of walkTs('src')) {
    const text = fs.readFileSync(file, 'utf8');
    for (const w of BANNED) {
      if (text.includes(w)) {
        const line = text.split('\n').findIndex((l) => l.includes(w)) + 1;
        offenders.push(`${file}:${line} 含「${w}」`);
      }
    }
  }
  assert.deepEqual(offenders, [], `术语回流（PRD §5.4）：\n${offenders.join('\n')}`);
});

test('正式术语在位：看竞对（五看之一）与竞品明细（工具层）', () => {
  const fiveLook = fs.readFileSync('src/types/researchProject.ts', 'utf8');
  assert.ok(fiveLook.includes('看竞对'), '五看里的看竞对命名必须存在');
  const lookView = fs.readFileSync('src/components/CompetitorLookView.tsx', 'utf8');
  assert.ok(lookView.includes('看竞对'), '看竞对视图标题必须用正式术语');
  const hub = fs.readFileSync('src/components/CompetitorHub.tsx', 'utf8');
  assert.ok(hub.includes('竞品明细'), '工具层必须叫竞品明细');
});

test('没有编码损坏痕迹（新引入的 BOM 与替换字符）', () => {
  const offenders: string[] = [];
  for (const file of walkTs('src')) {
    const raw = fs.readFileSync(file);
    const text = raw.toString('utf8');
    if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf && !KNOWN_BOM.has(file)) {
      offenders.push(`${file}: 新引入 UTF-8 BOM`);
    }
    if (text.includes('\uFFFD')) offenders.push(`${file}: 含替换字符（编码损坏）`);
  }
  assert.deepEqual(offenders, [], `编码问题：\n${offenders.join('\n')}`);
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
