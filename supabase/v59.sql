-- v59 · Gmail Desk: each person connects their own Gmail. Every 10 minutes the CRM reads new mail with Claude,
-- sorts it (founder requests, update requests, client updates, new enquiries, escalations, approvals, meetings, FYI),
-- links it to the lead (or creates the lead), adds tasks, meetings and escalations, and tracks approvals as a tree.
-- Mail stays private: only the mailbox owner sees their Gmail items and approvals. The Google refresh token is never
-- readable from the app (no policies on gmail_accounts; only the server function uses it).

create table if not exists public.gmail_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  email text not null,
  refresh_token text not null,
  last_sync_at timestamptz,
  last_error text,
  connected_at timestamptz not null default now(),
  active boolean not null default true
);
alter table public.gmail_accounts enable row level security;
revoke all on public.gmail_accounts from anon, authenticated;

create table if not exists public.gmail_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  message_id text not null,
  thread_id text,
  received_at timestamptz,
  direction text not null default 'in' check (direction in ('in', 'out')),
  from_email text, from_name text, to_emails text, subject text, snippet text,
  category text not null default 'fyi',
  priority text not null default 'normal' check (priority in ('high', 'normal', 'low')),
  summary text, action_needed text, due_date date,
  lead_id uuid references public.leads(id) on delete set null,
  task_id uuid references public.work_tasks(id) on delete set null,
  visit_id uuid references public.visits(id) on delete set null,
  complaint_id uuid references public.complaints(id) on delete set null,
  approval_id uuid,
  did text[] not null default '{}',
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (user_id, message_id)
);
create index if not exists gmail_items_user on public.gmail_items (user_id, received_at desc);
alter table public.gmail_items enable row level security;
drop policy if exists p_gi_r on public.gmail_items;
create policy p_gi_r on public.gmail_items for select using (user_id = public.me());
drop policy if exists p_gi_u on public.gmail_items;
create policy p_gi_u on public.gmail_items for update using (user_id = public.me()) with check (user_id = public.me());
drop policy if exists p_gi_d on public.gmail_items;
create policy p_gi_d on public.gmail_items for delete using (user_id = public.me());

create table if not exists public.gmail_approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  thread_id text not null,
  subject text,
  item text,
  requester_name text, requester_email text,
  approver_name text, approver_email text,
  lead_id uuid references public.leads(id) on delete set null,
  task_id uuid references public.work_tasks(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'info_needed', 'cancelled')),
  next_step text,
  timeline jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, thread_id)
);
alter table public.gmail_approvals enable row level security;
drop policy if exists p_ga_r on public.gmail_approvals;
create policy p_ga_r on public.gmail_approvals for select using (user_id = public.me() or (lead_id is not null and public.can_see_lead_id(lead_id)));
drop policy if exists p_ga_u on public.gmail_approvals;
create policy p_ga_u on public.gmail_approvals for update using (user_id = public.me()) with check (user_id = public.me());

-- tasks that came from mail
alter table public.work_tasks add column if not exists source text;
alter table public.work_tasks add column if not exists gmail_item_id uuid;

-- my connection, without the token
create or replace function public.my_gmail() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('email', email, 'last_sync_at', last_sync_at, 'last_error', last_error, 'connected_at', connected_at, 'active', active)
  from public.gmail_accounts where user_id = public.me()
$$;
create or replace function public.gmail_disconnect() returns void
language sql security definer set search_path = public as $$
  delete from public.gmail_accounts where user_id = public.me()
$$;
revoke execute on function public.my_gmail(), public.gmail_disconnect() from public, anon;
grant execute on function public.my_gmail(), public.gmail_disconnect() to authenticated;

-- the 10-minute sync: the database hands the server function a one-time ticket (no shared password needed)
create table if not exists public.job_tickets (id uuid primary key default gen_random_uuid(), job text not null, expires_at timestamptz not null default now() + interval '3 minutes');
alter table public.job_tickets enable row level security;
revoke all on public.job_tickets from anon, authenticated;

create or replace function public.kick_gmail_sync() returns void
language plpgsql security definer set search_path = public as $$
declare t uuid; base text;
begin
  if not exists (select 1 from public.gmail_accounts where active) then return; end if;
  delete from public.job_tickets where expires_at < now();
  insert into public.job_tickets (job) values ('gmail') returning id into t;
  base := coalesce((select value->>'functions_url' from public.settings where key = 'gmail'), 'https://bnhcdkkdiadesosuclpz.supabase.co/functions/v1');
  perform net.http_post(url := base || '/gmail', headers := jsonb_build_object('Content-Type', 'application/json'),
                        body := jsonb_build_object('action', 'cron', 'ticket', t), timeout_milliseconds := 140000);
end $$;
revoke execute on function public.kick_gmail_sync() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'garuda-gmail-sync';
    perform cron.schedule('garuda-gmail-sync', '*/10 * * * *', 'select public.kick_gmail_sync()');
  end if;
end $$;

-- new leads found in mail get this source
update public.settings set value = value || '["Email - Gmail"]'::jsonb where key = 'sources' and not (value ? 'Email - Gmail');
-- people whose emails count as founder / leadership requests (edit in Settings → Gmail)
insert into public.settings (key, value) values ('gmail', '{"leaders":[{"name":"Agnishwar Jayaprakash","alias":"Agni sir","role":"Founder & CEO"}],"lookback_days":3}')
on conflict (key) do nothing;
