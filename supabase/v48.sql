-- =====================================================================
-- v4.8 · Accounts from the organisations on leads and deals
-- =====================================================================
-- one account per organisation name; leads and deals with that organisation are linked to it (an existing link is kept)
create or replace function public.link_accounts() returns jsonb
language plpgsql security definer set search_path = public set statement_timeout = '120s' as $$
declare a int; b int;
begin
  if not public.is_head() and current_user not in ('postgres', 'supabase_admin') then raise exception 'Only an Admin can build accounts.'; end if;
  insert into public.institutions(name, kind, city, owner, notes)
  select distinct on (lower(trim(l.org))) trim(l.org), case when l.funnel = 'RPTO' and not l.is_deal then 'Organisation' else 'Institution' end, '',
         (select l2.owner from public.leads l2 where lower(trim(l2.org)) = lower(trim(l.org)) and l2.owner is not null group by l2.owner order by count(*) desc limit 1),
         'Created from the organisation on its leads and deals'
    from public.leads l
   where coalesce(trim(l.org), '') <> '' and length(trim(l.org)) > 2
     and not exists (select 1 from public.institutions i where lower(i.name) = lower(trim(l.org)))
   order by lower(trim(l.org)), l.is_deal desc
  on conflict do nothing;
  get diagnostics a = row_count;
  perform set_config('garuda.system', 'on', true);
  update public.leads l set institution_id = i.id
    from public.institutions i
   where l.institution_id is null and coalesce(trim(l.org), '') <> '' and lower(i.name) = lower(trim(l.org));
  get diagnostics b = row_count;
  perform set_config('garuda.system', 'off', true);
  return jsonb_build_object('accounts', a, 'linked', b);
end $$;
revoke all on function public.link_accounts() from public, anon;
grant execute on function public.link_accounts() to authenticated;
