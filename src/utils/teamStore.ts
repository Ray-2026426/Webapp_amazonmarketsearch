import type { SessionUser } from './auth';

export type TeamMemberRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: TeamMemberRole;
  status: 'active' | 'invited';
  invitedAt: string;
}

export interface Team {
  id: string;
  name: string;
  ownerId: string;
  members: TeamMember[];
  createdAt: string;
  updatedAt: string;
}

const TEAM_KEY_PREFIX = 'amzdev_teams:';

export const TEAM_ROLE_LABELS: Record<TeamMemberRole, string> = {
  owner: '负责人',
  admin: '管理员',
  member: '成员',
  viewer: '只读',
};

function storageKey(userId: string): string {
  return `${TEAM_KEY_PREFIX}${userId}`;
}

function createId(prefix: string): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}_${crypto.randomUUID()}`;
    }
  } catch {
    /* ignore */
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeTeam(raw: unknown): Team | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<Team>;
  if (!item.id || !item.name || !item.ownerId) return null;
  return {
    id: String(item.id),
    name: String(item.name),
    ownerId: String(item.ownerId),
    members: Array.isArray(item.members)
      ? item.members
          .filter((m): m is TeamMember => Boolean(m && typeof m === 'object' && (m as TeamMember).email))
          .map((m) => ({
            id: String(m.id || createId('tm')),
            email: normalizeEmail(m.email),
            name: String(m.name || m.email),
            role: (['owner', 'admin', 'member', 'viewer'] as TeamMemberRole[]).includes(m.role) ? m.role : 'member',
            status: m.status === 'active' ? 'active' : 'invited',
            invitedAt: String(m.invitedAt || nowIso()),
          }))
      : [],
    createdAt: String(item.createdAt || nowIso()),
    updatedAt: String(item.updatedAt || nowIso()),
  };
}

export function loadTeams(userId: string): Team[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeTeam).filter((team): team is Team => team !== null);
  } catch {
    return [];
  }
}

export function saveTeams(userId: string, teams: Team[]): void {
  localStorage.setItem(storageKey(userId), JSON.stringify(teams));
}

export function createTeam(user: SessionUser, name: string): Team {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('请填写团队名称');
  const teams = loadTeams(user.id);
  const now = nowIso();
  const ownerEmail = normalizeEmail(user.email || user.username);
  const team: Team = {
    id: createId('team'),
    name: trimmed,
    ownerId: user.id,
    createdAt: now,
    updatedAt: now,
    members: [
      {
        id: createId('tm'),
        email: ownerEmail,
        name: user.nickname || user.username || ownerEmail,
        role: 'owner',
        status: 'active',
        invitedAt: now,
      },
    ],
  };
  saveTeams(user.id, [team, ...teams]);
  return team;
}

export function renameTeam(userId: string, teamId: string, name: string): Team | null {
  const teams = loadTeams(userId);
  const idx = teams.findIndex((team) => team.id === teamId);
  if (idx < 0) return null;
  teams[idx] = { ...teams[idx], name: name.trim() || teams[idx].name, updatedAt: nowIso() };
  saveTeams(userId, teams);
  return teams[idx];
}

export function inviteTeamMember(
  userId: string,
  teamId: string,
  email: string,
  role: Exclude<TeamMemberRole, 'owner'>
): Team | null {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes('@')) throw new Error('请输入有效邮箱');
  const teams = loadTeams(userId);
  const idx = teams.findIndex((team) => team.id === teamId);
  if (idx < 0) return null;
  const team = teams[idx];
  const exists = team.members.some((member) => member.email === normalized);
  if (exists) throw new Error('该用户已在团队中');
  const now = nowIso();
  const next: Team = {
    ...team,
    updatedAt: now,
    members: [
      ...team.members,
      {
        id: createId('tm'),
        email: normalized,
        name: normalized,
        role,
        status: 'invited',
        invitedAt: now,
      },
    ],
  };
  teams[idx] = next;
  saveTeams(userId, teams);
  return next;
}

export function updateTeamMemberRole(
  userId: string,
  teamId: string,
  memberId: string,
  role: Exclude<TeamMemberRole, 'owner'>
): Team | null {
  const teams = loadTeams(userId);
  const idx = teams.findIndex((team) => team.id === teamId);
  if (idx < 0) return null;
  const team = teams[idx];
  const next: Team = {
    ...team,
    updatedAt: nowIso(),
    members: team.members.map((member) =>
      member.id === memberId && member.role !== 'owner' ? { ...member, role } : member
    ),
  };
  teams[idx] = next;
  saveTeams(userId, teams);
  return next;
}

export function removeTeamMember(userId: string, teamId: string, memberId: string): Team | null {
  const teams = loadTeams(userId);
  const idx = teams.findIndex((team) => team.id === teamId);
  if (idx < 0) return null;
  const team = teams[idx];
  const next: Team = {
    ...team,
    updatedAt: nowIso(),
    members: team.members.filter((member) => member.id !== memberId || member.role === 'owner'),
  };
  teams[idx] = next;
  saveTeams(userId, teams);
  return next;
}
