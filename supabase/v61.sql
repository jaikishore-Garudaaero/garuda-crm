-- v61 · QR lead capture. Each QR campaign (Marketing → QR Campaigns) gets a short code and a printable QR that opens
-- the public form q.html?c=CODE. A submission becomes a CRM lead tagged with the campaign (source "QR Code"), routed to
-- the right department by the service chosen, given an owner and a first-call task, and shown live in the CRM.
-- Referrals: the referrer's name and phone are kept on the lead, and linked to the referrer's own lead when found.

alter table public.mkt_campaigns add column if not exists qr_code text;
create unique index if not exists mkt_campaigns_qr_code on public.mkt_campaigns (lower(qr_code)) where qr_code is not null;
alter table public.leads add column if not exists referrer text not null default '';
alter table public.leads add column if not exists enquiry_for text not null default '';
create index if not exists leads_mkt_campaign on public.leads (mkt_campaign_id, created_at desc) where mkt_campaign_id is not null;

-- the services people can pick on the QR form, and where each one goes in the CRM (edit in Settings if needed)
insert into public.settings (key, value) values ('qr_services', '[
  {"label":"Drone Pilot Training (DGCA RPC: Small / Medium)","dept":"RPTO","course":""},
  {"label":"Train the Trainer (Instructor course)","dept":"RPTO","course":"Train the Trainer (TTT)"},
  {"label":"Bulk Training for a college or company","dept":"CoE","sub":"RPTO Admissions (Bulk)","org":true},
  {"label":"Drone Lab / Centre of Excellence (CoE)","dept":"CoE","sub":"UAV Lab - Type TBC","org":true},
  {"label":"CoE Partnership / MoU","dept":"CoE","sub":"Collaboration / MoU","org":true},
  {"label":"RPTO Establishment (start a training centre)","dept":"EST","sub":"RPTO Establishment","org":true},
  {"label":"Workshop / Dronistaan Day","dept":"CoE","sub":"Workshop","org":true},
  {"label":"Industrial Visit","dept":"CoE","sub":"IV (Industrial Visit)","org":true},
  {"label":"Internship","dept":"CoE","sub":"Internship"},
  {"label":"Drone courses (Assembly, Programming, Mapping, AI)","dept":"CoE","sub":"Course / Curriculum"},
  {"label":"Buy a drone (Kisan Agri Drone, Droni)","dept":"OTH"},
  {"label":"Drone services (spraying, survey, inspection)","dept":"OTH","org":true},
  {"label":"Dealership / Franchise","dept":"OTH","org":true},
  {"label":"Something else","dept":"OTH"}
]'::jsonb) on conflict (key) do nothing;
update public.settings set value = value || '["QR Code"]'::jsonb where key = 'sources' and not (value ? 'QR Code');

-- what the public form shows for a campaign code (no lead data)
create or replace function public.qr_info(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', m.name, 'active', m.status not in ('Completed', 'Paused', 'Stopped'),
           'services', coalesce((select value from public.settings where key = 'qr_services'), '[]'::jsonb))
  from public.mkt_campaigns m where lower(m.qr_code) = lower(trim(p_code)) limit 1
$$;

