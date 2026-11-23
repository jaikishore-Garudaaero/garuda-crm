-- v51 · Activity log: who did what, for the Super admin only
-- 1) only the Super admin reads the audit log
-- 2) every change keeps a readable label and the lead it belongs to
-- 3) the log covers the main working tables, settings, and sign-ins
-- 4) a summary function counts actions per person for a date range

alter table public.audit_log add column if not exists ref text;
alter table public.audit_log add column if not exists lead_id uuid;
create index if not exists audit_log_at on public.audit_log (changed_at desc);
create index if not exists audit_log_by on public.audit_log (changed_by, changed_at desc);
create index if not exists audit_log_tbl on public.audit_log (table_name, changed_at desc);
create index if not exists audit_log_lead on public.audit_log (lead_id);

drop policy if exists p_audit_r on public.audit_log;
create policy p_audit_r on public.audit_log for select using (public.is_super());

-- secrets never land in the log
create or replace function public.audit_mask(k text, v jsonb) returns jsonb language sql immutable as $$
  select case when k ~* '(secret|password|passwd|token|api_?key|private)' and v is not null and v <> 'null'::jsonb then to_jsonb('•••'::text) else v end
$$;

create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare d jsonb := '{}'::jsonb; k text; r jsonb; o jsonb; lbl text; lid uuid;
begin
  if coalesce(current_setting('garuda.skip_audit', true), '') = 'on' then return coalesce(new, old); end if;
  r := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  lbl := left(coalesce(r->>'name', r->>'full_name', r->>'title', r->>'client', r->>'subject', r->>'purpose', r->>'description', r->>'text'), 140);
  lid := case when tg_table_name = 'leads' then (r->>'id')::uuid
              when r ? 'lead_id' and nullif(r->>'lead_id','') is not null then (r->>'lead_id')::uuid end;
  if tg_op = 'INSERT' then
    insert into public.audit_log(table_name,row_id,action,diff,ref,lead_id)
      values (tg_table_name, new.id, 'insert',
        nullif(jsonb_strip_nulls(jsonb_build_object('stage', r->'stage', 'status', r->'status', 'amount', coalesce(r->'amount', r->'value'), 'owner', r->'owner')), '{}'::jsonb),
        lbl, lid);
    return new;
  elsif tg_op = 'DELETE' then
    o := '{}'::jsonb;
    for k in select jsonb_object_keys(r) loop o := o || jsonb_build_object(k, public.audit_mask(k, r->k)); end loop;
    insert into public.audit_log(table_name,row_id,action,diff,ref,lead_id) values (tg_table_name, old.id, 'delete', o, lbl, lid);
    return old;
  end if;
  o := to_jsonb(old);
  for k in select jsonb_object_keys(r) loop
    if k not in ('updated_at','ai_dirty','ai_score','ai_band','ai_summary','ai_next_action','ai_channel','ai_scored_at','last_contact_at','first_contact_at','next_followup_at','runs','history','updates')
       and (r->k) is distinct from (o->k) then
      d := d || jsonb_build_object(k, jsonb_build_array(public.audit_mask(k, o->k), public.audit_mask(k, r->k)));
    end if;
  end loop;
  -- history / updates arrays: keep only that they changed, not the whole array
  if (r ? 'history' and (r->'history') is distinct from (o->'history')) then d := d || '{"history":[null,"added an entry"]}'::jsonb; end if;
  if (r ? 'updates' and (r->'updates') is distinct from (o->'updates')) then d := d || '{"updates":[null,"added an update"]}'::jsonb; end if;
  if d <> '{}'::jsonb then
    insert into public.audit_log(table_name,row_id,action,diff,ref,lead_id) values (tg_table_name, new.id, 'update', d, lbl, lid);
  end if;
  return new;
end $function$;

