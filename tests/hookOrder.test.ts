// React hook 顺序守卫（防"React #310"这类线上崩溃）。
//
// 背景（真实事故，2026-09）：往 UserLookView 里插 `useState` 时，插到了组件级早退
// `if (!data) return <加载中 />` **之后**，于是"加载中 → 已加载"两次渲染的 hook 数量不同，
// 线上直接白屏报 `Minified React error #310`。这类 bug 只在数据加载完成后才炸，本地不点进去根本发现不了。
//
// 判定方式（用 TS 编译器 API，避免正则误判工具函数里的 if）：
//   1) 找出组件函数（函数名首字母大写，或默认导出函数）；
//   2) 顺序扫描组件函数体的顶层语句：一旦遇到"含 return 的 if"（组件级早退），
//      其后出现的任何 hook 调用（useState/useEffect/useCallback/useMemo/useRef/useReducer/useContext）都算违规。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

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

const HOOKS = new Set(['useState', 'useEffect', 'useCallback', 'useMemo', 'useRef', 'useReducer', 'useContext', 'useLayoutEffect', 'useId']);

function containsHookCall(node) {
  let found = null;
  const visit = (n) => {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && HOOKS.has(n.expression.text)) {
      found = n.expression.text;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** 该语句是否"可能提前返回"（if 分支里含 return / 直接 return） */
function isEarlyReturn(stmt) {
  if (ts.isReturnStatement(stmt)) return true;
  if (ts.isIfStatement(stmt)) {
    const hasReturn = (n) => {
      let hit = false;
      const visit = (x) => {
        if (hit) return;
        if (ts.isReturnStatement(x)) {
          hit = true;
          return;
        }
        ts.forEachChild(x, visit);
      };
      visit(n);
      return hit;
    };
    return hasReturn(stmt.thenStatement) || (stmt.elseStatement ? hasReturn(stmt.elseStatement) : false);
  }
  return false;
}

function isComponentLike(node) {
  if (ts.isFunctionDeclaration(node)) {
    const name = node.name?.text ?? '';
    return !!node.body && (/^[A-Z]/.test(name) || name === '');
  }
  return false;
}

function checkFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const problems = [];
  sf.forEachChild((node) => {
    if (!isComponentLike(node)) return;
    const fnName = node.name?.text ?? '(default)';
    let earlySeen = false;
    for (const stmt of node.body.statements) {
      if (!earlySeen && isEarlyReturn(stmt)) {
        earlySeen = true;
        continue;
      }
      if (!earlySeen) continue;
      // 早退之后：顶层语句里出现 hook 调用即违规
      const direct = ts.isVariableStatement(stmt)
        ? stmt.declarationList.declarations.map((d) => (d.initializer ? containsHookCall(d.initializer) : null)).find(Boolean)
        : containsHookCall(stmt);
      if (direct) {
        const line = sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1;
        problems.push(`${fnName} 第 ${line} 行仍在调用 ${direct}（组件级早退之后不得再调 hook）`);
      }
    }
  });
  return problems;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.tsx')) out.push(p.replace(/\\/g, '/'));
  }
  return out;
}

console.log('react hook order');

test('组件级早退之后不得再调用 hook（防 React #310 白屏）', () => {
  const files = walk('src/components');
  const all = [];
  for (const f of files) for (const p of checkFile(f)) all.push(`${f}: ${p}`);
  assert.deepEqual(all, [], `发现 hook 顺序问题：\n${all.join('\n')}`);
});

test('守卫本身有效：故意写错的样例必须被检出', () => {
  const sample = [
    "import { useState } from 'react';",
    'export function Broken({ data }: { data: unknown }) {',
    '  if (!data) return null;',
    '  const [x] = useState(1);',
    '  return x;',
    '}',
  ].join('\n');
  const tmp = 'src/components/__hookOrderFixture.tsx';
  fs.writeFileSync(tmp, sample, 'utf8');
  try {
    const problems = checkFile(tmp);
    assert.equal(problems.length, 1, `样例应被检出 1 条，实际 ${problems.length}`);
    assert.ok(problems[0].includes('useState'), problems[0]);
  } finally {
    fs.unlinkSync(tmp);
  }
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
