-- v54 · Project type: business project (official work, no lead) or lead project (a department and a lead)
alter table public.projects add column if not exists kind text not null default 'lead';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'projects_kind_chk') then
    alter table public.projects add constraint projects_kind_chk check (kind in ('lead', 'business'));
  end if;
end $$;
update public.projects set kind = 'business' where lead_id is null and kind = 'lead';

-- a new project must be readable straight after it is created (the check reads the row itself, not a lookup)
drop policy if exists p_proj_r on public.projects;
create policy p_proj_r on public.projects for select using (public.sees_all() or owner = any(public.scope_ids()) or deal_owner = any(public.scope_ids()) or public.can_see_project(id));
