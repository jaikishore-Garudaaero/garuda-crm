-- =====================================================================
-- Garuda RPTO & CoE CRM  ·  Supabase schema
-- Run once in Supabase → SQL Editor (as the project owner).
-- Order: this file, then seed.sql, then (optional) migration.sql, cron.sql
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. People and roles
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key default gen_random_uuid(),   -- the person (exists before they first sign in)
  auth_id       uuid unique,                                  -- their Supabase sign-in account, linked at first sign-in
  full_name     text not null default '',
  email         text not null default '',
  phone         text default '',
  role          text not null default 'pending' check (role in (
                  'pending','head','admin','developer','coe_field','coe_caller','coe_closer',
                  'rpto_telecaller','rpto_presenter','rpto_counsellor','shared_exec','finance')),
  vertical      text not null default 'Both' check (vertical in ('RPTO','CoE','Both')),
  email_access  boolean not null default false,   -- may send email marketing from the CRM
  territory     text default '',
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- the people directory exists before anyone signs in, so a profile is linked to its sign-in account by auth_id
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles alter column id set default gen_random_uuid();
alter table public.profiles add column if not exists auth_id uuid unique;
update public.profiles p set auth_id = p.id where p.auth_id is null and exists (select 1 from auth.users u where u.id = p.id);
-- the signed-in person's profile id (every rule in this database uses this, never auth.uid() directly)
create or replace function public.me() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.profiles where auth_id = auth.uid() and active
$$;

-- first user to sign up becomes Business Head; everyone else waits for approval
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from public.profiles;
  insert into public.profiles(id, email, full_name, role, email_access)
  values (new.id, coalesce(new.email,''),
          coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email,''),'@',1)),
          case when n = 0 then 'head' else 'pending' end,
          n = 0);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- role helpers (security definer so RLS policies can call them cheaply)
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = public.me() and active), 'none')
$$;
create or replace function public.is_head() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() in ('head','admin')
$$;
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() not in ('none','pending')
$$;
create or replace function public.my_email_access() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select email_access from public.profiles where id = public.me() and active), false)
$$;
create or replace function public.sees_all() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() in ('head','admin','shared_exec','finance')
$$;

-- ---------------------------------------------------------------------
-- 2. Settings and reference data
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

create table if not exists public.stages (
  funnel   text not null check (funnel in ('RPTO','CoE')),
  key      text not null,
  ord      int  not null,
  prob     int  not null,        -- forecast weight %
  is_won   boolean not null default false,
  is_lost  boolean not null default false,
  is_closed boolean not null default false,   -- closed but not lost (Duplicate, Other Department): not counted as lost or open
  primary key (funnel, key)
);
alter table public.stages add column if not exists is_closed boolean not null default false;

create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  funnel      text not null check (funnel in ('RPTO','CoE')),
  vertical    text not null,                 -- UAV Lab / RPTO Establishment / Academy / Training / Certification
  category    text not null default '',
  name        text not null,
  unit        text not null default 'unit',
  price       numeric(12,2) not null default 0,   -- list price, ex-GST
  gst_rate    numeric(7,4)  not null default 18,
  tier25      numeric(12,2),                 -- bulk price at 25+
  tier50      numeric(12,2),                 -- bulk price at 50+
  share_pct   numeric(5,2) default 100,      -- Garuda share of revenue
  duration    text default '',
  min_qty     int default 1,
  notes       text default '',
  active      boolean not null default true,
  sort        int not null default 100
);

create table if not exists public.product_items (     -- lab bill of materials
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  name        text not null,
  qty         numeric(10,2) not null default 1,
  unit_price  numeric(12,2) not null default 0,
  gst_rate    numeric(5,2) not null default 18,
  sort        int not null default 0
);

-- ---------------------------------------------------------------------
-- 3. Institutions and contacts (one master record per college)
-- ---------------------------------------------------------------------
create table if not exists public.institutions (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  kind             text default 'Engineering',  -- Engineering / Agri / Polytechnic / University / School / Government / Corporate / Other
  university       text default '',
  city             text default '',
  state            text default 'Tamil Nadu',
  address          text default '',
  website          text default '',
  lat              double precision,
  lng              double precision,
  geofence_m       int not null default 300,
  student_strength int,
  departments      text default '',
  territory        text default '',
  owner            uuid references public.profiles(id),
  score_access     int default 0 check (score_access between 0 and 5),
  score_strength   int default 0 check (score_strength between 0 and 5),
  score_fit        int default 0 check (score_fit between 0 and 5),
  score_budget     int default 0 check (score_budget between 0 and 5),
  score_site       int default 0 check (score_site between 0 and 5),
  score_timing     int default 0 check (score_timing between 0 and 5),
  strategic        boolean not null default false,
  parent_id        uuid references public.institutions(id),   -- multi-campus groups
  notes            text default '',
  created_by       uuid references public.profiles(id) default public.me(),
  created_at       timestamptz not null default now()
);
create unique index if not exists institutions_name_city on public.institutions (lower(name), lower(coalesce(city,'')));

