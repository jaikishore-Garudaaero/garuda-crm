-- v53 · Deleting a project: Super admin only. Its tasks and sub-tasks go with it (or are kept as standalone tasks),
-- its milestones and payment milestones go with it, recorded payments stay. Every row deleted is kept in the activity log.

drop policy if exists p_proj_w on public.projects;
drop policy if exists p_proj_i on public.projects;
drop policy if exists p_proj_u on public.projects;
drop policy if exists p_proj_d on public.projects;
create policy p_proj_i on public.projects for insert with check (public.is_staff());
create policy p_proj_u on public.projects for update using (public.can_see_project(id)) with check (public.is_staff());
create policy p_proj_d on public.projects for delete using (public.is_super());

create or replace function public.delete_project(p_id uuid, p_keep_tasks boolean default false)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_super() then raise exception 'Only the Super admin can delete a project'; end if;
  if p_keep_tasks then
    update public.work_tasks set project_id = null where project_id = p_id;
  else
    delete from public.work_tasks where project_id = p_id;
  end if;
  delete from public.projects where id = p_id;
end $$;
revoke all on function public.delete_project(uuid, boolean) from public, anon;
grant execute on function public.delete_project(uuid, boolean) to authenticated;
