-- =====================================================================
-- v4.6 · RPTO Team with four processes, Excel import, collections, department delete
-- =====================================================================
alter table public.departments add column if not exists team text not null default 'RPTO Team';
update public.departments set name = 'RPTO Academy', team = 'RPTO Team' where code = 'RPTO';
update public.departments set name = 'CoE', team = 'RPTO Team' where code = 'CoE';
insert into public.departments(code, name, color, ord, has_admissions, segments, loss_reasons, courses, team) values
 ('EST','RPTO Establishment','#8d3f91',3,false,'{"RPTO Establishment","RPTO Products"}','{Budget,"Management not interested","Went with a competitor","No response",Timing,Other}','{"RPTO Establishment","RPTO Products","Model A · Garuda-operated","Model B · Joint investment","Model C · College-owned"}','RPTO Team'),
 ('OTH','Other Services','#e08a2a',4,false,'{"IV (Industrial Visit)",Workshop,Other,"Not stated"}','{Budget,"Not interested","No response",Timing,Other}','{"IV (Industrial Visit)",Workshop,"Course / Curriculum",Internship,"Faculty Training (FDP)",Other}','RPTO Team')
on conflict (code) do update set team = excluded.team;
update public.departments set segments = '{"UAV Lab - Basic","UAV Lab - Standard","UAV Lab - Advanced","UAV Lab (type not stated)","Not stated"}' where code = 'CoE';
-- the two new processes use the institutional statuses (same as CoE)
delete from public.stages s where s.funnel in ('EST','OTH') and not exists (select 1 from public.leads l where l.funnel = s.funnel and l.stage = s.key);
insert into public.stages(funnel, key, ord, prob, is_won, is_lost, is_closed, grp, kind, needs_reason, needs_fee, needs_payment)
select f.code, s.key, s.ord, s.prob, s.is_won, s.is_lost, s.is_closed, s.grp, s.kind, s.needs_reason, s.needs_fee, s.needs_payment
  from public.stages s cross join (values ('EST'),('OTH')) f(code) where s.funnel = 'CoE'
on conflict (funnel, key) do nothing;
-- Academy statuses use the sheet's names
do $$ declare r record; begin
  for r in select * from (values ('F_Follow Up','Future Follow Up'),('Converted','Closed Won'),('CoE Leads','CoE Other Department')) x(o, n) loop
    if exists (select 1 from public.stages where funnel = 'RPTO' and key = r.o) and not exists (select 1 from public.stages where funnel = 'RPTO' and key = r.n) then
      insert into public.stages(funnel, key, ord, prob, is_won, is_lost, is_closed, grp, kind, needs_reason, needs_fee, needs_payment)
        select funnel, r.n, ord, prob, is_won, is_lost, is_closed, grp, kind, needs_reason, needs_fee, needs_payment from public.stages where funnel = 'RPTO' and key = r.o;
      perform set_config('garuda.system', 'on', true);
      update public.leads set stage = r.n where funnel = 'RPTO' and stage = r.o;
      perform set_config('garuda.system', 'off', true);
      delete from public.stages where funnel = 'RPTO' and key = r.o;
    end if;
  end loop;
end $$;
update public.stages set ord = 3, prob = 10, grp = 'Working', kind = 'lead' where funnel = 'RPTO' and key = 'Future Follow Up';
-- product interest for Bulk RPC sits with CoE, Academy courses as in the sheet
update public.products set funnel = 'EST' where code like 'RPTO-EST-%';
update public.products set funnel = 'OTH' where code in ('ACT-IV','TRN-WORKSHOP');

-- lead fields from the sheet
alter table public.leads add column if not exists routed_dept text not null default '';
alter table public.leads add column if not exists sheet_owner text not null default '';
alter table public.leads add column if not exists inherited boolean not null default false;
alter table public.leads add column if not exists touched_at timestamptz;
alter table public.leads add column if not exists meeting_date date;
alter table public.leads add column if not exists tier_source text not null default '';
create index if not exists leads_tier_idx on public.leads(campaign_tier);
create index if not exists leads_inherited_idx on public.leads(inherited) where inherited;
alter table public.profiles add column if not exists sheet_aliases text[] not null default '{}';
update public.profiles set sheet_aliases = x.a from (values
  ('sowmiyasathanaivel','{"Sowmiya S","Sowmiya SJ2","Sowmiya SM2","Sowmiya SK2","Sowmiya SB2","Sowmiya SS2"}'::text[]),
  ('sowmiya','{"Sowmya","Sowmiya MJ2","Sowmiya MM2","Sowmiya MK2","Sowmiya MB2","Sowmiya MS2"}'::text[]),
  ('alok_kumar','{"Alok","Alok_S"}'::text[]), ('coecollaboration','{"Jayamurugan","Jayamurugan_S"}'::text[]),
  ('jaikishore','{"Jai kishore"}'::text[]), ('pooja','{"Pooja"}'::text[])
) x(e, a) where split_part(lower(public.profiles.email), '@', 1) in (x.e, replace(x.e, 'sathanaivel', '.sathanaivel')) and public.profiles.sheet_aliases = '{}';

