-- v57 · Owner → Manager → Assignee on projects and tasks
--  Project: owner (oversees) and manager.
--  Task:    task_owner (oversees, usually the person who gives it), manager (assigned by the owner),
--           owner = the assignee (assigned by the manager). Project tasks take the project's owner and manager.
--  The owner (or a head) chooses the manager; the manager (or the owner, or a head) chooses the assignee.
--  Owner and manager see the task and the project even when someone else does the work.

alter table public.work_tasks add column if not exists task_owner uuid references public.profiles(id) on delete set null;
alter table public.work_tasks add column if not exists manager uuid references public.profiles(id) on delete set null;
alter table public.projects add column if not exists manager uuid references public.profiles(id) on delete set null;
update public.work_tasks set task_owner = created_by where task_owner is null;
create index if not exists work_tasks_task_owner on public.work_tasks (task_owner);
create index if not exists work_tasks_manager on public.work_tasks (manager);

-- owner and manager always see their tasks
create or replace function public.can_see_task_row(p_id uuid, p_owner uuid, p_created_by uuid, p_lead uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.sees_all() or p_owner = any(public.scope_ids()) or p_created_by = public.me()
      or (p_lead is not null and public.can_see_lead_id(p_lead))
      or exists (select 1 from public.work_subtasks s where s.task_id = p_id and s.owner = public.me())
      or exists (select 1 from public.work_tasks w where w.id = p_id and (w.task_owner = public.me() or w.manager = public.me()
                 or (w.project_id is not null and public.can_see_project(w.project_id))))
$$;

-- the project manager sees the project
create or replace function public.can_see_project(p uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.projects x where x.id = p and (public.sees_all() or x.owner = any(public.scope_ids()) or x.deal_owner = any(public.scope_ids())
    or x.manager = public.me()
    or exists (select 1 from public.project_items i where i.project_id = x.id and i.owner = public.me())
    or exists (select 1 from public.work_tasks w where w.project_id = x.id and (w.owner = public.me() or w.created_by = public.me() or w.manager = public.me() or w.task_owner = public.me()
         or exists (select 1 from public.work_subtasks s where s.task_id = w.id and s.owner = public.me())))))
$$;
drop policy if exists p_proj_r on public.projects;
create policy p_proj_r on public.projects for select using (public.sees_all() or owner = any(public.scope_ids()) or deal_owner = any(public.scope_ids()) or manager = public.me() or public.can_see_project(id));

-- new tasks: the giver owns it; a project task takes the project's owner and manager
create or replace function public.task_roles_default() returns trigger
language plpgsql security definer set search_path = public as $$
declare pj record;
begin
  if new.project_id is not null then
    select owner, manager into pj from public.projects where id = new.project_id;
    new.task_owner := coalesce(new.task_owner, pj.owner);
    new.manager := coalesce(new.manager, pj.manager);
  end if;
  new.task_owner := coalesce(new.task_owner, new.created_by, public.me());
  return new;
end $$;
drop trigger if exists trg_task_roles_default on public.work_tasks;
create trigger trg_task_roles_default before insert on public.work_tasks for each row execute function public.task_roles_default();

-- who may change whom
create or replace function public.task_roles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := public.me();
begin
  if me is null or public.sees_all() or public.is_head() then return new; end if;
  if new.task_owner is distinct from old.task_owner and me not in (coalesce(old.task_owner, me), coalesce(old.created_by, me)) then
    raise exception 'Only the task owner can hand the task to another owner';
  end if;
  if new.manager is distinct from old.manager and me <> all (array[old.task_owner, old.created_by]::uuid[]) and old.task_owner is not null then
    raise exception 'Only the task owner can choose the manager';
  end if;
  if new.owner is distinct from old.owner and me <> all (array[old.manager, old.task_owner, old.created_by]::uuid[])
     and not (old.manager is null and old.owner = me) then
    raise exception 'Only the manager or the owner can change the assignee';
  end if;
  return new;
end $$;
drop trigger if exists trg_task_roles_guard on public.work_tasks;
create trigger trg_task_roles_guard before update of task_owner, manager, owner on public.work_tasks for each row execute function public.task_roles_guard();

-- a new manager hears about it in the CRM and can then pick the assignee
create or replace function public.task_manager_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.manager is null or new.manager = public.me() then return new; end if;
  if tg_op = 'UPDATE' and new.manager is not distinct from old.manager then return new; end if;
  if tg_op = 'INSERT' and new.series_id is not null then return new; end if;
  insert into public.notifications (user_id, kind, title, body, lead_id, link)
  values (new.manager, 'info', 'You manage: ' || new.title,
          coalesce((select full_name from public.profiles where id = coalesce(public.me(), new.task_owner)), 'Someone') || ' made you the manager. Choose who does it.',
          new.lead_id, 'tasks/' || new.id);
  return new;
end $$;
drop trigger if exists trg_task_manager_notify on public.work_tasks;
create trigger trg_task_manager_notify after insert or update of manager on public.work_tasks for each row execute function public.task_manager_notify();

create or replace function public.project_manager_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.manager is null or new.manager = public.me() then return new; end if;
  if tg_op = 'UPDATE' and new.manager is not distinct from old.manager then return new; end if;
  insert into public.notifications (user_id, kind, title, body, link)
  values (new.manager, 'info', 'You manage the project: ' || new.name,
          coalesce((select full_name from public.profiles where id = public.me()), 'Someone') || ' made you the project manager.', 'projects/p-' || new.id);
  return new;
end $$;
drop trigger if exists trg_project_manager_notify on public.projects;
create trigger trg_project_manager_notify after insert or update of manager on public.projects for each row execute function public.project_manager_notify();

-- routines carry their owner and manager forward
do $$
declare d text;
begin
  d := pg_get_functiondef('public.recur_next'::regproc);
  if position('task_owner' in d) = 0 then
    d := replace(d, 'start_date, due_date, recur, remind_time, remind_email, series_id)', 'start_date, due_date, recur, remind_time, remind_email, series_id, task_owner, manager)');
    d := replace(d, 'new.remind_time, new.remind_email, coalesce(new.series_id, new.id))', 'new.remind_time, new.remind_email, coalesce(new.series_id, new.id), new.task_owner, new.manager)');
    execute d;
  end if;
end $$;
