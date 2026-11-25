-- v56 · Recurring tasks (daily routines) and reminders
-- A task can repeat: daily, weekdays (Mon–Sat), weekly or monthly. When it is marked Done, the next one is
-- created on the next due date with the same owner, project, description and sub-tasks (unticked).
-- A task can carry a reminder time (India time). Every 5 minutes the CRM reminds the owner of open tasks that are
-- due today or late and whose reminder time has passed: a notification in the CRM (bell + pop-up) and, if asked, an email.

alter table public.work_tasks add column if not exists recur text;
alter table public.work_tasks add column if not exists remind_time time;
alter table public.work_tasks add column if not exists remind_email boolean not null default false;
alter table public.work_tasks add column if not exists last_reminded_on date;
alter table public.work_tasks add column if not exists series_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'work_tasks_recur_chk') then
    alter table public.work_tasks add constraint work_tasks_recur_chk check (recur is null or recur in ('daily', 'weekdays', 'weekly', 'monthly'));
  end if;
end $$;
create index if not exists work_tasks_remind on public.work_tasks (remind_time) where remind_time is not null and status in ('Open', 'In progress');

-- the next date for a repeating task (weekdays skips Sundays: the team works Monday to Saturday)
create or replace function public.next_recur_date(p_recur text, p_from date) returns date
language plpgsql immutable as $$
declare d date;
begin
  if p_recur = 'daily' then return p_from + 1; end if;
  if p_recur = 'weekly' then return p_from + 7; end if;
  if p_recur = 'monthly' then return (p_from + interval '1 month')::date; end if;
  if p_recur = 'weekdays' then
    d := p_from + 1;
    while extract(isodow from d) = 7 loop d := d + 1; end loop;
    return d;
  end if;
  return null;
end $$;

-- when a repeating task is done, create the next one
create or replace function public.recur_next() returns trigger
language plpgsql security definer set search_path = public as $$
declare base date; nxt date; nid uuid; today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if new.recur is null or new.status <> 'Done' or old.status = 'Done' then return new; end if;
  base := greatest(coalesce(new.due_date, today), today - 1);
  nxt := public.next_recur_date(new.recur, base);
  if nxt <= today and new.recur <> 'monthly' then nxt := public.next_recur_date(new.recur, today); end if;
  insert into public.work_tasks (title, notes, lead_id, institution_id, project_id, owner, created_by, status, priority,
                                 start_date, due_date, recur, remind_time, remind_email, series_id)
  values (new.title, new.notes, new.lead_id, new.institution_id, new.project_id, new.owner, coalesce(new.created_by, new.owner), 'Open', new.priority,
          nxt, nxt, new.recur, new.remind_time, new.remind_email, coalesce(new.series_id, new.id))
  returning id into nid;
  insert into public.work_subtasks (task_id, title, ord, owner)
    select nid, s.title, s.ord, s.owner from public.work_subtasks s where s.task_id = new.id order by s.ord;
  -- the finished one stays in history; only the newest one in the series repeats
  update public.work_tasks set recur = null, series_id = coalesce(series_id, id) where id = new.id;
  return new;
end $$;
drop trigger if exists trg_recur_next on public.work_tasks;
create trigger trg_recur_next after update of status on public.work_tasks for each row execute function public.recur_next();

-- reminders: run every 5 minutes
create or replace function public.run_task_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare t record; n int := 0; today date := (now() at time zone 'Asia/Kolkata')::date; nowt time := (now() at time zone 'Asia/Kolkata')::time;
        app text; p record;
begin
  select coalesce(value->>'app_url', '') into app from public.settings where key = 'notify_email';
  for t in select * from public.work_tasks
           where remind_time is not null and status in ('Open', 'In progress') and owner is not null
             and coalesce(due_date, today) <= today and remind_time <= nowt
             and (last_reminded_on is null or last_reminded_on < today) loop
    insert into public.notifications (user_id, kind, title, body, lead_id, link)
    values (t.owner, case when t.due_date < today then 'bad' else 'warn' end,
            case when t.due_date < today then 'Late: ' else 'Reminder: ' end || t.title,
            case when t.due_date < today then 'Was due ' || to_char(t.due_date, 'DD Mon') else 'Due today' end
              || case when t.recur is not null then ' · repeats ' || t.recur else '' end,
            t.lead_id, 'tasks/' || t.id);
    if t.remind_email then
      select full_name, email into p from public.profiles where id = t.owner and active;
      if p.email is not null then
        perform public.send_mail(p.email, p.full_name, 'Reminder: ' || t.title,
          '<p>Hi ' || coalesce(split_part(p.full_name, ' ', 1), '') || ',</p><p>This is your reminder for <b>' || replace(replace(t.title, '<', '&lt;'), '>', '&gt;') || '</b>'
          || case when t.due_date < today then ' (it was due ' || to_char(t.due_date, 'DD Mon') || ').' else ' (due today).' end || '</p>'
          || case when app <> '' then '<p><a href="' || app || '/#tasks/' || t.id || '">Open the task</a></p>' else '' end, 'task_reminder');
      end if;
    end if;
    update public.work_tasks set last_reminded_on = today where id = t.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.run_task_reminders() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'garuda-task-reminders';
    perform cron.schedule('garuda-task-reminders', '*/5 * * * *', 'select public.run_task_reminders()');
  end if;
end $$;

-- reminder bookkeeping does not belong in the activity log
do $$
declare d text;
begin
  d := pg_get_functiondef('public.audit_row'::regproc);
  if position('last_reminded_on' in d) = 0 then
    d := replace(d, '''runs'',''history'',''updates'')', '''runs'',''history'',''updates'',''last_reminded_on'')');
    execute d;
  end if;
end $$;

-- the next copy of a routine is not announced as a "new task" email every day
do $$
declare d text;
begin
  d := pg_get_functiondef('public.task_assign_notify'::regproc);
  if position('series_id' in d) = 0 then
    d := replace(d, 'if new.owner is null then return new; end if;', 'if new.owner is null then return new; end if;
  if tg_op = ''INSERT'' and new.series_id is not null then return new; end if;');
    execute d;
  end if;
end $$;
