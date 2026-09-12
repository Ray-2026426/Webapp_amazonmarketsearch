// M5 · 出网路由决策（PRD §11.2：密钥只在服务端）— **用户决策 A 后的最终形态**。
//
// 用户拍板 A（2026-09）：**平台数据池只对登录用户开放，游客只能用示例数据**。
// 因此这里不再有"浏览器直连"这条退路：
//   - 登录 → 走服务端数据池（服务端用管理员密钥，浏览器永远拿不到密钥）；
//   - 未登录 → 明确拒绝，并告诉用户"用示例数据或先登录"，而不是偷偷回退到本地密钥模式。
//
// 为什么要把"自定义 MCP 地址"也去掉：它要求用户在浏览器里填自己的密钥，
// 那正是 §11.2 要消除的"本地 Key 模式"；保留它就等于留了一条绕过安全口径的后门。

import type { PoolDataType } from './poolCache';
import type { UsageTool } from './usageAccounting';

export type OutboundRoute = 'gateway' | 'blocked';

export interface RouteInput {
  /** 是否有登录 token */
  hasToken: boolean;
}

export interface RouteDecision {
  route: OutboundRoute;
  reason: string;
}

/**
 * 决定这次外部取数能不能执行、走哪条路。
 * 只有两条结论：gateway（登录，走服务端数据池）或 blocked（未登录，只给示例数据）。
 */
export function decideOutboundRoute(input: RouteInput): RouteDecision {
  if (input.hasToken) {
    return {
      route: 'gateway',
      reason: '已登录：走服务端数据池（管理员密钥由服务端使用，浏览器不接触密钥）',
    };
  }
  return {
    route: 'blocked',
    reason:
      '数据池只对登录用户开放（用户决策 A）：游客请使用示例数据体验全流程，或先登录/注册后再在线取数',
  };
}

/** 兼容旧调用：是否允许出网取数 */
export function canFetchFromPool(hasToken: boolean): boolean {
  return decideOutboundRoute({ hasToken }).route === 'gateway';
}

/**
 * MCP 工具 → 数据池缓存类型（决定 TTL 与缓存键；与 poolCache 的口径一致）。
 * 认不出来的工具一律 other（TTL 最短），宁可少缓存也不串数据。
 */
export function poolTypeForTool(toolName: string): PoolDataType {
  switch (String(toolName || '').trim()) {
    case 'review':
      return 'reviews';
    case 'traffic_keyword':
      return 'traffic';
    case 'keyword_miner':
    case 'keyword_research':
    case 'aba_research_weekly':
      return 'keywords';
    case 'asin_listing':
      return 'listing';
    case 'asin_detail':
      return 'asin_detail';
    default:
      return 'other';
  }
}

/** MCP 工具 → 用量记账分类（管理员据此看"钱花在哪个工具上"） */
export function usageToolForTool(toolName: string): UsageTool {
  switch (String(toolName || '').trim()) {
    case 'review':
      return 'reviews';
    case 'traffic_keyword':
      return 'traffic';
    case 'keyword_miner':
    case 'keyword_research':
    case 'aba_research_weekly':
      return 'keywords';
    case 'asin_listing':
      return 'competitor_listing';
    default:
      return 'market';
  }
}
