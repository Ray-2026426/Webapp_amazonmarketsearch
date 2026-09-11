import { useCallback, useEffect, useState } from 'react';
import { X, UserPlus, Shield, Mail, Loader2, Crown, Pencil, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from './ui/Card';
import { Select } from './ui/Select';
import {
  MEMBER_ROLE_LABELS,
  fetchProjectMembers,
  inviteProjectMember,
  removeProjectMember,
  setProjectMemberRole,
  type MemberRole,
  type ProjectMemberInfo,
} from '../utils/projectMembers';

const ROLE_ICONS: Record<MemberRole, typeof Crown> = {
  owner: Crown,
  editor: Pencil,
  viewer: Eye,
};

const ROLE_BADGE: Record<MemberRole, string> = {
  owner: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  editor: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  viewer: 'bg-[#f5f5f7] text-[#86868b] border-black/5',
};

export function ProjectMembersModal({
  projectId,
  currentUserId,
  onClose,
}: {
  projectId: string;
  currentUserId: string;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<ProjectMemberInfo[]>([]);
  const [myRole, setMyRole] = useState<MemberRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [cloudDisabled, setCloudDisabled] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Exclude<MemberRole, 'owner'>>('viewer');
  const [inviting, setInviting] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetchProjectMembers(projectId);
    setLoading(false);
    if (!res.ok) {
      setCloudDisabled(Boolean(res.cloudDisabled));
      if (res.error) toast.error(res.error);
      return;
    }
    setMembers(res.members);
    setMyRole(res.myRole);
    setCloudDisabled(Boolean(res.cloudDisabled));
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const isOwner = myRole === 'owner';

  const applyResult = (res: Awaited<ReturnType<typeof fetchProjectMembers>>, successMsg: string) => {
    if (!res.ok) {
      if (res.error) toast.error(res.error);
      return;
    }
    setMembers(res.members);
    setMyRole(res.myRole);
    toast.success(successMsg);
  };

  const submitInvite = async () => {
    const email = inviteEmail.trim();
    if (!email) {
      toast.error('请输入对方邮箱');
      return;
    }
    setInviting(true);
    const res = await inviteProjectMember(projectId, email, inviteRole);
    setInviting(false);
    if (res.ok) {
      setInviteEmail('');
      applyResult(res, '已发送邀请');
    } else {
      applyResult(res, '');
    }
  };

  const handleRemove = async (m: ProjectMemberInfo) => {
    setBusyUserId(m.user_id);
    const res = await removeProjectMember(projectId, m.user_id);
    setBusyUserId(null);
    applyResult(res, '已移除成员');
  };

  const handleRoleChange = async (m: ProjectMemberInfo, role: Exclude<MemberRole, 'owner'>) => {
    setBusyUserId(m.user_id);
    const res = await setProjectMemberRole(projectId, m.user_id, role);
    setBusyUserId(null);
    applyResult(res, '角色已更新');
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-[32px] shadow-[0_12px_40px_rgba(15,23,42,0.14)] border border-black/8 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between px-7 pt-6">
          <div>
            <h3 className="text-xl font-bold text-[#1d1d1f]">项目成员</h3>
            <p className="text-sm text-[#86868b] mt-0.5">
              {isOwner ? '邀请成员协作，可编辑 / 只读' : MEMBER_ROLE_LABELS[myRole ?? 'viewer'] + ' · 仅负责人可管理成员'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full hover:bg-[#f5f5f7] flex items-center justify-center text-[#86868b]">
            <X className="w-4 h-4" />
          </button>
        </div>

        {cloudDisabled ? (
          <div className="px-7 py-10 text-center">
            <Shield className="w-10 h-10 text-[#c7c7cc] mx-auto mb-3" />
            <p className="text-sm font-semibold text-[#424245]">云同步未配置</p>
            <p className="text-sm text-[#86868b] mt-1 max-w-xs mx-auto leading-relaxed">
              成员管理需要云账号（设置 → 云同步）。当前仅本机工作区，暂时无法邀请成员。
            </p>
          </div>
        ) : loading ? (
          <div className="px-7 py-10 flex flex-col items-center gap-2 text-[#86868b]">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-sm">加载成员…</span>
          </div>
        ) : (
          <div className="px-7 py-5 space-y-4">
            {/* 邀请区（仅 owner） */}
            {isOwner && (
              <div className="rounded-2xl border border-black/8 bg-gradient-to-b from-white to-[#f8f9fb] p-4">
                <p className="text-xs font-semibold text-[#424245] mb-2 flex items-center gap-1.5">
                  <UserPlus className="w-3.5 h-3.5 text-indigo-600" /> 邀请成员
                </p>
                <div className="flex items-center gap-2">
                  <input
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="对方邮箱（需已注册云账号）"
                    className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-black/8 bg-white text-sm text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300 transition-all"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void submitInvite();
                    }}
                  />
                  <Select
                    value={inviteRole}
                    onChange={(v) => setInviteRole(v as Exclude<MemberRole, 'owner'>)}
                    options={[
                      { value: 'viewer', label: '只读' },
                      { value: 'editor', label: '可编辑' },
                    ]}
                    size="md"
                    className="w-[104px] shrink-0"
                  />
                  <button
                    type="button"
                    disabled={inviting || !inviteEmail.trim()}
                    onClick={() => void submitInvite()}
                    className="shrink-0 px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
                  >
                    {inviting ? '邀请中…' : '邀请'}
                  </button>
                </div>
              </div>
            )}

            {/* 成员列表 */}
            <div className="space-y-2">
              {members.length === 0 ? (
                <p className="text-sm text-[#86868b] text-center py-6">暂无其他成员，只有你一个</p>
              ) : (
                members.map((m) => {
                  const Icon = ROLE_ICONS[m.role] ?? Eye;
                  const isSelf = m.user_id === currentUserId;
                  const busy = busyUserId === m.user_id;
                  return (
                    <div key={m.user_id} className="flex items-center gap-3 rounded-2xl border border-black/8 p-3 bg-white">
                      <div className="w-9 h-9 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 font-semibold text-sm shrink-0">
                        {(m.account || m.email || '?')[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[#1d1d1f] truncate">
                          {m.account || '云用户'}
                          {isSelf && <span className="text-[#aeaeb2] font-normal ml-1">（我）</span>}
                        </p>
                        <p className="text-xs text-[#86868b] truncate">{m.email || '未绑定邮箱'}</p>
                      </div>
                      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold border shrink-0', ROLE_BADGE[m.role])}>
                        <Icon className="w-3 h-3" />
                        {MEMBER_ROLE_LABELS[m.role]}
                      </span>
                      {isOwner && !isSelf && m.role !== 'owner' && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Select
                            value={m.role}
                            onChange={(v) => void handleRoleChange(m, v as Exclude<MemberRole, 'owner'>)}
                            options={[
                              { value: 'viewer', label: '只读' },
                              { value: 'editor', label: '可编辑' },
                            ]}
                            size="sm"
                            disabled={busy}
                            className="w-[92px]"
                          />
                          <button
                            type="button"
                            title="移除成员"
                            aria-label="移除成员"
                            disabled={busy}
                            onClick={() => void handleRemove(m)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-[#aeaeb2] hover:text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-40"
                          >
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {!isOwner && (
              <p className="text-xs text-[#86868b] flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" />
                成员管理仅项目负责人可用；可编辑成员可修改项目内容，只读成员仅可查看。
              </p>
            )}
          </div>
        )}

        <div className="px-7 pb-6 flex items-center justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl border border-black/8 text-sm font-medium text-[#424245] hover:bg-[#f5f5f7] transition-all">
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
