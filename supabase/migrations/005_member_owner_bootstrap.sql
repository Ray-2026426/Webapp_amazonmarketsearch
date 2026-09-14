-- Phase 3 RLS 修正：允许项目 owner 写入自己的首条 project_members owner 记录。
-- PostgREST upsert 会同时受 insert/update/select 策略影响，因此三类策略都要
-- 接受 projects.owner_id = auth.uid() 的 bootstrap 条件。

drop policy if exists "project_members_select_member" on public.project_members;
drop policy if exists "project_members_insert_owner" on public.project_members;
drop policy if exists "project_members_update_owner" on public.project_members;
drop policy if exists "project_members_delete_owner" on public.project_members;

create policy "project_members_select_member"
  on public.project_members for select
  using (public.can_read_project(project_id) or public.is_project_owner_column(project_id));

create policy "project_members_insert_owner"
  on public.project_members for insert
  with check (
    (role = 'owner' and user_id = auth.uid() and public.is_project_owner_column(project_id))
    or public.can_own_project(project_id)
  );

create policy "project_members_update_owner"
  on public.project_members for update
  using (public.can_own_project(project_id) or public.is_project_owner_column(project_id))
  with check (public.can_own_project(project_id) or public.is_project_owner_column(project_id));

create policy "project_members_delete_owner"
  on public.project_members for delete
  using (public.can_own_project(project_id) or public.is_project_owner_column(project_id));
