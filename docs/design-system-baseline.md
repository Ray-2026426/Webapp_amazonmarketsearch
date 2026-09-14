# 设计系统基线（Phase 0 提取）

> 目的：把现有页面中散落的颜色、圆角、组件和交互规则收敛为可复用的基线，作为后续 Phase 1+ 新增页面的唯一参考。本文档只做「提取与记录」，不做大规模重构。

## 1. 设计原则

- 视觉：Apple 风格，浅灰画布 + 白卡片 + 低对比边框，信息密度适中。
- 品牌主色：靛蓝（indigo）→ 紫（violet）渐变，用于主 CTA、选中态、强调元素。
- 中性色：采用 Apple 系统灰阶，不使用 Tailwind 默认的纯黑/深灰。
- 结论优先：卡片顶部先给结论/评分，再给证据与明细。
- 圆角：卡片 16–32px、控件 12px、胶囊 999px，整体偏「柔和」。

## 2. 色彩 Token

已在 `src/index.css` 的 `@theme` 中声明，新代码优先使用语义类（`bg-canvas` / `text-ink` / `border-line` / `bg-brand`）。

### 中性色（语义名 → 现有散落值）

| Token | 值 | 用途 |
| --- | --- | --- |
| `canvas` | `#f5f5f7` | 页面背景、卡片表头底、分隔底 |
| `canvas-soft` | `#fafafa` | 次级面板、表格斑马底 |
| `canvas-inset` | `#f8f9fb` | 输入框/下拉渐变底 |
| `ink` | `#1d1d1f` | 主文字、标题 |
| `ink-secondary` | `#424245` | 正文、说明 |
| `ink-tertiary` | `#86868b` | 辅助文字、图标（最高频） |
| `ink-muted` | `#aeaeb2` | 占位、弱提示 |
| `ink-faint` | `#c7c7cc` | 禁用、极弱提示 |
| `line` | `#e5e7eb` | 常规边框、分隔线 |

### 品牌与语义色

| 类别 | 值 | 说明 |
| --- | --- | --- |
| 品牌主 | `#4f46e5`（indigo-600） | 主按钮、选中态、链接 |
| 品牌强 | `#4338ca`（indigo-700） | hover/active |
| 品牌弱 | `#eef2ff`（indigo-50） | 选中底、标签底 |
| 强调 | `#8b5cf6`（violet-500） | 渐变 CTA 尾段、次强调 |
| 成功 | `#10b981` | 增长/正向 |
| 警示 | `#f59e0b` | 风险/待关注 |
| 危险 | `#ef4444` | 删除/负向 |

## 3. 字体与排版

- 字体：`-apple-system / SF Pro Text / Segoe UI / Roboto`，中文回退系统黑体。
- 标题 20–28px 加粗；正文 14–16px；辅助 12–13px；标签 10–11px 大写。
- 报告正文：行高 1.7–1.8，段间距 `my-3`，标题层级 h1>h2>h3 明显递减。

## 4. 圆角与阴影

| 元素 | 规范 |
| --- | --- |
| 卡片 | `rounded-[20px]` 或 `rounded-2xl`（16px），大弹窗 `rounded-[32px]` |
| 控件/输入 | `rounded-xl`（12px） |
| 胶囊/标签 | `rounded-full` |
| 卡片阴影 | `shadow-[0_4px_24px_rgba(0,0,0,0.04)]` |
| 弹层阴影 | `shadow-[0_12px_40px_rgba(15,23,42,0.14)]` |
| 边框 | `border-black/5`（轻）、`border-black/10`（重）、`border-black/8`（弹层） |

## 5. 组件清单

| 组件 | 路径 | 角色 |
| --- | --- | --- |
| `Card / CardHeader / CardTitle / CardDescription / CardContent` | `src/components/ui/Card.tsx` | 基础卡片（含 `cn()` 工具） |
| `Select` | `src/components/ui/Select.tsx` | 统一下拉，靛蓝选中态，支持分组/多尺寸/幽灵态 |
| `MultiSelectChips` | `src/components/ui/Select.tsx` | 胶囊式多选开关 |
| `MarkdownReport` | `src/components/MarkdownReport.tsx` | **AI Markdown 唯一渲染组件**（GFM + 表格样式） |
| `MetricCard` | `src/components/MetricCard.tsx` | 指标卡 |
| `FeishuPushButton` | `src/components/FeishuPushButton.tsx` | 报告推送到飞书 |
| 图表系列 | `*Chart.tsx` / `*DistributionChart.tsx` | 基于 recharts，统一容器与 tooltip |

## 6. 交互规则

- 按钮 hover：颜色加深 + 轻微位移/缩放（`active:scale-[0.98]`）。
- 主 CTA：`bg-gradient-to-r from-indigo-500 to-violet-500`，hover 到 600。
- 下拉/弹层：`transition-all` + `focus-visible:ring-2 ring-indigo-500/30`。
- 选中态：`bg-indigo-50 text-indigo-700` + 右侧勾。
- 禁用态：`opacity-50 cursor-not-allowed`（或 `opacity-40`）。
- 加载态：旋转圈 + 进度条 + 阶段文案。
- 空态：灰字居中 + 一句可行动提示。
- 破坏性操作（删除）：必须二次确认。
- 反馈：统一走 `sonner` 的 `toast.success / error / warning / info`。

## 7. 硬约束（后续页面必须遵守）

1. **禁止** 使用 `prose prose-*` 类：项目未安装 `@tailwindcss/typography`，该类是空操作，会导致表格无样式（已在 P0-2 修复）。
2. AI/报告 Markdown **一律** 走 `MarkdownReport`，不要裸用 `react-markdown`。
3. 组合类名用 `cn()`（`ui/Card.tsx` 导出），不要手写字符串拼接。
4. 新页面颜色优先用第 2 节的语义 Token，避免再散落硬编码。
5. 布局沿用：左导航 + 主栏 `main`（`min-h-screen flex`），弹窗用 fixed 遮罩 + `backdrop-blur`。
