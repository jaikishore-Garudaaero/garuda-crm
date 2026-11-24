-- v52 · Project tasks: Project → Task → Sub-task → Progress
-- a task belongs to a lead/deal/account (lead task) or to a project (project task)

alter table public.work_tasks add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.work_tasks add column if not exists start_date date;
alter table public.work_tasks add column if not exists progress int;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'work_tasks_progress_chk') then
    alter table public.work_tasks add constraint work_tasks_progress_chk check (progress is null or progress between 0 and 100);
  end if;
end $$;
create index if not exists work_tasks_project on public.work_tasks (project_id);

-- everyone who can see a project sees all of its tasks and sub-tasks (so the % complete is the same for everyone)
create or replace function public.can_see_task_row(p_id uuid, p_owner uuid, p_created_by uuid, p_lead uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.sees_all() or p_owner = any(public.scope_ids()) or p_created_by = public.me()
      or (p_lead is not null and public.can_see_lead_id(p_lead))
      or exists (select 1 from public.work_subtasks s where s.task_id = p_id and s.owner = public.me())
      or exists (select 1 from public.work_tasks w where w.id = p_id and w.project_id is not null and public.can_see_project(w.project_id))
$$;

-- people with a task or sub-task in a project can see that project
create or replace function public.can_see_project(p uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.projects x where x.id = p and (public.sees_all() or x.owner = any(public.scope_ids()) or x.deal_owner = any(public.scope_ids())
    or exists (select 1 from public.project_items i where i.project_id = x.id and i.owner = public.me())
    or exists (select 1 from public.work_tasks w where w.project_id = x.id and (w.owner = public.me() or w.created_by = public.me()
         or exists (select 1 from public.work_subtasks s where s.task_id = w.id and s.owner = public.me())))))
$$;

-- adding a task to a project needs access to that project
drop policy if exists p_wt_i on public.work_tasks;
create policy p_wt_i on public.work_tasks for insert with check (
  public.is_staff()
  and (lead_id is null or public.can_see_lead_id(lead_id))
  and (project_id is null or public.can_see_project(project_id))
  and (owner is null or exists (select 1 from public.profiles p where p.id = owner and p.active)));
