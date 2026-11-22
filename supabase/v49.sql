-- =====================================================================
-- Garuda CRM v4.9 · sales-sheet remarks as dated activity, referrals,
-- in-app notifications and lead automations (workflows)
-- Run after v48.sql. Safe to run again.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The sheet's "All Remarks (date-wise)" become dated remarks on the lead
--    (channel 'Sales sheet'). They set the last-contacted date, but do not
--    count as someone working the lead in the CRM (touched_at stays empty,
--    so a later sheet import can still update the lead).
-- ---------------------------------------------------------------------
drop trigger if exists trg_remarks_ai on public.remarks;
create trigger trg_remarks_ai after insert on public.remarks
  for each row when (new.channel <> 'Sales sheet') execute function public.remarks_after_insert();
drop trigger if exists trg_lead_touched on public.remarks;
create trigger trg_lead_touched after insert on public.remarks
  for each row when (new.channel <> 'Sales sheet') execute function public.lead_touched();
create index if not exists remarks_channel on public.remarks(channel, lead_id);

-- bulk system updates (contact dates from the sheet) can skip the field-by-field audit
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare d jsonb := '{}'::jsonb; k text;
begin
  if coalesce(current_setting('garuda.skip_audit', true), '') = 'on' then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then
    insert into public.audit_log(table_name,row_id,action,diff) values (tg_table_name, new.id, 'insert', null);
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log(table_name,row_id,action,diff) values (tg_table_name, old.id, 'delete', to_jsonb(old));
    return old;
  end if;
  for k in select jsonb_object_keys(to_jsonb(new)) loop
    if k not in ('updated_at','ai_dirty','ai_score','ai_band','ai_summary','ai_next_action','ai_channel','ai_scored_at','last_contact_at','first_contact_at','next_followup_at')
       and (to_jsonb(new)->k) is distinct from (to_jsonb(old)->k) then
      d := d || jsonb_build_object(k, jsonb_build_array(to_jsonb(old)->k, to_jsonb(new)->k));
    end if;
  end loop;
  if d <> '{}'::jsonb then
    insert into public.audit_log(table_name,row_id,action,diff) values (tg_table_name, new.id, 'update', d);
  end if;
  return new;
end $$;

-- "3 JAN - RNR", "27 jan callback", "31 July // not required", "03/02/2026 - ..." → (date, text)
create or replace function public.sheet_lines(p_text text, p_start date)
returns table(at timestamptz, txt text)
language plpgsql immutable as $$
declare
  mon constant text := '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  line text; m text[]; y int := extract(year from coalesce(p_start, current_date))::int; mi int; d date;
  cur_at date; cur_txt text; last_d date; body text;
begin
  -- several dated entries written on one line: break them apart
  body := regexp_replace(coalesce(p_text, ''), '\s+(?=\d{1,2}(?:st|nd|rd|th)?\s*' || mon || '\M\.?\s*(?:\d{2,4})?\s*(?:[-–:]|//))', E'\n', 'gi');
  for line in select trim(x) from regexp_split_to_table(body, E'\n+') x loop
    continue when line = '';
    mi := null; m := regexp_match(line, '^(\d{1,2})(?:st|nd|rd|th)?[\s./-]*' || mon || '\M\.?[\s,./-]*(\d{4}(?!\d)|\d{2}(?!\d))?\s*(?:[-–:]+|//+|,)?\s*(.*)$', 'i');
    if m is not null then
      mi := array_position(array['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'], lower(left(m[2], 3)));
    else
      m := regexp_match(line, '^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\s*(?:[-–:]+|//+)?\s*(.*)$');
      if m is not null and m[2]::int between 1 and 12 then mi := m[2]::int; end if;
    end if;
    if mi is null then                       -- no date: part of the entry above
      cur_txt := case when cur_txt is null then line else cur_txt || ' ' || line end;
      continue;
    end if;
    if cur_txt is not null then at := cur_at; txt := cur_txt; return next; end if;
    if m[3] is not null and m[3] <> '' and (case when length(m[3]) = 2 then 2000 + m[3]::int else m[3]::int end) between 2023 and extract(year from current_date)::int + 1 then y := case when length(m[3]) = 2 then 2000 + m[3]::int else m[3]::int end; end if;
    d := make_date(y, mi, 1) + (least(greatest(m[1]::int, 1), 31) - 1);
    if (m[3] is null or m[3] = '') and last_d is not null and d < last_d - 40 then y := y + 1; d := make_date(y, mi, 1) + (least(greatest(m[1]::int, 1), 31) - 1); end if;
    while d > current_date + 1 loop d := (d - interval '1 year')::date; end loop;
    last_d := d; cur_at := d; cur_txt := coalesce(nullif(trim(m[4]), ''), '(no remark)');
  end loop;
  if cur_txt is not null then at := cur_at; txt := cur_txt; return next; end if;
