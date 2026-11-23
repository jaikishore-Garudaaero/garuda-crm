-- =====================================================================
-- Garuda CRM v5.0 · Super admin, page access by role and person, deleting leads
-- Run after v49.sql. Safe to run again.
-- =====================================================================
alter table public.profiles add column if not exists super_admin boolean not null default false;

-- a Super admin is an Admin with the super flag
create or replace function public.is_super() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select super_admin and role = 'admin' and active from public.profiles where id = public.me()), false)
$$;
grant execute on function public.is_super() to authenticated;

-- only a Super admin makes or removes Admins and Super admins (the SQL editor and server jobs are exempt)
create or replace function public.guard_super() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if (new.super_admin or new.role = 'admin') and not public.is_super() then raise exception 'Only a Super admin can add an Admin'; end if;
    return new;
  end if;
  if new.super_admin is distinct from old.super_admin and not public.is_super() then raise exception 'Only a Super admin can change who is a Super admin'; end if;
  if old.super_admin and not public.is_super() and (new.role is distinct from old.role or new.active is distinct from old.active or new.email is distinct from old.email) then
    raise exception 'Only a Super admin can change a Super admin'; end if;
  if new.role is distinct from old.role and (new.role = 'admin' or old.role = 'admin') and not public.is_super() then
    raise exception 'Only a Super admin can make someone an Admin or take Admin away'; end if;
  if new.super_admin and new.role <> 'admin' then new.super_admin := false; end if;
  return new;
end $$;
drop trigger if exists trg_guard_super on public.profiles;
create trigger trg_guard_super before insert or update on public.profiles for each row execute function public.guard_super();

-- page access (settings key 'access') is changed only by a Super admin
create or replace function public.guard_access_setting() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  if coalesce(new.key, old.key) = 'access' and not public.is_super() then raise exception 'Only a Super admin can change page access'; end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_guard_access on public.settings;
create trigger trg_guard_access before insert or update or delete on public.settings for each row execute function public.guard_access_setting();

-- deleting leads: Super admin only (every delete is kept in the audit log with the full record)
drop policy if exists p_leads_d on public.leads;
create policy p_leads_d on public.leads for delete using (public.is_super());
create or replace function public.delete_leads(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_super() then raise exception 'Only a Super admin can delete leads'; end if;
  delete from public.leads where id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end $$;
alter function public.delete_leads(uuid[]) set statement_timeout = '120s';
revoke all on function public.delete_leads(uuid[]) from public, anon;
grant execute on function public.delete_leads(uuid[]) to authenticated;

-- automations and other jobs treat any active Admin as "the head"
-- (no change needed: they already pick role = 'admin')

-- the first Super admin: set once in the Supabase SQL editor, for example
--   update public.profiles set super_admin = true where lower(email) = '<the owner''s work email>' and role = 'admin';
