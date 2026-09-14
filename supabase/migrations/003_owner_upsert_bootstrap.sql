-- Phase 3 RLS 修正：允许 owner 在 project_members 记录建立前完成 projects upsert。
-- PostgREST upsert 会同时检查 update policy；新项目首写时成员行尚不存在，
-- 因此 update policy 需要接受 projects.owner_id = auth.uid() 的 bootstrap 场景。

drop policy if exists "projects_select_member" on public.projects;
drop policy if exists "projects_update_editor" on public.projects;

create policy "projects_select_member"
  on public.projects for select
  using (public.can_read_project(id) or owner_id = auth.uid());

create policy "projects_update_editor"
  on public.projects for update
  using (public.can_write_project(id) or owner_id = auth.uid())
  with check (public.can_write_project(id) or owner_id = auth.uid());
