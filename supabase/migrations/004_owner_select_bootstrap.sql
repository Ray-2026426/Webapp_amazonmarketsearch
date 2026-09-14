-- Phase 3 RLS 修正：PostgREST upsert 还会受到 select/read policy 影响。
-- 新项目首写时 project_members 行尚不存在，因此 owner_id = auth.uid()
-- 也需要在 select policy 中作为 bootstrap 条件。

drop policy if exists "projects_select_member" on public.projects;

create policy "projects_select_member"
  on public.projects for select
  using (public.can_read_project(id) or owner_id = auth.uid());
