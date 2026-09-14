# 本地工作区 vs phase-0 分支：分叉说明（需你拍板）

> 记录时间：2026-09（M0 推送前）
> 结论：**本地工作区与 `phase-0` 分支是两条分叉线，各有对方没有的东西**。本次推送采取**非破坏性**处理：phase-0 的文件全部保留在仓库里，不删除。

---

## 一、分叉的事实

| 线索 | 说明 |
| --- | --- |
| 本地工作区文件时间 | 2026-09-05 / 09-06（比 phase-0 的 08-30 更新） |
| 本地含 phase-0 没有的 | 用户 9-5/9-6 的改动 + 本次 M0 的代码与文档 |
| phase-0 含本地没有的 | 20 个文件（见下表） |
| 类型模型差异 | 本地 `OpportunityCard` 没有 `scoreBreakdown / evidenceRefs / reasoning / counterEvidence / humanEdits`；`SessionUser` 没有 `nickname` —— 说明本地是一条**独立演进**的线，不是 phase-0 的简单延续 |
| phase-0 独有文件在本地被引用情况 | 基本 0 处引用（本地已改用 `lookAi.ts` 等新实现，但**尚未接线**） |

推断：本地约等于 **phase-0 在 8-29 中途的状态 + 你后续的本地重构**，而 phase-0 在 8-29 下旬~8-30 又加了若干能力，本地没拿到。

---

## 二、phase-0 有、本地没有的 20 个文件

### 2.1 有价值的能力（6 个，本次**保留在仓库中**、不在本地磁盘）

| 文件 | 它是什么 | 与 V2 PRD 的关系 |
| --- | --- | --- |
| `src/utils/opportunityAi.ts` | AI 综合四看证据生成机会候选（含背景/引导问题） | **正是 §6.5「AI 生成 0-N 候选机会卡」**；本地改用 `lookAi.ts` 但零调用（断链 #1） |
| `src/utils/opportunityHtmlReport.ts` | 独立、可打印的 HTML 审核报告（内嵌 CSS、评分可视化、反证） | **正是 §5.5 ㉑ 报告页 / §9.4 决策包导出** |
| `src/utils/projectDecision.ts` | 项目级决策摘要（Go/No-Go 汇总、五看证据编排） | **正是 §6.5「决策摘要 + Go/No-Go 汇总」** |
| `src/utils/teamStore.ts` | 团队/成员/角色存储（owner/admin/member/viewer） | Phase B「团队空间」雏形（§3.3） |
| `src/components/TeamSettingsPanel.tsx` | 团队设置界面（邀请/改角色/移除） | 同上 |
| `tests/teamStore.test.ts` | 团队存储测试 | 同上 |

> 这 6 个文件目前**不在本地磁盘上**（因为与本地类型冲突，放着会让 `tsc` 报 24 个错），但**完整保留在仓库里**（本次提交已显式保留它们，取回方式见下）。
>
> ⚠️ **重要**：`git status` 会把这 6 个文件显示为"未暂存的删除"。**请不要把它们的删除提交上去**——那会真的从仓库里删掉这些能力。本次 M0 提交（`M0: env fix + diagnosability …`）已按"保留"处理。
>
> 随时可取回：
> ```powershell
> git show phase-0:src/utils/opportunityHtmlReport.ts > tmp.ts     # 单个取回
> git checkout phase-0 -- src/utils/opportunityAi.ts               # 批量取回
> ```

### 2.2 无冲突的工具与文档（14 个，本次已恢复到本地磁盘，内容与 phase-0 一致）

| 文件 | 作用 |
| --- | --- |
| `docs/product-charter.md` | **产品总纲**（长期事实源） |
| `docs/phase0-business-ui-optimization-checklist.md` | Phase 0 优化 PRD |
| `docs/amazon-market-research-prd.md` | **PRD v1**（V2 的前身） |
| `docs/phase0-adversarial-review.md` | Phase 0 对抗式审查记录 |
| `docs/five-look-opportunity-refactor-plan.md` | 五看重构计划 |
| `docs/design-system-baseline.md` | 设计系统基线 |
| `docs/phase3-verification.md` | Phase 3 云同步验收记录 |
| `docs/ui-verification-checklist.md` | UI 验证清单 |
| `docs/admin-and-keys-setup.md` | 管理员与密钥配置说明 |
| `AGENTS.md` | **仓库给 AI/贡献者的规则**（含"改动产品定义要同步更新 charter 与 Phase 0 PRD"） |
| `.vercelignore` | Vercel 忽略清单 |
| `src/utils/marketFormat.ts` | 货币符号等格式化工具 |
| `src/utils/promptOverrides.ts` | Prompt 覆盖（配合 14 个预设） |
| `src/components/five-look/FiveLookSummaryShell.tsx` | 五看摘要骨架组件 |

---

## 三、待你拍板的问题

**Q：这 6 个能力怎么办？**（三选一，可分开处理）

> ✅ **已拍板（2026-09）：选 A —— 在 M4 合并回来。** 记入 PRD §15.1 第 24 项。本次推送已把这 6 个文件**保留在仓库里**（不在本地磁盘，避免 `tsc` 报错），M4 做"机会 V2 + 报告页"时适配到当前类型即可直接用。

- **A（推荐，已选）在 M4/M4 中合并回来**：把它们适配到当前类型（缺的字段加成可选字段，不破坏现有逻辑），这样 §6.5 的 AI 机会生成、㉑ 的 HTML 报告、决策摘要都能直接用现成实现。建议放到 **M4（机会 V2 + 报告页）** 一起做，因为那时正好需要。
- **B 按新架构重写**：以本地类型为准，重新实现（`lookAi.ts` 已承担 AI 部分；HTML 报告需要新写）。工作量更大，但不背历史包袱。
- **C 明确废弃**：写进 PRD 的"范围外"，并在仓库里删除这 6 个文件。

**Q：本地 9-5/9-6 的改动要不要也推到 phase-0？**
本次推送已包含（见下）；若你只想推 M0，可在推送前用 `git reset --soft phase-0` 后重新选择性提交。

**Q：45 个修改文件里有没有你不想公开的？**
仓库是**公开**的。`.gitignore` 已挡住密钥类文件，但代码/文档内容都会公开可见。推之前建议过一眼 `git show --stat`。

---

## 四、本次推送包含什么（推送前请核对）

| 类别 | 内容 |
| --- | --- |
| **M0（本次新增）** | `api/health.ts`、`api/keepalive.ts`、`server/devApiPlugin.ts`、`src/components/SystemDiagnosticsPanel.tsx`；改 `api/auth/_shared.ts`（去硬编码）、`vite.config.ts`、`vercel.json`（cron）、`src/components/AiSettingsPanel.tsx`（新增"诊断"Tab） |
| **文档** | `docs/amazon-market-research-prd-v2.md`（V2 改革 PRD）、`docs/ui-wireframes.html`、`docs/ui-wireframes-l3.html`、`docs/M0-setup-checklist.md`、本文件 |
| **你的本地改动** | 9-5/9-6 以来的 `src/**`、`api/**` 等共约 45 个修改文件 |
| **不包含** | 上述 6 个 phase-0 文件的删除（已取消暂存，仓库保留）；`.env.local`、`.vercel*`（.gitignore 挡住） |

推送命令（在工作区根目录）：

```powershell
git show --stat HEAD          # 先核对这次提交的内容
git push origin phase-0       # 只推 phase-0，不碰 main
```