-- projects: order value, what came in, what is pending, delivery
alter table public.projects add column if not exists project_code text not null default '';
alter table public.projects add column if not exists order_value numeric(14,2) not null default 0;
alter table public.projects add column if not exists opening_received numeric(14,2) not null default 0;
alter table public.projects add column if not exists delivered text not null default '';
alter table public.projects add column if not exists po_ref text not null default '';
alter table public.projects add column if not exists order_date date;
alter table public.projects add column if not exists import_key text;
create unique index if not exists projects_import_key on public.projects(import_key) where import_key is not null;
alter table public.revenue_entries add column if not exists import_key text;
create unique index if not exists revenue_import_key on public.revenue_entries(import_key) where import_key is not null;
alter table public.admissions add column if not exists import_key text;
create unique index if not exists admissions_import_key on public.admissions(import_key) where import_key is not null;
alter table public.admission_sources add column if not exists import_key text;
create unique index if not exists admsrc_import_key on public.admission_sources(import_key) where import_key is not null;

-- money in for a project = opening amount from the sheet + verified payments on its deal
create or replace function public.project_money() returns table(project_id uuid, order_value numeric, received numeric, pending numeric)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(p.order_value, 0), p.value),
         p.opening_received + coalesce((select sum(y.amount_ex) from public.payments y where y.lead_id = p.lead_id and y.status = 'Verified' and y.claimed_at > coalesce(p.created_at, now() - interval '100 years')), 0),
         greatest(coalesce(nullif(p.order_value, 0), p.value) - p.opening_received - coalesce((select sum(y.amount_ex) from public.payments y where y.lead_id = p.lead_id and y.status = 'Verified' and y.claimed_at > coalesce(p.created_at, now() - interval '100 years')), 0), 0)
    from public.projects p where public.can_see_project(p.id)
$$;
grant execute on function public.project_money() to authenticated;

-- a verified payment also clears the matching "Pending PO" lines in the ledger, oldest first
create or replace function public.payments_to_ledger() returns trigger
language plpgsql security definer set search_path = public as $$
declare l record; adm boolean; left_amt numeric; e record;
begin
  if tg_op = 'DELETE' then return old; end if;
  if new.status <> 'Verified' then delete from public.revenue_entries where payment_id = new.id; return new; end if;
  select * into l from public.leads where id = new.lead_id;
  select has_admissions into adm from public.departments where code = l.funnel;
  insert into public.revenue_entries(month, department, channel, segment, client, amount, status, opp_ref, lead_id, payment_id, source, created_by)
  values (date_trunc('month', new.paid_on)::date, l.funnel, case when coalesce(adm,false) then 'Academy (direct)' else 'B2B' end,
          case when coalesce(adm,false) then public.course_segment(l.course) else public.coe_segment(nullif(l.sub_category, '')) end,
          case when coalesce(adm,false) then l.name else coalesce(nullif(l.org,''), l.name) end,
          new.amount_ex, 'Collected', coalesce(l.ref_id,''), l.id, new.id, 'payment', new.verified_by)
  on conflict (payment_id) do update set month = excluded.month, amount = excluded.amount, segment = excluded.segment, client = excluded.client;
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

-- the first time anyone works an imported lead in the CRM
create or replace function public.lead_touched() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.leads set touched_at = now() where id = new.lead_id and imported and touched_at is null;
  return new;
end $$;
drop trigger if exists trg_lead_touched on public.remarks;
create trigger trg_lead_touched after insert on public.remarks for each row execute function public.lead_touched();

