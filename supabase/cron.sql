-- =====================================================================
-- Garuda CRM · scheduled jobs (pg_cron + pg_net)
-- 1. Database → Extensions: enable "pg_cron" and "pg_net".
-- 2. Replace <PROJECT_REF> and <CRON_SECRET> below (CRON_SECRET = the value you set with
--    `supabase secrets set CRON_SECRET=...`). Then run this file in the SQL editor.
-- Times are UTC. 02:00 UTC = 7:30 am IST.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobname) from cron.job where jobname like 'garuda-%';

-- hourly: SLA escalations (no first contact, hot leads overdue)
select cron.schedule('garuda-sla', '5 * * * *', $$ select public.run_sla_checks(); $$);

-- every 30 minutes (8 am to 9 pm IST): Claude re-scores leads that had new remarks, quotes or emails
select cron.schedule('garuda-ai-score', '*/30 2-15 * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/ai',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
    body := '{"action":"score_batch","limit":40}'::jsonb,
    timeout_milliseconds := 120000);
$$);

-- daily 7:30 am IST: lead-age automation, segments, digest
select cron.schedule('garuda-ai-daily', '0 2 * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/ai',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
    body := '{"action":"daily"}'::jsonb,
    timeout_milliseconds := 300000);
$$);

-- every 5 minutes: scheduled campaigns, drip sequences, webinar reminders
select cron.schedule('garuda-email', '*/5 * * * *', $$
  select public.launch_due_campaigns(); select public.run_sequences(); select public.run_webinar_reminders();
$$);

-- every 30 minutes: approval reminders and escalations

-- nightly: keep the audit log to 2 years
select cron.schedule('garuda-audit-trim', '30 20 * * *', $$ delete from public.audit_log where changed_at < now() - interval '2 years'; $$);
