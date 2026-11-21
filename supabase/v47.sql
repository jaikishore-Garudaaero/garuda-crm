-- =====================================================================
-- v4.7 · ₹10 Cr targets, Revenue So Far ledger (product + owner), product names as in the target sheet
-- =====================================================================
-- who a revenue line belongs to, and the day the money came in (payments recorded in the CRM have a day; sheet lines are monthly)
alter table public.revenue_entries add column if not exists owner uuid references public.profiles(id) on delete set null;
alter table public.revenue_entries add column if not exists owner_label text not null default '';
alter table public.revenue_entries add column if not exists paid_on date;
create index if not exists revenue_owner_idx on public.revenue_entries(owner);

-- product names exactly as the target sheet has them
update public.departments set segments = '{"Small","Medium","Top-Up Medium (Garuda RPC)","Top-Up Medium","TTT (Small)","Refresher","Academy – Other (extra flying hrs, partner centres)"}' where code = 'RPTO';
update public.departments set segments = '{"Basic Lab","Standard Lab","Advanced Lab","CoE – Other / to confirm"}' where code = 'CoE';
update public.departments set segments = '{"RPTO Establishment"}' where code = 'EST';
update public.departments set segments = '{"Institutional Visits / IV","Dronistaan Day","Workshop"}' where code = 'OTH';
create or replace function public.coe_segment(c text) returns text language sql immutable as $$
  select case
    when c in ('UAV Lab - Basic','Basic Lab','Basic UAV Lab') then 'Basic Lab'
    when c in ('UAV Lab - Standard','Standard Lab','Standard UAV Lab') then 'Standard Lab'
    when c in ('UAV Lab - Advanced','Advanced Lab','Advanced UAV Lab') then 'Advanced Lab'
    when c in ('RPTO Establishment','RPTO Products','RPTO Admissions (Bulk)') then 'RPTO Establishment'
    when c in ('IV (Industrial Visit)','Institutional Visits / IV') then 'Institutional Visits / IV'
    when c = 'Workshop' then 'Workshop' when c = 'Dronistaan Day' then 'Dronistaan Day'
    else 'CoE – Other / to confirm' end $$;
create or replace function public.course_segment(c text) returns text language sql immutable as $$
  select case c when 'Small Class RPC' then 'Small' when 'Medium Class RPC' then 'Medium' when 'Small + Medium RPC' then 'Medium'
    when 'Top-up Medium' then 'Top-Up Medium' when 'Train the Trainer (TTT)' then 'TTT (Small)' when 'Refresher' then 'Refresher'
    else 'Academy – Other (extra flying hrs, partner centres)' end $$;
update public.revenue_entries set segment = public.coe_segment(segment) where department in ('CoE','EST','OTH') and source <> 'import';

-- names the target sheet uses for people
update public.profiles set sheet_aliases = array(select distinct unnest(sheet_aliases || x.a)) from (values
  ('Sowmiya Murugan', '{"Sowmiya"}'::text[]), ('Sowmiya Sathanaivel', '{"Sowmiya.S","Sowmiya. S"}'::text[]), ('Jayamurugan Adhirajan', '{"Jeya murugan","Jeyamurugan"}'::text[])
) x(n, a) where public.profiles.full_name = x.n;

-- a verified payment lands in the ledger with its owner and its day
create or replace function public.payments_to_ledger() returns trigger
language plpgsql security definer set search_path = public as $$
declare l record; adm boolean; left_amt numeric; e record;
begin
  if tg_op = 'DELETE' then return old; end if;
  if new.status <> 'Verified' then delete from public.revenue_entries where payment_id = new.id; return new; end if;
  select * into l from public.leads where id = new.lead_id;
  select has_admissions into adm from public.departments where code = l.funnel;
  insert into public.revenue_entries(month, paid_on, department, channel, segment, client, amount, status, opp_ref, lead_id, payment_id, source, owner, created_by)
  values (date_trunc('month', new.paid_on)::date, new.paid_on, l.funnel, case when coalesce(adm,false) then 'Academy (direct)' else 'B2B' end,
          case when coalesce(adm,false) then public.course_segment(l.course) else public.coe_segment(nullif(l.sub_category, '')) end,
          case when coalesce(adm,false) then l.name else coalesce(nullif(l.org,''), l.name) end,
          new.amount_ex, 'Collected', coalesce(l.ref_id,''), l.id, new.id, 'payment', l.owner, new.verified_by)
  on conflict (payment_id) do update set month = excluded.month, paid_on = excluded.paid_on, amount = excluded.amount, segment = excluded.segment, client = excluded.client, owner = excluded.owner;
  if tg_op = 'INSERT' or old.status is distinct from 'Verified' then
    left_amt := new.amount_ex;
    for e in select id, amount from public.revenue_entries where status = 'Pending PO' and (lead_id = l.id or (coalesce(l.ref_id,'') <> '' and opp_ref = l.ref_id)) order by month, created_at loop
      exit when left_amt <= 0;
      if e.amount <= left_amt then delete from public.revenue_entries where id = e.id; left_amt := left_amt - e.amount;
      else update public.revenue_entries set amount = amount - left_amt where id = e.id; left_amt := 0; end if;
    end loop;
  end if;
  return new;
