-- Phase 3 成员管理与乐观并发：
-- 1) projects 增加 revision 列（服务端乐观锁，与客户端 data.version 解耦）。
-- 2) find_user_id_by_email：按邮箱解析 Supabase 用户 id，用于成员邀请。
-- 3) project_members_with_info：成员列表（含邮箱/账号），供成员管理 UI。
-- 4) push_project_if_revision：原子"版本检查 + 写入"，仅在 service_role 下可调用。

alter table public.projects
  add column if not exists revision bigint not null default 1;

-- 按邮箱找 Supabase 用户（security definer 读取 auth.users）。
-- 只允许已登录用户调用（authenticated），并校验调用者是项目成员（防枚举）。
create or replace function public.find_user_id_by_email(target_email text)
returns uuid
language sql
stable
security definer
set search_path = auth, public
as $$
  select id
  from auth.users
  where lower(email) = lower(target_email)
    and auth.uid() is not null
  limit 1;
$$;

revoke all on function public.find_user_id_by_email(text) from public, anon;
grant execute on function public.find_user_id_by_email(text) to authenticated;

-- 项目成员列表（含邮箱与注册账号），供成员管理 UI 使用。
-- security definer + 显式成员校验：非项目成员返回空，不泄露其他项目成员。
create or replace function public.project_members_with_info(p_project_id text)
returns table (
  user_id uuid,
  role text,
  email text,
  account text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = auth, public
as $$
  select
    pm.user_id,
    pm.role,
    u.email,
    (u.raw_user_meta_data ->> 'account')::text as account,
    pm.created_at
  from public.project_members pm
  left join auth.users u on u.id = pm.user_id
  where pm.project_id = p_project_id
    and public.can_read_project(p_project_id)
  order by
    case pm.role when 'owner' then 0 when 'editor' then 1 else 2 end,
    pm.created_at asc;
$$;

revoke all on function public.project_members_with_info(text) from public, anon;
grant execute on function public.project_members_with_info(text) to authenticated;

-- 原子乐观写入：仅 owner/editor 可写；revision 不匹配时返回云端当前数据（冲突）。
-- 仅 service_role 有执行权（service_role 绕过 RLS，必须由后端 API 鉴权后调用）。
create or replace function public.push_project_if_revision(
  p_id text,
  p_expected_revision bigint,
  p_user_id uuid,
  p_data jsonb,
  p_updated_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.projects%rowtype;
  v_role text;
begin
  select * into v_current from public.projects where id = p_id for update;
  if not found then
    insert into public.projects (id, user_id, owner_id, data, updated_at, revision)
    values (p_id, p_user_id, p_user_id, p_data, p_updated_at, 1);
    insert into public.project_members (project_id, user_id, role)
    values (p_id, p_user_id, 'owner')
    on conflict (project_id, user_id) do update set role = excluded.role;
    return jsonb_build_object('ok', true, 'revision', 1);
  end if;

  select pm.role into v_role
  from public.project_members pm
  where pm.project_id = p_id and pm.user_id = p_user_id
  limit 1;
  if v_role is null then
    if v_current.owner_id = p_user_id then
      v_role := 'owner'; -- 旧数据 bootstrap：owner_id 无成员行时按 owner 处理
    else
      return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;
  end if;
  if v_role not in ('owner', 'editor') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_current.revision <> p_expected_revision then
    return jsonb_build_object(
      'ok', false,
      'conflict', true,
      'current', v_current.data,
      'revision', v_current.revision
    );
  end if;

  update public.projects
  set data = p_data, updated_at = p_updated_at, revision = v_current.revision + 1
  where id = p_id;
  return jsonb_build_object('ok', true, 'revision', v_current.revision + 1);
end;
$$;

revoke all on function public.push_project_if_revision(text, bigint, uuid, jsonb, timestamptz) from public;
grant execute on function public.push_project_if_revision(text, bigint, uuid, jsonb, timestamptz) to service_role;
