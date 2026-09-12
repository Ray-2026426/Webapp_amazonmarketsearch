// M5 · 出网路由决策（PRD §11.2：密钥只在服务端）。
//
// 抽成纯函数的原因：**这是安全相关的判断**——"这次调用走服务端网关还是浏览器直连"决定了
// 浏览器里是否需要密钥。写成可测函数，才能把规则锁住（而不是散落在调用点里各写一遍）。
//
// 规则（当前阶段，游客策略待用户拍板）：
// 1. 用户显式填了**自定义** MCP 地址（非 /api-proxy 的内置路径）→ 走他自己的地址（他的密钥他的责任）；
// 2. 有登录 token → 走服务端数据池（前端无密钥可用，也不需要）；
// 3. 没登录（游客/演示）→ 只能走旧路径，且旧路径在设置页必须标注为"临时/不安全"。

import type { PoolDataType } from './poolCache';
import type { UsageTool } from './usageAccounting';

export type OutboundRoute = 'custom-endpoint' | 'gateway' | 'browser-legacy';

export interface RouteInput {
  /** 用户在设置里填的 MCP 地址（可能为空） */
  mcpUrl?: string;
  /** 是否有登录 token */
  hasToken: boolean;
}

/** 是否属于"内置代理路径"（这类路径由本应用转发，不算用户自定义地址） */
export function isBuiltinProxyPath(url: string | undefined): boolean {
  const u = String(url ?? '').trim();
  return u.length === 0 || u.startsWith('/api-proxy/');
}

/**
 * 决定这次出网走哪条路。**顺序即优先级**：自定义地址 > 服务端网关 > 浏览器直连。
 */
export function decideOutboundRoute(input: RouteInput): { route: OutboundRoute; reason: string } {
  const url = String(input.mcpUrl ?? '').trim();
  if (!isBuiltinProxyPath(url)) {
    return {
      route: 'custom-endpoint',
      reason: `你填了自定义 MCP 地址（${url.slice(0, 60)}${url.length > 60 ? '…' : ''}）：这次调用直接连它，密钥来自你的本地设置`,
    };
  }
  if (input.hasToken) {
    return { route: 'gateway', reason: '已登录：走服务端数据池（管理员密钥由服务端使用，浏览器不接触密钥）' };
  }
  return {
    route: 'browser-legacy',
    reason: '未登录（游客/演示）：只能走浏览器直连，需要在设置里自行填写密钥——这是临时路径，登录后请改用数据池',
  };
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