end $$;

-- ledger import: with a scope (e.g. 'rsf|'), lines of that scope no longer in the sheet are removed, so the CRM matches the sheet
drop function if exists public.import_revenue(jsonb);
create or replace function public.import_revenue(p_rows jsonb, p_scope text default null) returns int
language plpgsql security definer set search_path = public set statement_timeout = '120s' as $$
declare n int;
begin
  if not public.is_head() then raise exception 'Only an Admin can import.'; end if;
  create temp table _rv on commit drop as
  select x.* from jsonb_to_recordset(p_rows) x(import_key text, month date, paid_on date, dept text, channel text, segment text, client text, amount numeric, status text, opp_ref text, note text, owner_label text);
  if p_scope is not null then
    delete from public.revenue_entries r where r.source = 'import' and r.import_key like p_scope || '%' and not exists (select 1 from _rv where _rv.import_key = r.import_key);
    -- Revenue So Far replaces the sales sheet's Revenue Ledger lines
    if p_scope = 'rsf|' then delete from public.revenue_entries where source = 'import' and import_key like 'rev|%'; end if;
  end if;
  insert into public.revenue_entries(import_key, month, paid_on, department, channel, segment, client, amount, status, opp_ref, lead_id, source, note, owner_label, owner, created_by)
  select x.import_key, x.month, x.paid_on, x.dept, coalesce(x.channel, ''), coalesce(nullif(x.segment, ''), 'Not stated'), coalesce(x.client, ''), x.amount, x.status, coalesce(x.opp_ref, ''),
         (select l.id from public.leads l where coalesce(x.opp_ref, '') <> '' and l.ref_id = x.opp_ref limit 1), 'import', coalesce(x.note, ''), coalesce(x.owner_label, ''),
         public.owner_from_label(nullif(x.owner_label, '')), public.me()
    from _rv x
  on conflict (import_key) where import_key is not null do update set month = excluded.month, paid_on = excluded.paid_on, department = excluded.department, channel = excluded.channel, segment = excluded.segment,
    client = excluded.client, amount = excluded.amount, status = excluded.status, opp_ref = excluded.opp_ref, lead_id = excluded.lead_id, note = excluded.note,
    owner_label = excluded.owner_label, owner = excluded.owner;
  get diagnostics n = row_count; return n;
end $$;

-- targets for one financial year, replaced as a whole: team (segment '', no person), product (segment), person (no segment)
create or replace function public.import_targets(p_fy int, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public set statement_timeout = '120s' as $$
declare n int; miss jsonb;
begin
  if not public.is_head() then raise exception 'Only an Admin can import.'; end if;
  create temp table _tg on commit drop as
  select x.dept, coalesce(x.segment, '') segment, nullif(x.person_label, '') person_label, public.owner_from_label(nullif(x.person_label, '')) person, x.amount
    from jsonb_to_recordset(p_rows) x(dept text, segment text, person_label text, amount numeric)
   where x.dept in (select code from public.departments) and coalesce(x.amount, 0) >= 0;
  select jsonb_agg(distinct person_label) into miss from _tg where person_label is not null and person is null;
  delete from public.sales_targets where fy = p_fy;
  insert into public.sales_targets(fy, dept, segment, person, amount, updated_by)
  select p_fy, dept, segment, person, sum(amount), public.me() from _tg where person_label is null or person is not null group by dept, segment, person;
  get diagnostics n = row_count;
  return jsonb_build_object('saved', n, 'not_matched', coalesce(miss, '[]'::jsonb));
end $$;
revoke all on function public.import_revenue(jsonb, text), public.import_targets(int, jsonb) from public, anon;
grant execute on function public.import_revenue(jsonb, text), public.import_targets(int, jsonb) to authenticated;
alter function public.import_leads(jsonb) set statement_timeout = '120s';
alter function public.import_projects(jsonb) set statement_timeout = '120s';
alter function public.import_admissions(jsonb, jsonb) set statement_timeout = '120s';

-- clear everything an earlier sheet import brought in (Settings → Import → Start again); people, settings and tasks stay
create or replace function public.clear_imported() returns jsonb
language plpgsql security definer set search_path = public set statement_timeout = '300s' as $$
declare a int; b int; c int;
begin
  if not public.is_head() then raise exception 'Only an Admin can clear imported data.'; end if;
  perform set_config('garuda.system', 'on', true);
  delete from public.revenue_entries where source = 'import'; get diagnostics a = row_count;
  delete from public.projects where import_key is not null;
  delete from public.admissions where import_key is not null; delete from public.admission_sources where import_key is not null;
  delete from public.lead_history h using public.leads l where l.id = h.lead_id and l.imported and l.touched_at is null;
  delete from public.audit_log g using public.leads l where g.table_name = 'leads' and g.row_id = l.id and l.imported and l.touched_at is null;
  delete from public.leads where imported and touched_at is null; get diagnostics b = row_count;
  select count(*) into c from public.leads where imported;
  perform set_config('garuda.system', 'off', true);
  return jsonb_build_object('revenue', a, 'leads', b, 'kept_worked', c);
end $$;
revoke all on function public.clear_imported() from public, anon;
grant execute on function public.clear_imported() to authenticated;
