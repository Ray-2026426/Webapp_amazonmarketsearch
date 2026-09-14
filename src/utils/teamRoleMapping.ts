// M6 · 团队角色 ↔ 项目角色 的映射与权限边界（PRD §11.4 / §12 M6「团队空间与权限收口」）。
//
// 背景（真实问题）：仓库里存在两套角色词表——
//   团队（teamStore）：owner / admin / member / viewer
//   项目（projectMembers）：owner / editor / viewer
// 如果不把它们的关系写死，就会出现"团队管理员到底能不能改别人项目"这种靠猜的权限问题。
//
// 本模块的**唯一原则**：
//   1) **项目内容的权限一律以「项目成员角色」为准**——团队角色不直接授予项目写入权；
//   2) 团队角色只决定"团队管理"能力（建团队/邀请/改角色/移除），以及"默认项目角色"（新建项目时用）；
//   3) 映射只允许"降级"或"等价"，**绝不允许升级**：团队 admin 不能变成项目 owner（否则一个团队管理员
//      就能接管别人的项目，属于权限提升漏洞）。

import type { TeamMemberRole } from './teamStore';
import type { MemberRole } from './projectMembers';

export const TEAM_ROLES: TeamMemberRole[] = ['owner', 'admin', 'member', 'viewer'];

/** 团队角色 → 项目默认角色（只在"新建项目/新增成员"时作为默认值，不覆盖已有的项目角色） */
export const TEAM_TO_PROJECT_ROLE: Record<TeamMemberRole, MemberRole> = {
  owner: 'owner',
  admin: 'editor',
  member: 'editor',
  viewer: 'viewer',
};

/** 项目角色 → 团队角色（邀请项目成员进团队时的默认值） */
export const PROJECT_TO_TEAM_ROLE: Record<MemberRole, TeamMemberRole> = {
  owner: 'owner',
  editor: 'member',
  viewer: 'viewer',
};

/** 团队管理能力：只有 owner / admin 能改团队（邀请、改角色、移除） */
export function canManageTeam(role: TeamMemberRole): boolean {
  return role === 'owner' || role === 'admin';
}

/** 是否允许移除/降级团队负责人（永远不允许——否则团队会失去 owner） */
export function canModifyTeamOwner(): boolean {
  return false;
}

/**
 * 团队角色能否获得"项目写入"权：**不能直接获得**。
 * 它只能给出"默认项目角色"，真正能不能写由项目成员表决定。
 */
export function defaultProjectRoleForTeamRole(role: TeamMemberRole): MemberRole {
  return TEAM_TO_PROJECT_ROLE[role];
}

/**
 * 权限比较序（用于断言"映射绝不升级"）。
 * 项目侧：viewer < editor < owner。
 */
export function projectRoleRank(role: MemberRole): number {
  return role === 'owner' ? 2 : role === 'editor' ? 1 : 0;
}

export function teamRoleRank(role: TeamMemberRole): number {
  return role === 'owner' ? 3 : role === 'admin' ? 2 : role === 'member' ? 1 : 0;
}

/**
 * 安全断言：团队角色映射到项目角色时**不得升级**。
 * 允许等价或降级（例如 admin→editor 是降级：团队管理权 ≠ 项目所有权）。
 */
export function mappingIsNonEscalating(role: TeamMemberRole): boolean {
  const mapped = TEAM_TO_PROJECT_ROLE[role];
  // 团队管理员不是项目负责人：明确降级
  if (role === 'admin') return mapped === 'editor';
  // 其它角色的语义必须等价
  const expected: Record<Exclude<TeamMemberRole, 'admin'>, MemberRole> = {
    owner: 'owner',
    member: 'editor',
    viewer: 'viewer',
  };
  return expected[role as Exclude<TeamMemberRole, 'admin'>] === mapped;
}

/** 人话说明（团队空间面板里直接显示，避免用户猜"这两个角色什么关系"） */
export function describeRoleMapping(role: TeamMemberRole): string {
  const mapped = TEAM_TO_PROJECT_ROLE[role];
  const projectLabel = mapped === 'owner' ? '项目负责人' : mapped === 'editor' ? '可编辑' : '只读';
  const teamAbility = canManageTeam(role) ? '可管理团队（邀请/改角色/移除）' : '不能管理团队';
  return `团队「${role}」→ 项目默认角色「${projectLabel}」；${teamAbility}；项目内实际权限以该项目的成员角色为准`;
}

/** 团队成员列表里可选的"团队角色"（owner 不在此列：负责人只能转让，不能直接邀请成 owner） */
export const INVITABLE_TEAM_ROLES: Exclude<TeamMemberRole, 'owner'>[] = ['admin', 'member', 'viewer'];