create or replace function public.qr_submit(p_code text, p_name text, p_phone text, p_email text, p_services text[],
  p_org text default '', p_city text default '', p_ref_name text default '', p_ref_phone text default '', p_note text default '', p_hp text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m public.mkt_campaigns; svc jsonb; first jsonb; dept text; individual boolean; v_stage text; v_owner uuid;
  p10 text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  r10 text := right(regexp_replace(coalesce(p_ref_phone, ''), '\D', '', 'g'), 10);
  em text := lower(trim(coalesce(p_email, ''))); nm text := left(trim(coalesce(p_name, '')), 120);
  v_org text := left(trim(coalesce(p_org, '')), 160); dup public.leads; v_ref uuid; lid uuid; ref_txt text; label text; picked text[];
begin
  if coalesce(p_hp, '') <> '' then return jsonb_build_object('ok', true); end if;          -- bots fill the hidden field
  select * into m from public.mkt_campaigns where lower(qr_code) = lower(trim(p_code)) limit 1;
  if m.id is null then raise exception 'This QR code is not active.'; end if;
  if m.status in ('Completed', 'Paused', 'Stopped') then raise exception 'This campaign has ended.'; end if;
  if length(nm) < 2 then raise exception 'Please enter your name.'; end if;
  if length(p10) <> 10 or p10 !~ '^[6-9]' then raise exception 'Please enter a valid 10-digit mobile number.'; end if;
  if em <> '' and em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Please check the email address.'; end if;
  if coalesce(array_length(p_services, 1), 0) = 0 then raise exception 'Please choose what you are looking for.'; end if;
  -- flood guard: at most 60 submissions a minute per campaign, and one per phone per campaign per hour
  if (select count(*) from public.leads where mkt_campaign_id = m.id and created_at > now() - interval '1 minute') >= 60 then
    raise exception 'Too many submissions right now. Please try again in a minute.'; end if;
  if exists (select 1 from public.leads where mkt_campaign_id = m.id and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = p10 and created_at > now() - interval '1 hour')
     or exists (select 1 from public.remarks r join public.leads l on l.id = r.lead_id where right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 10) = p10
                and r.text like 'QR scan · ' || m.name || '%' and r.created_at > now() - interval '1 hour') then
    return jsonb_build_object('ok', true, 'again', true); end if;

  svc := coalesce((select value from public.settings where key = 'qr_services'), '[]'::jsonb);
  picked := array(select left(trim(x), 80) from unnest(p_services) x where trim(x) <> '' limit 8);
  select e into first from jsonb_array_elements(svc) e where e->>'label' = picked[1] limit 1;
  dept := coalesce(first->>'dept', 'RPTO');
  if not exists (select 1 from public.departments where code = dept and active) then dept := 'RPTO'; end if;
  individual := coalesce((select has_admissions from public.departments where code = dept), true);
  label := array_to_string(picked, ', ');
  ref_txt := nullif(concat_ws(' · ', nullif(left(trim(coalesce(p_ref_name, '')), 120), ''), nullif(r10, '')), '');
  if length(r10) = 10 then
    select id into v_ref from public.leads where right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = r10 order by created_at limit 1;
  end if;

  -- already a lead: note the new interest on it and warm it up, instead of a duplicate
  select * into dup from public.leads l
   where right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 10) = p10 or (em <> '' and lower(l.email) = em)
   order by l.created_at desc limit 1;
  if dup.id is not null then
    insert into public.remarks (lead_id, author, channel, outcome, text)
    values (dup.id, coalesce(dup.owner, public.next_owner(dup.funnel)), 'Note', 'Note',
            'QR scan · ' || m.name || ': interested in ' || label || coalesce('. Referred by ' || ref_txt, '') || coalesce('. ' || nullif(left(p_note, 300), ''), ''));
    update public.leads set temperature = 'Hot', ai_dirty = true, touched_at = now(),
           referrer = case when referrer = '' then coalesce(ref_txt, '') else referrer end,
           referred_by = coalesce(referred_by, v_ref) where id = dup.id;
    if dup.owner is not null then
      insert into public.notifications (user_id, kind, title, body, lead_id, link)
      values (dup.owner, 'lead', 'QR re-enquiry: ' || dup.name, m.name || ' · ' || label, dup.id, '#lead/' || dup.id);
    end if;
    return jsonb_build_object('ok', true, 'existing', true);
  end if;

  select key into v_stage from public.stages where funnel = dept and kind = 'lead' order by ord limit 1;
  v_owner := public.next_owner(dept);
  insert into public.leads (funnel, name, contact_name, phone, email, city, org, source, mkt_campaign_id, utm, stage, temperature,
                            owner, created_by, course, sub_category, enquiry_for, also_interested, referrer, referred_by, notes,
                            consent_email, enquiry_date)
  values (dept, case when individual or v_org = '' then nm else v_org end, case when individual or v_org = '' then '' else nm end,
          p10, em, left(trim(coalesce(p_city, '')), 80), v_org, 'QR Code', m.id, jsonb_build_object('campaign', m.qr_code, 'medium', 'qr'),
          coalesce(v_stage, 'New'), 'Warm', v_owner, v_owner,
          case when individual then coalesce(nullif(first->>'course', ''), '') else '' end,
          case when individual then '' else coalesce(nullif(first->>'sub', ''), 'Not Specified') end,
          label, array_to_string(picked[2:], ', '), coalesce(ref_txt, ''), v_ref,
          'QR scan · ' || m.name || ': ' || label || coalesce('. Referred by ' || ref_txt, '') || coalesce('. ' || nullif(left(p_note, 300), ''), ''),
          em <> '', current_date)
  returning id into lid;
  insert into public.tasks (title, kind, lead_id, owner, due_at, priority, auto_rule, created_by)
  values ('First call: ' || nm || ' (QR · ' || m.name || ')', 'Call', lid, v_owner, now() + interval '2 hours', 'High', 'new_lead', v_owner);
  if v_owner is not null then
    insert into public.notifications (user_id, kind, title, body, lead_id, link)
    values (v_owner, 'lead', 'New QR lead: ' || nm, m.name || ' · ' || label, lid, '#lead/' || lid);
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.qr_info(text), public.qr_submit(text, text, text, text, text[], text, text, text, text, text, text) from public;
grant execute on function public.qr_info(text), public.qr_submit(text, text, text, text, text[], text, text, text, text, text, text) to anon, authenticated;
