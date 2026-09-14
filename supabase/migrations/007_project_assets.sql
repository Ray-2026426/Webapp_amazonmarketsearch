-- Phase 3 Storage 接入：项目资产桶 + 基于项目成员角色的存储 RLS。
-- 路径约定：{projectId}/{assetName}；权限与项目成员一致：
--   - owner/editor/viewer 可读（成员可读）
--   - owner/editor 可写（新增/覆盖）
--   - owner 可删（级联删除用）
-- 说明：上传走后端 service_role，storage.objects.owner 不适用，因此 RLS 按路径前缀解析项目权限。

insert into storage.buckets (id, name, public)
values ('project-assets', 'project-assets', false)
on conflict (id) do nothing;

-- 从存储路径解析项目 id：路径 = {projectId}/{assetName}
create or replace function public.asset_project_id(path text)
returns text
language sql
immutable
set search_path = public
as $$
  select split_part(coalesce($1, ''), '/', 1)
$$;

-- 当前用户是否可读该资产（项目成员）
create or replace function public.can_read_asset(bucket text, path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    bucket = 'project-assets'
    and public.current_project_role(public.asset_project_id(path)) in ('owner', 'editor', 'viewer')
$$;

-- 当前用户是否可写该资产（owner/editor）
create or replace function public.can_write_asset(bucket text, path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    bucket = 'project-assets'
    and public.current_project_role(public.asset_project_id(path)) in ('owner', 'editor')
$$;

-- 当前用户是否可删该资产（owner）
create or replace function public.can_delete_asset(bucket text, path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    bucket = 'project-assets'
    and public.current_project_role(public.asset_project_id(path)) = 'owner'
$$;

grant execute on function public.asset_project_id(text) to anon, authenticated;
grant execute on function public.can_read_asset(text, text) to anon, authenticated;
grant execute on function public.can_write_asset(text, text) to anon, authenticated;
grant execute on function public.can_delete_asset(text, text) to anon, authenticated;

drop policy if exists "assets_select_member" on storage.objects;
create policy "assets_select_member"
  on storage.objects for select
  using (public.can_read_asset(bucket_id, name));

drop policy if exists "assets_insert_editor" on storage.objects;
create policy "assets_insert_editor"
  on storage.objects for insert
  with check (public.can_write_asset(bucket_id, name));

drop policy if exists "assets_update_editor" on storage.objects;
create policy "assets_update_editor"
  on storage.objects for update
  using (public.can_write_asset(bucket_id, name))
  with check (public.can_write_asset(bucket_id, name));

drop policy if exists "assets_delete_owner" on storage.objects;
create policy "assets_delete_owner"
  on storage.objects for delete
  using (public.can_delete_asset(bucket_id, name));
