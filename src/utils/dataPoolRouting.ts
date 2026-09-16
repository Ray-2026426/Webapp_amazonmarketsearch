// M5 · 出网路由决策（PRD §11.2 + §15.26 BYO Key）— **当前形态**。
//
// 用户拍板 A（2026-09）：**平台数据池只对登录用户开放，游客只能用示例数据**。
// 用户后来又推翻 A 的一半（§15.26 BYO Key）：**用户可以填自己的密钥**（只存本机、随请求体带给网关）。
// 两者合起来的现状是"两条路都走服务端网关"，差别只在用谁的密钥：
//   - 登录 → 走服务端数据池；**平台密钥只由服务端使用，浏览器拿不到**；
//     用户若填了自己的密钥，则这次请求用他自己那把（也仍然经网关转发，不进 URL、不落库、不写日志）；
//   - 未登录 → 明确拒绝，并告诉用户"用示例数据或先登录"，而不是偷偷回退到"浏览器直连对方 MCP"。
//
// 注意（别再按旧口径改回去）：**"浏览器不接触密钥"这句只对平台密钥成立**。
// 用户自带密钥本来就存在他自己的浏览器里，这是 §15.26 明确接受的设计。

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
      reason:
        '已登录：走服务端数据池（平台密钥只在服务端使用，浏览器拿不到；你自己填的密钥也只随请求体发给本站网关）',
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