-- settings rows are keyed by name, not id
create or replace function public.audit_setting()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare d jsonb := '{}'::jsonb; k text; nv jsonb; ov jsonb;
begin
  if coalesce(current_setting('garuda.skip_audit', true), '') = 'on' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    insert into public.audit_log(table_name,row_id,action,diff,ref) values ('settings', null, 'delete', null, old.key);
    return old;
  end if;
  nv := new.value; ov := case when tg_op = 'UPDATE' then old.value end;
  if jsonb_typeof(nv) = 'object' and (ov is null or jsonb_typeof(ov) = 'object') then
    for k in select jsonb_object_keys(nv) union select jsonb_object_keys(coalesce(ov, '{}'::jsonb)) loop
      if (nv->k) is distinct from (ov->k) then
        d := d || jsonb_build_object(k, jsonb_build_array(public.audit_mask(k, ov->k), public.audit_mask(k, nv->k)));
      end if;
    end loop;
  elsif nv is distinct from ov then
    d := jsonb_build_object('value', jsonb_build_array(public.audit_mask(new.key, ov), public.audit_mask(new.key, nv)));
  end if;
  if d <> '{}'::jsonb then
    insert into public.audit_log(table_name,row_id,action,diff,ref) values ('settings', null, lower(tg_op), d, new.key);
  end if;
  return new;
end $function$;

drop trigger if exists trg_audit_settings on public.settings;
create trigger trg_audit_settings after insert or update or delete on public.settings for each row execute function public.audit_setting();

-- attach the row audit to the working tables (leads and payments already have it)
do $$
declare t text;
begin
  foreach t in array array['remarks','tasks','work_tasks','work_subtasks','profiles','automations','revenue_entries','admissions',
    'institutions','contacts','visits','complaints','projects','project_items','products','product_items','campaigns','mkt_campaigns',
    'campaign_spend','email_templates','email_lists','email_sequences','events','batches','sales_targets','targets','eod_reports',
    'daily_mom','approvals','approval_rules','price_disclosures','business_tasks','review_meetings','review_items']
  loop
    if to_regclass('public.' || t) is not null
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'id' and data_type = 'uuid')
       and not exists (select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgfoid = 'public.audit_row'::regproc) then
      execute format('create trigger trg_audit_%s after insert or update or delete on public.%I for each row execute function public.audit_row()', t, t);
    end if;
  end loop;
end $$;

-- sign-ins and other app events, written by the app itself
create or replace function public.log_activity(p_action text, p_ref text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if public.me() is null then return; end if;
  if p_action not in ('sign in', 'export', 'import') then raise exception 'Unknown activity'; end if;
  -- one sign-in per person per 30 minutes is enough
  if p_action = 'sign in' and exists (select 1 from public.audit_log where changed_by = public.me() and table_name = 'session'
       and action = 'sign in' and changed_at > now() - interval '30 minutes') then return; end if;
  insert into public.audit_log(table_name, row_id, action, ref) values ('session', null, p_action, left(p_ref, 140));
end $$;
revoke all on function public.log_activity(text, text) from public, anon;
grant execute on function public.log_activity(text, text) to authenticated;

-- per person, per area, per action counts for a date range (Super admin only)
create or replace function public.audit_summary(p_from timestamptz, p_to timestamptz)
returns table(changed_by uuid, table_name text, action text, n bigint, last_at timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.is_super() then raise exception 'Only the Super admin sees the activity log'; end if;
  return query select a.changed_by, a.table_name, a.action, count(*), max(a.changed_at)
    from public.audit_log a where a.changed_at >= p_from and a.changed_at < p_to
    group by 1, 2, 3;
end $$;
alter function public.audit_summary(timestamptz, timestamptz) set statement_timeout = '60s';
revoke all on function public.audit_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.audit_summary(timestamptz, timestamptz) to authenticated;

-- backfill the lead link and label on existing lead rows
update public.audit_log set lead_id = row_id where table_name = 'leads' and lead_id is null;
update public.audit_log a set ref = left(l.name, 140) from public.leads l where a.table_name = 'leads' and a.ref is null and l.id = a.row_id;
