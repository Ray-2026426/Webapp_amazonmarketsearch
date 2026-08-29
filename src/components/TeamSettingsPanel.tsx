import { useMemo, useState } from 'react';
import { Crown, Mail, Plus, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Select } from './ui/Select';
import {
  createTeam,
  inviteTeamMember,
  loadTeams,
  removeTeamMember,
  renameTeam,
  TEAM_ROLE_LABELS,
  updateTeamMemberRole,
  type Team,
  type TeamMemberRole,
} from '../utils/teamStore';
import type { SessionUser } from '../utils/auth';

const INVITE_ROLES: Exclude<TeamMemberRole, 'owner'>[] = ['member', 'admin', 'viewer'];

export function TeamSettingsPanel({ currentUser }: { currentUser?: SessionUser | null }) {
  const [teams, setTeams] = useState<Team[]>(() => (currentUser ? loadTeams(currentUser.id) : []));
  const [activeTeamId, setActiveTeamId] = useState(() => teams[0]?.id ?? '');
  const [teamName, setTeamName] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Exclude<TeamMemberRole, 'owner'>>('member');

  const activeTeam = useMemo(
    () => teams.find((team) => team.id === activeTeamId) ?? teams[0] ?? null,
    [activeTeamId, teams]
  );

  const refresh = (nextActiveId?: string) => {
    if (!currentUser) return;
    const next = loadTeams(currentUser.id);
    setTeams(next);
    setActiveTeamId(nextActiveId ?? next.find((team) => team.id === activeTeamId)?.id ?? next[0]?.id ?? '');
  };

  const handleCreate = () => {
    if (!currentUser) return;
    try {
      const team = createTeam(currentUser, teamName);
      setTeamName('');
      refresh(team.id);
      toast.success('团队已创建');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建团队失败');
    }
  };

  const handleRename = () => {
    if (!currentUser || !activeTeam) return;
    const updated = renameTeam(currentUser.id, activeTeam.id, renameValue);
    if (!updated) return;
    setRenameValue('');
    refresh(updated.id);
    toast.success('团队名称已更新');
  };

  const handleInvite = () => {
    if (!currentUser || !activeTeam) return;
    try {
      const updated = inviteTeamMember(currentUser.id, activeTeam.id, inviteEmail, inviteRole);
      if (!updated) return;
      setInviteEmail('');
      refresh(updated.id);
      toast.success('邀请已记录');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '邀请失败');
    }
  };

  const handleRoleChange = (memberId: string, role: Exclude<TeamMemberRole, 'owner'>) => {
    if (!currentUser || !activeTeam) return;
    const updated = updateTeamMemberRole(currentUser.id, activeTeam.id, memberId, role);
    if (!updated) return;
    refresh(updated.id);
    toast.success('成员角色已更新');
  };

  const handleRemove = (memberId: string) => {
    if (!currentUser || !activeTeam) return;
    const updated = removeTeamMember(currentUser.id, activeTeam.id, memberId);
    if (!updated) return;
    refresh(updated.id);
    toast.success('成员已移除');
  };

  if (!currentUser) {
    return (
      <div className="rounded-2xl border border-black/10 bg-[#fafafa] p-6 text-sm text-[#86868b]">
        登录后可以创建团队，并邀请相关用户加入协作。
      </div>
    );
  }

  return (
    <div className="space-y-4 overflow-y-auto">
      <div className="rounded-2xl bg-indigo-50 border border-indigo-100 px-4 py-3 text-sm text-indigo-900 leading-relaxed">
        团队用于管理 OG&huhu 的协作成员。当前先保存在本机浏览器，后续可接入云同步后承载跨账号邀请与权限。
      </div>

      <div className="rounded-2xl border border-black/10 bg-white p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Plus className="w-4 h-4 text-indigo-600" />
          <p className="text-sm font-bold text-[#1d1d1f]">创建团队</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
            placeholder="例如：OG&huhu 选品组"
            className="flex-1 px-3 py-2.5 bg-[#f5f5f7] border border-black/5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={!teamName.trim()}
            className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            创建
          </button>
        </div>
      </div>

      {teams.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
          <div className="rounded-2xl border border-black/10 bg-white p-3 space-y-2">
            <div className="flex items-center gap-2 px-1 pb-1">
              <Users className="w-4 h-4 text-indigo-600" />
              <p className="text-sm font-bold text-[#1d1d1f]">我的团队</p>
            </div>
            {teams.map((team) => (
              <button
                key={team.id}
                type="button"
                onClick={() => setActiveTeamId(team.id)}
                className={`w-full text-left px-3 py-2.5 rounded-xl border text-sm transition-all ${
                  activeTeam?.id === team.id
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-100'
                    : 'bg-[#fafafa] text-[#424245] border-black/5 hover:bg-[#f5f5f7]'
                }`}
              >
                <span className="block font-semibold truncate">{team.name}</span>
                <span className="block text-xs opacity-70">{team.members.length} 位成员</span>
              </button>
            ))}
          </div>

          {activeTeam && (
            <div className="rounded-2xl border border-black/10 bg-white p-4 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-[#1d1d1f]">{activeTeam.name}</p>
                  <p className="text-xs text-[#86868b] mt-0.5">创建者：{currentUser.nickname || currentUser.username}</p>
                </div>
                <div className="flex gap-2">
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    placeholder="修改团队名称"
                    className="w-full sm:w-40 px-3 py-2 bg-[#f5f5f7] border border-black/5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                  />
                  <button
                    type="button"
                    onClick={handleRename}
                    disabled={!renameValue.trim()}
                    className="px-3 py-2 rounded-xl border border-black/10 bg-white text-sm font-semibold text-[#424245] hover:bg-[#f5f5f7] disabled:opacity-40"
                  >
                    更新
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-black/8 bg-[#fafafa] p-3">
                <p className="text-xs font-semibold text-[#424245] mb-2 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-indigo-600" /> 邀请成员
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleInvite();
                    }}
                    placeholder="输入对方邮箱"
                    className="flex-1 px-3 py-2 bg-white border border-black/8 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                  />
                  <Select
                    value={inviteRole}
                    onChange={(value) => setInviteRole(value as Exclude<TeamMemberRole, 'owner'>)}
                    options={INVITE_ROLES.map((role) => ({ value: role, label: TEAM_ROLE_LABELS[role] }))}
                    size="md"
                    className="sm:w-28"
                  />
                  <button
                    type="button"
                    onClick={handleInvite}
                    disabled={!inviteEmail.trim()}
                    className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    邀请
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {activeTeam.members.map((member) => (
                  <div key={member.id} className="flex items-center gap-3 rounded-2xl border border-black/8 bg-white p-3">
                    <div className="w-9 h-9 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
                      {member.role === 'owner' ? <Crown className="w-4 h-4" /> : <Users className="w-4 h-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#1d1d1f] truncate">{member.name}</p>
                      <p className="text-xs text-[#86868b] truncate">
                        {member.email} · {member.status === 'active' ? '已加入' : '已邀请'}
                      </p>
                    </div>
                    {member.role === 'owner' ? (
                      <span className="px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold border border-indigo-100">
                        {TEAM_ROLE_LABELS.owner}
                      </span>
                    ) : (
                      <Select
                        value={member.role}
                        onChange={(value) => handleRoleChange(member.id, value as Exclude<TeamMemberRole, 'owner'>)}
                        options={INVITE_ROLES.map((role) => ({ value: role, label: TEAM_ROLE_LABELS[role] }))}
                        className="w-24 shrink-0"
                      />
                    )}
                    {member.role !== 'owner' && (
                      <button
                        type="button"
                        onClick={() => handleRemove(member.id)}
                        title="移除成员"
                        aria-label="移除成员"
                        className="w-8 h-8 rounded-full flex items-center justify-center text-[#86868b] hover:text-rose-600 hover:bg-rose-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