end $$;

create or replace function public.sheet_outcome(t text) returns text language sql immutable as $$
  select case
    when t ~* '(rnr|not reach|unreach|switch(ed)? ?off|busy|no answer|not (picking|answer|lift)|disconnect|not respond|ringing|out of (service|coverage)|not available|call not)' then 'No answer'
    when t ~* '(not interest|no interest|not required|not need|dropp?ed|not eligible|already (purchased|done|joined|bought))' then 'Not interested'
    when t ~* '(call ?back|follow|will (call|update|visit|come|join|confirm|plan|inform|check|discuss|let)|interested|asked|sent|shared|whats ?app|mail|brochure|details|visit|meeting|quotation|proposal)' then 'Follow-up'
    else 'Spoke' end $$;

create or replace function public.sync_sheet_remarks(p_lead_ids uuid[] default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int; fallback uuid;
begin
  if not (public.is_head() or current_user in ('postgres', 'supabase_admin')) then raise exception 'Only an Admin can do this'; end if;
  select id into fallback from public.profiles where role = 'admin' and active order by created_at limit 1;
  perform set_config('garuda.skip_audit', 'on', true);
  delete from public.remarks where channel = 'Sales sheet' and (p_lead_ids is null or lead_id = any(p_lead_ids));
  insert into public.remarks(lead_id, author, created_at, channel, outcome, text)
    select h.lead_id, coalesce(l.owner, l.created_by, fallback),
           coalesce(x.at, l.enquiry_date::timestamptz, l.created_at) + interval '12 hours',
           'Sales sheet', case when x.at is null then 'Note' else public.sheet_outcome(x.txt) end, left(x.txt, 2000)
    from public.lead_history h
    join public.leads l on l.id = h.lead_id
    cross join lateral public.sheet_lines(h.text, coalesce(l.enquiry_date, l.created_at::date)) x
    where coalesce(trim(h.text), '') <> '' and (p_lead_ids is null or h.lead_id = any(p_lead_ids))
      and coalesce(l.owner, l.created_by, fallback) is not null;
  get diagnostics n = row_count;
  -- last and first contact from the dated entries
  update public.leads l set
      last_contact_at  = greatest(l.last_contact_at, s.mx),
      first_contact_at = least(coalesce(l.first_contact_at, s.mn), s.mn)
    from (select lead_id, max(created_at) mx, min(created_at) mn from public.remarks
          where channel = 'Sales sheet' and outcome <> 'Note' and (p_lead_ids is null or lead_id = any(p_lead_ids)) group by lead_id) s
    where l.id = s.lead_id and (l.last_contact_at is distinct from greatest(l.last_contact_at, s.mx) or l.first_contact_at is null);
  return jsonb_build_object('remarks', n);
end $$;
alter function public.sync_sheet_remarks(uuid[]) set statement_timeout = '600s';
revoke all on function public.sync_sheet_remarks(uuid[]) from public, anon;
grant execute on function public.sync_sheet_remarks(uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Referrals: who referred this lead, and who on the team brought it in
-- ---------------------------------------------------------------------
alter table public.leads add column if not exists referred_by uuid references public.leads(id) on delete set null;
alter table public.leads add column if not exists referral_by uuid references public.profiles(id) on delete set null;
create index if not exists leads_referred_by on public.leads(referred_by) where referred_by is not null;

-- ---------------------------------------------------------------------
-- 3. In-app notifications (the bell), written by automations and the system
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null default 'info',     -- info / warn / bad / good
  title      text not null,
  body       text default '',
  lead_id    uuid references public.leads(id) on delete cascade,
  link       text default '',
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists notif_user on public.notifications(user_id, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists p_notif_r on public.notifications;
create policy p_notif_r on public.notifications for select using (user_id = public.me() or public.is_head());
drop policy if exists p_notif_u on public.notifications;
create policy p_notif_u on public.notifications for update using (user_id = public.me()) with check (user_id = public.me());
drop policy if exists p_notif_i on public.notifications;
create policy p_notif_i on public.notifications for insert with check (public.is_staff());
drop policy if exists p_notif_d on public.notifications;
create policy p_notif_d on public.notifications for delete using (user_id = public.me() or public.is_head());
grant select, insert, update, delete on public.notifications to authenticated;
grant all on public.notifications to service_role;
do $$ begin execute 'alter publication supabase_realtime add table public.notifications'; exception when others then null; end $$;

-- ---------------------------------------------------------------------
-- 4. Automations: a trigger, conditions and a list of steps per workflow
-- ---------------------------------------------------------------------
create table if not exists public.automations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  active      boolean not null default false,
  trigger     text not null default 'lead_created',
        -- lead_created / stage_changed / became_deal / won / lost / no_contact / followup_overdue / referral_added
  conditions  jsonb not null default '{}'::jsonb,  -- {funnels:[], sources:'text', tiers:[], stages:[], to_stage:'', days:n, hours:n}
  steps       jsonb not null default '[]'::jsonb,  -- [{type:'email'|'whatsapp'|'task'|'notify'|'wait'|'assign'|'tier'|'stage'|'remark', ...}]
  template    text default '',
  runs        int not null default 0,
  created_by  uuid references public.profiles(id) default public.me(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table if not exists public.automation_runs (
  id            uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations(id) on delete cascade,
  lead_id       uuid not null references public.leads(id) on delete cascade,
  step          int not null default 0,
  due_at        timestamptz not null default now(),
  status        text not null default 'Waiting' check (status in ('Waiting','Done','Failed','Stopped')),
  log           jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz,
  unique (automation_id, lead_id)
);
create index if not exists arun_due on public.automation_runs(status, due_at);
alter table public.automations enable row level security;
alter table public.automation_runs enable row level security;
drop policy if exists p_auto_r on public.automations;
create policy p_auto_r on public.automations for select using (public.is_staff());
drop policy if exists p_auto_w on public.automations;
create policy p_auto_w on public.automations for all using (public.is_head()) with check (public.is_head());
drop policy if exists p_arun_r on public.automation_runs;
create policy p_arun_r on public.automation_runs for select using (public.is_head() or public.can_see_lead_id(lead_id));
drop policy if exists p_arun_w on public.automation_runs;
create policy p_arun_w on public.automation_runs for all using (public.is_head()) with check (public.is_head());
grant select, insert, update, delete on public.automations, public.automation_runs to authenticated;
grant all on public.automations, public.automation_runs to service_role;

-- {{name}}, {{first_name}}, {{org}}, {{owner}}, {{course}}, {{phone}} in messages
create or replace function public.auto_fill(p text, l public.leads) returns text language sql stable as $$
  select replace(replace(replace(replace(replace(replace(replace(coalesce(p, ''),
    '{{name}}', coalesce(l.contact_name, l.name, '')),
    '{{first_name}}', split_part(coalesce(nullif(l.contact_name, ''), l.name, ''), ' ', 1)),
    '{{org}}', coalesce(l.org, '')),
    '{{owner}}', coalesce((select full_name from public.profiles where id = l.owner), 'the Garuda team')),
    '{{owner_phone}}', coalesce((select phone from public.profiles where id = l.owner), '')),
    '{{course}}', coalesce(nullif(l.course, 'Not Specified'), nullif(l.sub_category, 'Not Specified'), 'drone training')),
    '{{phone}}', coalesce(l.phone, '')) $$;

-- does this lead match the workflow's conditions?
create or replace function public.auto_match(a public.automations, l public.leads) returns boolean language sql stable as $$
  select (coalesce(jsonb_array_length(a.conditions->'funnels'), 0) = 0 or a.conditions->'funnels' ? l.funnel)
     and (coalesce(a.conditions->>'sources', '') = '' or coalesce(l.source, '') ~* (a.conditions->>'sources'))
     and (coalesce(jsonb_array_length(a.conditions->'tiers'), 0) = 0 or exists (select 1 from jsonb_array_elements_text(a.conditions->'tiers') t where coalesce(l.campaign_tier, '') ilike t || '%'))
     and (coalesce(jsonb_array_length(a.conditions->'stages'), 0) = 0 or a.conditions->'stages' ? l.stage)
$$;

-- start a workflow for a lead (once per lead per workflow)
create or replace function public.auto_start(p_auto uuid, p_lead uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.automation_runs(automation_id, lead_id) values (p_auto, p_lead) on conflict (automation_id, lead_id) do nothing;
end $$;

-- run the due steps; called every few minutes, and straight after a lead event
create or replace function public.run_automations(p_lead uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare r record; a public.automations; l public.leads; s jsonb; n int := 0; i int; done boolean; who uuid; msg text; head uuid; rr uuid;
begin
  perform set_config('garuda.system', 'on', true);
  select id into head from public.profiles where role = 'admin' and active order by created_at limit 1;
  -- time-based triggers: no contact for N days, follow-up overdue by N hours
  if p_lead is null then
    for a in select * from public.automations where active and trigger in ('no_contact', 'followup_overdue') loop
      if a.trigger = 'no_contact' then
        insert into public.automation_runs(automation_id, lead_id)
          select a.id, x.id from public.leads x
          join public.stages st on st.funnel = x.funnel and st.key = x.stage and not st.is_won and not st.is_lost and not st.is_closed
          where public.auto_match(a, x)
            and coalesce(x.last_contact_at, x.allocated_date::timestamptz, x.created_at) < now() - make_interval(days => greatest(coalesce((a.conditions->>'days')::int, 2), 1))
            and coalesce(x.allocated_date::timestamptz, x.created_at) > now() - interval '60 days'
          limit 500
          on conflict do nothing;
      else
        insert into public.automation_runs(automation_id, lead_id)
          select a.id, x.id from public.leads x
          join public.stages st on st.funnel = x.funnel and st.key = x.stage and not st.is_won and not st.is_lost and not st.is_closed
          where public.auto_match(a, x) and x.next_followup_at is not null
            and x.next_followup_at < now() - make_interval(hours => greatest(coalesce((a.conditions->>'hours')::int, 2), 0))
            and x.next_followup_at > now() - interval '14 days'
            and coalesce(x.last_contact_at, '-infinity') < x.next_followup_at
          limit 500
          on conflict do nothing;
      end if;
    end loop;
  end if;

  for r in select * from public.automation_runs where status = 'Waiting' and due_at <= now() and (p_lead is null or lead_id = p_lead) order by due_at limit 300 for update skip locked loop
    select * into a from public.automations where id = r.automation_id;
    select * into l from public.leads where id = r.lead_id;
    if a.id is null or not a.active or l.id is null then
      update public.automation_runs set status = 'Stopped', finished_at = now() where id = r.id; continue;
    end if;
    i := r.step; done := true;
    while i < jsonb_array_length(a.steps) loop
      s := a.steps -> i;
      begin
        if s->>'type' = 'wait' then
          update public.automation_runs set step = i + 1, due_at = now() + make_interval(mins => greatest(coalesce((s->>'minutes')::int, 60), 1)),
            log = log || jsonb_build_array(jsonb_build_object('step', i, 'type', 'wait', 'ok', true, 'msg', 'Waiting ' || coalesce(s->>'minutes', '60') || ' min', 'at', now())) where id = r.id;
          done := false; exit;
        elsif s->>'type' = 'email' then
          if coalesce(l.email, '') ~ '@' and not coalesce(l.opted_out, false) then
            insert into public.email_queue(lead_id, to_email, to_name, category, subject, html, auto_rule, created_by)
              values (l.id, l.email, coalesce(l.contact_name, l.name), 'Follow-up', public.auto_fill(s->>'subject', l),
                      '<p>' || replace(replace(public.auto_fill(s->>'body', l), E'\n\n', '</p><p>'), E'\n', '<br>') || '</p>', 'automation:' || a.id, l.owner);
            msg := 'Email queued to ' || l.email;
          else msg := 'No email address: skipped'; end if;
        elsif s->>'type' = 'whatsapp' then
          who := coalesce(l.owner, head);
          if who is not null and coalesce(l.phone, '') <> '' then
            insert into public.notifications(user_id, kind, title, body, lead_id, link)
              values (who, 'warn', 'Send WhatsApp: ' || coalesce(l.name, ''), public.auto_fill(s->>'text', l), l.id,
                      'https://wa.me/91' || right(regexp_replace(l.phone, '\D', '', 'g'), 10) || '?text=' || replace(replace(replace(public.auto_fill(s->>'text', l), ' ', '%20'), E'\n', '%0A'), '&', '%26'));
            msg := 'WhatsApp ready for ' || coalesce((select full_name from public.profiles where id = who), 'owner');
          else msg := 'No phone: skipped'; end if;
        elsif s->>'type' = 'task' then
          insert into public.tasks(title, kind, lead_id, owner, due_at, auto_rule, created_by)
            values (public.auto_fill(coalesce(s->>'title', 'Call {{name}}'), l), coalesce(s->>'kind', 'Call'), l.id, coalesce(l.owner, head),
                    now() + make_interval(hours => coalesce((s->>'hours')::int, 4)), 'automation', coalesce(l.owner, head));
          update public.leads set next_followup_at = least(coalesce(next_followup_at, 'infinity'), now() + make_interval(hours => coalesce((s->>'hours')::int, 4))) where id = l.id;
          msg := 'Task created';
        elsif s->>'type' = 'notify' then
          for who in select distinct x from unnest(array[case when coalesce(s->>'to', 'owner') in ('owner', 'both') then coalesce(l.owner, head) end,
                                                         case when coalesce(s->>'to', 'owner') in ('head', 'both') then head end]) x where x is not null loop
            insert into public.notifications(user_id, kind, title, body, lead_id) values (who, coalesce(s->>'kind', 'warn'), public.auto_fill(coalesce(s->>'title', a.name), l), public.auto_fill(s->>'text', l), l.id);
          end loop;
          msg := 'Notified';
        elsif s->>'type' = 'assign' then
          if s->>'to' = 'round_robin' then
            select p.id into rr from public.profiles p where p.active and p.role in ('member', 'lead', 'manager') and (coalesce(p.departments, '{}') = '{}' or l.funnel = any(p.departments))
              order by (select count(*) from public.leads x where x.owner = p.id and x.created_at > now() - interval '1 day'), random() limit 1;
          else rr := nullif(s->>'to', '')::uuid; end if;
          if rr is not null then update public.leads set owner = rr where id = l.id; l.owner := rr; msg := 'Assigned'; else msg := 'Nobody to assign'; end if;
        elsif s->>'type' = 'tier' then
          update public.leads set campaign_tier = s->>'value', tier_source = 'automation' where id = l.id; msg := 'Tier set';
        elsif s->>'type' = 'stage' then
          update public.leads set stage = s->>'value' where id = l.id; msg := 'Status set';
        elsif s->>'type' = 'remark' then
          insert into public.remarks(lead_id, author, channel, outcome, text) values (l.id, coalesce(l.owner, head), 'Note', 'Note', public.auto_fill(s->>'text', l));
          msg := 'Note added';
        else msg := 'Unknown step'; end if;
        update public.automation_runs set log = log || jsonb_build_array(jsonb_build_object('step', i, 'type', s->>'type', 'ok', true, 'msg', msg, 'at', now())) where id = r.id;
      exception when others then
        update public.automation_runs set log = log || jsonb_build_array(jsonb_build_object('step', i, 'type', s->>'type', 'ok', false, 'msg', sqlerrm, 'at', now())) where id = r.id;
      end;
      i := i + 1;
    end loop;
    if done then
      update public.automation_runs set step = i, status = 'Done', finished_at = now() where id = r.id;
      update public.automations set runs = runs + 1 where id = a.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.run_automations(uuid) from public, anon;
grant execute on function public.run_automations(uuid) to authenticated;

-- lead events start the matching workflows (imported rows never do)
create or replace function public.auto_on_lead() returns trigger
language plpgsql security definer set search_path = public as $$
declare a public.automations; st_new public.stages; st_old public.stages; ev text[] := '{}'; started boolean := false;
begin
  if new.imported and tg_op = 'INSERT' then return new; end if;
  if pg_trigger_depth() > 2 then return new; end if;
  select * into st_new from public.stages where funnel = new.funnel and key = new.stage;
  if tg_op = 'INSERT' then
    ev := ev || 'lead_created'::text;
    if new.referred_by is not null then ev := ev || 'referral_added'::text; end if;
  else
    if new.stage is distinct from old.stage then
      ev := ev || 'stage_changed'::text;
      select * into st_old from public.stages where funnel = old.funnel and key = old.stage;
      if coalesce(st_new.is_won, false) and not coalesce(st_old.is_won, false) then ev := ev || 'won'::text; end if;
      if coalesce(st_new.is_lost, false) and not coalesce(st_old.is_lost, false) then ev := ev || 'lost'::text; end if;
    end if;
    if coalesce(new.is_deal, false) and not coalesce(old.is_deal, false) then ev := ev || 'became_deal'::text; end if;
  end if;
  if cardinality(ev) = 0 then return new; end if;
  for a in select * from public.automations where active and trigger = any(ev) loop
    if public.auto_match(a, new) and (a.trigger <> 'stage_changed' or coalesce(a.conditions->>'to_stage', '') in ('', new.stage)) then
      perform public.auto_start(a.id, new.id); started := true;
    end if;
  end loop;
  if started then perform public.run_automations(new.id); end if;
  return new;
end $$;
drop trigger if exists trg_auto_on_lead on public.leads;
create trigger trg_auto_on_lead after insert or update of stage, is_deal on public.leads
  for each row execute function public.auto_on_lead();

-- ready-made workflows, switched off until someone turns them on
insert into public.automations(name, trigger, template, conditions, steps)
select * from (values
  ('Welcome a new lead', 'lead_created', 'welcome', '{}'::jsonb,
   '[{"type":"email","subject":"Welcome to Garuda Aerospace, {{first_name}}","body":"Hi {{first_name}},\n\nThank you for your interest in {{course}} with Garuda Aerospace. {{owner}} from our team will call you shortly to understand what you need.\n\nRegards,\nGaruda Aerospace"},{"type":"whatsapp","text":"Hi {{first_name}}, this is {{owner}} from Garuda Aerospace. Thank you for your enquiry about {{course}}. When is a good time to call you?"},{"type":"task","title":"First call: {{name}}","hours":2}]'::jsonb),
  ('Speed to lead: alert if not called in 1 day', 'no_contact', 'speed', '{"days":1}'::jsonb,
   '[{"type":"notify","to":"both","kind":"bad","title":"Not called yet: {{name}}","text":"This lead came in more than a day ago and nobody has called. Call now."}]'::jsonb),
  ('Missed follow-up escalation', 'followup_overdue', 'missed', '{"hours":4}'::jsonb,
   '[{"type":"notify","to":"owner","kind":"bad","title":"Follow-up missed: {{name}}","text":"The follow-up is 4 hours overdue."},{"type":"wait","minutes":1440},{"type":"notify","to":"head","kind":"bad","title":"Still not followed up: {{name}}","text":"The owner has not followed up for a day."}]'::jsonb),
  ('RNR retry: WhatsApp then call again', 'stage_changed', 'rnr', '{"to_stage":"RNR"}'::jsonb,
   '[{"type":"whatsapp","text":"Hi {{first_name}}, we tried calling you about {{course}} at Garuda Aerospace. Reply with a good time and we will call you back."},{"type":"wait","minutes":2880},{"type":"task","title":"Retry call: {{name}}","hours":1}]'::jsonb),
  ('Deal created: proposal and meeting', 'became_deal', 'deal', '{}'::jsonb,
   '[{"type":"task","title":"Send the proposal / quotation to {{name}}","hours":24},{"type":"notify","to":"head","kind":"good","title":"New deal: {{name}}","text":"{{owner}} converted a lead to a deal."}]'::jsonb),
  ('Won: thank-you and onboarding', 'won', 'won', '{}'::jsonb,
   '[{"type":"email","subject":"Welcome aboard, {{first_name}}","body":"Hi {{first_name}},\n\nThank you for choosing Garuda Aerospace. {{owner}} will share the next steps for {{course}} shortly.\n\nRegards,\nGaruda Aerospace"},{"type":"task","title":"Onboarding call: {{name}}","hours":24},{"type":"wait","minutes":10080},{"type":"whatsapp","text":"Hi {{first_name}}, how is your experience with Garuda Aerospace so far? If a friend is interested in drones, send us their name and number and we will take care of them."}]'::jsonb),
  ('Lost: win-back after 30 days', 'lost', 'winback', '{}'::jsonb,
   '[{"type":"wait","minutes":43200},{"type":"whatsapp","text":"Hi {{first_name}}, Garuda Aerospace has new batches for {{course}}. Would you like the dates and fees?"},{"type":"tier","value":"R1 - Win-back"}]'::jsonb),
  ('Referral: thank the referrer, call the friend', 'referral_added', 'referral', '{}'::jsonb,
   '[{"type":"task","title":"Call the referral: {{name}}","hours":4},{"type":"notify","to":"owner","kind":"good","title":"New referral: {{name}}","text":"A client referred {{name}}. Call within 4 hours."}]'::jsonb)
) v(name, trigger, template, conditions, steps)
where not exists (select 1 from public.automations x where x.template = v.template);

-- every 5 minutes (needs the pg_cron extension)
do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobname) from cron.job where jobname = 'garuda-automations';
  perform cron.schedule('garuda-automations', '*/5 * * * *', 'select public.run_automations();');
exception when others then raise notice 'pg_cron not available here: %', sqlerrm; end $$;
