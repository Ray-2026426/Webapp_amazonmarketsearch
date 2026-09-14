/**
 * 一把跑完所有测试套件（零依赖，node 直接可用）。
 *
 * 为什么要有它：本机与 CI 都不一定装了 npm，而 npm test 里串了 38 条命令，
 * 既难读也难定位失败。这里：
 *   node tests/runAll.mjs          # 跑全部
 *   node tests/runAll.mjs l3 hook  # 只跑文件名包含 l3 或 hook 的套件
 *
 * 约定（与各测试文件保持一致）：每个套件以 `result: N passed, M failed` 收尾。
 * 任何一个套件失败、或**没有打印 result 行**（除了显式写在 NO_RESULT_OK 里的既有例外），
 * 整体退出码为 1 —— 避免"某个套件其实没跑起来却被当成通过"。
 */
import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

/** 既有例外：这个套件只打印 "aiConfig tests passed"，没有 result 行（历史格式，非本次引入） */
const NO_RESULT_OK = new Set(['aiConfig.test.ts']);

const filters = process.argv.slice(2).map((s) => s.toLowerCase());
const dir = join(process.cwd(), 'tests');
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.test.ts'))
  .filter((f) => filters.length === 0 || filters.some((k) => f.toLowerCase().includes(k)))
  .sort();

if (files.length === 0) {
  console.error('没有匹配的测试套件。');
  process.exit(1);
}

function runSuite(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', join('tests', file)], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('close', (code) => {
      const m = out.match(/result:\s*(\d+)\s*passed,\s*(\d+)\s*failed/);
      resolve({
        file,
        code: code ?? 1,
        passed: m ? Number(m[1]) : 0,
        failed: m ? Number(m[2]) : 0,
        hasResult: Boolean(m),
        tail: out.trim().split(/\r?\n/).slice(-12).join('\n'),
      });
    });
  });
}

const results = [];
for (const file of files) {
  process.stdout.write(`… ${file}\n`);
  results.push(await runSuite(file));
}

console.log('\n──────────────── 套件结果 ────────────────');
let totalPassed = 0;
let totalFailed = 0;
const bad = [];

for (const r of results) {
  totalPassed += r.passed;
  totalFailed += r.failed;
  const label = r.hasResult ? `${r.passed} passed, ${r.failed} failed` : `无 result 行（exit=${r.code}）`;
  console.log(`${r.file.padEnd(34)} ${label}`);
  const missingResult = !r.hasResult && !NO_RESULT_OK.has(r.file);
  if (r.code !== 0 || r.failed > 0 || missingResult) bad.push(r);
}

console.log('────────────────────────────────────────');
console.log(`套件 ${results.length} 个 ｜ 断言 ${totalPassed} passed, ${totalFailed} failed ｜ 问题套件 ${bad.length} 个`);

if (bad.length > 0) {
  console.log('\n失败/异常的套件明细：');
  for (const r of bad) {
    console.log(`\n===== ${r.file} (exit=${r.code}) =====\n${r.tail}`);
  }
  process.exit(1);
}

console.log('全部通过。');
