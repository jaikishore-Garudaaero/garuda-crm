-- v60 · 33-point lead report: every lead (follow-ups and deals included) laid out in the management 33-point format,
-- one row per lead, split RPTO / CoE / Others. Runs as the signed-in person, so each person exports only the leads they can see.
-- RPTO enquiries routed to CoE (stage "CoE Other Department" or routed to "CoE / Institutions") are listed under CoE.

create or replace function public.report_33_dept(l public.leads) returns text
language sql immutable as $$
  select case
    when l.funnel = 'CoE' or (l.funnel = 'RPTO' and (l.stage = 'CoE Other Department' or l.routed_dept = 'CoE / Institutions')) then 'CoE'
    when l.funnel = 'RPTO' then 'RPTO'
    else 'Others' end
$$;

create or replace function public.report_33_count() returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_object_agg(d, n), '{}'::jsonb) from (select public.report_33_dept(l) d, count(*) n from public.leads l group by 1) x
$$;

-- one page of rows for a department; each row is the 35 cells B..AJ of the 33 POINTS layout (SI NO filled by the caller)
create or replace function public.report_33(p_dept text, p_offset int default 0, p_limit int default 2000)
returns table (cells text[])
language sql stable set search_path = public as $$
  with base as materialized (
    select l.*, least(coalesce(l.enquiry_date, l.created_at::date), l.created_at::date) as origin
    from public.leads l
    where public.report_33_dept(l) = p_dept
    order by coalesce(l.enquiry_date, l.created_at::date) desc, l.lead_no desc nulls last, l.id
    offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 5000)
  ),
  rk as (
    select b.id, b.owner, count(r.id) as n_rem, max(r.created_at) as last_rem,
           string_agg(distinct p.full_name, ', ') filter (where p.role in ('admin', 'clevel', 'manager') and r.author is distinct from b.owner and r.created_at > now() - interval '90 days') as hods,
           (select string_agg(to_char(x.created_at at time zone 'Asia/Kolkata', 'DD-Mon-YY') || ': ' || left(regexp_replace(x.text, '\s+', ' ', 'g'), 160), ' | ' order by x.created_at desc)
              from (select created_at, text from public.remarks where lead_id = b.id order by created_at desc limit 3) x) as last3
    from base b left join public.remarks r on r.lead_id = b.id left join public.profiles p on p.id = r.author
    group by b.id, b.owner
  ),
  vk as (
    select b.id, count(v.id) as n_meet, max(coalesce(v.checkin_at, v.planned_at)) as last_meet,
           bool_or(v.purpose ilike '%demo%' or v.purpose ilike '%poc%') as demo
    from base b left join public.visits v on v.lead_id = b.id group by b.id
  ),
  won as materialized (
    select id, right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) as ph, lower(nullif(email, '')) as em, coalesce(won_at, created_at) as at
    from public.leads where stage ilike 'closed won%' or won_at is not null
  ),
  rep as (
    select b.id, exists (
      select 1 from won w where w.id <> b.id and w.at < b.created_at
        and ((length(w.ph) = 10 and w.ph = b.ph) or (w.em is not null and w.em = lower(b.email)))
    ) as repeat
    from (select id, created_at, email, right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) as ph from base) b
  )
  select array[
    to_char(b.origin, 'DD-Mon-YYYY'),                                                                  -- 2 date of origin
    coalesce(nullif(b.contact_name, ''), b.name),                                                       -- 3 name
    coalesce(b.phone, ''),                                                                              -- 4 phone
    coalesce(b.email, ''),                                                                              -- 5 email
    coalesce(i.name, nullif(b.org, ''), case when p_dept = 'RPTO' then 'Individual' else b.name end),   -- 6 organisation
    concat_ws(', ', nullif(coalesce(b.city, i.city), ''), nullif(coalesce(b.state, i.state), '')),      -- 7 location
    case when p_dept = 'RPTO' then coalesce(nullif(nullif(b.course, ''), 'Not Specified'), 'RPC drone pilot training (course not specified)')
         else coalesce(nullif(nullif(b.sub_category, ''), 'Not Specified'), case when b.funnel = 'RPTO' then 'Routed from RPTO enquiry' else 'Not specified' end) end, -- 8 segment
    coalesce(nullif(b.client_type, ''), case when p_dept = 'RPTO' and b.funnel = 'RPTO' and b.stage <> 'CoE Other Department' then 'Individual (pilot aspirant)'
                                             when coalesce(i.kind, '') <> '' then initcap(i.kind) else 'Institution' end), -- 9 customer profile
    coalesce(nullif(split_part(b.source, ' - ', 1), ''), 'Not recorded'),                               -- 10 lead origin
    coalesce(nullif(split_part(b.source, ' - ', 2), ''), nullif(b.source, ''), ''),                    -- 10A avenue
    left(coalesce(nullif(b.notes, ''), nullif(b.latest_remark, ''), ''), 500),                         -- 10B requests / remarks
    b.stage || coalesce(' · ' || nullif(b.temperature, ''), '') || case when b.is_deal then ' · Deal' else '' end, -- 11 status
    case when p_dept = 'RPTO' then 'Drone Service (pilot training)'
         when b.sub_category ilike 'UAV Lab%' then 'Drone Sale (UAV lab)'
         when b.funnel = 'EST' or b.sub_category ilike 'RPTO Establishment%' then 'Drone Service (RPTO establishment)'
         else 'Drone Service (' || coalesce(nullif(nullif(b.sub_category, ''), 'Not Specified'), 'CoE partnership') || ')' end, -- 12 nature
    case when coalesce(b.value, 0) > 0 then round(b.value)::text when coalesce(b.unit_price, 0) > 0 then round(b.unit_price * greatest(coalesce(b.qty, 1), 1))::text else '' end, -- 13 value
    coalesce(nullif(round(b.qty), 0), 1)::text,                                                              -- 14 quantity
    coalesce(sb.full_name, cb.full_name, case when b.imported then 'Imported from the sales sheet' end, ''), -- 15 assigned by
    concat_ws(' · ', coalesce(ow.full_name, nullif(b.owner_name, ''), 'Unassigned'), p_dept),          -- 16 assigned to
    case when rk.hods is not null then 'Yes (' || rk.hods || ')' else 'No' end,                         -- 17 HOD / CXO
    (coalesce(b.call_attempts, 0) + rk.n_rem + vk.n_meet)::text,                                        -- 18 times reached
    coalesce(to_char(greatest(b.last_contact_at::date, rk.last_rem::date, b.last_followup, vk.last_meet::date), 'DD-Mon-YYYY'), ''), -- 19 last follow-up
    coalesce((select case when d = 1 then '1 day' else d || ' days' end from (select greatest(0, greatest(b.last_contact_at::date, rk.last_rem::date, b.last_followup, vk.last_meet::date) - b.origin) d) z where d is not null), ''), -- 20 nurtured
    case when b.stage ilike 'closed won%' or b.stage ilike 'mou signed%' or b.won_at is not null then 'Yes' else 'No' end, -- 21 sale yet
    case when b.stage ilike 'closed won%' or b.won_at is not null then ''
         else coalesce(nullif(b.lost_reason, ''), case b.stage when 'RNR' then 'Not reachable (ringing, no response)' when 'Duplicate' then 'Duplicate enquiry'
              when 'Other Department' then 'Belongs to another department' when 'CoE Other Department' then 'Routed to CoE'
              when 'Future Follow Up' then 'Interested later (future follow-up)' when 'Closed Lost' then 'Lost (reason not recorded)' else 'In progress' end) end, -- 22 reason
    case when rep.repeat then 'Yes (repeat customer)' else 'No' end,                                    -- 23 previous customer
    '', '', '',                                                                                          -- 24-26 84 data points: not tracked in the CRM
    case when vk.n_meet > 0 then 'Yes (' || vk.n_meet || ', last ' || to_char(vk.last_meet, 'DD-Mon-YY') || ')'
         when b.meeting_date is not null then 'Yes (' || to_char(b.meeting_date, 'DD-Mon-YY') || ')' else 'No' end, -- 27 meeting
    case when vk.demo then 'Yes (demo planned / done)' else '' end,                                     -- 28 demo / POC
    case when b.stage ilike 'closed won%' or b.won_at is not null then '100%'
         when b.stage in ('Closed Lost', 'Duplicate', 'Other Department') then '0%'
         else case b.temperature when 'Hot' then '75%' when 'Warm' then '50%' when 'Cold' then '20%' when 'Nurture' then '10%' when 'Drop' then '0%' else '' end end, -- 29 probability
    case when b.stage ilike 'closed%' or b.won_at is not null then 'Closed'
         when b.expected_close is not null then to_char(b.expected_close, 'DD-Mon-YYYY')
         else case b.temperature when 'Hot' then 'Within 30 days' when 'Warm' then '1 to 3 months' when 'Cold' then '3 to 6 months' when 'Nurture' then '6+ months' else '' end end, -- 30 timeline
    case when coalesce(b.value, 0) > 0 and b.temperature in ('Hot', 'Warm', 'Cold', 'Nurture') and not (b.stage ilike 'closed%')
         then round(b.value * case b.temperature when 'Hot' then 0.75 when 'Warm' then 0.5 when 'Cold' then 0.2 else 0.1 end)::text
         when coalesce(b.value, 0) > 0 and (b.stage ilike 'closed won%' or b.won_at is not null) then round(b.value)::text else '' end, -- 31 revenue expected
    left(coalesce(rk.last3, nullif(b.latest_update, ''), nullif(b.latest_remark, ''), ''), 1000),       -- 32 regular updates
    case when b.stage ilike 'closed won%' or b.won_at is not null then 'Closed (won)'
         when b.stage ilike 'closed lost%' or b.stage in ('Duplicate', 'Other Department') then 'Closed (lost)' else 'Open' end -- 33 closed?
  ] as cells
  from base b
  join rk on rk.id = b.id join vk on vk.id = b.id join rep on rep.id = b.id
  left join public.institutions i on i.id = b.institution_id
  left join public.profiles ow on ow.id = b.owner
  left join public.profiles sb on sb.id = b.sourced_by
  left join public.profiles cb on cb.id = b.created_by
  order by b.origin desc, b.lead_no desc nulls last, b.id
$$;

revoke execute on function public.report_33(text, int, int), public.report_33_count() from public, anon;
grant execute on function public.report_33(text, int, int), public.report_33_count() to authenticated;
create index if not exists remarks_lead_created on public.remarks (lead_id, created_at desc);
create index if not exists visits_lead on public.visits (lead_id);