create table if not exists public.contacts (
  id               uuid primary key default gen_random_uuid(),
  institution_id   uuid references public.institutions(id) on delete cascade,
  name             text not null,
  designation      text default '',
  role_type        text default 'Other',   -- Chairman / Trustee / Principal / Director / Dean / HoD / TPO / Procurement / Finance / Other
  phone            text default '',
  email            text default '',
  consent_email    boolean not null default false,
  consent_whatsapp boolean not null default false,
  opted_out        boolean not null default false,
  notes            text default '',
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. Campaigns (needed before leads)
-- ---------------------------------------------------------------------
create table if not exists public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  channel       text not null default 'Email',  -- Email / WhatsApp / Google Ads / Meta Ads / LinkedIn / Webinar / Event / Referral / SEO / Other
  purpose       text not null default 'Marketing', -- Marketing / Newsletter / Training update / Internal update / Lead generation / Follow-up
  status        text not null default 'Draft',  -- Draft / Scheduled / Active / Paused / Completed
  funnel        text default 'Both',
  budget        numeric(12,2) default 0,
  spend         numeric(12,2) default 0,
  start_date    date,
  end_date      date,
  utm_campaign  text default '',
  external_id   text default '',                -- Google / Meta campaign id
  sender        text default '',                -- from-address alias used for email campaigns
  owner         uuid references public.profiles(id) default public.me(),
  notes         text default '',
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. Leads / opportunities
-- ---------------------------------------------------------------------
create sequence if not exists public.lead_no_seq start 1001;

create table if not exists public.leads (
  id               uuid primary key default gen_random_uuid(),
  lead_no          text unique not null default ('L-' || nextval('public.lead_no_seq')),
  funnel           text not null check (funnel in ('RPTO','CoE')),
  name             text not null,                 -- candidate name, or opportunity title for CoE
  institution_id   uuid references public.institutions(id),
  contact_id       uuid references public.contacts(id),
  contact_name     text default '',
  designation      text default '',
  phone            text default '',
  email            text default '',
  city             text default '',
  state            text default '',
  source           text default '',
  campaign_id      uuid references public.campaigns(id),
  utm              jsonb default '{}'::jsonb,
  external_id      text unique,                   -- ad platform lead id (dedupe)
  product_id       uuid references public.products(id),
  qty              numeric(10,2) not null default 1,
  unit_price       numeric(12,2) not null default 0,    -- ex-GST
  discount_pct     numeric(5,2)  not null default 0,
  gst_rate         numeric(7,4)  not null default 18,
  share_pct        numeric(5,2)  not null default 100,
  value            numeric(14,2) generated always as (round(qty * unit_price * (1 - discount_pct/100), 2)) stored,  -- ex-GST
  stage            text not null,
  temperature      text default 'Warm' check (temperature in ('Hot','Warm','Cold','Nurture')),
  owner            uuid references public.profiles(id),
  sourced_by       uuid references public.profiles(id),
  closed_by        uuid references public.profiles(id),
  support_by       uuid references public.profiles(id),
  expected_close   date,
  won_at           timestamptz,
  lost_reason      text default '',
  po_ref           text default '',
  -- RPTO candidate details
  age              int,
  education        text default '',
  existing_rpc     boolean default false,
  eligible         text default 'Unknown' check (eligible in ('Unknown','Eligible','Not eligible')),
  preferred_centre text default '',
  documents        jsonb not null default '{}'::jsonb,   -- {"aadhaar":true,"10th":true,"photo":false}
  batch_id         uuid,
  certificate      text default 'Not started',          -- Not started / In training / Completed / Issued
  -- consent
  consent_email    boolean not null default false,
  consent_whatsapp boolean not null default false,
  opted_out        boolean not null default false,
  -- activity markers (maintained by triggers)
  first_contact_at timestamptz,
  last_contact_at  timestamptz,
  next_followup_at timestamptz,
  fee_disclosed    boolean not null default false,
  -- Claude assessment
  ai_score         int,
  ai_band          text,
  ai_summary       text,
  ai_next_action   text,
  ai_channel       text,
  ai_scored_at     timestamptz,
  ai_dirty         boolean not null default true,      -- new activity since last score
  notes            text default '',
  created_by       uuid references public.profiles(id) default public.me(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists leads_owner on public.leads(owner);
create index if not exists leads_stage on public.leads(funnel, stage);
create index if not exists leads_phone on public.leads(phone);
create index if not exists leads_email on public.leads(lower(email));

-- ---------------------------------------------------------------------
-- 6. Remarks (call log) – timestamp is fixed, edits are kept
-- ---------------------------------------------------------------------
create table if not exists public.remarks (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid not null references public.leads(id) on delete cascade,
  author           uuid not null references public.profiles(id) default public.me(),
  created_at       timestamptz not null default now(),
  channel          text not null default 'Outbound call', -- Outbound call / Inbound call / WhatsApp / Email / Visit / Meeting / Note
  outcome          text not null default 'Note',          -- No answer / Busy / Interested / Follow-up / Counselled / Not eligible / Not interested / Converted / Note
  text             text not null default '',
  temperature      text,
  fee_disclosed    boolean not null default false,
  price_quoted     numeric(12,2),
  next_followup_at timestamptz,
  edited           boolean not null default false
);
create index if not exists remarks_lead on public.remarks(lead_id, created_at desc);
create index if not exists remarks_author on public.remarks(author, created_at desc);

create table if not exists public.remark_edits (
  id         uuid primary key default gen_random_uuid(),
  remark_id  uuid not null references public.remarks(id) on delete cascade,
  old_text   text,
  old_outcome text,
  edited_by  uuid references public.profiles(id) default public.me(),
  edited_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 7. Price disclosures (enquired value)
-- ---------------------------------------------------------------------
create table if not exists public.price_disclosures (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.leads(id) on delete cascade,
  product_id    uuid references public.products(id),
  qty           numeric(10,2) not null default 1,
  unit_price    numeric(12,2) not null default 0,
  discount_pct  numeric(5,2) not null default 0,
  amount        numeric(14,2) not null default 0,   -- ex-GST quoted
  gst_rate      numeric(7,4) not null default 18,
  response      text default '',                    -- Accepted / Thinking / Too costly / Comparing / Other
  disclosed_by  uuid not null references public.profiles(id) default public.me(),
  disclosed_at  timestamptz not null default now()
);
create index if not exists pd_lead on public.price_disclosures(lead_id);

-- ---------------------------------------------------------------------
-- 8. Payments – sales claims, finance verifies
-- ---------------------------------------------------------------------
create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.leads(id) on delete cascade,
  amount        numeric(14,2) not null,       -- received, incl. GST
  amount_ex     numeric(14,2) not null,       -- ex-GST portion
  paid_on       date not null default current_date,
  mode          text default 'Bank transfer',
  reference     text default '',
  milestone     text default '',              -- Advance 40% / Delivery 40% / Final 20% / Full fee
  status        text not null default 'Claimed' check (status in ('Claimed','Verified','Rejected','Refunded')),
  claimed_by    uuid references public.profiles(id) default public.me(),
  claimed_at    timestamptz not null default now(),
  verified_by   uuid references public.profiles(id),
  verified_at   timestamptz,
  notes         text default ''
);
create index if not exists payments_lead on public.payments(lead_id);

-- ---------------------------------------------------------------------
-- 9. Tasks
-- ---------------------------------------------------------------------
create table if not exists public.tasks (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  kind           text not null default 'Follow-up',  -- Call / Follow-up / Meeting / Visit / Proposal / Payment / Document / Renewal / Escalation / Other
  lead_id        uuid references public.leads(id) on delete cascade,
  institution_id uuid references public.institutions(id) on delete cascade,
  owner          uuid references public.profiles(id) default public.me(),
  due_at         timestamptz not null default now(),
  priority       text not null default 'Normal' check (priority in ('Low','Normal','High','Urgent')),
  status         text not null default 'Open' check (status in ('Open','Done','Cancelled')),
  auto_rule      text,                                -- set when created by automation
  notes          text default '',
  created_by     uuid references public.profiles(id) default public.me(),
  created_at     timestamptz not null default now(),
  done_at        timestamptz
);
create index if not exists tasks_owner on public.tasks(owner, status, due_at);

-- ---------------------------------------------------------------------
-- 10. Training calendar: batches and events (workshops, webinars, visits...)
-- ---------------------------------------------------------------------
create table if not exists public.batches (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  product_id  uuid references public.products(id),
  course      text not null,              -- Small / Medium / TTT / Top-up ...
  centre      text not null,              -- Chennai / Assam / Madhya Pradesh / Jaipur
  start_date  date not null,
  end_date    date not null,
  capacity    int  not null default 20,
  trainer     text default '',
  status      text not null default 'Planned', -- Planned / Open / Full / Running / Completed / Cancelled
  notes       text default '',
  created_at  timestamptz not null default now()
);
alter table public.leads drop constraint if exists leads_batch_fk;
alter table public.leads add constraint leads_batch_fk foreign key (batch_id) references public.batches(id) on delete set null;

create table if not exists public.events (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null default 'Workshop', -- Dronistaan Day / Workshop / FDP / Webinar / Industrial visit / Demo / Awareness talk / Elective / Other
  title          text not null,
  institution_id uuid references public.institutions(id),
  lead_id        uuid references public.leads(id) on delete set null,
  campaign_id    uuid references public.campaigns(id),
  start_at       timestamptz not null,
  end_at         timestamptz,
  location       text default '',
  owner          uuid references public.profiles(id) default public.me(),
  status         text not null default 'Planned', -- Planned / Confirmed / Done / Cancelled
  capacity       int,
  cost           numeric(12,2) default 0,
  notes          text default '',
  created_at     timestamptz not null default now()
);

create table if not exists public.event_attendees (      -- webinar / event registrations
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references public.events(id) on delete cascade,
  lead_id        uuid references public.leads(id) on delete cascade,
  name           text default '',
  phone          text default '',
  email          text default '',
  segment        text default 'RPTO',   -- RPTO / CoE
  registered_at  timestamptz not null default now(),
  attended       boolean not null default false,
  qualified      boolean not null default false,
  handed_over_to uuid references public.profiles(id),
  handed_over_at timestamptz,
  outcome        text default ''
);

-- ---------------------------------------------------------------------
-- 11. Field visits (geo check-in)
-- ---------------------------------------------------------------------
create table if not exists public.visits (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid references public.institutions(id),
  lead_id         uuid references public.leads(id) on delete set null,
  owner           uuid references public.profiles(id) default public.me(),
  purpose         text default 'Discovery',  -- Discovery / Qualified meeting / Proposal discussion / Site assessment / Negotiation / Event coordination / Account expansion
  planned_at      timestamptz,
  checkin_at      timestamptz,
  checkin_lat     double precision,
  checkin_lng     double precision,
  checkin_acc_m   double precision,
  distance_m      double precision,
  verified        boolean not null default false,
  checkout_at     timestamptz,
  mom             text default '',
  outcome         text default '',
  next_action     text default '',
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 12. Daily EOD reports
-- ---------------------------------------------------------------------
create table if not exists public.eod_reports (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) default public.me(),
  report_date   date not null default current_date,
  auto          jsonb not null default '{}'::jsonb,   -- metrics computed from the CRM at submission
  manual        jsonb not null default '{}'::jsonb,   -- fields the person typed
  plan_next     text default '',
  blockers      text default '',
  submitted_at  timestamptz not null default now(),
  unique (user_id, report_date)
);

-- ---------------------------------------------------------------------
-- 13. Email marketing
-- ---------------------------------------------------------------------
create table if not exists public.email_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  category   text not null default 'Marketing', -- Newsletter / Marketing / Training update / Internal update / Follow-up
  subject    text not null,
  html       text not null,
  active     boolean not null default true,
  created_by uuid references public.profiles(id) default public.me(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_queue (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid references public.campaigns(id) on delete set null,
  template_id     uuid references public.email_templates(id) on delete set null,
  lead_id         uuid references public.leads(id) on delete set null,
  contact_id      uuid references public.contacts(id) on delete set null,
  to_email        text not null,
  to_name         text default '',
  category        text not null default 'Marketing',
  subject         text not null,
  html            text not null,
  sender          text default '',          -- alias on the marketing mailbox
  status          text not null default 'Queued' check (status in ('Queued','Sending','Sent','Failed','Skipped')),
  scheduled_at    timestamptz not null default now(),
  sent_at         timestamptz,
  gmail_thread_id text,
  opened_at       timestamptz,
  clicked_at      timestamptz,
  replied_at      timestamptz,
  bounced_at      timestamptz,
  error           text,
  auto_rule       text,
  created_by      uuid references public.profiles(id) default public.me(),
  created_at      timestamptz not null default now()
);
create index if not exists eq_status on public.email_queue(status, scheduled_at);
create index if not exists eq_lead on public.email_queue(lead_id);

create table if not exists public.unsubscribes (
  email      text primary key,
  reason     text default '',
  created_at timestamptz not null default now()
);

-- automation rules (lead age → email / task)
create table if not exists public.automation_rules (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  active       boolean not null default false,
  funnel       text default 'Both',
  trigger      text not null default 'lead_age',  -- lead_age / no_contact_days / stage_idle_days
  min_days     int not null default 0,
  max_days     int not null default 9999,
  stages       text[] default '{}',               -- empty = any open stage
  action       text not null default 'queue_email', -- queue_email / create_task
  template_id  uuid references public.email_templates(id),
  task_title   text default '',
  once         boolean not null default true,      -- fire once per lead
  created_at   timestamptz not null default now()
);
create table if not exists public.automation_log (
  rule_id   uuid references public.automation_rules(id) on delete cascade,
  lead_id   uuid references public.leads(id) on delete cascade,
  fired_at  timestamptz not null default now(),
  primary key (rule_id, lead_id)
);

-- ---------------------------------------------------------------------
-- 14. Ad platform intake log and AI
-- ---------------------------------------------------------------------
create table if not exists public.intake_log (
  id          uuid primary key default gen_random_uuid(),
  platform    text not null,        -- google / meta / website / other
  payload     jsonb,
  lead_id     uuid references public.leads(id) on delete set null,
  status      text not null default 'ok',
  error       text,
  received_at timestamptz not null default now()
);

create table if not exists public.ai_runs (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null,      -- score / draft / brief / ask / digest
  lead_id        uuid references public.leads(id) on delete set null,
  model          text,
  input_tokens   int,
  output_tokens  int,
  result         jsonb,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now()
);

create table if not exists public.ai_insights (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null default 'daily_digest',
  for_date   date not null default current_date,
  content    jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 15. CoE projects, complaints, targets, audit
-- ---------------------------------------------------------------------
create table if not exists public.projects (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid references public.leads(id) on delete set null,
  institution_id uuid references public.institutions(id),
  name           text not null,
  owner          uuid references public.profiles(id),
  status         text not null default 'Handover', -- Handover / Site readiness / Procurement / Dispatch / Installation / Training / Launched / Accepted / On hold
  start_date     date default current_date,
  target_date    date,
  milestones     jsonb not null default '[]'::jsonb, -- [{name, due, done_at, evidence}]
  checklist      jsonb not null default '{}'::jsonb,  -- {contract:true, po:true, advance:false, site:false ...}
  accepted_at    timestamptz,
  renewal_date   date,
  notes          text default '',
  created_at     timestamptz not null default now()
);

create table if not exists public.complaints (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid references public.leads(id) on delete set null,
  institution_id uuid references public.institutions(id),
  raised_by     uuid references public.profiles(id) default public.me(),
  category      text default 'Commercial',  -- Safety / Compliance / Commercial / Training / Product / Other
  severity      text not null default 'Medium' check (severity in ('Low','Medium','High','Critical')),
  description   text not null,
  status        text not null default 'Open' check (status in ('Open','Escalated','Resolved','Closed')),
  escalated_to  uuid references public.profiles(id),
  escalated_at  timestamptz,
  closure_notes text default '',
  created_at    timestamptz not null default now(),
  closed_at     timestamptz
);

create table if not exists public.targets (
  id        uuid primary key default gen_random_uuid(),
  month     date not null,                       -- first day of month
  user_id   uuid references public.profiles(id),  -- null = team target
  vertical  text not null default 'All',
  amount    numeric(14,2) not null default 0,     -- revenue target ex-GST
  unique (month, user_id, vertical)
);

create table if not exists public.audit_log (
  id         bigserial primary key,
  table_name text not null,
  row_id     uuid,
  action     text not null,
  changed_by uuid default public.me(),
  changed_at timestamptz not null default now(),
  diff       jsonb
);

-- =====================================================================
-- TRIGGERS
-- =====================================================================

-- keep updated_at, flag AI re-score, record stage changes in the audit log
create or replace function public.leads_before_update() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if new.stage is distinct from old.stage then
    new.ai_dirty := true;
  end if;
  return new;
end $$;
drop trigger if exists trg_leads_bu on public.leads;
create trigger trg_leads_bu before update on public.leads
  for each row execute function public.leads_before_update();

-- stage gates from the SOPs
create or replace function public.check_stage_gate() returns trigger
language plpgsql security definer set search_path = public as $$
declare st record; has_fee boolean; has_paid boolean;
begin
  if tg_op = 'UPDATE' and new.stage is not distinct from old.stage then return new; end if;
  select * into st from public.stages where funnel = new.funnel and key = new.stage;
  if not found then raise exception 'Unknown stage "%" for funnel %', new.stage, new.funnel; end if;

  if st.is_won and new.won_at is null then new.won_at := now(); end if;
  if st.is_won and new.closed_by is null then new.closed_by := coalesce(public.me(), new.owner); end if;
  if st.is_lost and coalesce(new.lost_reason,'') = '' then
    raise exception 'Add a lost reason before moving to Lost';
  end if;

  if new.funnel = 'RPTO' and st.ord >= (select ord from public.stages where funnel='RPTO' and key='Counselled') and not st.is_lost then
    has_fee := new.fee_disclosed or exists (select 1 from public.price_disclosures where lead_id = new.id);
    if not has_fee then raise exception 'Record the fee disclosure (price + GST) before marking Counselled'; end if;
  end if;
  if new.funnel = 'RPTO' and st.is_won then
    has_paid := exists (select 1 from public.payments where lead_id = new.id and status = 'Verified');
    if not has_paid and public.me() is not null and not public.is_head() then
      raise exception 'A finance-verified payment is needed before Payment received';
    end if;
  end if;
  if new.funnel = 'CoE' and new.stage in ('Proposal','Negotiation') and coalesce(new.unit_price,0) = 0 then
    raise exception 'Add the product and quoted value before moving to %', new.stage;
  end if;
  if new.funnel = 'CoE' and st.is_won and public.me() is not null and coalesce(new.po_ref,'') = ''
     and not exists (select 1 from public.payments where lead_id = new.id and status in ('Claimed','Verified')) then
    raise exception 'Add the PO / contract reference or an advance before marking Contracted';
  end if;
  return new;
end $$;
drop trigger if exists trg_leads_gate on public.leads;
create trigger trg_leads_gate before insert or update of stage on public.leads
  for each row execute function public.check_stage_gate();

-- audit trail for leads and payments
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare d jsonb := '{}'::jsonb; k text;
begin
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
drop trigger if exists trg_audit_leads on public.leads;
create trigger trg_audit_leads after insert or update or delete on public.leads for each row execute function public.audit_row();
drop trigger if exists trg_audit_payments on public.payments;
create trigger trg_audit_payments after insert or update or delete on public.payments for each row execute function public.audit_row();

-- remarks: fixed timestamp + author, edits kept, lead activity markers updated
create or replace function public.remarks_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.created_at := old.created_at;
  new.author     := old.author;
  new.lead_id    := old.lead_id;
  if new.text is distinct from old.text or new.outcome is distinct from old.outcome then
    insert into public.remark_edits(remark_id, old_text, old_outcome) values (old.id, old.text, old.outcome);
    new.edited := true;
  end if;
  return new;
end $$;
drop trigger if exists trg_remarks_bu on public.remarks;
create trigger trg_remarks_bu before update on public.remarks
  for each row execute function public.remarks_before_update();

create or replace function public.remarks_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.created_at := coalesce(new.created_at, now());
  update public.leads set
    first_contact_at = coalesce(first_contact_at, case when new.outcome <> 'Note' then new.created_at end),
    last_contact_at  = case when new.outcome <> 'Note' then new.created_at else last_contact_at end,
    next_followup_at = coalesce(new.next_followup_at, next_followup_at),
    fee_disclosed    = fee_disclosed or new.fee_disclosed,
    temperature      = coalesce(new.temperature, temperature),
    ai_dirty         = true
  where id = new.lead_id;
  -- a follow-up date on a remark becomes a task for the lead owner
  if new.next_followup_at is not null then
    update public.tasks set status = 'Done', done_at = now()
      where lead_id = new.lead_id and status = 'Open' and kind in ('Call','Follow-up') and due_at <= now() + interval '1 day';
    insert into public.tasks(title, kind, lead_id, owner, due_at, auto_rule, created_by)
      select 'Follow up: ' || l.name, 'Follow-up', l.id, coalesce(l.owner, new.author), new.next_followup_at, 'remark_followup', new.author
      from public.leads l where l.id = new.lead_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_remarks_ai on public.remarks;
create trigger trg_remarks_ai after insert on public.remarks
  for each row execute function public.remarks_after_insert();

-- price disclosure marks fee disclosed
create or replace function public.pd_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.leads set fee_disclosed = true, ai_dirty = true where id = new.lead_id;
  return new;
end $$;
drop trigger if exists trg_pd_ai on public.price_disclosures;
create trigger trg_pd_ai after insert on public.price_disclosures
  for each row execute function public.pd_after_insert();

-- only finance / head may verify payments
create or replace function public.payments_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if public.me() is not null and new.status <> 'Claimed' and public.my_role() not in ('finance','head','admin','developer') then
      new.status := 'Claimed';
    end if;
    if new.status = 'Verified' then new.verified_by := public.me(); new.verified_at := coalesce(new.verified_at, now()); end if;
    return new;
  end if;
  if public.me() is null then return new; end if;   -- server / SQL editor
  if new.status is distinct from old.status then
    if public.my_role() not in ('finance','head','admin','developer') then
      raise exception 'Only Finance can verify or reject a payment';
    end if;
    if new.status = 'Verified' then new.verified_by := public.me(); new.verified_at := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_payments_guard on public.payments;
create trigger trg_payments_guard before insert or update on public.payments
  for each row execute function public.payments_guard();

-- unsubscribes block marketing email everywhere
create or replace function public.unsub_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.leads    set opted_out = true, consent_email = false where lower(email) = lower(new.email);
  update public.contacts set opted_out = true, consent_email = false where lower(email) = lower(new.email);
  update public.email_queue set status = 'Skipped', error = 'Unsubscribed'
    where lower(to_email) = lower(new.email) and status = 'Queued' and category <> 'Internal update';
  return new;
end $$;
drop trigger if exists trg_unsub on public.unsubscribes;
create trigger trg_unsub after insert on public.unsubscribes
  for each row execute function public.unsub_after_insert();

-- email queue: only people with email access may queue; unsubscribed addresses are skipped
create or replace function public.email_queue_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.me() is not null and not public.my_email_access() then
    raise exception 'You do not have email marketing access';
  end if;
  if new.category <> 'Internal update' and exists (select 1 from public.unsubscribes u where lower(u.email) = lower(new.to_email)) then
    new.status := 'Skipped'; new.error := 'Unsubscribed';
  end if;
  return new;
end $$;
drop trigger if exists trg_eq_guard on public.email_queue;
create trigger trg_eq_guard before insert on public.email_queue
  for each row execute function public.email_queue_guard();

-- reply to a marketing email → task for the owner
create or replace function public.email_reply_task() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.replied_at is not null and old.replied_at is null and new.lead_id is not null then
    insert into public.tasks(title, kind, lead_id, owner, due_at, priority, auto_rule)
      select 'Email reply from ' || l.name || ': respond', 'Follow-up', l.id, l.owner, now(), 'High', 'email_reply'
      from public.leads l where l.id = new.lead_id;
    update public.leads set ai_dirty = true where id = new.lead_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_eq_reply on public.email_queue;
create trigger trg_eq_reply after update of replied_at on public.email_queue
  for each row execute function public.email_reply_task();

-- =====================================================================
-- SERVER FUNCTIONS
-- =====================================================================

-- round-robin owner for new leads (used by the ads intake function)
create or replace function public.next_owner(p_funnel text) returns uuid
language plpgsql security definer set search_path = public as $$
declare roles text[]; pick uuid;
begin
  roles := case when p_funnel = 'RPTO' then array['rpto_telecaller','rpto_presenter'] else array['coe_caller'] end;
  select p.id into pick
  from public.profiles p
  left join lateral (select max(l.created_at) as last_at from public.leads l where l.owner = p.id) x on true
  where p.active and p.role = any(roles)
  order by x.last_at nulls first, p.created_at
  limit 1;
  if pick is null then
    select id into pick from public.profiles where active and role in ('head','admin') order by created_at limit 1;
  end if;
  return pick;
end $$;

-- hourly SLA sweep: overdue hot leads and uncontacted new leads escalate to the Business Head
create or replace function public.run_sla_checks() returns int
language plpgsql security definer set search_path = public as $$
declare sla_hours int; n int := 0; head uuid;
begin
  sla_hours := coalesce((select (value->>'first_contact_hours')::int from public.settings where key = 'sla'), 2);
  select id into head from public.profiles where active and role = 'head' order by created_at limit 1;

  insert into public.tasks(title, kind, lead_id, owner, due_at, priority, auto_rule)
  select 'SLA breached – no first contact: ' || l.name, 'Escalation', l.id, head, now(), 'Urgent', 'sla_first_contact'
  from public.leads l join public.stages s on s.funnel = l.funnel and s.key = l.stage
  where l.first_contact_at is null and not s.is_won and not s.is_lost and not s.is_closed
    and l.created_at < now() - make_interval(hours => sla_hours)
    and not exists (select 1 from public.tasks t where t.lead_id = l.id and t.auto_rule = 'sla_first_contact');
  get diagnostics n = row_count;

  insert into public.tasks(title, kind, lead_id, owner, due_at, priority, auto_rule)
  select 'Hot lead follow-up overdue: ' || l.name, 'Escalation', l.id, head, now(), 'High', 'sla_hot_overdue'
  from public.leads l
  where l.temperature = 'Hot' and l.next_followup_at < now() - interval '1 day'
    and not exists (select 1 from public.tasks t where t.lead_id = l.id and t.auto_rule = 'sla_hot_overdue' and t.status = 'Open');
  return n;
end $$;

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
create or replace function public.can_see_lead(l public.leads) returns boolean
language sql stable security definer set search_path = public as $$
  select public.sees_all()
      or l.owner = public.me() or l.sourced_by = public.me() or l.created_by = public.me()
      or l.closed_by = public.me() or l.support_by = public.me()
      or (l.funnel = 'RPTO' and public.my_role() in ('rpto_counsellor','rpto_presenter'))
      or (l.funnel = 'CoE'  and public.my_role() in ('coe_closer'))
      or (l.funnel = 'CoE'  and public.my_role() = 'coe_field' and l.institution_id in
            (select id from public.institutions i where i.owner = public.me()))
$$;
create or replace function public.can_see_lead_id(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.leads l where l.id = p and public.can_see_lead(l))
$$;

do $$ declare t text; begin
  for t in select unnest(array['profiles','settings','stages','products','product_items','institutions','contacts',
    'campaigns','leads','remarks','remark_edits','price_disclosures','payments','tasks','batches','events','event_attendees',
    'visits','eod_reports','email_templates','email_queue','unsubscribes','automation_rules','automation_log','intake_log',
    'ai_runs','ai_insights','projects','complaints','targets','audit_log']) loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- drop old policies so the script can be re-run
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- profiles
create policy p_profiles_read  on public.profiles for select using (public.me() is not null);
create policy p_profiles_self  on public.profiles for update using (id = public.me())
  with check (id = public.me() and role = public.my_role() and email_access = public.my_email_access());
create policy p_profiles_head  on public.profiles for all using (public.is_head()) with check (public.is_head());

-- reference data: everyone signed in reads, head edits
create policy p_settings_r on public.settings for select using (public.is_staff());
create policy p_settings_w on public.settings for all using (public.is_head()) with check (public.is_head());
create policy p_stages_r   on public.stages   for select using (public.is_staff());
create policy p_stages_w   on public.stages   for all using (public.is_head()) with check (public.is_head());
create policy p_products_r on public.products for select using (public.is_staff());
create policy p_products_w on public.products for all using (public.is_head()) with check (public.is_head());
create policy p_items_r    on public.product_items for select using (public.is_staff());
create policy p_items_w    on public.product_items for all using (public.is_head()) with check (public.is_head());
create policy p_targets_r  on public.targets for select using (public.is_staff());
create policy p_targets_w  on public.targets for all using (public.is_head()) with check (public.is_head());

-- institutions & contacts: shared master data for staff
create policy p_inst_r on public.institutions for select using (public.is_staff());
create policy p_inst_i on public.institutions for insert with check (public.is_staff());
create policy p_inst_u on public.institutions for update using (public.is_staff());
create policy p_inst_d on public.institutions for delete using (public.is_head());
create policy p_cont_r on public.contacts for select using (public.is_staff());
create policy p_cont_i on public.contacts for insert with check (public.is_staff());
create policy p_cont_u on public.contacts for update using (public.is_staff());
create policy p_cont_d on public.contacts for delete using (public.is_head());

-- leads
create policy p_leads_r on public.leads for select using (public.can_see_lead(leads));
create policy p_leads_i on public.leads for insert with check (public.is_staff());
create policy p_leads_u on public.leads for update using (public.can_see_lead(leads));
create policy p_leads_d on public.leads for delete using (public.is_head());

-- remarks: insert own, update own text (history kept), nobody deletes except head
create policy p_rem_r on public.remarks for select using (public.can_see_lead_id(lead_id));
create policy p_rem_i on public.remarks for insert with check (author = public.me() and public.can_see_lead_id(lead_id));
create policy p_rem_u on public.remarks for update using (author = public.me() or public.is_head());
create policy p_rem_d on public.remarks for delete using (public.is_head());
create policy p_remed_r on public.remark_edits for select using (public.is_staff());
create policy p_remed_i on public.remark_edits for insert with check (public.is_staff());

-- price disclosures
create policy p_pd_r on public.price_disclosures for select using (public.can_see_lead_id(lead_id));
create policy p_pd_i on public.price_disclosures for insert with check (disclosed_by = public.me() and public.can_see_lead_id(lead_id));
create policy p_pd_d on public.price_disclosures for delete using (public.is_head());

-- payments
create policy p_pay_r on public.payments for select using (public.can_see_lead_id(lead_id));
create policy p_pay_i on public.payments for insert with check (public.can_see_lead_id(lead_id));
create policy p_pay_u on public.payments for update using (public.my_role() in ('finance','head','admin','developer') or (claimed_by = public.me() and status = 'Claimed'));
create policy p_pay_d on public.payments for delete using (public.is_head());

-- tasks: own, or anything for head
create policy p_tasks_r on public.tasks for select using (owner = public.me() or created_by = public.me() or public.sees_all());
create policy p_tasks_i on public.tasks for insert with check (public.is_staff());
create policy p_tasks_u on public.tasks for update using (owner = public.me() or created_by = public.me() or public.sees_all());
create policy p_tasks_d on public.tasks for delete using (created_by = public.me() or public.is_head());

-- calendar
create policy p_batch_r on public.batches for select using (public.is_staff());
create policy p_batch_w on public.batches for all using (public.my_role() in ('head','admin','developer','shared_exec','rpto_counsellor')) with check (public.my_role() in ('head','admin','developer','shared_exec','rpto_counsellor'));
create policy p_ev_r on public.events for select using (public.is_staff());
create policy p_ev_i on public.events for insert with check (public.is_staff());
create policy p_ev_u on public.events for update using (owner = public.me() or public.sees_all());
create policy p_ev_d on public.events for delete using (owner = public.me() or public.is_head());
create policy p_att_r on public.event_attendees for select using (public.is_staff());
create policy p_att_w on public.event_attendees for all using (public.is_staff()) with check (public.is_staff());

-- visits
create policy p_vis_r on public.visits for select using (owner = public.me() or public.sees_all() or public.my_role() = 'coe_closer');
create policy p_vis_i on public.visits for insert with check (owner = public.me() or public.sees_all());
create policy p_vis_u on public.visits for update using (owner = public.me() or public.is_head());

-- EOD
create policy p_eod_r on public.eod_reports for select using (user_id = public.me() or public.sees_all());
create policy p_eod_i on public.eod_reports for insert with check (user_id = public.me());
create policy p_eod_u on public.eod_reports for update using (user_id = public.me() and report_date >= current_date - 1);

-- email marketing
create policy p_tpl_r on public.email_templates for select using (public.is_staff());
create policy p_tpl_w on public.email_templates for all using (public.is_head() or public.my_email_access())
  with check (public.is_head() or public.my_email_access());
create policy p_eq_r on public.email_queue for select using (created_by = public.me() or public.sees_all() or public.can_see_lead_id(lead_id));
create policy p_eq_i on public.email_queue for insert with check (public.my_email_access());
create policy p_eq_u on public.email_queue for update using (public.is_head() or (created_by = public.me() and status = 'Queued'));
create policy p_unsub_r on public.unsubscribes for select using (public.is_staff());
create policy p_unsub_i on public.unsubscribes for insert with check (public.is_staff());
create policy p_rules_r on public.automation_rules for select using (public.is_staff());
create policy p_rules_w on public.automation_rules for all using (public.is_head()) with check (public.is_head());
create policy p_alog_r on public.automation_log for select using (public.is_head());

-- campaigns
create policy p_camp_r on public.campaigns for select using (public.is_staff());
create policy p_camp_i on public.campaigns for insert with check (public.is_staff());
create policy p_camp_u on public.campaigns for update using (owner = public.me() or public.is_head());
create policy p_camp_d on public.campaigns for delete using (public.is_head());

-- intake + AI
create policy p_intake_r on public.intake_log for select using (public.is_head());
create policy p_ai_r on public.ai_runs for select using (public.is_head() or created_by = public.me());
create policy p_ins_r on public.ai_insights for select using (public.is_staff());

-- projects, complaints
create policy p_proj_r on public.projects for select using (public.is_staff());
create policy p_proj_w on public.projects for all using (public.sees_all() or owner = public.me()) with check (public.is_staff());
create policy p_comp_r on public.complaints for select using (raised_by = public.me() or public.sees_all() or escalated_to = public.me());
create policy p_comp_i on public.complaints for insert with check (public.is_staff());
create policy p_comp_u on public.complaints for update using (public.sees_all() or escalated_to = public.me());

-- audit: head only
create policy p_audit_r on public.audit_log for select using (public.is_head() or (table_name = 'leads' and public.can_see_lead_id(row_id)));

-- =====================================================================
-- REALTIME (so dashboards update live)
-- =====================================================================
do $$ declare t text; begin
  for t in select unnest(array['leads','remarks','payments','tasks','price_disclosures','email_queue','visits','eod_reports']) loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when others then null;
    end;
  end loop;
end $$;


-- =====================================================================
-- V2 · developer role and full access, business task sheet, weekly
--      review meetings, daily MOM, comments, approval matrix, email
--      marketing (lists, contacts, campaigns, sequences, clicks),
--      webinar registrations with payment, GST categories
-- =====================================================================

-- ---------------------------------------------------------------------
-- Roles: Business Head, Admin and Developer have full access
-- ---------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in (
  'pending','head','admin','developer','coe_field','coe_caller','coe_closer',
  'rpto_telecaller','rpto_presenter','rpto_counsellor','shared_exec','finance',
  'clevel','manager','lead','member'));   -- v4 roles too, so re-running this file on a v4 database works

create or replace function public.is_head() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() in ('head','admin','developer')
$$;
create or replace function public.sees_all() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() in ('head','admin','developer','shared_exec','finance')
$$;
create or replace function public.my_email_access() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select email_access or role in ('head','admin','developer') from public.profiles where id = public.me() and active), false)
$$;
-- set by server functions that write on the system's behalf (notifications, approvals)
create or replace function public.is_system() returns boolean
language sql stable as $$ select coalesce(current_setting('garuda.system', true), '') = 'on' $$;

create or replace function public.html_esc(t text) returns text
language sql immutable as $$ select replace(replace(replace(coalesce(t,''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') $$;

-- head does not work leads: new leads fall back to the shared executive, then the head
create or replace function public.next_owner(p_funnel text) returns uuid
language plpgsql security definer set search_path = public as $$
declare roles text[]; pick uuid;
begin
  roles := case when p_funnel = 'RPTO' then array['rpto_telecaller','rpto_presenter'] else array['coe_caller'] end;
  select p.id into pick
  from public.profiles p
  left join lateral (select max(l.created_at) as last_at from public.leads l where l.owner = p.id) x on true
  where p.active and p.role = any(roles)
  order by x.last_at nulls first, p.created_at
  limit 1;
  if pick is null then
    select id into pick from public.profiles where active and role = 'shared_exec' order by created_at limit 1;
  end if;
  if pick is null then
    select id into pick from public.profiles where active and role in ('head','admin') order by created_at limit 1;
  end if;
  return pick;
end $$;

-- hot-lead SLA is now in hours
create or replace function public.run_sla_checks() returns int
language plpgsql security definer set search_path = public as $$
declare sla_hours int; hot_hours int; n int := 0; head uuid;
begin
  sla_hours := coalesce((select (value->>'first_contact_hours')::int from public.settings where key = 'sla'), 2);
  hot_hours := coalesce((select (value->>'hot_followup_hours')::int from public.settings where key = 'sla'), 24);
  select id into head from public.profiles where active and role = 'head' order by created_at limit 1;

  insert into public.tasks(title, kind, lead_id, owner, due_at, priority, auto_rule)
  select 'SLA breached – no first contact: ' || l.name, 'Escalation', l.id, head, now(), 'Urgent', 'sla_first_contact'
  from public.leads l join public.stages s on s.funnel = l.funnel and s.key = l.stage
  where l.first_contact_at is null and not s.is_won and not s.is_lost and not s.is_closed
    and l.created_at < now() - make_interval(hours => sla_hours)
    and not exists (select 1 from public.tasks t where t.lead_id = l.id and t.auto_rule = 'sla_first_contact');
  get diagnostics n = row_count;

  insert into public.tasks(title, kind, lead_id, owner, due_at, priority, auto_rule)
  select 'Hot lead follow-up overdue: ' || l.name, 'Escalation', l.id, head, now(), 'High', 'sla_hot_overdue'
  from public.leads l
  where l.temperature = 'Hot' and l.next_followup_at < now() - make_interval(hours => hot_hours)
    and not exists (select 1 from public.tasks t where t.lead_id = l.id and t.auto_rule = 'sla_hot_overdue' and t.status = 'Open');
  return n;
end $$;

-- system-written emails (notifications, reminders) skip the email-access check
create or replace function public.email_queue_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.me() is not null and not public.is_system() and not public.my_email_access() then
    raise exception 'You do not have email marketing access';
  end if;
  if new.category <> 'Internal update' and exists (select 1 from public.unsubscribes u where lower(u.email) = lower(new.to_email)) then
    new.status := 'Skipped'; new.error := 'Unsubscribed';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Price book: product lines and GST categories
-- ---------------------------------------------------------------------
alter table public.products add column if not exists line text not null default '';
alter table public.products add column if not exists gst_category text not null default '';
alter table public.product_items add column if not exists gst_category text not null default '';

create or replace function public.apply_gst_rates() returns int
language plpgsql security definer set search_path = public as $$
declare cats jsonb; c jsonb; n int := 0; k int;
begin
  if public.me() is not null and not public.is_head() then
    raise exception 'Only the Business Head, Admin or Developer can change GST rates';
  end if;
  select value->'categories' into cats from public.settings where key = 'gst';
  for c in select * from jsonb_array_elements(coalesce(cats, '[]'::jsonb)) loop
    continue when coalesce(c->>'rate', '') = '';
    update public.products set gst_rate = (c->>'rate')::numeric where gst_category = c->>'key';
    get diagnostics k = row_count; n := n + k;
    update public.product_items set gst_rate = (c->>'rate')::numeric where gst_category = c->>'key';
  end loop;
  -- labs carry a blended rate from their line items
  update public.products p set gst_rate = round(x.g / nullif(x.ex, 0) * 100, 4)
  from (select product_id, sum(qty * unit_price) ex, sum(qty * unit_price * gst_rate / 100) g from public.product_items group by product_id) x
  where x.product_id = p.id and p.gst_category = 'lab';
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Business task sheet (columns follow the CoE / RPTO task sheet)
-- ---------------------------------------------------------------------
create sequence if not exists public.business_task_seq start 1;
create table if not exists public.business_tasks (
  id               uuid primary key default gen_random_uuid(),
  sno              int not null default nextval('public.business_task_seq'),
  task             text not null,
  sub_task         text not null default '',
  vertical         text not null default 'Both',
  assigned_on      date default current_date,               -- date assigned / feedback given
  action_taken     text not null default '',
  metrics          text not null default '',                -- metrics (total no. of …), start to end
  turnaround       text not null default '',                -- time (turn around time)
  links            text not null default '',
  completion_pct   int not null default 0 check (completion_pct between 0 and 100),
  deadline         date,
  recurrence       text not null default 'None' check (recurrence in ('None','Daily','Weekly','Monthly','TBC')),
  duration         text not null default '',                -- duration in days / weeks / months
  allocation       text not null default 'Self' check (allocation in ('Self','Team')),
  assignees        uuid[] not null default '{}',
  assignee_text    text not null default '',                -- names outside the CRM (Finance, IT, Rithika …)
  support_required text not null default '',                -- support needed from management, CXOs, other HoDs
  budget_tmc       text not null default '',
  money_commitment text not null default '',
  revenue_impact   text not null default '',                -- revenue / impact towards 365 Cr in 365 days
  approved_by      text not null default '',
  remarks          text not null default '',
  problems         text not null default '',
  issue            text not null default '',
  solution         text not null default '',
  status           text not null default 'New' check (status in ('New','Open','In progress','Recurring','Management support needed','Closed')),
  priority         text not null default 'Normal' check (priority in ('Low','Normal','High','Urgent')),
  lead_id          uuid references public.leads(id) on delete set null,
  created_by       uuid references public.profiles(id) default public.me(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  closed_at        timestamptz
);

create table if not exists public.review_meetings (
  id           uuid primary key default gen_random_uuid(),
  meeting_date date not null default current_date,
  title        text not null default '',
  chaired_by   uuid references public.profiles(id) default public.me(),
  attendees    uuid[] not null default '{}',
  notes        text not null default '',
  status       text not null default 'Open' check (status in ('Open','Closed')),
  created_at   timestamptz not null default now(),
  closed_at    timestamptz
);

create table if not exists public.review_items (
  id             uuid primary key default gen_random_uuid(),
  meeting_id     uuid not null references public.review_meetings(id) on delete cascade,
  task_id        uuid not null references public.business_tasks(id) on delete cascade,
  status_before  text,
  status_after   text,
  completion_pct int,
  remarks        text not null default '',
  next_action    text not null default '',
  due            date,
  updated_by     uuid references public.profiles(id) default public.me(),
  updated_at     timestamptz not null default now(),
  unique (meeting_id, task_id)
);

create or replace function public.business_tasks_bu() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if new.status = 'Closed' and old.status <> 'Closed' then new.closed_at := now(); new.completion_pct := greatest(new.completion_pct, 100); end if;
  if new.status <> 'Closed' then new.closed_at := null; end if;
  return new;
end $$;
drop trigger if exists trg_bt_bu on public.business_tasks;
create trigger trg_bt_bu before update on public.business_tasks for each row execute function public.business_tasks_bu();

-- a remark or status set in a review meeting updates the task itself
create or replace function public.review_item_apply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.business_tasks set
    status = coalesce(nullif(new.status_after, ''), status),
    completion_pct = coalesce(new.completion_pct, completion_pct),
    remarks = case when coalesce(new.remarks, '') <> '' then new.remarks else remarks end,
    deadline = coalesce(new.due, deadline)
  where id = new.task_id;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_ri_apply on public.review_items;
create trigger trg_ri_apply before insert or update on public.review_items
  for each row when (new.status_after is not null or new.remarks <> '' or new.completion_pct is not null)
  execute function public.review_item_apply();

-- start a review: every task that is not closed is carried into the meeting
create or replace function public.start_review(p_date date default current_date, p_title text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare mid uuid;
begin
  if public.me() is not null and not public.is_staff() then raise exception 'Not allowed'; end if;
  insert into public.review_meetings(meeting_date, title, chaired_by)
    values (p_date, coalesce(p_title, 'Weekly review · ' || to_char(p_date, 'DD Mon YYYY')), public.me())
    returning id into mid;
  insert into public.review_items(meeting_id, task_id, status_before)
    select mid, id, status from public.business_tasks where status <> 'Closed';
  return mid;
end $$;

-- ---------------------------------------------------------------------
-- Daily MOM (Business Head's daily report) and comments / remarks
-- ---------------------------------------------------------------------
create table if not exists public.daily_mom (
  id            uuid primary key default gen_random_uuid(),
  report_date   date not null default current_date,
  author        uuid not null references public.profiles(id) default public.me(),
  category      text not null,      -- Interdepartmental / Client & vendor / Intra-departmental / Project / Product / Escalation / Boss EOD download
  what_we_did   text not null default '',
  involved      uuid[] not null default '{}',
  involved_text text not null default '',
  sort          int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (report_date, author, category)
);

create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  entity     text not null check (entity in ('mom','eod','task','approval','review','webinar')),
  entity_id  uuid not null,
  author     uuid not null references public.profiles(id) default public.me(),
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists comments_entity on public.comments(entity, entity_id);

alter table public.eod_reports add column if not exists remarks text not null default '';

-- ---------------------------------------------------------------------
-- Approval matrix: queries and approvals raised on leads
-- ---------------------------------------------------------------------
create table if not exists public.approval_rules (
  id                 uuid primary key default gen_random_uuid(),
  request_type       text not null,       -- Discount / Free seat / Price exception / Proposal / Payment terms / Refund / Revenue share / Rate card / Other
  label              text not null default '',
  min_value          numeric,             -- e.g. discount % or deal value range this rule covers
  max_value          numeric,
  approver_role      text,
  approver_user      uuid references public.profiles(id),
  second_role        text,                -- optional second signature
  second_user        uuid references public.profiles(id),
  escalate_role      text,                -- after the SLA is missed
  escalate_user      uuid references public.profiles(id),
  sla_hours          int not null default 8,
  remind_every_hours int not null default 4,
  active             boolean not null default true,
  sort               int not null default 100
);

create sequence if not exists public.approval_no_seq start 101;
create table if not exists public.approvals (
  id               uuid primary key default gen_random_uuid(),
  req_no           text unique not null default ('A-' || nextval('public.approval_no_seq')),
  kind             text not null default 'Approval' check (kind in ('Approval','Query')),
  request_type     text not null default 'Other',
  lead_id          uuid references public.leads(id) on delete set null,
  title            text not null,
  details          text not null default '',
  requested        jsonb not null default '{}'::jsonb,   -- {"discount_pct":8} / {"unit_price":18000} / {"value":1500000}
  status           text not null default 'Pending' check (status in ('Pending','Approved','Rejected','Answered','Withdrawn','Escalated')),
  level            int not null default 1,
  levels           int not null default 1,
  rule_id          uuid references public.approval_rules(id) on delete set null,
  requested_by     uuid references public.profiles(id) default public.me(),
  assigned_to      uuid references public.profiles(id),
  second_approver  uuid references public.profiles(id),
  escalate_to      uuid references public.profiles(id),
  due_at           timestamptz,
  reminders        int not null default 0,
  last_reminder_at timestamptz,
  decided_by       uuid references public.profiles(id),
  decided_at       timestamptz,
  decision_note    text not null default '',
  history          jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists approvals_assigned on public.approvals(assigned_to, status);

create or replace function public.approver_for(p_role text, p_user uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(p_user, (select id from public.profiles where active and role = p_role order by created_at limit 1))
$$;

create or replace function public.approvals_bi() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; val numeric;
begin
  new.requested_by := coalesce(new.requested_by, public.me());
  new.status := 'Pending'; new.level := 1; new.levels := 1;
  begin
    val := nullif(coalesce(new.requested->>'value', new.requested->>'discount_pct', new.requested->>'amount'), '')::numeric;
  exception when others then val := null;
  end;
  if new.kind = 'Approval' then
    select * into r from public.approval_rules
     where active and request_type = new.request_type
       and (min_value is null or val is null or val >= min_value)
       and (max_value is null or val is null or val <= max_value)
     order by sort, min_value nulls first limit 1;
    if found then
      new.rule_id := r.id;
      new.assigned_to := coalesce(new.assigned_to, public.approver_for(r.approver_role, r.approver_user));
      new.second_approver := public.approver_for(r.second_role, r.second_user);
      new.escalate_to := public.approver_for(r.escalate_role, r.escalate_user);
      if new.second_approver is not null and new.second_approver is distinct from new.assigned_to then new.levels := 2; end if;
      new.due_at := now() + make_interval(hours => coalesce(r.sla_hours, 8));
    end if;
  end if;
  new.assigned_to := coalesce(new.assigned_to, public.approver_for('head', null));
  new.due_at := coalesce(new.due_at, now() + interval '8 hours');
  new.history := jsonb_build_array(jsonb_build_object('at', now(), 'by', new.requested_by, 'action', 'Raised', 'to', new.assigned_to));
  return new;
end $$;
drop trigger if exists trg_approvals_bi on public.approvals;
create trigger trg_approvals_bi before insert on public.approvals for each row execute function public.approvals_bi();

-- in-app task + email to the person who must act; repeated calls bump the same task
create or replace function public.approval_notify(p_id uuid, p_to uuid, p_what text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.approvals; pe text; nm text; req text;
begin
  if p_to is null then return; end if;
  select * into a from public.approvals where id = p_id;
  if exists (select 1 from public.tasks where auto_rule = 'approval:' || a.id and owner = p_to and status = 'Open') then
    update public.tasks set title = p_what || ': ' || a.title, priority = case when p_what like 'Reminder%' or p_what like 'Escalated%' then 'Urgent' else priority end, due_at = least(due_at, now())
     where auto_rule = 'approval:' || a.id and owner = p_to and status = 'Open';
  else
    insert into public.tasks(title, kind, lead_id, owner, due_at, priority, auto_rule, created_by)
      values (p_what || ': ' || a.title, 'Approval', a.lead_id, p_to, coalesce(a.due_at, now()), 'High', 'approval:' || a.id, a.requested_by);
  end if;
  select email, full_name into pe, nm from public.profiles where id = p_to;
  select full_name into req from public.profiles where id = a.requested_by;
  if coalesce(pe, '') <> '' then
    perform set_config('garuda.system', 'on', true);
    insert into public.email_queue(to_email, to_name, category, subject, html, auto_rule, created_by)
    values (pe, nm, 'Internal update', '[' || a.req_no || '] ' || p_what || ': ' || a.title,
      '<p>' || public.html_esc(p_what) || ' in Garuda CRM.</p><p><b>' || public.html_esc(a.title) || '</b><br>' || public.html_esc(a.details) ||
      '</p><p>Raised by ' || public.html_esc(coalesce(req, '')) || '. Please respond by ' ||
      to_char(a.due_at at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM') || ' IST.</p>', 'approval', null);
    perform set_config('garuda.system', 'off', true);
  end if;
end $$;

create or replace function public.approvals_ai() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.approval_notify(new.id, new.assigned_to, case when new.kind = 'Query' then 'Question for you' else 'Approval needed' end);
  return new;
end $$;
drop trigger if exists trg_approvals_ai on public.approvals;
create trigger trg_approvals_ai after insert on public.approvals for each row execute function public.approvals_ai();

create or replace function public.approvals_bu() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := public.me(); act text;
begin
  new.updated_at := now();
  if new.status is not distinct from old.status then return new; end if;
  if me is not null and not public.is_head() then
    if new.status = 'Withdrawn' then
      if me is distinct from old.requested_by then raise exception 'Only the person who raised it can withdraw it'; end if;
    elsif me is distinct from old.assigned_to and me is distinct from old.escalate_to then
      raise exception 'This request is waiting for someone else';
    end if;
  end if;
  if new.status in ('Approved','Rejected') and me is not distinct from old.requested_by and not public.is_head() then
    raise exception 'You cannot decide your own request';
  end if;
  act := new.status;
  if new.status = 'Approved' and old.level < old.levels then
    new.level := old.level + 1; new.status := 'Pending'; new.assigned_to := old.second_approver;
    new.due_at := now() + (coalesce(old.due_at, now()) - old.created_at);
    act := 'Approved at level ' || old.level || ', sent for second signature';
  elsif new.status in ('Approved','Rejected','Answered','Withdrawn') then
    new.decided_by := me; new.decided_at := now();
  end if;
  new.history := coalesce(old.history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', now(), 'by', me, 'action', act, 'note', new.decision_note, 'to', new.assigned_to));
  return new;
end $$;
drop trigger if exists trg_approvals_bu on public.approvals;
create trigger trg_approvals_bu before update on public.approvals for each row execute function public.approvals_bu();

create or replace function public.approvals_au() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status and new.level = old.level and new.assigned_to is not distinct from old.assigned_to then return new; end if;
  update public.tasks set status = 'Done', done_at = now()
   where auto_rule = 'approval:' || new.id and status = 'Open' and (new.status not in ('Pending','Escalated') or owner is distinct from new.assigned_to);
  if new.status = 'Pending' and new.level > old.level then
    perform public.approval_notify(new.id, new.assigned_to, 'Second signature needed');
    return new;
  end if;
  if new.status = 'Escalated' then
    perform public.approval_notify(new.id, new.assigned_to, 'Escalated to you (SLA missed)');
    return new;
  end if;
  if new.status in ('Approved','Rejected','Answered') then
    perform set_config('garuda.system', 'on', true);
    if new.status = 'Approved' and new.lead_id is not null then
      if new.request_type = 'Discount' and (new.requested ? 'discount_pct') then
        update public.leads set discount_pct = (new.requested->>'discount_pct')::numeric where id = new.lead_id;
      elsif new.request_type = 'Price exception' and (new.requested ? 'unit_price') then
        update public.leads set unit_price = (new.requested->>'unit_price')::numeric where id = new.lead_id;
      end if;
    end if;
    if new.lead_id is not null then
      insert into public.remarks(lead_id, author, channel, outcome, text)
      values (new.lead_id, coalesce(public.me(), new.decided_by, new.assigned_to, new.requested_by), 'Note', 'Note',
              new.req_no || ' · ' || new.request_type || ' ' || lower(new.status) || coalesce(': ' || nullif(new.decision_note, ''), ''));
    end if;
    perform set_config('garuda.system', 'off', true);
    insert into public.tasks(title, kind, lead_id, owner, due_at, priority, auto_rule, created_by)
    values ('Your request ' || new.req_no || ' was ' || lower(new.status) || ': ' || new.title, 'Approval', new.lead_id, new.requested_by, now(), 'Normal',
            'approval-result:' || new.id, coalesce(public.me(), new.assigned_to));
  end if;
  return new;
end $$;
drop trigger if exists trg_approvals_au on public.approvals;
create trigger trg_approvals_au after update on public.approvals for each row execute function public.approvals_au();

-- reminders every N hours; escalation when the SLA is missed (runs from cron)
create or replace function public.run_approval_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare a record; n int := 0;
begin
  for a in select ap.id, ap.status, ap.due_at, ap.assigned_to, ap.escalate_to, ap.reminders, ap.last_reminder_at, ap.created_at,
                  coalesce(r.remind_every_hours, 4) as every_h
             from public.approvals ap left join public.approval_rules r on r.id = ap.rule_id
            where ap.status in ('Pending','Escalated') loop
    if a.status = 'Pending' and a.due_at < now() and a.escalate_to is not null and a.escalate_to is distinct from a.assigned_to then
      update public.approvals set status = 'Escalated', assigned_to = a.escalate_to where id = a.id;
      n := n + 1;
    elsif coalesce(a.last_reminder_at, a.created_at) < now() - make_interval(hours => a.every_h) then
      update public.approvals set reminders = reminders + 1, last_reminder_at = now() where id = a.id;
      perform public.approval_notify(a.id, a.assigned_to, 'Reminder ' || (a.reminders + 1));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- a discount above the sales limit needs an approved request first
create or replace function public.discount_gate() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim numeric;
begin
  if public.me() is null or public.is_system() or public.is_head() then return new; end if;
  if tg_op = 'UPDATE' and new.discount_pct <= old.discount_pct then return new; end if;
  lim := coalesce((select (value->>'sales')::numeric from public.settings where key = 'discounts'), 5);
  if new.discount_pct > lim and not exists (
       select 1 from public.approvals a where a.lead_id = new.id and a.request_type = 'Discount' and a.status = 'Approved'
          and (a.requested->>'discount_pct')::numeric >= new.discount_pct) then
    raise exception '%', 'A discount above ' || lim || '% needs approval. Use "Request approval" on the lead.';
  end if;
  return new;
end $$;
drop trigger if exists trg_leads_discount on public.leads;
create trigger trg_leads_discount before insert or update of discount_pct on public.leads
  for each row execute function public.discount_gate();

-- ---------------------------------------------------------------------
-- Email marketing: contacts, lists, campaigns, sequences, clicks
-- ---------------------------------------------------------------------
create table if not exists public.email_contacts (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  first_name  text not null default '',
  last_name   text not null default '',
  company     text not null default '',
  designation text not null default '',
  phone       text not null default '',
  city        text not null default '',
  country     text not null default '',
  tags        text[] not null default '{}',
  source      text not null default '',
  lead_id     uuid references public.leads(id) on delete set null,
  subscribed  boolean not null default true,
  bounced     boolean not null default false,
  notes       text not null default '',
  custom      jsonb not null default '{}'::jsonb,
  created_by  uuid references public.profiles(id) default public.me(),
  created_at  timestamptz not null default now()
);
create unique index if not exists email_contacts_email on public.email_contacts (lower(email));

create table if not exists public.email_lists (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text not null default '',
  kind        text not null default 'Static' check (kind in ('Static','Dynamic')),
  filter      jsonb not null default '{}'::jsonb,   -- dynamic: {"target":"leads","funnel":"RPTO","stages":[],"status":"open","min_age":8,"max_age":30,...}
  created_by  uuid references public.profiles(id) default public.me(),
  created_at  timestamptz not null default now()
);

create table if not exists public.email_list_members (
  list_id    uuid not null references public.email_lists(id) on delete cascade,
  contact_id uuid not null references public.email_contacts(id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (list_id, contact_id)
);

alter table public.campaigns add column if not exists subject text not null default '';
alter table public.campaigns add column if not exists subject_b text not null default '';
alter table public.campaigns add column if not exists ab_split int not null default 0;
alter table public.campaigns add column if not exists preheader text not null default '';
alter table public.campaigns add column if not exists html text not null default '';
alter table public.campaigns add column if not exists template_id uuid references public.email_templates(id) on delete set null;
alter table public.campaigns add column if not exists reply_to text not null default '';
alter table public.campaigns add column if not exists list_ids uuid[] not null default '{}';
alter table public.campaigns add column if not exists exclude_list_ids uuid[] not null default '{}';
alter table public.campaigns add column if not exists scheduled_at timestamptz;
alter table public.campaigns add column if not exists sent_at timestamptz;
alter table public.campaigns add column if not exists recipients int not null default 0;
alter table public.campaigns add column if not exists stats jsonb not null default '{}'::jsonb;   -- imported history

create table if not exists public.email_sequences (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category      text not null default 'Follow-up',
  active        boolean not null default false,
  trigger       text not null default 'manual' check (trigger in ('manual','lead_created','webinar_registered','webinar_attended','webinar_noshow','list_join')),
  funnel        text not null default 'Both',
  list_id       uuid references public.email_lists(id) on delete set null,
  event_id      uuid references public.events(id) on delete set null,
  stop_on_reply boolean not null default true,
  sender        text not null default '',
  created_by    uuid references public.profiles(id) default public.me(),
  created_at    timestamptz not null default now()
);

create table if not exists public.sequence_steps (
  id          uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.email_sequences(id) on delete cascade,
  step_no     int not null,
  delay_days  int not null default 0,
  delay_hours int not null default 0,
  condition   text not null default 'always' check (condition in ('always','not_opened','not_replied','opened')),
  template_id uuid references public.email_templates(id) on delete set null,
  subject     text not null default '',
  html        text not null default '',
  unique (sequence_id, step_no)
);

create table if not exists public.sequence_enrollments (
  id            uuid primary key default gen_random_uuid(),
  sequence_id   uuid not null references public.email_sequences(id) on delete cascade,
  lead_id       uuid references public.leads(id) on delete cascade,
  contact_id    uuid references public.email_contacts(id) on delete cascade,
  attendee_id   uuid,
  email         text not null,
  name          text not null default '',
  vars          jsonb not null default '{}'::jsonb,
  status        text not null default 'Active' check (status in ('Active','Completed','Stopped','Replied','Unsubscribed','Bounced')),
  current_step  int not null default 0,
  next_run_at   timestamptz not null default now(),
  last_queue_id uuid,
  enrolled_by   uuid references public.profiles(id) default public.me(),
  enrolled_at   timestamptz not null default now(),
  unique (sequence_id, email)
);

alter table public.email_queue add column if not exists variant text;
alter table public.email_queue add column if not exists email_contact_id uuid references public.email_contacts(id) on delete set null;
alter table public.email_queue add column if not exists enrollment_id uuid references public.sequence_enrollments(id) on delete set null;
alter table public.email_queue add column if not exists step_no int;
alter table public.email_queue add column if not exists reply_to text not null default '';
alter table public.email_queue add column if not exists event_id uuid references public.events(id) on delete set null;

create table if not exists public.email_clicks (
  id         bigserial primary key,
  queue_id   uuid references public.email_queue(id) on delete cascade,
  url        text not null default '',
  clicked_at timestamptz not null default now()
);

-- merge tags: {{first_name}} {{name}} {{institution}} {{product}} {{price}} …
create or replace function public.render_tags(t text, v jsonb) returns text
language plpgsql immutable as $$
declare k text; val text;
begin
  if t is null then return ''; end if;
  for k, val in select key, value from jsonb_each_text(coalesce(v, '{}'::jsonb)) loop
    t := regexp_replace(t, '\{\{\s*' || k || '\s*\}\}', replace(public.html_esc(val), '\', '\\'), 'gi');
  end loop;
  return regexp_replace(t, '\{\{\s*[a-z_]+\s*\}\}', '', 'gi');
end $$;

create or replace function public.lead_vars(p_lead uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'first_name', split_part(coalesce(nullif(l.contact_name, ''), l.name), ' ', 1),
    'name', coalesce(nullif(l.contact_name, ''), l.name),
    'email', l.email,
    'institution', coalesce(i.name, ''), 'company', coalesce(i.name, ''),
    'product', coalesce(p.name, 'our drone programmes'),
    'price', case when l.unit_price > 0 then '₹' || trim(to_char(l.unit_price, '99,99,99,999')) else '' end,
    'owner_name', coalesce(o.full_name, 'Team Garuda'),
    'next_batch', coalesce((select to_char(b.start_date, 'DD Mon YYYY') from public.batches b where b.start_date >= current_date order by b.start_date limit 1), 'the next available date'),
    'centre', coalesce((select b.centre from public.batches b where b.start_date >= current_date order by b.start_date limit 1), 'Chennai'),
    'month', to_char(now(), 'FMMonth YYYY'))
  from public.leads l
  left join public.institutions i on i.id = l.institution_id
  left join public.products p on p.id = l.product_id
  left join public.profiles o on o.id = l.owner
  where l.id = p_lead
$$;

create or replace function public.contact_vars(c public.email_contacts) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'first_name', coalesce(nullif(c.first_name, ''), split_part(c.email, '@', 1)),
    'last_name', c.last_name,
    'name', trim(c.first_name || ' ' || c.last_name),
    'email', c.email, 'company', c.company, 'institution', c.company,
    'designation', c.designation, 'city', c.city,
    'owner_name', 'Team Garuda', 'month', to_char(now(), 'FMMonth YYYY'))
$$;

create or replace function public.list_recipients(p_list uuid)
returns table(email text, name text, lead_id uuid, contact_id uuid, vars jsonb, consent boolean)
language plpgsql stable security definer set search_path = public as $$
declare li record; f jsonb;
begin
  select * into li from public.email_lists where id = p_list;
  if not found then return; end if;
  f := coalesce(li.filter, '{}'::jsonb);
  if li.kind = 'Static' then
    return query
      select c.email, trim(c.first_name || ' ' || c.last_name), c.lead_id, c.id, public.contact_vars(c), (c.subscribed and not c.bounced)
      from public.email_list_members m join public.email_contacts c on c.id = m.contact_id
      where m.list_id = p_list;
  elsif coalesce(f->>'target', 'leads') = 'contacts' then
    return query
      select c.email, trim(c.first_name || ' ' || c.last_name), c.lead_id, c.id, public.contact_vars(c), (c.subscribed and not c.bounced)
      from public.email_contacts c
      where jsonb_array_length(coalesce(f->'tags', '[]'::jsonb)) = 0
         or c.tags && array(select jsonb_array_elements_text(f->'tags'));
  else
    return query
      select l.email, coalesce(nullif(l.contact_name, ''), l.name), l.id, null::uuid, public.lead_vars(l.id), (l.consent_email and not l.opted_out)
      from public.leads l join public.stages s on s.funnel = l.funnel and s.key = l.stage
      where coalesce(l.email, '') <> ''
        and (coalesce(f->>'funnel', 'Both') in ('Both', '') or l.funnel = f->>'funnel')
        and (jsonb_array_length(coalesce(f->'stages', '[]'::jsonb)) = 0 or l.stage in (select jsonb_array_elements_text(f->'stages')))
        and (jsonb_array_length(coalesce(f->'sources', '[]'::jsonb)) = 0 or l.source in (select jsonb_array_elements_text(f->'sources')))
        and (jsonb_array_length(coalesce(f->'temperatures', '[]'::jsonb)) = 0 or l.temperature in (select jsonb_array_elements_text(f->'temperatures')))
        and (jsonb_array_length(coalesce(f->'ai_bands', '[]'::jsonb)) = 0 or l.ai_band in (select jsonb_array_elements_text(f->'ai_bands')))
        and (jsonb_array_length(coalesce(f->'tiers', '[]'::jsonb)) = 0 or l.campaign_tier in (select jsonb_array_elements_text(f->'tiers')))
        and (case coalesce(f->>'status', 'open')
               when 'all' then true when 'won' then s.is_won when 'lost' then s.is_lost
               else not s.is_won and not s.is_lost and not s.is_closed end)
        and (coalesce(f->>'min_age', '') = '' or (current_date - l.created_at::date) >= (f->>'min_age')::int)
        and (coalesce(f->>'max_age', '') = '' or (current_date - l.created_at::date) <= (f->>'max_age')::int);
  end if;
end $$;

create or replace function public.launch_campaign(p_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare c record; n int; snd text; cat text;
begin
  if public.me() is not null and not public.my_email_access() then raise exception 'You do not have email marketing access'; end if;
  select * into c from public.campaigns where id = p_id for update;
  if not found then raise exception 'Campaign not found'; end if;
  if c.status in ('Sent','Sending') and c.sent_at is not null then raise exception 'This campaign was already sent'; end if;
  if coalesce(c.subject, '') = '' or coalesce(c.html, '') = '' then raise exception 'Add a subject and the email content first'; end if;
  if coalesce(array_length(c.list_ids, 1), 0) = 0 then raise exception 'Choose at least one audience list'; end if;
  cat := case when c.purpose in ('Newsletter','Marketing','Training update','Internal update','Follow-up','Webinar') then c.purpose else 'Marketing' end;
  snd := coalesce(nullif(c.sender, ''), (select value->'senders'->>cat from public.settings where key = 'email'), '');
  with r as (
    select distinct on (lower(x.email)) x.*
      from unnest(c.list_ids) lid, lateral public.list_recipients(lid) x
     where coalesce(x.email, '') <> ''
     order by lower(x.email), x.lead_id nulls last),
  ex as (select lower(x.email) e from unnest(c.exclude_list_ids) lid, lateral public.list_recipients(lid) x),
  ok as (
    select r.*, row_number() over (order by md5(lower(r.email) || p_id::text)) rn, count(*) over () total from r
     where lower(r.email) not in (select e from ex)
       and lower(r.email) not in (select lower(u.email) from public.unsubscribes u)
       and (cat = 'Internal update' or r.consent))
  insert into public.email_queue(campaign_id, template_id, lead_id, email_contact_id, to_email, to_name, category, subject, html, sender, reply_to, variant, scheduled_at, created_by)
  select p_id, c.template_id, ok.lead_id, ok.contact_id, ok.email, ok.name, cat,
         public.render_tags(case when coalesce(c.subject_b, '') <> '' and ok.rn <= ceil(ok.total * c.ab_split / 100.0) then c.subject_b else c.subject end, ok.vars),
         case when coalesce(c.preheader, '') <> '' then '<div style="display:none;max-height:0;overflow:hidden;opacity:0">' || public.html_esc(c.preheader) || '</div>' else '' end
           || public.render_tags(c.html, ok.vars), snd, c.reply_to,
         case when coalesce(c.subject_b, '') <> '' and ok.rn <= ceil(ok.total * c.ab_split / 100.0) then 'B' else 'A' end,
         now(), public.me()
    from ok;
  get diagnostics n = row_count;
  update public.campaigns set status = 'Sent', sent_at = now(), recipients = n, channel = 'Email' where id = p_id;
  return n;
end $$;

create or replace function public.launch_due_campaigns() returns int
language plpgsql security definer set search_path = public as $$
declare c record; n int := 0;
begin
  for c in select id from public.campaigns where status = 'Scheduled' and scheduled_at <= now() and channel = 'Email' loop
    begin
      n := n + public.launch_campaign(c.id);
    exception when others then
      update public.campaigns set status = 'Paused', notes = notes || ' [' || to_char(now(), 'DD Mon HH24:MI') || ' launch failed: ' || sqlerrm || ']' where id = c.id;
    end;
  end loop;
  return n;
end $$;

create or replace function public.enroll_in_sequence(p_seq uuid, p_email text, p_name text, p_lead uuid, p_contact uuid, p_attendee uuid, p_vars jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare d int; h int; ok boolean;
begin
  if coalesce(p_email, '') = '' then return false; end if;
  if exists (select 1 from public.unsubscribes where lower(email) = lower(p_email)) then return false; end if;
  select delay_days, delay_hours into d, h from public.sequence_steps where sequence_id = p_seq order by step_no limit 1;
  insert into public.sequence_enrollments(sequence_id, email, name, lead_id, contact_id, attendee_id, vars, next_run_at, enrolled_by)
  values (p_seq, lower(p_email), coalesce(p_name, ''), p_lead, p_contact, p_attendee, coalesce(p_vars, '{}'::jsonb),
          now() + make_interval(days => coalesce(d, 0), hours => coalesce(h, 0)), public.me())
  on conflict (sequence_id, email) do nothing;
  get diagnostics d = row_count;
  return d > 0;
end $$;

-- ---------------------------------------------------------------------
-- Webinars: public registration, payment, reminders
-- ---------------------------------------------------------------------
alter table public.events add column if not exists meeting_link text not null default '';
alter table public.events add column if not exists slug text;
alter table public.events add column if not exists description text not null default '';
alter table public.events add column if not exists is_paid boolean not null default false;
alter table public.events add column if not exists fee numeric(12,2) not null default 0;
alter table public.events add column if not exists gst_rate numeric(5,2) not null default 18;
alter table public.events add column if not exists registration_open boolean not null default true;
alter table public.events add column if not exists recording_link text not null default '';
alter table public.events add column if not exists segment text not null default 'RPTO';
alter table public.events add column if not exists remind_24h boolean not null default true;
alter table public.events add column if not exists remind_1h boolean not null default true;
alter table public.events add column if not exists questions jsonb not null default '[]'::jsonb;
create unique index if not exists events_slug on public.events(slug) where slug is not null;

alter table public.event_attendees add column if not exists city text not null default '';
alter table public.event_attendees add column if not exists college text not null default '';
alter table public.event_attendees add column if not exists course_interest text not null default '';
alter table public.event_attendees add column if not exists answers jsonb not null default '{}'::jsonb;
alter table public.event_attendees add column if not exists status text not null default 'Registered';
alter table public.event_attendees add column if not exists amount numeric(12,2) not null default 0;
alter table public.event_attendees add column if not exists order_id text;
alter table public.event_attendees add column if not exists payment_id text;
alter table public.event_attendees add column if not exists paid_at timestamptz;
alter table public.event_attendees add column if not exists confirmed_at timestamptz;
alter table public.event_attendees add column if not exists reminder_24h_at timestamptz;
alter table public.event_attendees add column if not exists reminder_1h_at timestamptz;
alter table public.event_attendees add column if not exists recording_sent_at timestamptz;
alter table public.event_attendees add column if not exists consent boolean not null default true;
alter table public.event_attendees add column if not exists utm jsonb not null default '{}'::jsonb;
alter table public.event_attendees drop constraint if exists event_attendees_status_check;
alter table public.event_attendees add constraint event_attendees_status_check check (status in ('Registered','Payment pending','Active','Cancelled','Refunded'));
create unique index if not exists event_attendees_email on public.event_attendees(event_id, lower(email)) where email <> '';

create or replace function public.attendee_vars(p_att uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'first_name', split_part(a.name, ' ', 1), 'name', a.name, 'email', a.email,
    'webinar', e.title,
    'date', to_char(e.start_at at time zone 'Asia/Kolkata', 'FMDay, DD Mon YYYY'),
    'time', to_char(e.start_at at time zone 'Asia/Kolkata', 'HH12:MI AM') || ' IST',
    'meeting_link', e.meeting_link, 'recording_link', e.recording_link,
    'fee', case when e.is_paid then '₹' || trim(to_char(a.amount, '99,99,99,999')) else 'Free' end,
    'month', to_char(now(), 'FMMonth YYYY'), 'owner_name', 'Team Garuda')
  from public.event_attendees a join public.events e on e.id = a.event_id
  where a.id = p_att
$$;

create or replace function public.queue_webinar_email(p_att uuid, p_template text) returns void
language plpgsql security definer set search_path = public as $$
declare a record; t record; v jsonb; snd text;
begin
  select at.*, ev.id as ev_id into a from public.event_attendees at join public.events ev on ev.id = at.event_id where at.id = p_att;
  if not found or coalesce(a.email, '') = '' then return; end if;
  select * into t from public.email_templates where name = p_template and active order by updated_at desc limit 1;
  if not found then return; end if;
  v := public.attendee_vars(p_att);
  snd := coalesce((select value->'senders'->>'Webinar' from public.settings where key = 'email'), '');
  perform set_config('garuda.system', 'on', true);
  insert into public.email_queue(template_id, lead_id, to_email, to_name, category, subject, html, sender, event_id, auto_rule, created_by)
  values (t.id, a.lead_id, a.email, a.name, 'Webinar', public.render_tags(t.subject, v), public.render_tags(t.html, v), snd, a.ev_id, p_template, null);
  perform set_config('garuda.system', 'off', true);
end $$;

create or replace function public.attendee_bi() returns trigger
language plpgsql as $$
begin
  if new.status = 'Active' and new.confirmed_at is null and (tg_op = 'INSERT' or old.status is distinct from 'Active') then
    new.confirmed_at := now();
  end if;
  return new;
end $$;
drop trigger if exists trg_att_bi on public.event_attendees;
create trigger trg_att_bi before insert or update on public.event_attendees for each row execute function public.attendee_bi();

create or replace function public.attendee_ai() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.confirmed_at is not null and (tg_op = 'INSERT' or old.confirmed_at is null) then
    perform public.queue_webinar_email(new.id, 'Webinar confirmation');
  end if;
  return new;
end $$;
drop trigger if exists trg_att_ai on public.event_attendees;
create trigger trg_att_ai after insert or update on public.event_attendees for each row execute function public.attendee_ai();

create or replace function public.run_webinar_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare a record; n int := 0;
begin
  for a in select at.id from public.event_attendees at join public.events ev on ev.id = at.event_id
            where ev.kind = 'Webinar' and ev.status <> 'Cancelled' and at.status = 'Active' and ev.remind_24h
              and at.reminder_24h_at is null and ev.start_at between now() + interval '2 hours' and now() + interval '24 hours' loop
    perform public.queue_webinar_email(a.id, 'Webinar reminder');
    update public.event_attendees set reminder_24h_at = now() where id = a.id; n := n + 1;
  end loop;
  for a in select at.id from public.event_attendees at join public.events ev on ev.id = at.event_id
            where ev.kind = 'Webinar' and ev.status <> 'Cancelled' and at.status = 'Active' and ev.remind_1h
              and at.reminder_1h_at is null and ev.start_at between now() and now() + interval '75 minutes' loop
    perform public.queue_webinar_email(a.id, 'Webinar starting soon');
    update public.event_attendees set reminder_1h_at = now() where id = a.id; n := n + 1;
  end loop;
  for a in select at.id from public.event_attendees at join public.events ev on ev.id = at.event_id
            where ev.kind = 'Webinar' and coalesce(ev.recording_link, '') <> '' and at.status = 'Active'
              and at.recording_sent_at is null and ev.start_at < now() - interval '2 hours' and ev.start_at > now() - interval '30 days' loop
    perform public.queue_webinar_email(a.id, 'Webinar recording');
    update public.event_attendees set recording_sent_at = now() where id = a.id; n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.run_sequences() returns int
language plpgsql security definer set search_path = public as $$
declare s record; e record; st record; nx record; pv record; n int := 0; cat text; snd text; ok boolean; v jsonb; qid uuid;
begin
  -- automatic enrolment
  for s in select * from public.email_sequences where active and trigger <> 'manual' loop
    if s.trigger = 'lead_created' then
      perform public.enroll_in_sequence(s.id, l.email, coalesce(nullif(l.contact_name, ''), l.name), l.id, null, null, '{}'::jsonb)
         from public.leads l
        where l.created_at > now() - interval '3 days' and coalesce(l.email, '') <> '' and l.consent_email and not l.opted_out
          and (s.funnel = 'Both' or l.funnel = s.funnel)
          and not exists (select 1 from public.sequence_enrollments x where x.sequence_id = s.id and x.email = lower(l.email));
    elsif s.trigger in ('webinar_registered', 'webinar_attended', 'webinar_noshow') then
      perform public.enroll_in_sequence(s.id, a.email, a.name, a.lead_id, null, a.id, public.attendee_vars(a.id))
         from public.event_attendees a join public.events ev on ev.id = a.event_id
        where ev.kind = 'Webinar' and coalesce(a.email, '') <> '' and a.status = 'Active'
          and (s.event_id is null or a.event_id = s.event_id)
          and (s.trigger = 'webinar_registered'
               or (s.trigger = 'webinar_attended' and a.attended)
               or (s.trigger = 'webinar_noshow' and not a.attended and ev.start_at < now() - interval '3 hours' and ev.start_at > now() - interval '30 days'
                   and exists (select 1 from public.event_attendees y where y.event_id = ev.id and y.attended)))
          and not exists (select 1 from public.sequence_enrollments x where x.sequence_id = s.id and x.email = lower(a.email));
    elsif s.trigger = 'list_join' and s.list_id is not null then
      perform public.enroll_in_sequence(s.id, r.email, r.name, r.lead_id, r.contact_id, null, r.vars)
         from public.list_recipients(s.list_id) r
        where r.consent and not exists (select 1 from public.sequence_enrollments x where x.sequence_id = s.id and x.email = lower(r.email));
    end if;
  end loop;

  -- send the next step for everyone who is due
  for e in select en.*, sq.category as seq_cat, sq.sender as seq_sender
             from public.sequence_enrollments en join public.email_sequences sq on sq.id = en.sequence_id
            where en.status = 'Active' and en.next_run_at <= now() and sq.active
            order by en.next_run_at limit 500 loop
    qid := null;
    if exists (select 1 from public.unsubscribes u where lower(u.email) = lower(e.email)) then
      update public.sequence_enrollments set status = 'Unsubscribed' where id = e.id; continue;
    end if;
    select * into st from public.sequence_steps where sequence_id = e.sequence_id and step_no > e.current_step order by step_no limit 1;
    if not found then update public.sequence_enrollments set status = 'Completed' where id = e.id; continue; end if;
    ok := true;
    if st.condition <> 'always' and e.last_queue_id is not null then
      select * into pv from public.email_queue where id = e.last_queue_id;
      ok := case st.condition when 'not_opened' then pv.opened_at is null
                              when 'not_replied' then pv.replied_at is null
                              when 'opened' then pv.opened_at is not null else true end;
    end if;
    if ok then
      cat := case when e.seq_cat in ('Newsletter','Marketing','Training update','Internal update','Follow-up','Webinar') then e.seq_cat else 'Follow-up' end;
      snd := coalesce(nullif(e.seq_sender, ''), (select value->'senders'->>cat from public.settings where key = 'email'), '');
      v := coalesce(e.vars, '{}'::jsonb) || case when e.lead_id is not null then coalesce(public.lead_vars(e.lead_id), '{}'::jsonb) else '{}'::jsonb end;
      insert into public.email_queue(lead_id, email_contact_id, to_email, to_name, category, subject, html, sender, enrollment_id, step_no, template_id, auto_rule)
      select e.lead_id, e.contact_id, e.email, e.name, cat,
             public.render_tags(coalesce(nullif(st.subject, ''), t.subject), v),
             public.render_tags(coalesce(nullif(st.html, ''), t.html), v),
             snd, e.id, st.step_no, st.template_id, 'sequence'
        from (select 1) one left join public.email_templates t on t.id = st.template_id
       where coalesce(nullif(st.subject, ''), t.subject, '') <> ''
      returning id into qid;
      if qid is not null then n := n + 1; end if;
    end if;
    select * into nx from public.sequence_steps where sequence_id = e.sequence_id and step_no > st.step_no order by step_no limit 1;
    update public.sequence_enrollments set
      current_step = st.step_no,
      last_queue_id = coalesce(qid, last_queue_id),
      status = case when nx.step_no is null then 'Completed' else 'Active' end,
      next_run_at = now() + make_interval(days => coalesce(nx.delay_days, 0), hours => coalesce(nx.delay_hours, 0))
    where id = e.id;
  end loop;
  return n;
end $$;

-- replies and bounces stop sequences; bounces mark the contact
create or replace function public.email_queue_seq_stop() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.enrollment_id is not null and new.replied_at is not null and old.replied_at is null then
    update public.sequence_enrollments en set status = 'Replied'
      from public.email_sequences s
     where en.id = new.enrollment_id and s.id = en.sequence_id and s.stop_on_reply and en.status = 'Active';
  end if;
  if new.bounced_at is not null and old.bounced_at is null then
    update public.email_contacts set bounced = true where lower(email) = lower(new.to_email);
    if new.enrollment_id is not null then
      update public.sequence_enrollments set status = 'Bounced' where id = new.enrollment_id and status = 'Active';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_eq_seq on public.email_queue;
create trigger trg_eq_seq after update of replied_at, bounced_at on public.email_queue for each row execute function public.email_queue_seq_stop();

create or replace function public.unsub_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.leads    set opted_out = true, consent_email = false where lower(email) = lower(new.email);
  update public.contacts set opted_out = true, consent_email = false where lower(email) = lower(new.email);
  update public.email_contacts set subscribed = false where lower(email) = lower(new.email);
  update public.sequence_enrollments set status = 'Unsubscribed' where lower(email) = lower(new.email) and status = 'Active';
  update public.email_queue set status = 'Skipped', error = 'Unsubscribed'
    where lower(to_email) = lower(new.email) and status = 'Queued' and category <> 'Internal update';
  return new;
end $$;

-- ---------------------------------------------------------------------
-- RLS for the new tables
-- ---------------------------------------------------------------------
do $$ declare t text; begin
  for t in select unnest(array['business_tasks','review_meetings','review_items','daily_mom','comments','approval_rules','approvals',
    'email_contacts','email_lists','email_list_members','email_sequences','sequence_steps','sequence_enrollments','email_clicks']) loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy p_bt_r on public.business_tasks for select using (public.is_staff());
create policy p_bt_i on public.business_tasks for insert with check (public.is_staff());
create policy p_bt_u on public.business_tasks for update using (created_by = public.me() or public.me() = any(assignees) or public.sees_all());
create policy p_bt_d on public.business_tasks for delete using (public.is_head());
create policy p_rm_r on public.review_meetings for select using (public.is_staff());
create policy p_rm_w on public.review_meetings for all using (public.is_staff()) with check (public.is_staff());
create policy p_ri_r on public.review_items for select using (public.is_staff());
create policy p_ri_w on public.review_items for all using (public.is_staff()) with check (public.is_staff());

create policy p_mom_r on public.daily_mom for select using (public.is_staff());
create policy p_mom_i on public.daily_mom for insert with check (author = public.me());
create policy p_mom_u on public.daily_mom for update using (author = public.me() or public.is_head());
create policy p_mom_d on public.daily_mom for delete using (author = public.me() or public.is_head());
create policy p_com_r on public.comments for select using (public.is_staff());
create policy p_com_i on public.comments for insert with check (author = public.me() and public.is_staff());
create policy p_com_d on public.comments for delete using (author = public.me() or public.is_head());

create policy p_ar_r on public.approval_rules for select using (public.is_staff());
create policy p_ar_w on public.approval_rules for all using (public.is_head()) with check (public.is_head());
create policy p_ap_r on public.approvals for select using (requested_by = public.me() or assigned_to = public.me() or second_approver = public.me() or escalate_to = public.me() or public.sees_all());
create policy p_ap_i on public.approvals for insert with check (public.is_staff() and requested_by = public.me());
create policy p_ap_u on public.approvals for update using (requested_by = public.me() or assigned_to = public.me() or second_approver = public.me() or escalate_to = public.me() or public.is_head()) with check (public.is_staff());

create policy p_ec_r on public.email_contacts for select using (public.is_staff());
create policy p_ec_w on public.email_contacts for all using (public.my_email_access()) with check (public.my_email_access());
create policy p_el_r on public.email_lists for select using (public.is_staff());
create policy p_el_w on public.email_lists for all using (public.my_email_access()) with check (public.my_email_access());
create policy p_elm_r on public.email_list_members for select using (public.is_staff());
create policy p_elm_w on public.email_list_members for all using (public.my_email_access()) with check (public.my_email_access());
create policy p_es_r on public.email_sequences for select using (public.is_staff());
create policy p_es_w on public.email_sequences for all using (public.my_email_access()) with check (public.my_email_access());
create policy p_ss_r on public.sequence_steps for select using (public.is_staff());
create policy p_ss_w on public.sequence_steps for all using (public.my_email_access()) with check (public.my_email_access());
create policy p_se_r on public.sequence_enrollments for select using (public.is_staff());
create policy p_se_w on public.sequence_enrollments for all using (public.my_email_access()) with check (public.my_email_access());
create policy p_eclk_r on public.email_clicks for select using (public.is_staff());

do $$ declare t text; begin
  for t in select unnest(array['approvals','business_tasks','review_items','daily_mom','comments','event_attendees']) loop
    begin execute format('alter publication supabase_realtime add table public.%I', t); exception when others then null; end;
  end loop;
end $$;

-- =====================================================================
-- v3 · the team's sales sheet inside the CRM
--   stages = RPTO Lead Status / CoE Lead Stage / CoE Pipeline Status
--   sheet fields on every lead, revenue ledger, admissions log,
--   owner names linked to accounts, approvals / tasks / EOD screens retired
-- =====================================================================
alter table public.stages add column if not exists grp text not null default '';
alter table public.stages add column if not exists needs_reason boolean not null default false;

alter table public.profiles add column if not exists sheet_name text not null default '';   -- name used in the sales sheet ("Sowmya", "Jai kishore")

alter table public.leads drop constraint if exists leads_temperature_check;
alter table public.leads add constraint leads_temperature_check check (temperature in ('Hot','Warm','Cold','Nurture','Drop'));
alter table public.leads
  add column if not exists ref_id          text,                       -- sheet Lead ID / Opp ID
  add column if not exists imported        boolean not null default false,
  add column if not exists owner_name      text not null default '',  -- "Assigned To" / "Lead Owner" as written in the sheet
  add column if not exists enquiry_date    date,
  add column if not exists allocated_date  date,
  add column if not exists course          text not null default '',  -- RPTO course interest
  add column if not exists sub_category    text not null default '',  -- CoE sub-category (UAV Lab - Standard, IV, Workshop ...)
  add column if not exists engagement      text not null default '',
  add column if not exists campaign_tier   text not null default '',
  add column if not exists priority_score  int,
  add column if not exists tier_reason     text not null default '',
  add column if not exists language        text not null default '',
  add column if not exists campaign_ok     boolean,
  add column if not exists call_attempts   int not null default 0,
  add column if not exists latest_remark   text not null default '',
  add column if not exists client_type     text not null default '',
  add column if not exists also_interested text not null default '',
  add column if not exists latest_update   text not null default '',
  add column if not exists last_followup   date,
  add column if not exists collected_import numeric(14,2) not null default 0,  -- "Collected to date" from the sheet
  add column if not exists pending_po      numeric(14,2) not null default 0,
  add column if not exists pipeline        boolean not null default false,     -- CoE: on the CoE Pipeline (In Progress or later)
  add column if not exists free_seat       boolean not null default false,     -- RPTO: admitted on a free seat
  add column if not exists org             text not null default '';           -- location / organisation text from the sheet
create unique index if not exists leads_ref_uq on public.leads(funnel, ref_id);
create index if not exists leads_funnel_stage on public.leads(funnel, stage);
create index if not exists leads_owner_idx on public.leads(owner);
create index if not exists leads_enquiry_idx on public.leads(enquiry_date);
create index if not exists leads_phone_idx on public.leads(phone);

-- full call history from the sheet (long text, fetched only when a lead is opened)
create table if not exists public.lead_history (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  text    text not null default ''
);

-- RPTO course → revenue / admission segment; CoE sub-category → revenue segment
create or replace function public.course_segment(c text) returns text language sql immutable as $$
  select case c when 'Small Class RPC' then 'Small' when 'Medium Class RPC' then 'Medium' when 'Small + Medium RPC' then 'Medium'
    when 'Top-up Medium' then 'Top-Up Medium' when 'Train the Trainer (TTT)' then 'TTT (Small)' else 'Other' end $$;
create or replace function public.coe_segment(c text) returns text language sql immutable as $$
  select case when c in ('UAV Lab - Basic','UAV Lab - Standard','UAV Lab - Advanced','RPTO Establishment','IV (Industrial Visit)','Workshop') then c
    when c = 'UAV Lab - Type TBC' then 'UAV Lab (type not stated)' when c = 'RPTO Admissions (Bulk)' then 'RPTO Products'
    when coalesce(c,'') in ('','Not Specified') then 'Not stated' else c end $$;
create or replace function public.can_finance() returns boolean
language sql stable security definer set search_path = public as $$ select public.my_role() in ('finance','head','admin','developer') $$;

-- sheet fields kept up to date by the CRM
create or replace function public.leads_v3_bi() returns trigger
language plpgsql security definer set search_path = public as $$
declare st record;
begin
  if tg_op = 'INSERT' then
    new.enquiry_date := coalesce(new.enquiry_date, (new.created_at at time zone 'Asia/Kolkata')::date, current_date);
    new.allocated_date := coalesce(new.allocated_date, case when new.owner is not null then new.enquiry_date end);
    if not new.imported and new.ref_id is null then new.ref_id := new.lead_no; end if;
  end if;
  if new.owner is not null and (tg_op = 'INSERT' or new.owner is distinct from old.owner) then
    new.owner_name := coalesce((select full_name from public.profiles where id = new.owner), new.owner_name);
    if tg_op = 'UPDATE' and old.owner is null then new.allocated_date := coalesce(new.allocated_date, current_date); end if;
  end if;
  if new.funnel = 'CoE' and not (new.imported and public.is_system()) then
    select * into st from public.stages where funnel = 'CoE' and key = new.stage;
    if found and (st.grp in ('Pipeline','Won') or (st.is_lost and tg_op = 'UPDATE' and old.pipeline)) then new.pipeline := true; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_leads_v3_bi on public.leads;
create trigger trg_leads_v3_bi before insert or update on public.leads
  for each row execute function public.leads_v3_bi();

-- stage gates (the database is the final check; the app shows the same messages first)
create or replace function public.check_stage_gate() returns trigger
language plpgsql security definer set search_path = public as $$
declare st record;
begin
  if tg_op = 'UPDATE' and new.stage is not distinct from old.stage then return new; end if;
  select * into st from public.stages where funnel = new.funnel and key = new.stage;
  if not found then raise exception 'Unknown stage "%" for funnel %', new.stage, new.funnel; end if;
  if st.is_won and new.won_at is null then new.won_at := now(); end if;
  if not st.is_won and tg_op = 'UPDATE' and new.won_at is not null then new.won_at := null; end if;
  if st.is_won and new.closed_by is null then new.closed_by := coalesce(public.me(), new.owner); end if;
  if public.me() is null or public.is_system() then return new; end if;
  if st.needs_reason and coalesce(new.lost_reason,'') = '' then
    raise exception 'Add a lost reason before moving to %', new.stage;
  end if;
  if new.funnel = 'RPTO' and new.stage in ('Pipeline','Converted')
     and not (new.fee_disclosed or exists (select 1 from public.price_disclosures where lead_id = new.id)) then
    raise exception 'Record the fee told to the candidate (price + GST) before moving to %', new.stage;
  end if;
  if new.funnel = 'RPTO' and st.is_won and not public.can_finance()
     and not exists (select 1 from public.payments where lead_id = new.id and status in ('Claimed','Verified')) then
    raise exception 'Record the payment before marking Converted';
  end if;
  if new.funnel = 'CoE' and st.is_won and coalesce(new.po_ref,'') = ''
     and not exists (select 1 from public.payments where lead_id = new.id and status in ('Claimed','Verified')) then
    raise exception 'Add the PO / contract reference or a payment before marking Closed Won';
  end if;
  return new;
end $$;

-- discounts: the sales limit applies; only the Business Head, Admin or Developer can go above it
create or replace function public.discount_gate() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim numeric;
begin
  if public.me() is null or public.is_system() or public.is_head() then return new; end if;
  if tg_op = 'UPDATE' and new.discount_pct <= old.discount_pct then return new; end if;
  lim := coalesce((select (value->>'sales')::numeric from public.settings where key = 'discounts'), 5);
  if new.discount_pct > lim then
    raise exception '%', 'Discounts above ' || lim || '% can only be given by the Business Head.';
  end if;
  return new;
end $$;

-- every call remark updates the sheet columns (call attempts, latest remark)
create or replace function public.remarks_v3_ai() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.leads set
    call_attempts = call_attempts + case when new.channel in ('Outbound call','Inbound call') then 1 else 0 end,
    latest_remark = left(to_char(new.created_at at time zone 'Asia/Kolkata', 'DD Mon') || ' - ' || coalesce(new.text,''), 500),
    last_followup = (new.created_at at time zone 'Asia/Kolkata')::date
  where id = new.lead_id;
  return new;
end $$;
drop trigger if exists trg_remarks_v3_ai on public.remarks;
create trigger trg_remarks_v3_ai after insert on public.remarks
  for each row execute function public.remarks_v3_ai();

-- the sheet's owner names become real owners as soon as that person has an account
create or replace function public.link_owner_names() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform set_config('garuda.system','on',true);
  update public.leads l set owner = p.id
  from public.profiles p
  where l.owner is null and l.owner_name <> '' and p.active and p.role not in ('pending')
    and lower(trim(l.owner_name)) in (lower(trim(p.full_name)), lower(trim(nullif(p.sheet_name,''))));
  get diagnostics n = row_count;
  perform set_config('garuda.system','off',true);
  return n;
end $$;
create or replace function public.profiles_link_ai() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public.link_owner_names(); return new; end $$;
drop trigger if exists trg_profiles_link on public.profiles;
create trigger trg_profiles_link after insert or update of full_name, sheet_name, role, active on public.profiles
  for each row execute function public.profiles_link_ai();

-- ---------------------------------------------------------------------
-- Revenue ledger (collected and pending POs, by month and segment)
-- ---------------------------------------------------------------------
create table if not exists public.revenue_entries (
  id          uuid primary key default gen_random_uuid(),
  month       date not null,                          -- first day of the month
  department  text not null check (department in ('RPTO Training','CoE')),
  channel     text not null default '',               -- Academy (direct) / Partner centre / B2B
  segment     text not null,
  client      text not null default '',
  amount      numeric(14,2) not null,                 -- ex-GST
  status      text not null default 'Collected' check (status in ('Collected','Pending PO')),
  opp_ref     text not null default '',
  lead_id     uuid references public.leads(id) on delete set null,
  payment_id  uuid unique references public.payments(id) on delete cascade,
  source      text not null default 'manual' check (source in ('import','payment','manual')),
  note        text not null default '',
  created_by  uuid references public.profiles(id) default public.me(),
  created_at  timestamptz not null default now()
);
create index if not exists revenue_month on public.revenue_entries(month);

-- a verified payment on a lead is written to the ledger automatically
create or replace function public.payments_to_ledger() returns trigger
language plpgsql security definer set search_path = public as $$
declare l record;
begin
  if tg_op = 'DELETE' then return old; end if;
  if new.status <> 'Verified' then
    delete from public.revenue_entries where payment_id = new.id;
    return new;
  end if;
  select * into l from public.leads where id = new.lead_id;
  insert into public.revenue_entries(month, department, channel, segment, client, amount, status, opp_ref, lead_id, payment_id, source, created_by)
  values (date_trunc('month', new.paid_on)::date,
          case when l.funnel = 'RPTO' then 'RPTO Training' else 'CoE' end,
          case when l.funnel = 'RPTO' then 'Academy (direct)' else 'B2B' end,
          case when l.funnel = 'RPTO' then public.course_segment(l.course) else public.coe_segment(l.sub_category) end,
          case when l.funnel = 'RPTO' then l.name else coalesce(nullif(l.org,''), l.name) end,
          new.amount_ex, 'Collected', coalesce(l.ref_id,''), l.id, new.id, 'payment', new.verified_by)
  on conflict (payment_id) do update set month = excluded.month, amount = excluded.amount, segment = excluded.segment, client = excluded.client;
  return new;
end $$;
drop trigger if exists trg_payments_ledger on public.payments;
create trigger trg_payments_ledger after insert or update on public.payments
  for each row execute function public.payments_to_ledger();

-- ---------------------------------------------------------------------
-- Admissions (paid / free, by month and segment) and admissions by source
-- ---------------------------------------------------------------------
create table if not exists public.admissions (
  id         uuid primary key default gen_random_uuid(),
  month      date not null,
  segment    text not null,
  paid       int not null default 0,
  free       int not null default 0,
  source     text not null default '',
  lead_id    uuid unique references public.leads(id) on delete cascade,  -- set when the CRM counts a converted lead
  note       text not null default '',
  created_by uuid references public.profiles(id) default public.me(),
  created_at timestamptz not null default now()
);
create index if not exists admissions_month on public.admissions(month);
create table if not exists public.admission_sources (
  id         uuid primary key default gen_random_uuid(),
  month      date not null,
  source     text not null,
  admissions int not null default 0,
  note       text not null default '',
  created_by uuid references public.profiles(id) default public.me(),
  created_at timestamptz not null default now()
);

-- an RPTO lead moved to Converted is counted as an admission (once); moving it back removes it
create or replace function public.leads_admission() returns trigger
language plpgsql security definer set search_path = public as $$
declare won boolean;
begin
  if new.funnel <> 'RPTO' or public.is_system() then return new; end if;   -- the sheet import brings its own admissions log
  select is_won into won from public.stages where funnel = 'RPTO' and key = new.stage;
  if coalesce(won,false) then
    insert into public.admissions(month, segment, paid, free, source, lead_id, created_by)
    values (date_trunc('month', coalesce(new.won_at, now()) at time zone 'Asia/Kolkata')::date, public.course_segment(new.course),
            case when new.free_seat then 0 else 1 end, case when new.free_seat then 1 else 0 end, new.source, new.id, public.me())
    on conflict (lead_id) do update set segment = excluded.segment, paid = excluded.paid, free = excluded.free, source = excluded.source;
  elsif tg_op = 'UPDATE' then
    delete from public.admissions where lead_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists trg_leads_admission on public.leads;
create trigger trg_leads_admission after insert or update of stage, course, free_seat, source on public.leads
  for each row execute function public.leads_admission();

-- ---------------------------------------------------------------------
-- security for the new tables
-- ---------------------------------------------------------------------
alter table public.lead_history enable row level security;
alter table public.revenue_entries enable row level security;
alter table public.admissions enable row level security;
alter table public.admission_sources enable row level security;
drop policy if exists p_hist_r on public.lead_history;
create policy p_hist_r on public.lead_history for select using (public.can_see_lead_id(lead_id));
drop policy if exists p_hist_w on public.lead_history;
create policy p_hist_w on public.lead_history for all using (public.is_head()) with check (public.is_head());
do $$ declare t text; begin
  foreach t in array array['revenue_entries','admissions','admission_sources'] loop
    execute format('drop policy if exists p_%s_r on public.%I', t, t);
    execute format('create policy p_%s_r on public.%I for select using (public.is_staff())', t, t);
    execute format('drop policy if exists p_%s_w on public.%I', t, t);
    execute format('create policy p_%s_w on public.%I for all using (public.can_finance()) with check (public.can_finance())', t, t);
  end loop;
end $$;
grant select, insert, update, delete on public.lead_history, public.revenue_entries, public.admissions, public.admission_sources to authenticated;
grant all on public.lead_history, public.revenue_entries, public.admissions, public.admission_sources to service_role;
do $$ declare t text; begin
  foreach t in array array['revenue_entries','admissions'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t); exception when others then null; end;
  end loop;
end $$;

-- approval reminders are no longer used
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobname) from cron.job where jobname = 'garuda-approvals';
  end if;
exception when others then null;
end $$;

-- fast lead visibility: the same rule as can_see_lead(), written inline so Postgres works out the
-- caller's role once per query instead of once per row (20,000+ leads from the sales sheet)
drop policy if exists p_leads_r on public.leads;
create policy p_leads_r on public.leads for select using (
  (select public.sees_all())
  or owner = (select public.me()) or sourced_by = (select public.me()) or created_by = (select public.me())
  or closed_by = (select public.me()) or support_by = (select public.me())
  or (funnel = 'RPTO' and (select public.my_role()) in ('rpto_counsellor','rpto_presenter'))
  or (funnel = 'CoE' and (select public.my_role()) = 'coe_closer')
  or (funnel = 'CoE' and (select public.my_role()) = 'coe_field'
      and institution_id in (select i.id from public.institutions i where i.owner = (select public.me()))));
drop policy if exists p_leads_u on public.leads;
create policy p_leads_u on public.leads for update using (
  (select public.sees_all())
  or owner = (select public.me()) or sourced_by = (select public.me()) or created_by = (select public.me())
  or closed_by = (select public.me()) or support_by = (select public.me())
  or (funnel = 'RPTO' and (select public.my_role()) in ('rpto_counsellor','rpto_presenter'))
  or (funnel = 'CoE' and (select public.my_role()) = 'coe_closer')
  or (funnel = 'CoE' and (select public.my_role()) = 'coe_field'
      and institution_id in (select i.id from public.institutions i where i.owner = (select public.me()))));
create index if not exists leads_sourced_idx on public.leads(sourced_by);
create index if not exists leads_created_by_idx on public.leads(created_by);

-- =====================================================================
-- v4 · multi-department CRM with hierarchy-based access
--   departments table (no department names in code), lead statuses and deal stages per department,
--   people directory with Reports to, roles C-level / Admin / Manager / Lead / Member + permission switches,
--   leads → deals on one record, field visits, accounts, ad and other campaigns, projects, escalations
-- =====================================================================

-- ---------- departments ----------
create table if not exists public.departments (
  code          text primary key,                       -- short code shown on chips, e.g. RPTO, CoE, DaaS
  name          text not null,
  color         text not null default '#2f7fd0',
  active        boolean not null default true,
  ord           int not null default 10,
  has_admissions boolean not null default false,        -- counts each won deal as an admission (training departments)
  segments      text[] not null default '{}',           -- revenue segments
  loss_reasons  text[] not null default '{Budget,Not interested,No response,Went with a competitor,Timing,Other}',
  courses       text[] not null default '{}',           -- products / courses the team sells (in addition to the price book)
  created_at    timestamptz not null default now()
);
insert into public.departments(code, name, color, ord, has_admissions, segments, loss_reasons, courses) values
 ('RPTO','RPTO Training','#2f7fd0',1,true,
  '{Small,Medium,"Top-Up Medium (Garuda RPC)","Top-Up Medium","TTT (Small)",Refresher,"Extra Flying Hours",Other,"CFMTTI / NERFMTTI Admissions"}',
  '{"Fee too high","Not eligible","Joined another academy","Not interested","No response","Location / timing",Duplicate,Other}',
  '{"Small Class RPC","Medium Class RPC","Small + Medium RPC","Top-up Medium","Train the Trainer (TTT)","Not Specified"}'),
 ('CoE','Centre of Excellence','#14a3a0',2,false,
  '{"UAV Lab - Basic","UAV Lab - Standard","UAV Lab - Advanced","UAV Lab (type not stated)","RPTO Establishment","RPTO Products","IV (Industrial Visit)",Workshop,"Not stated"}',
  '{Budget,"Management not interested","Went with a competitor","No response","Timing / academic calendar",Other}',
  '{"UAV Lab - Basic","UAV Lab - Standard","UAV Lab - Advanced","UAV Lab - Type TBC","RPTO Establishment","RPTO Admissions (Bulk)","IV (Industrial Visit)",Workshop,"Course / Curriculum",Internship,"Faculty Training (FDP)","Collaboration / MoU","Research / Consultancy","Not Specified"}')
on conflict (code) do nothing;

-- department code is now a reference, not a fixed list
do $$ declare r record; begin
  for r in select conrelid::regclass as t, conname from pg_constraint
           where contype = 'c' and connamespace = 'public'::regnamespace
             and conname in ('stages_funnel_check','products_funnel_check','leads_funnel_check','profiles_vertical_check','revenue_entries_department_check',
                             'profiles_role_check','complaints_status_check','complaints_severity_check')
  loop execute format('alter table %s drop constraint %I', r.t, r.conname); end loop;
end $$;
update public.revenue_entries set department = 'RPTO' where department = 'RPTO Training';
do $$ begin
  alter table public.leads add constraint leads_dept_fk foreign key (funnel) references public.departments(code) on update cascade;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.stages add constraint stages_dept_fk foreign key (funnel) references public.departments(code) on update cascade on delete cascade;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.revenue_entries add constraint revenue_dept_fk foreign key (department) references public.departments(code) on update cascade;
exception when duplicate_object then null; end $$;

-- ---------- statuses (lead phase) and stages (deal phase) per department ----------
alter table public.stages add column if not exists kind text not null default 'lead';      -- lead | deal | both
alter table public.stages add column if not exists needs_fee boolean not null default false;  -- fee told to the candidate must be recorded first
alter table public.stages add column if not exists needs_payment boolean not null default false;  -- a payment or PO reference must exist first
do $$ begin alter table public.stages add constraint stages_kind_check check (kind in ('lead','deal','both')); exception when duplicate_object then null; end $$;

create table if not exists public.revenue_targets (
  dept   text not null references public.departments(code) on update cascade on delete cascade,
  month  date not null,
  amount numeric(14,2) not null default 0,
  primary key (dept, month)
);

-- a new department starts with a simple set of statuses and stages that Settings can change
create or replace function public.departments_seed_stages() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.stages(funnel, key, ord, prob, is_won, is_lost, grp, kind, needs_reason) values
    (new.code,'New',1,5,false,false,'Lead','lead',false), (new.code,'Contacted',2,10,false,false,'Lead','lead',false),
    (new.code,'Qualified',3,15,false,false,'Lead','lead',false), (new.code,'Proposal',10,30,false,false,'Pipeline','deal',false),
    (new.code,'Negotiation',11,60,false,false,'Pipeline','deal',false), (new.code,'Won',20,100,true,false,'Won','deal',false),
    (new.code,'Lost',90,0,false,true,'Lost','both',true)
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists trg_departments_seed on public.departments;
create trigger trg_departments_seed after insert on public.departments for each row execute function public.departments_seed_stages();

-- ---------- one record, two phases: lead → deal ----------
alter table public.leads add column if not exists is_deal boolean not null default false;
alter table public.leads add column if not exists deal_at timestamptz;
alter table public.leads add column if not exists stage_changed_at timestamptz default now();
alter table public.leads add column if not exists mkt_campaign_id uuid;
create index if not exists leads_deal_idx on public.leads(is_deal);

-- ---------- people directory, roles and permission switches ----------
alter table public.profiles add column if not exists designation text not null default '';
alter table public.profiles add column if not exists emp_id text not null default '';
alter table public.profiles add column if not exists departments text[] not null default '{}';
alter table public.profiles add column if not exists reports_to uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists daily_report text not null default '';
alter table public.profiles add column if not exists allow_external boolean not null default false;
alter table public.profiles add column if not exists perms jsonb not null default '{}';  -- finance, email, campaigns, export, pricebook, hide_sales
alter table public.profiles add column if not exists deactivated_at timestamptz;
alter table public.profiles alter column role set default 'member';
create unique index if not exists profiles_email_uq on public.profiles(lower(email));
update public.profiles set role = case role
  when 'head' then 'admin' when 'developer' then 'admin' when 'admin' then 'admin'
  when 'shared_exec' then 'manager' when 'finance' then 'member'
  when 'pending' then 'member' else 'member' end,
  perms = perms || case when role = 'finance' then '{"finance":true}'::jsonb else '{}'::jsonb end
 where role not in ('clevel','admin','manager','lead','member');
do $$ begin
  alter table public.profiles add constraint profiles_role_check check (role in ('clevel','admin','manager','lead','member'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_email_domain check (allow_external or email = '' or lower(email) like '%@garudaaerospace.com');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_not_own_manager check (reports_to is null or reports_to <> id);
exception when duplicate_object then null; end $$;

-- no cycles in Reports to
create or replace function public.profiles_no_cycle() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.reports_to is not null and exists (
    with recursive up as (select id, reports_to from public.profiles where id = new.reports_to
                          union select p.id, p.reports_to from public.profiles p join up on p.id = up.reports_to)
    select 1 from up where id = new.id) then
    raise exception '% cannot report to someone who reports to them.', new.full_name;
  end if;
  return new;
end $$;
drop trigger if exists trg_profiles_no_cycle on public.profiles;
create trigger trg_profiles_no_cycle before insert or update of reports_to on public.profiles for each row execute function public.profiles_no_cycle();

-- sign-in: only people on Users & Access can enter; the first sign-in links the account to the profile
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  select * into p from public.profiles where lower(email) = lower(coalesce(new.email,'')) limit 1;
  if not found or not p.active then
    raise exception 'Your email isn''t registered in Garuda CRM. Ask your manager to add you.';
  end if;
  update public.profiles set auth_id = new.id where id = p.id;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---------- role, permission and scope helpers ----------
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = public.me()), 'none') $$;
create or replace function public.my_perm(k text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (perms->>k)::boolean from public.profiles where id = public.me()), false) $$;
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$ select public.me() is not null $$;
create or replace function public.is_head() returns boolean          -- Settings and administration
language sql stable security definer set search_path = public as $$ select public.my_role() = 'admin' $$;
create or replace function public.sees_all() returns boolean         -- every record in every department
language sql stable security definer set search_path = public as $$ select public.my_role() in ('clevel','admin') $$;
create or replace function public.can_finance() returns boolean
language sql stable security definer set search_path = public as $$ select public.my_role() = 'admin' or public.my_perm('finance') $$;
create or replace function public.my_email_access() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() = 'admin' or public.my_perm('email') or coalesce((select email_access from public.profiles where id = public.me()), false) $$;
create or replace function public.can_reassign() returns boolean
language sql stable security definer set search_path = public as $$ select public.my_role() in ('clevel','admin','manager','lead') $$;
-- me + everyone below me in the Reports to tree, at any depth
create or replace function public.scope_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  with recursive t as (select id from public.profiles where id = public.me()
                       union select p.id from public.profiles p join t on p.reports_to = t.id)
  select coalesce(array_agg(id), '{}') from t $$;
create or replace function public.in_scope(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.sees_all() or p = any(public.scope_ids()) $$;
create or replace function public.can_see_lead(l public.leads) returns boolean
language sql stable security definer set search_path = public as $$
  select public.sees_all() or l.owner = any(public.scope_ids()) or l.created_by = public.me() $$;
create or replace function public.can_see_lead_id(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.leads l where l.id = p and (public.sees_all() or l.owner = any(public.scope_ids()) or l.created_by = public.me())) $$;
create or replace function public.can_finance_role() returns boolean language sql stable as $$ select public.can_finance() $$;

-- ---------- row level security keyed on the hierarchy ----------
drop policy if exists p_leads_r on public.leads;
create policy p_leads_r on public.leads for select using (
  (select public.sees_all()) or owner = any((select public.scope_ids())::uuid[]) or created_by = (select public.me()));
drop policy if exists p_leads_u on public.leads;
create policy p_leads_u on public.leads for update using (
  (select public.sees_all()) or owner = any((select public.scope_ids())::uuid[]) or created_by = (select public.me()));
drop policy if exists p_leads_d on public.leads;
create policy p_leads_d on public.leads for delete using (public.is_head());

-- reassigning: Members cannot; everyone else only to people inside their own scope
create or replace function public.leads_owner_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.me() is null or public.is_system() or new.owner is not distinct from old.owner then return new; end if;
  if not public.can_reassign() and not (old.owner is null and new.owner = public.me()) then
    raise exception 'Only managers can reassign leads and deals.';
  end if;
  if new.owner is not null and not public.in_scope(new.owner) then
    raise exception 'You can only assign to people in your team.';
  end if;
  return new;
end $$;
drop trigger if exists trg_leads_owner_guard on public.leads;
create trigger trg_leads_owner_guard before update of owner on public.leads for each row execute function public.leads_owner_guard();

drop policy if exists p_profiles_head on public.profiles;
create policy p_profiles_head on public.profiles for all using (public.is_head()) with check (public.is_head());
drop policy if exists p_profiles_read on public.profiles;
create policy p_profiles_read on public.profiles for select using (public.is_staff());
drop policy if exists p_products_w on public.products;
create policy p_products_w on public.products for all using (public.is_head() or public.my_perm('pricebook')) with check (public.is_head() or public.my_perm('pricebook'));
drop policy if exists p_items_w on public.product_items;
create policy p_items_w on public.product_items for all using (public.is_head() or public.my_perm('pricebook')) with check (public.is_head() or public.my_perm('pricebook'));
drop policy if exists p_pay_u on public.payments;
create policy p_pay_u on public.payments for update using (public.can_finance() or (claimed_by = public.me() and status = 'Claimed'));

-- payments: only Finance (or Admin) can verify
create or replace function public.payments_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.me() is null or public.is_system() then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'Claimed' and not public.can_finance() then new.status := 'Claimed'; end if;
    new.claimed_by := coalesce(new.claimed_by, public.me());
  elsif new.status is distinct from old.status and not public.can_finance() then
    raise exception 'Only Finance can verify or reject payments.';
  end if;
  if new.status = 'Verified' and (tg_op = 'INSERT' or old.status is distinct from 'Verified') then
    new.verified_by := public.me(); new.verified_at := now();
  end if;
  return new;
end $$;

-- ---------- departments, targets: everyone reads, Admin writes ----------
alter table public.departments enable row level security;
alter table public.revenue_targets enable row level security;
drop policy if exists p_dept_r on public.departments; create policy p_dept_r on public.departments for select using (public.is_staff());
drop policy if exists p_dept_w on public.departments; create policy p_dept_w on public.departments for all using (public.is_head()) with check (public.is_head());
drop policy if exists p_rt_r on public.revenue_targets; create policy p_rt_r on public.revenue_targets for select using (public.is_staff());
drop policy if exists p_rt_w on public.revenue_targets; create policy p_rt_w on public.revenue_targets for all using (public.is_head()) with check (public.is_head());

-- ---------- revenue: Finance and C-level/Admin see everything; others see entries on deals in their scope ----------
drop policy if exists p_revenue_entries_r on public.revenue_entries;
create policy p_revenue_entries_r on public.revenue_entries for select using (
  (select public.sees_all()) or (select public.can_finance()) or (lead_id is not null and public.can_see_lead_id(lead_id)));
drop policy if exists p_admissions_r on public.admissions;
create policy p_admissions_r on public.admissions for select using (public.is_staff());

-- ---------- field visits ----------
alter table public.visits add column if not exists status text not null default 'Planned';
alter table public.visits add column if not exists next_step text not null default '';
alter table public.visits add column if not exists next_followup_at timestamptz;
alter table public.visits add column if not exists remarks text not null default '';
alter table public.visits add column if not exists history jsonb not null default '[]';
alter table public.visits add column if not exists created_by uuid default public.me();
alter table public.visits add column if not exists checkin_photo text not null default '';   -- small JPEG (data URL) taken at check-in
do $$ begin alter table public.visits add constraint visits_status_check check (status in ('Planned','Done','Rescheduled','Cancelled')); exception when duplicate_object then null; end $$;
update public.visits set status = 'Done' where checkout_at is not null and status = 'Planned';
create or replace function public.visits_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'Done' and coalesce(new.outcome,'') = '' then raise exception 'Add the outcome before marking the visit Done.'; end if;
  if tg_op = 'UPDATE' and new.planned_at is distinct from old.planned_at then
    new.history := coalesce(old.history,'[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', now(), 'by', public.me(), 'from', old.planned_at, 'to', new.planned_at));
    if new.status = 'Planned' and old.planned_at is not null then new.status := 'Rescheduled'; end if;
  end if;
  if new.owner is not null and public.me() is not null and not public.is_system() and (tg_op = 'INSERT' or new.owner is distinct from old.owner) and not public.in_scope(new.owner) then
    raise exception 'You can only assign visits to people in your team.';
  end if;
  return new;
end $$;
drop trigger if exists trg_visits_rules on public.visits;
create trigger trg_visits_rules before insert or update on public.visits for each row execute function public.visits_rules();
drop policy if exists p_vis_r on public.visits;
create policy p_vis_r on public.visits for select using ((select public.sees_all()) or owner = any((select public.scope_ids())::uuid[]) or created_by = (select public.me()));
drop policy if exists p_vis_i on public.visits;
create policy p_vis_i on public.visits for insert with check (public.is_staff());
drop policy if exists p_vis_u on public.visits;
create policy p_vis_u on public.visits for update using ((select public.sees_all()) or owner = any((select public.scope_ids())::uuid[]) or created_by = (select public.me()));
drop policy if exists p_vis_d on public.visits;
create policy p_vis_d on public.visits for delete using (public.is_head() or created_by = public.me());

-- ---------- accounts (the institutions table: colleges, companies, government bodies) ----------
alter table public.institutions alter column kind set default 'College';
update public.institutions set kind = 'College' where coalesce(kind,'') in ('','Engineering','Arts & Science','Polytechnic','University','Agri','Other college');

-- ---------- campaigns: paid ads and every other marketing activity ----------
create table if not exists public.campaign_types (
  name     text primary key,
  fields   jsonb not null default '[]',   -- [{key, label, type: text|number|date|dropdown, options: []}]
  built_in boolean not null default false,
  ord      int not null default 10
);
insert into public.campaign_types(name, fields, built_in, ord) values
 ('Webinar','[{"key":"registrations","label":"Registrations","type":"number"},{"key":"attendees","label":"Attendees","type":"number"},{"key":"recording","label":"Recording link","type":"text"}]',true,1),
 ('Expo / Event','[{"key":"venue","label":"Venue","type":"text"},{"key":"booth_cost","label":"Booth cost","type":"number"},{"key":"footfall","label":"Footfall","type":"number"}]',true,2),
 ('Referral','[{"key":"reward","label":"Reward per referral","type":"number"}]',true,3),
 ('WhatsApp broadcast','[{"key":"audience","label":"Audience size","type":"number"},{"key":"template","label":"Template name","type":"text"}]',true,4),
 ('College seminar','[{"key":"college","label":"College","type":"text"},{"key":"students","label":"Students attended","type":"number"}]',true,5),
 ('Other','[]',true,9)
on conflict (name) do nothing;
create table if not exists public.mkt_campaigns (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'ad' check (kind in ('ad','other')),
  type        text not null default '',                 -- ad: platform name; other: campaign type
  name        text not null,
  platform    text not null default '',                 -- Meta, Google, LinkedIn, YouTube, Other
  dept        text references public.departments(code) on update cascade,
  ad_link     text not null default '',
  landing_link text not null default '',
  utm         text not null default '',                 -- UTM campaign value used to match web leads
  start_date  date,
  end_date    date,
  budget      numeric(14,2) not null default 0,
  status      text not null default 'Active',
  extra       jsonb not null default '{}',              -- values for the campaign type's extra fields
  event_id    uuid references public.events(id) on delete set null,   -- webinar registrations and payments
  notes       text not null default '',
  owner       uuid references public.profiles(id) default public.me(),
  created_at  timestamptz not null default now()
);
create table if not exists public.campaign_spend (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.mkt_campaigns(id) on delete cascade,
  spent_on    date not null default current_date,
  amount      numeric(14,2) not null,
  note        text not null default '',
  created_by  uuid references public.profiles(id) default public.me(),
  created_at  timestamptz not null default now()
);
do $$ begin alter table public.leads add constraint leads_mkt_campaign_fk foreign key (mkt_campaign_id) references public.mkt_campaigns(id) on delete set null; exception when duplicate_object then null; end $$;
create index if not exists leads_mkt_campaign_idx on public.leads(mkt_campaign_id);
create unique index if not exists mkt_campaigns_utm_uq on public.mkt_campaigns(lower(utm)) where utm <> '';
alter table public.campaign_types enable row level security;
alter table public.mkt_campaigns enable row level security;
alter table public.campaign_spend enable row level security;
create or replace function public.can_campaigns() returns boolean
language sql stable security definer set search_path = public as $$ select public.sees_all() or public.my_perm('campaigns') $$;
drop policy if exists p_ct_r on public.campaign_types; create policy p_ct_r on public.campaign_types for select using (public.is_staff());
drop policy if exists p_ct_w on public.campaign_types; create policy p_ct_w on public.campaign_types for all using (public.is_head()) with check (public.is_head());
drop policy if exists p_mc_r on public.mkt_campaigns; create policy p_mc_r on public.mkt_campaigns for select using (public.is_staff());
drop policy if exists p_mc_w on public.mkt_campaigns; create policy p_mc_w on public.mkt_campaigns for all using (public.can_campaigns()) with check (public.can_campaigns());
drop policy if exists p_cs_r on public.campaign_spend; create policy p_cs_r on public.campaign_spend for select using (public.is_staff());
drop policy if exists p_cs_w on public.campaign_spend; create policy p_cs_w on public.campaign_spend for all using (public.can_campaigns()) with check (public.can_campaigns());
-- web leads are linked to their campaign by the UTM campaign value
create or replace function public.leads_link_campaign() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.mkt_campaign_id is null and coalesce(new.utm->>'campaign', new.utm->>'utm_campaign', '') <> '' then
    select id into new.mkt_campaign_id from public.mkt_campaigns where lower(utm) = lower(coalesce(new.utm->>'campaign', new.utm->>'utm_campaign')) limit 1;
  end if;
  return new;
end $$;
drop trigger if exists trg_leads_link_campaign on public.leads;
create trigger trg_leads_link_campaign before insert on public.leads for each row execute function public.leads_link_campaign();
-- earlier marketing records move into the new campaigns: ad campaigns from the old ad tracker, webinars as type Webinar
insert into public.mkt_campaigns(kind, type, name, platform, dept, utm, start_date, end_date, budget, notes)
select 'ad', c.channel, c.name, case when c.channel ilike '%google%' then 'Google' when c.channel ilike '%meta%' or c.channel ilike '%facebook%' or c.channel ilike '%instagram%' then 'Meta' when c.channel ilike '%linkedin%' then 'LinkedIn' else 'Other' end,
       case when c.funnel in (select code from public.departments) then c.funnel end, coalesce(c.utm_campaign,''), c.start_date, c.end_date, coalesce(c.budget,0), 'Moved from the old campaign tracker'
  from public.campaigns c
 where c.channel ~* '(google|meta|facebook|instagram|linkedin|youtube|ads)' and not exists (select 1 from public.mkt_campaigns m where m.name = c.name and m.kind = 'ad');
insert into public.campaign_spend(campaign_id, spent_on, amount, note)
select m.id, coalesce(c.start_date, current_date), c.spend, 'Spend from the old campaign tracker'
  from public.campaigns c join public.mkt_campaigns m on m.name = c.name and m.kind = 'ad'
 where coalesce(c.spend,0) > 0 and not exists (select 1 from public.campaign_spend s where s.campaign_id = m.id);
insert into public.mkt_campaigns(kind, type, name, dept, start_date, end_date, budget, event_id, extra, notes)
select 'other', 'Webinar', e.title, case when e.segment in (select code from public.departments) then e.segment end, (e.start_at at time zone 'Asia/Kolkata')::date,
       (coalesce(e.end_at, e.start_at) at time zone 'Asia/Kolkata')::date, coalesce(e.cost,0), e.id,
       jsonb_build_object('registrations', (select count(*) from public.event_attendees a where a.event_id = e.id),
                          'attendees', (select count(*) from public.event_attendees a where a.event_id = e.id and a.attended), 'recording', coalesce(e.recording_link,'')),
       'Moved from Webinars'
  from public.events e where e.kind = 'Webinar' and not exists (select 1 from public.mkt_campaigns m where m.event_id = e.id);

-- ---------- projects: created automatically when a deal is won ----------
alter table public.projects add column if not exists dept text references public.departments(code) on update cascade;
alter table public.projects add column if not exists value numeric(14,2) not null default 0;
alter table public.projects add column if not exists deal_owner uuid references public.profiles(id);
alter table public.projects add column if not exists end_date date;
alter table public.projects add column if not exists links text not null default '';
update public.projects set status = case status when 'Planned' then 'Not started' when 'Active' then 'In progress' when 'Done' then 'Completed' else status end
 where status not in ('Not started','In progress','On hold','Completed');
create table if not exists public.project_items (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  kind        text not null check (kind in ('milestone','task','payment')),
  name        text not null,
  due_date    date,
  owner       uuid references public.profiles(id),
  status      text not null default 'Open' check (status in ('Open','In progress','Done','Invoiced','Collected','Cancelled')),
  amount      numeric(14,2) not null default 0,          -- payment milestones, ex-GST
  payment_id  uuid references public.payments(id) on delete set null,
  done_at     timestamptz,
  created_by  uuid references public.profiles(id) default public.me(),
  created_at  timestamptz not null default now()
);
create index if not exists project_items_project on public.project_items(project_id);
create or replace function public.won_deal_project() returns trigger
language plpgsql security definer set search_path = public as $$
declare won boolean;
begin
  select is_won into won from public.stages where funnel = new.funnel and key = new.stage;
  if coalesce(won,false) and (tg_op = 'INSERT' or old.stage is distinct from new.stage) and not public.is_system()
     and not exists (select 1 from public.projects where lead_id = new.id) then
    insert into public.projects(lead_id, institution_id, name, owner, deal_owner, status, dept, value, start_date)
    values (new.id, new.institution_id, new.name, new.owner, new.owner, 'Not started', new.funnel, coalesce(new.value,0), current_date);
  end if;
  return new;
end $$;
drop trigger if exists trg_won_deal_project on public.leads;
create trigger trg_won_deal_project after insert or update of stage on public.leads for each row execute function public.won_deal_project();
-- a collected payment milestone becomes a payment on the deal (Finance verifies it, then it reaches the ledger)
create or replace function public.project_payment_collected() returns trigger
language plpgsql security definer set search_path = public as $$
declare pr record; pid uuid;
begin
  if new.kind <> 'payment' or new.status <> 'Collected' or (tg_op = 'UPDATE' and old.status = 'Collected') or new.payment_id is not null then return new; end if;
  select * into pr from public.projects where id = new.project_id;
  if pr.lead_id is null then return new; end if;
  insert into public.payments(lead_id, amount, amount_ex, status, mode, reference, claimed_by)
  values (pr.lead_id, round(new.amount * 1.18, 2), new.amount, 'Claimed', 'Bank transfer', 'Project milestone: ' || new.name, public.me())
  returning id into pid;
  new.payment_id := pid; new.done_at := now();
  return new;
end $$;
drop trigger if exists trg_project_payment on public.project_items;
create trigger trg_project_payment before insert or update on public.project_items for each row execute function public.project_payment_collected();
alter table public.project_items enable row level security;
create or replace function public.can_see_project(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects x where x.id = p and (public.sees_all() or x.owner = any(public.scope_ids()) or x.deal_owner = any(public.scope_ids())
    or exists (select 1 from public.project_items i where i.project_id = x.id and i.owner = public.me()))) $$;
drop policy if exists p_proj_r on public.projects;
create policy p_proj_r on public.projects for select using (public.can_see_project(id));
drop policy if exists p_proj_w on public.projects;
create policy p_proj_w on public.projects for all using (public.can_see_project(id)) with check (public.is_staff());
drop policy if exists p_pi_r on public.project_items; create policy p_pi_r on public.project_items for select using (public.can_see_project(project_id));
drop policy if exists p_pi_w on public.project_items; create policy p_pi_w on public.project_items for all using (public.can_see_project(project_id)) with check (public.can_see_project(project_id));

-- ---------- escalations (the complaints table) ----------
alter table public.complaints add column if not exists title text not null default '';
alter table public.complaints add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.complaints add column if not exists dept text references public.departments(code) on update cascade;
alter table public.complaints add column if not exists type text not null default 'Customer complaint';
alter table public.complaints add column if not exists owner uuid references public.profiles(id);
alter table public.complaints add column if not exists due_at timestamptz;
alter table public.complaints add column if not exists history jsonb not null default '[]';
update public.complaints set status = case status when 'Escalated' then 'Escalated up' else status end;
update public.complaints set owner = coalesce(owner, escalated_to, raised_by), title = case when title = '' then left(coalesce(description,''), 80) else title end;
do $$ begin alter table public.complaints add constraint complaints_status_check check (status in ('Open','In progress','Escalated up','Resolved','Closed')); exception when duplicate_object then null; end $$;
do $$ begin alter table public.complaints add constraint complaints_severity_check check (severity in ('Low','Medium','High','Critical')); exception when duplicate_object then null; end $$;
create or replace function public.escalation_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare hrs numeric;
begin
  if tg_op = 'INSERT' or new.severity is distinct from old.severity then
    hrs := coalesce((select (value->>new.severity)::numeric from public.settings where key = 'escalation_hours'), 48);
    new.due_at := coalesce(case when tg_op = 'INSERT' then new.created_at else old.created_at end, now()) + make_interval(hours => hrs::int);
  end if;
  new.owner := coalesce(new.owner, new.raised_by, public.me());
  if new.status in ('Resolved','Closed') and new.closed_at is null then new.closed_at := now(); end if;
  return new;
end $$;
drop trigger if exists trg_escalation_rules on public.complaints;
create trigger trg_escalation_rules before insert or update on public.complaints for each row execute function public.escalation_rules();
-- Escalate up: ownership moves to the current owner's Reports to person
create or replace function public.escalate_up(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare cur uuid; up uuid;
begin
  select owner into cur from public.complaints where id = p_id;
  if cur is null then raise exception 'Escalation not found.'; end if;
  if not public.in_scope(cur) and cur <> public.me() then raise exception 'This escalation is outside your team.'; end if;
  select reports_to into up from public.profiles where id = cur;
  if up is null then raise exception 'The current owner has nobody above them to escalate to.'; end if;
  update public.complaints set owner = up, status = 'Escalated up', escalated_to = up, escalated_at = now(),
    history = history || jsonb_build_array(jsonb_build_object('at', now(), 'by', public.me(), 'from', cur, 'to', up))
   where id = p_id;
  return up;
end $$;
drop policy if exists p_comp_r on public.complaints;
create policy p_comp_r on public.complaints for select using ((select public.sees_all()) or owner = any((select public.scope_ids())::uuid[]) or raised_by = (select public.me()));
drop policy if exists p_comp_u on public.complaints;
create policy p_comp_u on public.complaints for update using ((select public.sees_all()) or owner = any((select public.scope_ids())::uuid[]) or raised_by = (select public.me()));

-- ---------- deactivate instead of delete: open work moves to someone else ----------
create or replace function public.deactivate_user(p_user uuid, p_to uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int;
begin
  if not public.is_head() then raise exception 'Only an Admin can deactivate people.'; end if;
  if p_to is null or p_to = p_user then raise exception 'Choose who takes over the open work.'; end if;
  perform set_config('garuda.system','on',true);
  update public.leads l set owner = p_to from public.stages s
   where l.owner = p_user and s.funnel = l.funnel and s.key = l.stage and not s.is_won and not s.is_lost and not s.is_closed;
  get diagnostics k = row_count; n := n + k;
  update public.visits set owner = p_to where owner = p_user and status in ('Planned','Rescheduled'); get diagnostics k = row_count; n := n + k;
  update public.complaints set owner = p_to where owner = p_user and status not in ('Resolved','Closed'); get diagnostics k = row_count; n := n + k;
  update public.projects set owner = p_to where owner = p_user and status <> 'Completed'; get diagnostics k = row_count; n := n + k;
  update public.profiles set reports_to = p_to where reports_to = p_user;
  update public.profiles set active = false, deactivated_at = now() where id = p_user;
  perform set_config('garuda.system','off',true);
  return n;
end $$;

-- ---------- stage rules: statuses belong to leads, stages to deals; gates come from the stage settings ----------
create or replace function public.check_stage_gate() returns trigger
language plpgsql security definer set search_path = public as $$
declare st record;
begin
  if tg_op = 'UPDATE' and new.stage is not distinct from old.stage and new.is_deal is not distinct from old.is_deal then return new; end if;
  select * into st from public.stages where funnel = new.funnel and key = new.stage;
  if not found then raise exception 'Unknown status "%" for %', new.stage, new.funnel; end if;
  if tg_op = 'UPDATE' and new.stage is distinct from old.stage then new.stage_changed_at := now(); end if;
  if new.is_deal and new.deal_at is null then new.deal_at := now(); end if;
  if st.is_won and new.won_at is null then new.won_at := now(); end if;
  if not st.is_won and tg_op = 'UPDATE' and new.won_at is not null then new.won_at := null; end if;
  if st.is_won and new.closed_by is null then new.closed_by := coalesce(public.me(), new.owner); end if;
  if public.me() is null or public.is_system() then return new; end if;
  if st.kind = 'deal' and not new.is_deal then raise exception '"%" is a deal stage. Convert the lead to a deal first.', new.stage; end if;
  if st.kind = 'lead' and new.is_deal then raise exception '"%" is a lead status. Choose a deal stage.', new.stage; end if;
  if st.needs_reason and coalesce(new.lost_reason,'') = '' then raise exception 'Add a loss reason before moving to %', new.stage; end if;
  if st.needs_fee and not (new.fee_disclosed or exists (select 1 from public.price_disclosures where lead_id = new.id)) then
    raise exception 'Record the fee told to the client (price + GST) before moving to %', new.stage;
  end if;
  if st.needs_payment and coalesce(new.po_ref,'') = '' and not public.can_finance()
     and not exists (select 1 from public.payments where lead_id = new.id and status in ('Claimed','Verified')) then
    raise exception 'Record a payment or the PO / contract reference before moving to %', new.stage;
  end if;
  return new;
end $$;

-- an admission is counted when a deal is won in a department that has admissions
create or replace function public.leads_admission() returns trigger
language plpgsql security definer set search_path = public as $$
declare won boolean; adm boolean;
begin
  if public.is_system() then return new; end if;
  select has_admissions into adm from public.departments where code = new.funnel;
  if not coalesce(adm,false) then return new; end if;
  select is_won into won from public.stages where funnel = new.funnel and key = new.stage;
  if coalesce(won,false) then
    insert into public.admissions(month, segment, paid, free, source, lead_id, created_by)
    values (date_trunc('month', coalesce(new.won_at, now()) at time zone 'Asia/Kolkata')::date, public.course_segment(new.course),
            case when new.free_seat then 0 else 1 end, case when new.free_seat then 1 else 0 end, new.source, new.id, public.me())
    on conflict (lead_id) do update set segment = excluded.segment, paid = excluded.paid, free = excluded.free, source = excluded.source;
  elsif tg_op = 'UPDATE' then
    delete from public.admissions where lead_id = new.id;
  end if;
  return new;
end $$;
alter table public.admissions add column if not exists dept text references public.departments(code) on update cascade default 'RPTO';

-- a verified payment is written to the ledger under the deal's department
create or replace function public.payments_to_ledger() returns trigger
language plpgsql security definer set search_path = public as $$
declare l record; adm boolean;
begin
  if tg_op = 'DELETE' then return old; end if;
  if new.status <> 'Verified' then delete from public.revenue_entries where payment_id = new.id; return new; end if;
  select * into l from public.leads where id = new.lead_id;
  select has_admissions into adm from public.departments where code = l.funnel;
  insert into public.revenue_entries(month, department, channel, segment, client, amount, status, opp_ref, lead_id, payment_id, source, created_by)
  values (date_trunc('month', new.paid_on)::date, l.funnel, case when coalesce(adm,false) then 'Academy (direct)' else 'B2B' end,
          case when coalesce(adm,false) then public.course_segment(l.course) else public.coe_segment(l.sub_category) end,
          case when coalesce(adm,false) then l.name else coalesce(nullif(l.org,''), l.name) end,
          new.amount_ex, 'Collected', coalesce(l.ref_id,''), l.id, new.id, 'payment', new.verified_by)
  on conflict (payment_id) do update set month = excluded.month, amount = excluded.amount, segment = excluded.segment, client = excluded.client;
  return new;
end $$;

-- new web leads go round-robin to active sales people of that department
create or replace function public.next_owner(p_funnel text) returns uuid
language plpgsql security definer set search_path = public as $$
declare pick uuid;
begin
  select p.id into pick from public.profiles p
   where p.active and p_funnel = any(p.departments) and p.role in ('member','lead','manager') and not coalesce((p.perms->>'hide_sales')::boolean,false)
   order by (select count(*) from public.leads l where l.owner = p.id and l.created_at > now() - interval '1 day'), p.created_at
   limit 1;
  if pick is null then select id into pick from public.profiles where active and role = 'admin' order by created_at limit 1; end if;
  return pick;
end $$;

-- the sheet's owner names follow the people directory
create or replace function public.link_owner_names() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform set_config('garuda.system','on',true);
  update public.leads l set owner = p.id from public.profiles p
   where l.owner is null and l.owner_name <> '' and p.active
     and lower(trim(l.owner_name)) in (lower(trim(p.full_name)), lower(trim(nullif(p.sheet_name,''))));
  get diagnostics n = row_count;
  perform set_config('garuda.system','off',true);
  return n;
end $$;

grant select, insert, update, delete on public.departments, public.revenue_targets, public.campaign_types, public.mkt_campaigns, public.campaign_spend, public.project_items to authenticated;
grant all on public.departments, public.revenue_targets, public.campaign_types, public.mkt_campaigns, public.campaign_spend, public.project_items to service_role;
do $$ declare t text; begin
  foreach t in array array['visits','complaints','projects','project_items','mkt_campaigns','departments'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t); exception when others then null; end;
  end loop;
end $$;

-- =====================================================================
-- v4.1 · Lead tasks with sub-tasks (MoU ready, visit arrangements, visit preparation …)
-- A task belongs to a lead or deal (or an account), has an owner and a due date,
-- and a list of sub-tasks; each sub-task records the work done. Progress = sub-tasks done.
-- Seen by: C-level / Admin, the task owner's tree, the lead owner's tree, and its creator.
-- =====================================================================
create table if not exists public.work_tasks (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (length(trim(title)) > 0),
  lead_id        uuid references public.leads(id) on delete cascade,
  institution_id uuid references public.institutions(id) on delete set null,
  owner          uuid references public.profiles(id) default public.me(),
  due_date       date,
  priority       text not null default 'Normal' check (priority in ('Low','Normal','High','Urgent')),
  status         text not null default 'Open' check (status in ('Open','In progress','Done','Cancelled')),
  notes          text not null default '',
  updates        jsonb not null default '[]'::jsonb,     -- [{at, by, text}] work-done log
  created_by     uuid references public.profiles(id) default public.me(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  done_at        timestamptz
);
create table if not exists public.work_subtasks (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.work_tasks(id) on delete cascade,
  title      text not null check (length(trim(title)) > 0),
  ord        int not null default 0,
  done       boolean not null default false,
  work_done  text not null default '',
  owner      uuid references public.profiles(id),
  due_date   date,
  done_by    uuid references public.profiles(id),
  done_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists work_tasks_lead on public.work_tasks(lead_id);
create index if not exists work_tasks_owner on public.work_tasks(owner, status, due_date);
create index if not exists work_subtasks_task on public.work_subtasks(task_id, ord);

-- checked on the row itself (a lookup by id cannot see a row that is still being inserted)
create or replace function public.can_see_task_row(p_id uuid, p_owner uuid, p_created_by uuid, p_lead uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.sees_all() or p_owner = any(public.scope_ids()) or p_created_by = public.me()
      or (p_lead is not null and public.can_see_lead_id(p_lead))
      or exists (select 1 from public.work_subtasks s where s.task_id = p_id and s.owner = public.me())
$$;
create or replace function public.can_see_task(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.work_tasks w where w.id = t and public.can_see_task_row(w.id, w.owner, w.created_by, w.lead_id))
$$;
alter table public.work_tasks enable row level security;
alter table public.work_subtasks enable row level security;
drop policy if exists p_wt_r on public.work_tasks;
create policy p_wt_r on public.work_tasks for select using (public.can_see_task_row(id, owner, created_by, lead_id));
drop policy if exists p_wt_i on public.work_tasks;
create policy p_wt_i on public.work_tasks for insert with check (public.is_staff() and (lead_id is null or public.can_see_lead_id(lead_id)) and (owner is null or public.sees_all() or owner = any(public.scope_ids()) or (lead_id is not null and owner = (select l.owner from public.leads l where l.id = lead_id))));
drop policy if exists p_wt_u on public.work_tasks;
create policy p_wt_u on public.work_tasks for update using (public.can_see_task_row(id, owner, created_by, lead_id)) with check (public.is_staff());
drop policy if exists p_wt_d on public.work_tasks;
create policy p_wt_d on public.work_tasks for delete using (public.sees_all() or created_by = public.me() or owner = any(public.scope_ids()));
drop policy if exists p_ws_all on public.work_subtasks;
create policy p_ws_all on public.work_subtasks for all using (public.can_see_task(task_id)) with check (public.can_see_task(task_id));

-- progress bookkeeping: a sub-task ticked records who and when; the task closes itself when every sub-task is done
create or replace function public.work_subtask_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int; d int;
begin
  if tg_op in ('INSERT','UPDATE') then
    if new.done and (tg_op = 'INSERT' or not old.done) then new.done_by := coalesce(public.me(), new.done_by); new.done_at := now(); end if;
    if not new.done then new.done_by := null; new.done_at := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists work_subtask_rules on public.work_subtasks;
create trigger work_subtask_rules before insert or update on public.work_subtasks for each row execute function public.work_subtask_rules();
create or replace function public.work_task_progress() returns trigger
language plpgsql security definer set search_path = public as $$
declare tid uuid := coalesce(new.task_id, old.task_id); n int; d int;
begin
  select count(*), count(*) filter (where done) into n, d from public.work_subtasks where task_id = tid;
  update public.work_tasks set
    status = case when status = 'Cancelled' then status when n > 0 and d = n then 'Done' when d > 0 and status in ('Open','Done') then 'In progress' when d = 0 and status = 'Done' then 'Open' else status end,
    done_at = case when n > 0 and d = n then coalesce(done_at, now()) else null end,
    updated_at = now()
   where id = tid;
  return null;
end $$;
drop trigger if exists work_task_progress on public.work_subtasks;
create trigger work_task_progress after insert or update or delete on public.work_subtasks for each row execute function public.work_task_progress();
create or replace function public.work_task_touch() returns trigger
language plpgsql as $$ begin new.updated_at := now(); if new.status = 'Done' and old.status <> 'Done' then new.done_at := now(); elsif new.status <> 'Done' then new.done_at := null; end if; return new; end $$;
drop trigger if exists work_task_touch on public.work_tasks;
create trigger work_task_touch before update on public.work_tasks for each row execute function public.work_task_touch();

grant select, insert, update, delete on public.work_tasks, public.work_subtasks to authenticated;
grant all on public.work_tasks, public.work_subtasks to service_role;
do $$ declare t text; begin
  foreach t in array array['work_tasks','work_subtasks'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t); exception when others then null; end;
  end loop;
end $$;

-- =====================================================================
-- v4.2 · Sales targets (FY · department · segment · executive), lead transfer between teams,
--        internal chat, anyone can give a task to anyone
-- =====================================================================
-- Yearly revenue targets (ex-GST). person null = the department's (or segment's) team target;
-- a row with a person is that executive's share. Monthly = yearly / 12 unless revenue_targets phase the
-- department by month; weekly = yearly / 52. segment '' = all segments.
create table if not exists public.sales_targets (
  id         uuid primary key default gen_random_uuid(),
  fy         int not null,                                   -- 2026 = FY 2026-27 (April to March)
  dept       text not null references public.departments(code) on update cascade,
  segment    text not null default '',
  person     uuid references public.profiles(id) on delete cascade,
  amount     numeric(14,2) not null default 0 check (amount >= 0),
  updated_by uuid references public.profiles(id) default public.me(),
  updated_at timestamptz not null default now()
);
create unique index if not exists sales_targets_key on public.sales_targets(fy, dept, segment, coalesce(person, '00000000-0000-0000-0000-000000000000'::uuid));
alter table public.sales_targets enable row level security;
drop policy if exists p_st_r on public.sales_targets;
create policy p_st_r on public.sales_targets for select using (public.sees_all() or person is null or person = any(public.scope_ids()));
drop policy if exists p_st_w on public.sales_targets;
create policy p_st_w on public.sales_targets for all
  using (public.sees_all() or (public.can_reassign() and person is not null and person = any(public.scope_ids()) and person <> public.me()))
  with check (public.sees_all() or (public.can_reassign() and person is not null and person = any(public.scope_ids()) and person <> public.me()));

-- move a lead to another team (department): its status starts again at that team's first lead status,
-- and it goes to the person chosen, or round robin in that team
create or replace function public.transfer_lead(p_lead uuid, p_dept text, p_owner uuid default null, p_reason text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare l public.leads; st text; who uuid; frm text;
begin
  if public.me() is null then raise exception 'Not signed in'; end if;
  select * into l from public.leads where id = p_lead;
  if not found or not public.can_see_lead_id(p_lead) then raise exception 'You cannot see this lead.'; end if;
  if not exists (select 1 from public.departments where code = p_dept and active) then raise exception 'Choose an active team.'; end if;
  if l.funnel = p_dept then raise exception 'The lead is already with %.', p_dept; end if;
  select key into st from public.stages where funnel = p_dept and kind in ('lead','both') and not is_won and not is_lost and not is_closed order by ord limit 1;
  if st is null then raise exception '% has no lead statuses yet.', p_dept; end if;
  who := coalesce(p_owner, public.next_owner(p_dept));
  if who is not null and not exists (select 1 from public.profiles where id = who and active) then raise exception 'That person is not active.'; end if;
  frm := l.funnel;
  perform set_config('garuda.system','on',true);
  update public.leads set funnel = p_dept, stage = st, is_deal = false, owner = coalesce(who, owner), stage_changed_at = now(), updated_at = now() where id = p_lead;
  insert into public.remarks(lead_id, author, channel, outcome, text)
    values (p_lead, public.me(), 'Note', 'Note', format('Transferred from %s to %s%s', frm, p_dept, case when coalesce(p_reason,'') <> '' then ': ' || p_reason else '' end));
  perform set_config('garuda.system','off',true);
  return who;
end $$;
grant execute on function public.transfer_lead(uuid, text, uuid, text) to authenticated;

-- internal chat: 'general', 'dept:<code>', 'dm:<id>:<id>' (ids sorted; the same id twice is a note to self)
create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  room       text not null check (room ~ '^(general|dept:[A-Za-z0-9_-]+|dm:[0-9a-f-]{36}:[0-9a-f-]{36})$'),
  sender     uuid not null references public.profiles(id) default public.me(),
  body       text not null check (length(body) between 1 and 4000),
  task_id    uuid references public.work_tasks(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists chat_room_time on public.chat_messages(room, created_at);
alter table public.chat_messages enable row level security;
create or replace function public.can_chat(p_room text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.me() is not null and (p_room = 'general' or p_room like 'dept:%' or (p_room like 'dm:%' and position(public.me()::text in p_room) > 0))
$$;
drop policy if exists p_chat_r on public.chat_messages;
create policy p_chat_r on public.chat_messages for select using (public.can_chat(room));
drop policy if exists p_chat_i on public.chat_messages;
create policy p_chat_i on public.chat_messages for insert with check (public.can_chat(room) and sender = public.me());
drop policy if exists p_chat_u on public.chat_messages;
create policy p_chat_u on public.chat_messages for update using (public.can_chat(room)) with check (public.can_chat(room));
drop policy if exists p_chat_d on public.chat_messages;
create policy p_chat_d on public.chat_messages for delete using (sender = public.me() or public.is_head());

-- tasks: anyone can give a task to anyone in the CRM (the owner then sees it as their own)
drop policy if exists p_wt_i on public.work_tasks;
create policy p_wt_i on public.work_tasks for insert with check (public.is_staff() and (lead_id is null or public.can_see_lead_id(lead_id)) and (owner is null or exists (select 1 from public.profiles p where p.id = owner and p.active)));

grant select, insert, update, delete on public.sales_targets, public.chat_messages to authenticated;
grant all on public.sales_targets, public.chat_messages to service_role;
do $$ declare t text; begin
  foreach t in array array['chat_messages','sales_targets'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t); exception when others then null; end;
  end loop;
end $$;

-- =====================================================================
-- v4.3 · Duplicates are not losses: "closed, not lost" statuses
-- =====================================================================
update public.stages set is_lost = false, is_closed = true, needs_reason = false
 where funnel = 'RPTO' and key in ('Duplicate','Other Department','CoE Leads');
-- chat reactions: { "👍": [profile ids] }
alter table public.chat_messages add column if not exists reactions jsonb not null default '{}'::jsonb;

-- =====================================================================
-- v4.4 · Sign-in: who has signed in, who has a password, who is blocked
-- =====================================================================
-- Admin view of every person's sign-in (Users & Access)
create or replace function public.sign_in_status()
returns table(profile_id uuid, last_sign_in_at timestamptz, invited_at timestamptz, confirmed boolean, has_password boolean, blocked boolean)
language sql stable security definer set search_path = public, auth as $$
  select p.id, u.last_sign_in_at, u.invited_at, u.email_confirmed_at is not null,
         coalesce(u.encrypted_password, '') <> '', coalesce(u.banned_until > now(), false)
    from public.profiles p left join auth.users u on u.id = p.auth_id
   where public.is_head()
$$;
-- the signed-in person: has a password been set yet? (first sign-in from an invite or email link asks for one)
create or replace function public.i_have_password() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce((select encrypted_password <> '' from auth.users where id = auth.uid()), false)
$$;
revoke all on function public.sign_in_status() from public, anon;
revoke all on function public.i_have_password() from public, anon;
grant execute on function public.sign_in_status() to authenticated;
grant execute on function public.i_have_password() to authenticated;

-- =====================================================================
-- v4.5 · Live updates for people and settings; sign-in status that matches how invites work
--   An invite is a sign-in link, so "invited" = the link was sent; "has a password" = the person chose one in the CRM
--   (recorded as pw_set on their sign-in account), not Supabase's internal placeholder password.
-- =====================================================================
do $$ declare t text; begin
  foreach t in array array['profiles','departments','stages','products','product_items','institutions','contacts','mkt_campaigns','campaign_spend','revenue_targets','events','admission_sources','campaign_types'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t); exception when others then null; end;
  end loop;
end $$;
alter table public.departments replica identity full;
alter table public.stages replica identity full;
alter table public.revenue_targets replica identity full;
alter table public.campaign_types replica identity full;
create or replace function public.sign_in_status()
returns table(profile_id uuid, last_sign_in_at timestamptz, invited_at timestamptz, confirmed boolean, has_password boolean, blocked boolean)
language sql stable security definer set search_path = public, auth as $$
  select p.id, u.last_sign_in_at, coalesce(u.invited_at, u.confirmation_sent_at, u.recovery_sent_at), u.email_confirmed_at is not null,
         coalesce((u.raw_user_meta_data->>'pw_set')::boolean, false), coalesce(u.banned_until > now(), false)
    from public.profiles p left join auth.users u on u.id = p.auth_id
   where public.is_head()
$$;
create or replace function public.i_have_password() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce((select (raw_user_meta_data->>'pw_set')::boolean from auth.users where id = auth.uid()), false)
$$;
revoke all on function public.sign_in_status() from public, anon;
revoke all on function public.i_have_password() from public, anon;
grant execute on function public.sign_in_status() to authenticated;
grant execute on function public.i_have_password() to authenticated;
-- =====================================================================
-- v4.5 · Task emails: a task or sub-task given to someone emails them, and the person who gave it
--   Emails go into email_queue; with a Brevo API key in Supabase Vault (name: brevo_api_key) they are sent at once.
-- =====================================================================
insert into public.settings(key, value) values ('notify_email', '{"enabled":true,"from_email":"jaikishore@garudaaerospace.com","from_name":"Garuda CRM","app_url":"https://garuda-crm.vercel.app"}')
on conflict (key) do nothing;
do $$ begin create extension if not exists pg_net; exception when others then null; end $$;

create or replace function public.send_mail(p_to text, p_name text, p_subject text, p_html text, p_rule text default 'task_notify') returns void
language plpgsql security definer set search_path = public as $$
declare cfg jsonb; api_key text; qid uuid; body jsonb;
begin
  if coalesce(p_to, '') = '' then return; end if;
  select value into cfg from public.settings where key = 'notify_email';
  if cfg is not null and coalesce((cfg->>'enabled')::boolean, true) = false then return; end if;
  perform set_config('garuda.system', 'on', true);
  insert into public.email_queue(to_email, to_name, category, subject, html, auto_rule, created_by)
    values (p_to, coalesce(p_name, ''), 'Internal update', p_subject, p_html, p_rule, null) returning id into qid;
  perform set_config('garuda.system', 'off', true);
  if to_regclass('vault.decrypted_secrets') is not null then
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into api_key using 'brevo_api_key';
  end if;
  if coalesce(api_key, '') <> '' and to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null then
    body := jsonb_build_object('sender', jsonb_build_object('email', coalesce(cfg->>'from_email', 'jaikishore@garudaaerospace.com'), 'name', coalesce(cfg->>'from_name', 'Garuda CRM')),
      'to', jsonb_build_array(jsonb_build_object('email', p_to, 'name', coalesce(nullif(p_name, ''), p_to))), 'subject', p_subject, 'htmlContent', p_html);
    execute 'select net.http_post(url := $1, body := $2, params := ''{}''::jsonb, headers := $3, timeout_milliseconds := 8000)'
      using 'https://api.brevo.com/v3/smtp/email', body, jsonb_build_object('api-key', api_key, 'content-type', 'application/json', 'accept', 'application/json');
    update public.email_queue set status = 'Sent', sent_at = now() where id = qid;
  end if;
end $$;
revoke all on function public.send_mail(text, text, text, text, text) from public, anon, authenticated;

create or replace function public.task_mail_html(p_head text, p_title text, p_rows jsonb, p_notes text, p_link text) returns text
language sql immutable as $$
  select '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1c2333">'
    || '<p style="font-size:13px;color:#6b7590;margin:0 0 6px">Garuda CRM</p>'
    || '<h2 style="margin:0 0 4px;font-size:18px">' || public.html_esc(p_head) || '</h2>'
    || '<p style="font-size:16px;font-weight:bold;margin:10px 0 12px">' || public.html_esc(p_title) || '</p>'
    || '<table style="border-collapse:collapse;font-size:14px">'
    || coalesce((select string_agg('<tr><td style="padding:3px 14px 3px 0;color:#6b7590">' || public.html_esc(r->>0) || '</td><td style="padding:3px 0"><b>' || public.html_esc(r->>1) || '</b></td></tr>', '') from jsonb_array_elements(p_rows) r where coalesce(r->>1, '') <> ''), '')
    || '</table>'
    || case when coalesce(p_notes, '') <> '' then '<p style="font-size:14px;line-height:1.5;background:#f3f5fa;border-radius:10px;padding:10px 12px">' || public.html_esc(p_notes) || '</p>' else '' end
    || '<p style="margin:18px 0"><a href="' || p_link || '" style="background:#3a5fd9;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:bold">Open the task</a></p>'
    || '<p style="font-size:12px;color:#8a93a8">You get this email because a task in Garuda CRM was given to you or by you.</p></div>'
$$;

create or replace function public.task_assign_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare giver uuid; a record; g record; url text; rows jsonb; lk text;
begin
  if new.owner is null then return new; end if;
  if tg_op = 'UPDATE' and new.owner is not distinct from old.owner then return new; end if;
  giver := coalesce(public.me(), new.created_by);
  if giver is null or giver = new.owner then return new; end if;
  select full_name, email into a from public.profiles where id = new.owner;
  select full_name, email into g from public.profiles where id = giver;
  url := coalesce((select value->>'app_url' from public.settings where key = 'notify_email'), '') || '/#tasks/' || new.id;
  lk := (select coalesce(nullif(l.name, ''), '') from public.leads l where l.id = new.lead_id);
  rows := jsonb_build_array(jsonb_build_array('Given by', g.full_name), jsonb_build_array('Assigned to', a.full_name),
    jsonb_build_array('Due', to_char(new.due_date, 'DD Mon YYYY')), jsonb_build_array('Priority', new.priority), jsonb_build_array('Lead / deal', lk));
  perform public.send_mail(a.email, a.full_name, 'New task from ' || coalesce(g.full_name, 'Garuda CRM') || ': ' || new.title,
    public.task_mail_html(coalesce(g.full_name, 'Someone') || ' gave you a task', new.title, rows, new.notes, url));
  perform public.send_mail(g.email, g.full_name, 'You assigned a task to ' || coalesce(a.full_name, '') || ': ' || new.title,
    public.task_mail_html('You assigned a task to ' || coalesce(a.full_name, ''), new.title, rows, new.notes, url));
  return new;
end $$;
drop trigger if exists trg_task_assign_notify on public.work_tasks;
create trigger trg_task_assign_notify after insert or update of owner on public.work_tasks for each row execute function public.task_assign_notify();

create or replace function public.subtask_assign_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare giver uuid; a record; g record; t record; url text; rows jsonb;
begin
  if new.owner is null then return new; end if;
  if tg_op = 'UPDATE' and new.owner is not distinct from old.owner then return new; end if;
  select * into t from public.work_tasks where id = new.task_id;
  giver := coalesce(public.me(), t.created_by);
  if giver is null or giver = new.owner then return new; end if;
  select full_name, email into a from public.profiles where id = new.owner;
  select full_name, email into g from public.profiles where id = giver;
  url := coalesce((select value->>'app_url' from public.settings where key = 'notify_email'), '') || '/#tasks/' || new.task_id;
  rows := jsonb_build_array(jsonb_build_array('In task', t.title), jsonb_build_array('Given by', g.full_name), jsonb_build_array('Assigned to', a.full_name),
    jsonb_build_array('Due', to_char(new.due_date, 'DD Mon YYYY')));
  perform public.send_mail(a.email, a.full_name, 'New sub-task from ' || coalesce(g.full_name, 'Garuda CRM') || ': ' || new.title,
    public.task_mail_html(coalesce(g.full_name, 'Someone') || ' gave you a sub-task', new.title, rows, null, url));
  perform public.send_mail(g.email, g.full_name, 'You assigned a sub-task to ' || coalesce(a.full_name, '') || ': ' || new.title,
    public.task_mail_html('You assigned a sub-task to ' || coalesce(a.full_name, ''), new.title, rows, null, url));
  return new;
end $$;
drop trigger if exists trg_subtask_assign_notify on public.work_subtasks;
create trigger trg_subtask_assign_notify after insert or update of owner on public.work_subtasks for each row execute function public.subtask_assign_notify();
