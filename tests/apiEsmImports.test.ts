/**
 * api/** 的 import 必须带扩展名 —— 这是"本地全绿、线上炸"的经典坑。
 *
 * 事故背景（2026-09）：管理员后台在线上一直返回 `FUNCTION_INVOCATION_FAILED`（Vercel 平台级错误，
 * 说明函数在 try/catch 之外、通常就是**模块加载阶段**就崩了），而本地 `tsx` / Vite 一切正常。
 * 排查发现规律非常干净：
 *   · 线上**能用**的：`api/auth/[action].ts → './_shared.js'`、`api/health.ts → './auth/_shared.js'`（都带 .js）
 *   · 线上**崩掉**的：`api/admin`、`api/data`、`api/ai` 三个文件里有 **8 处无扩展名的相对 import**
 * 本地解析器（tsx/vite）能补扩展名，线上 Node 的 ESM 解析不会 —— 于是只在生产炸。
 *
 * 这条守卫把这个不一致钉死：**api/** 下任何相对 import 都必须显式带 .js/.json**。
 * 被 api 直接加载的 `src/utils/**` 服务端模块同样要显式带扩展名，否则会在线上二级依赖加载时崩。
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

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

function apiFiles(): string[] {
  const candidates = [
    'C:\\Users\\A\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\git\\cmd\\git.exe',
    'git',
  ];
  for (const bin of candidates) {
    try {
      return execFileSync(bin, ['ls-files', 'api'], { encoding: 'utf8' })
        .split(/\r?\n/)
        .filter((f) => f.endsWith('.ts'));
    } catch {
      /* 试下一个 */
    }
  }
  return [];
}

console.log('api 运行时：相对 import 必须带扩展名（防"本地绿、线上崩"）');

test('api/** 下所有相对 import 都带 .js/.json 扩展名', () => {
  const files = apiFiles();
  assert(files.length > 5, `api 文件列表异常（${files.length} 个），守卫无法生效`);
  const offenders: string[] = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/from\s+'(\.[^']+)'/g)) {
      if (!/\.(js|json|mjs|cjs)$/.test(m[1])) offenders.push(`${f} → ${m[1]}`);
    }
  }
  assert(
    offenders.length === 0,
    `这些相对 import 没带扩展名（本地能跑、线上会 FUNCTION_INVOCATION_FAILED）：\n       ${offenders.join('\n       ')}`
  );
});

test('已知在线上可用的入口仍保持带扩展名的写法（回归基线）', () => {
  const auth = readFileSync('api/auth/[action].ts', 'utf8');
  assert(auth.includes("from './_shared.js'"), '登录入口必须保持 ./_shared.js');
  const health = readFileSync('api/health.ts', 'utf8');
  assert(health.includes("from './auth/_shared.js'"), '健康检查必须保持 ./auth/_shared.js');
});

test('管理员/数据池/AI 三条链路引用的工具模块都带扩展名', () => {
  const checks: [string, string][] = [
    ['api/admin/[action].ts', "from '../../src/utils/usageAccounting.js'"],
    ['api/admin/[action].ts', "from '../../src/utils/keyMasking.js'"],
    ['api/data/[action].ts', "from '../../src/utils/poolCache.js'"],
    ['api/ai/[action].ts', "from '../../src/utils/aiEndpoints.js'"],
    ['src/utils/poolCacheStore.ts', "from './poolCache.js'"],
  ];
  for (const [file, spec] of checks) {
    assert(readFileSync(file, 'utf8').includes(spec), `${file} 应包含 ${spec}`);
  }
});

test('诊断接口保持"零静态依赖"（它自己不能也崩掉）', () => {
  const diag = readFileSync('api/diag.ts', 'utf8');
  const staticImports = [...diag.matchAll(/^import\s.+$/gm)].map((m) => m[0]);
  assert(
    staticImports.every((l) => l.includes('@vercel/node')),
    `诊断接口只能静态引入类型包，否则它会和被测代码一起崩：${staticImports.join(' | ')}`
  );
  assert(diag.includes('await import('), '诊断接口应使用动态 import + try/catch 才能捕获加载错误');

  // 只回报"布尔/非敏感值"：每个 process.env.X 要么被 Boolean() 包住，要么在白名单里
  const SAFE = new Set(['VERCEL_ENV', 'VERCEL_GIT_COMMIT_SHA']);
  const unsafe: string[] = [];
  for (const m of diag.matchAll(/process\.env\.([A-Z_0-9]+)/g)) {
    const name = m[1];
    if (SAFE.has(name)) continue;
    const around = diag.slice(Math.max(0, m.index - 40), m.index + name.length + 4);
    if (!/Boolean\($|Boolean\(/.test(around)) unsafe.push(name);
  }
  assert(unsafe.length === 0, `这些环境变量可能被原样回显（必须只回布尔）：${unsafe.join(', ')}`);
  assert(!/:\s*process\.env\.[A-Z_0-9]+\s*[,}]/.test(diag), '不得把环境变量值直接放进返回体');
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
