// 线框图二级页⑭ 标了「可编辑」：控制点阈值必须能改。
//
// 为什么单独一个纯函数模块（不放进 React 组件、也不塞进 opportunityPlan）：
// 阈值是**确定性推导出来的数字**，人工改动必须同时满足四件事，而这四件事与 UI 无关、必须可测：
//   1. 改成什么就是什么（只 trim，不做任何"智能化"加工，更不许顺手补一个更好看的默认值）；
//   2. **阈值一改，之前的"已确认"作废**（confirmed=false）——用户确认的是**那个数字**，数字变了就得重新拍板；
//   3. 空 / 纯空白输入一律拒绝（返回原数组），UI 用 `canEditThreshold()` 直接禁用「保存」；
//   4. 重算 / 重新生成决策包时，人工改过的阈值不能被静默覆盖（阈值是人的决定，不是派生物的附属品）。
// 内联形态与二级页⑭ 用的是同一个组件、同一份状态（`OpportunityRoadmapBlock`），所以规则只写这一份。

import type { ControlPoint } from '../types/opportunity';

/** 这个输入能不能当阈值保存：非空、去掉首尾空白后还有内容。 */
export function canEditThreshold(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 人工改写某个控制点的阈值。
 * - 成功：返回**新数组**，该点 `threshold` = trim 后的输入、`thresholdEdited: true`、`confirmed: false`；
 * - 拒绝：输入为空/纯空白 → 原样返回入参（同一个数组引用，不产生半成品状态）；
 * - cpId 找不到 → 原样返回入参（不新建、不猜）。
 *
 * 调用约定：UI 在"输入与当前阈值完全相同"时**禁用「保存」**（见 `OpportunityRoadmapBlock`），
 * 这样界面上的「已人工修改」永远对应一次真实改动，不会把"原样保存"记成人工修改。
 */
export function editControlPointThreshold(
  points: ControlPoint[],
  cpId: string,
  nextThreshold: string
): ControlPoint[] {
  if (!canEditThreshold(nextThreshold)) return points;
  const threshold = nextThreshold.trim();
  let hit = false;
  const next = points.map((p) => {
    if (p.id !== cpId) return p;
    hit = true;
    return { ...p, threshold, thresholdEdited: true, confirmed: false };
  });
  return hit ? next : points;
}

/**
 * 恢复某个控制点的**派生默认值**（由调用方按同一条确定性规则重算后传入，绝不在这里编数字）。
 * - `originalThreshold` 为空/纯空白 → 原样返回入参（拿不到默认值时宁可不动，也不假装恢复成功）；
 * - 成功：`threshold` 回到派生值、清掉 `thresholdEdited`、并且同样 `confirmed: false`
 *   （数字变回默认值也是一次数字变动，同样需要重新拍板）。
 */
export function resetControlPointThreshold(
  points: ControlPoint[],
  cpId: string,
  originalThreshold: string
): ControlPoint[] {
  if (!canEditThreshold(originalThreshold)) return points;
  const threshold = originalThreshold.trim();
  let hit = false;
  const next = points.map((p) => {
    if (p.id !== cpId) return p;
    hit = true;
    return { ...p, threshold, thresholdEdited: undefined, confirmed: false };
  });
  return hit ? next : points;
}

/** 有多少条阈值被人工改过（给界面显示用，例如「3 条已人工修改」）。 */
export function countEditedThresholds(points: ControlPoint[]): number {
  return points.filter((p) => p.thresholdEdited === true).length;
}

/**
 * 控制点的**稳定身份**：重算时 id 是重新生成的（`cp_<时间戳>_<序号>`），
 * 所以"同一个控制点"不能靠 id 认，只能靠"它是什么"认：类型 + 标签 + 指标。
 * 这也是显示"派生默认值"时的对齐键。
 */
export function controlPointIdentity(cp: ControlPoint): string {
  return `${cp.kind}::${cp.label.trim()}::${cp.metric.trim()}`;
}

/**
 * 重算决策包时的合并规则（**人工结果不许被静默丢掉**）。
 * 对每个新推导出来的控制点，按 id（优先）或身份找上一次的同名点：
 * - 上一次被人工改过 → 保留**人工阈值**与 `thresholdEdited`，并要求重新确认（confirmed=false）；
 * - 上一次确认过、且新推导出来的阈值与当时**一字不差** → 保留确认（用户拍的就是这个数字）；
 * - 数字变了 → 回到待确认（系统不代替用户拍板）；
 * - 上一次改过、但这次推导里已经没有这个控制点了 → 仍然保留这一条（宁可多留，不可静默删除人的数字）。
 */
export function mergeControlPointsPreservingEdits(
  derived: ControlPoint[],
  previous?: ControlPoint[] | null
): ControlPoint[] {
  const prev = previous ?? [];
  if (prev.length === 0) return derived;
  const byId = new Map(prev.map((p) => [p.id, p]));
  const byIdentity = new Map(prev.map((p) => [controlPointIdentity(p), p]));
  const matched = new Set<string>();

  const merged = derived.map((d) => {
    const match = byId.get(d.id) ?? byIdentity.get(controlPointIdentity(d));
    if (!match) return d;
    matched.add(match.id);
    if (match.thresholdEdited === true) {
      return { ...d, threshold: match.threshold, thresholdEdited: true, confirmed: false };
    }
    if (match.confirmed && match.threshold === d.threshold) return { ...d, confirmed: true };
    return d;
  });

  const orphans = prev.filter((p) => p.thresholdEdited === true && !matched.has(p.id));
  return orphans.length > 0 ? [...merged, ...orphans] : merged;
}
