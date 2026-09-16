# Repository instructions

Before product, UX, UI, workflow, or architecture changes, read these files in order:

1. `docs/product-charter.md` — long-term product intent and non-negotiable business/UI principles.
2. `docs/phase0-business-ui-optimization-checklist.md` — the currently approved Phase 0 optimization PRD.
3. The relevant implementation and tests.

Important rules:

- This product exists to identify evidence-backed unmet needs and return 0–N real opportunities. It is not a generic analytics dashboard.
- Treat “看用户” as the demand taxonomy that connects market, competitor, self, and opportunity analysis.
- Distinguish current implementation from target-state requirements; do not assume the PRD is already implemented.
- Preserve the existing indigo/purple, white-card, rounded, friendly visual style. Improve hierarchy and usability instead of re-skinning it.
- Do not add Phase 0 validation-task management, deadlines, reminders, or complex portfolio management unless the user explicitly expands scope.
- AI conclusions must be traceable to evidence, allow human review, and may legitimately return zero opportunities.
- When a change affects product definitions, UI rules, scope, or workflow, update `docs/product-charter.md` and the Phase 0 PRD in the same change.
- For implementation work, verify with `npm test`, `npm run lint`, and `npm run build` unless the requested change is documentation-only.

## 交付与协作（2026-09 起，务必遵守）

- **只有 `main`**：`phase-0` 已删除。所有提交直推 `main`（`main` 即生产分支，Vercel 自动部署）。
- **本地没有 npm**：用 `node tests/runAll.mjs`（一次跑完全部套件，并会揪出"没打印 result 行的套件"）替代 `npm test`；
  `node node_modules/typescript/bin/tsc --noEmit` 替代 `npm run lint`；`node node_modules/vite/bin/vite.js build` 替代 `npm run build`。
- **本机唯一的安装器是 pnpm**（随 harness 附带，不在 PATH 上，任选一个存在的）：
  `D:\DeepSeekHarness\node\node_modules\pnpm\bin\pnpm.cjs` 或
  `C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs`。
  重新安装依赖必须**先对齐 npm 锁、再冻结安装**，否则 pnpm 会按 `^`/`~` 重新解析版本，装出与 Vercel
  （用 `package-lock.json` 构建）不一致的树：
  ```
  node <pnpm.cjs> import                              # package-lock.json → pnpm-lock.yaml，版本完全对齐
  node <pnpm.cjs> install --frozen-lockfile --prefer-offline
  ```
  `pnpm-lock.yaml` 与 `pnpm-workspace.yaml` 是**本机专用**文件（已进 `.gitignore`），不要提交，仓库真相源仍是 `package-lock.json`。
  2026-09-16 出过一次事故：有人直接 `pnpm install` 且中途被打断，`node_modules` 里 47 个包的入口文件被删空
  （`typescript/bin/tsc`、`tsx/dist/cli.mjs`、`vite/bin/vite.js` 全没了），导致所有验证命令报 `MODULE_NOT_FOUND`；
  用上面两条命令重建后才恢复。**验证三件套报"模块找不到"时，先怀疑依赖树，不要先怀疑源码。**
- **验证口径**：改动后必须三项全绿才算完成 —— `tsc --noEmit` exit 0 ｜ `node tests/runAll.mjs` 全过（当前基线：49 套件 / 536 断言 / 0 失败）｜ `vite build` exit 0。
  断言数只应增加；若某次跑出比基线少的断言数，说明有套件没执行（runAll 会把"没打印 result 行"的套件单独列出来），要查清再继续。
- **可能有两个代理同时推 `main`**（本仓库历史上出现过另一个代理 `Codex` 并行提交）。因此：
  1. 推送前先 `git fetch origin`，若被拒**绝不要强推**，先 `git merge origin/main` 合并（本仓库试过一次，零冲突）；
  2. 合并后必须**重跑全量验证**再推；
  3. 禁止 `--force` / `--force-with-lease` 到 `main`。
- **文档纪律**：改了产品定义/UI 规则/口径/工作流，必须在同一轮更新 `docs/amazon-market-research-prd-v2.md` 的对应小节
  （决策记录按 §15.x 递增编号）；与线框图冲突的用户指示要用 ⚠️ 显式留痕，不要偷偷改图纸去迎合实现。
- **测试纪律**：新增守卫可以，但**不许削弱既有断言**；改口径导致旧断言过时，要改断言并写明"为什么这不是放松"。