-- a sheet name (e.g. "Sowmiya MJ2") to a person
create or replace function public.owner_from_label(p text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.profiles
   where p is not null and (lower(trim(p)) = lower(full_name) or lower(trim(p)) = lower(nullif(sheet_name, '')) or lower(trim(p)) = any(select lower(x) from unnest(sheet_aliases) x))
   order by active desc limit 1
$$;

-- ---------- Excel import: leads (upsert on process + sheet ID; leads already worked in the CRM keep their CRM status and owner) ----------
create or replace function public.import_leads(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n_new int := 0; n_upd int := 0; n_skip int := 0; bad jsonb;
begin
  if not public.is_head() then raise exception 'Only an Admin can import.'; end if;
  perform set_config('garuda.system', 'on', true);
  create temp table _in on commit drop as
  select x.*, public.owner_from_label(x.owner_label) as owner_id
    from jsonb_to_recordset(p_rows) as x(funnel text, ref_id text, stage text, is_deal boolean, name text, contact_name text, designation text, phone text, email text,
      city text, org text, source text, enquiry_date date, allocated_date date, owner_label text, course text, sub_category text, also_interested text,
      routed_dept text, value numeric, temperature text, campaign_tier text, priority_score int, tier_reason text, tier_source text, language text, eligible text,
      call_attempts int, latest_remark text, latest_update text, client_type text, expected_close date, meeting_date date, won_at date, lost_reason text,
      collected_import numeric, pending_po numeric, history text, inherited boolean);
  select jsonb_agg(distinct i.funnel || ':' || i.stage) into bad from _in i where not exists (select 1 from public.stages s where s.funnel = i.funnel and s.key = i.stage);
  if bad is not null then raise exception 'These statuses are not set up in the CRM: %', bad; end if;
  with up as (
    update public.leads l set
      stage = case when l.touched_at is null then i.stage else l.stage end,
      is_deal = case when l.touched_at is null then coalesce(i.is_deal, false) else l.is_deal end,
      owner = case when l.touched_at is null then coalesce(i.owner_id, l.owner) else l.owner end,
      name = coalesce(nullif(i.name, ''), l.name), contact_name = coalesce(i.contact_name, ''), phone = coalesce(i.phone, ''), email = coalesce(i.email, ''),
      city = coalesce(i.city, ''), org = coalesce(i.org, ''), source = coalesce(i.source, ''), enquiry_date = i.enquiry_date, allocated_date = i.allocated_date,
      course = coalesce(i.course, ''), sub_category = coalesce(i.sub_category, ''), also_interested = coalesce(i.also_interested, ''), routed_dept = coalesce(i.routed_dept, ''),
      unit_price = coalesce(i.value, 0), temperature = coalesce(nullif(i.temperature, ''), l.temperature), campaign_tier = coalesce(i.campaign_tier, ''),
      priority_score = i.priority_score, tier_reason = coalesce(i.tier_reason, ''), tier_source = coalesce(i.tier_source, ''), language = coalesce(i.language, ''),
      eligible = coalesce(nullif(i.eligible, ''), 'Unknown'), call_attempts = greatest(l.call_attempts, coalesce(i.call_attempts, 0)), latest_remark = coalesce(i.latest_remark, ''),
      latest_update = coalesce(i.latest_update, ''), client_type = coalesce(i.client_type, ''), expected_close = i.expected_close, meeting_date = i.meeting_date,
      won_at = coalesce(l.won_at, i.won_at::timestamptz), lost_reason = coalesce(nullif(i.lost_reason, ''), l.lost_reason),
      collected_import = coalesce(i.collected_import, 0), pending_po = coalesce(i.pending_po, 0), sheet_owner = coalesce(i.owner_label, ''), inherited = coalesce(i.inherited, false),
      stage_changed_at = case when l.touched_at is null then coalesce(i.won_at, i.enquiry_date)::timestamptz else l.stage_changed_at end,
      imported = true, updated_at = now()
    from _in i where l.funnel = i.funnel and l.ref_id = i.ref_id returning l.id)
  select count(*) into n_upd from up;
  with ins as (
    insert into public.leads(funnel, ref_id, stage, is_deal, name, contact_name, designation, phone, email, city, org, source, enquiry_date, allocated_date, owner, owner_name,
      course, sub_category, also_interested, routed_dept, unit_price, temperature, campaign_tier, priority_score, tier_reason, tier_source, language, eligible, call_attempts,
      latest_remark, latest_update, client_type, expected_close, meeting_date, won_at, deal_at, lost_reason, collected_import, pending_po, sheet_owner, inherited, imported, created_at, created_by, stage_changed_at)
    select i.funnel, i.ref_id, i.stage, coalesce(i.is_deal, false), coalesce(nullif(i.name, ''), 'No name'), coalesce(i.contact_name, ''), coalesce(i.designation, ''), coalesce(i.phone, ''), coalesce(i.email, ''),
      coalesce(i.city, ''), coalesce(i.org, ''), coalesce(i.source, ''), i.enquiry_date, i.allocated_date, i.owner_id, coalesce(i.owner_label, ''),
      coalesce(i.course, ''), coalesce(i.sub_category, ''), coalesce(i.also_interested, ''), coalesce(i.routed_dept, ''), coalesce(i.value, 0),
      coalesce(nullif(i.temperature, ''), 'Warm'), coalesce(i.campaign_tier, ''), i.priority_score, coalesce(i.tier_reason, ''), coalesce(i.tier_source, ''), coalesce(i.language, ''),
      coalesce(nullif(i.eligible, ''), 'Unknown'), coalesce(i.call_attempts, 0), coalesce(i.latest_remark, ''), coalesce(i.latest_update, ''), coalesce(i.client_type, ''),
      i.expected_close, i.meeting_date, i.won_at::timestamptz, case when coalesce(i.is_deal, false) then coalesce(i.won_at, i.enquiry_date, current_date)::timestamptz end,
      coalesce(i.lost_reason, ''), coalesce(i.collected_import, 0), coalesce(i.pending_po, 0), coalesce(i.owner_label, ''), coalesce(i.inherited, false), true,
      coalesce(i.enquiry_date::timestamptz, now()), public.me(), coalesce(i.won_at, i.enquiry_date)::timestamptz
    from _in i where not exists (select 1 from public.leads l where l.funnel = i.funnel and l.ref_id = i.ref_id)
    returning id)
  select count(*) into n_new from ins;
  insert into public.lead_history(lead_id, text)
    select l.id, i.history from _in i join public.leads l on l.funnel = i.funnel and l.ref_id = i.ref_id where coalesce(i.history, '') <> ''
  on conflict (lead_id) do update set text = excluded.text;
  select count(*) into n_skip from _in where owner_label is not null and owner_label <> '' and owner_id is null;
  perform set_config('garuda.system', 'off', true);
  return jsonb_build_object('new', n_new, 'updated', n_upd, 'no_owner', n_skip);
end $$;

-- ---------- Excel import: won projects, the revenue ledger and admissions ----------
create or replace function public.import_projects(p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_head() then raise exception 'Only an Admin can import.'; end if;
  insert into public.projects(import_key, project_code, lead_id, name, dept, owner, deal_owner, status, value, order_value, opening_received, delivered, po_ref, order_date, start_date, notes)
  select x.import_key, coalesce(x.project_code, ''), l.id, x.name, x.dept, l.owner, l.owner, coalesce(x.status, 'In progress'), coalesce(x.order_value, 0), coalesce(x.order_value, 0),
         coalesce(x.received, 0), coalesce(x.delivered, ''), coalesce(x.po_ref, ''), x.order_date, coalesce(x.order_date, current_date), coalesce(x.notes, '')
    from jsonb_to_recordset(p_rows) x(import_key text, project_code text, lead_ref text, name text, dept text, status text, order_value numeric, received numeric, delivered text, po_ref text, order_date date, notes text)
    left join public.leads l on l.ref_id = x.lead_ref and l.funnel = x.dept
  on conflict (import_key) where import_key is not null do update set project_code = excluded.project_code, name = excluded.name, order_value = excluded.order_value,
    value = excluded.value, opening_received = excluded.opening_received, delivered = excluded.delivered, order_date = excluded.order_date, notes = excluded.notes, lead_id = coalesce(public.projects.lead_id, excluded.lead_id);
  get diagnostics n = row_count; return n;
end $$;

create or replace function public.import_revenue(p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_head() then raise exception 'Only an Admin can import.'; end if;
  insert into public.revenue_entries(import_key, month, department, channel, segment, client, amount, status, opp_ref, lead_id, source, note, created_by)
  select x.import_key, x.month, x.dept, coalesce(x.channel, ''), coalesce(nullif(x.segment, ''), 'Not stated'), coalesce(x.client, ''), x.amount, x.status, coalesce(x.opp_ref, ''),
         (select l.id from public.leads l where coalesce(x.opp_ref, '') <> '' and l.ref_id = x.opp_ref limit 1), 'import', coalesce(x.note, ''), public.me()
    from jsonb_to_recordset(p_rows) x(import_key text, month date, dept text, channel text, segment text, client text, amount numeric, status text, opp_ref text, note text)
  on conflict (import_key) where import_key is not null do update set month = excluded.month, department = excluded.department, channel = excluded.channel, segment = excluded.segment,
    client = excluded.client, amount = excluded.amount, status = excluded.status, opp_ref = excluded.opp_ref, lead_id = excluded.lead_id, note = excluded.note;
  get diagnostics n = row_count; return n;
end $$;

create or replace function public.import_admissions(p_adm jsonb, p_src jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int; m int;
begin
  if not public.is_head() then raise exception 'Only an Admin can import.'; end if;
  insert into public.admissions(import_key, month, segment, paid, free, dept, note, created_by)
  select x.import_key, x.month, x.segment, coalesce(x.paid, 0), coalesce(x.free, 0), 'RPTO', 'From the sales sheet', public.me()
    from jsonb_to_recordset(p_adm) x(import_key text, month date, segment text, paid int, free int)
  on conflict (import_key) where import_key is not null do update set paid = excluded.paid, free = excluded.free, segment = excluded.segment, month = excluded.month;
  get diagnostics n = row_count;
  insert into public.admission_sources(import_key, month, source, admissions, created_by)
  select x.import_key, x.month, x.source, coalesce(x.admissions, 0), public.me()
    from jsonb_to_recordset(p_src) x(import_key text, month date, source text, admissions int)
  on conflict (import_key) where import_key is not null do update set admissions = excluded.admissions, source = excluded.source, month = excluded.month;
  get diagnostics m = row_count; return n + m;
end $$;
revoke all on function public.import_leads(jsonb), public.import_projects(jsonb), public.import_revenue(jsonb), public.import_admissions(jsonb, jsonb) from public, anon;
grant execute on function public.import_leads(jsonb), public.import_projects(jsonb), public.import_revenue(jsonb), public.import_admissions(jsonb, jsonb) to authenticated;

-- ---------- delete a department (process): move everything to another one first ----------
create or replace function public.delete_department(p_code text, p_to text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int; st text; moved int := 0;
begin
  if not public.is_head() then raise exception 'Only an Admin can delete a department.'; end if;
  if not exists (select 1 from public.departments where code = p_code) then raise exception 'Department not found.'; end if;
  select count(*) into n from public.leads where funnel = p_code;
  if n > 0 or exists (select 1 from public.revenue_entries where department = p_code) then
    if p_to is null or p_to = p_code or not exists (select 1 from public.departments where code = p_to) then raise exception 'Choose where its records should go.'; end if;
  end if;
  perform set_config('garuda.system', 'on', true);
  if p_to is not null and p_to <> p_code then
    select key into st from public.stages where funnel = p_to and kind in ('lead','both') and not is_won and not is_lost and not is_closed order by ord limit 1;
    update public.leads l set funnel = p_to, stage = case when exists (select 1 from public.stages s where s.funnel = p_to and s.key = l.stage) then l.stage else st end where l.funnel = p_code;
    get diagnostics moved = row_count;
    update public.revenue_entries set department = p_to where department = p_code;
    update public.admissions set dept = p_to where dept = p_code;
    update public.projects set dept = p_to where dept = p_code;
    update public.complaints set dept = p_to where dept = p_code;
    update public.mkt_campaigns set dept = p_to where dept = p_code;
    update public.products set funnel = p_to where funnel = p_code;
    delete from public.sales_targets t where t.dept = p_code and exists (select 1 from public.sales_targets o where o.dept = p_to and o.fy = t.fy and o.segment = t.segment and o.person is not distinct from t.person);
    update public.sales_targets set dept = p_to where dept = p_code;
    delete from public.revenue_targets where dept = p_code;
    update public.profiles set departments = array(select distinct unnest(array_replace(departments, p_code, p_to))) where p_code = any(departments);
  else
    update public.profiles set departments = array_remove(departments, p_code) where p_code = any(departments);
    update public.mkt_campaigns set dept = null where dept = p_code;
    update public.complaints set dept = null where dept = p_code;
    update public.projects set dept = null where dept = p_code;
    delete from public.sales_targets where dept = p_code; delete from public.revenue_targets where dept = p_code;
    delete from public.products where funnel = p_code and not exists (select 1 from public.leads l where l.product_id = products.id);
  end if;
  delete from public.stages where funnel = p_code;
  delete from public.departments where code = p_code;
  perform set_config('garuda.system', 'off', true);
  return jsonb_build_object('moved', moved);
end $$;
revoke all on function public.delete_department(text, text) from public, anon;
grant execute on function public.delete_department(text, text) to authenticated;
