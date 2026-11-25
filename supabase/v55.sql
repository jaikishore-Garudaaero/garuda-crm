-- v55 · one kind of project task: tasks added under "Milestones & tasks" become real project tasks
-- (with sub-tasks, remarks and % complete); milestones and payment milestones stay as they are
insert into public.work_tasks (title, project_id, owner, due_date, status, created_by, created_at, start_date, done_at, priority)
select i.name, i.project_id, i.owner, i.due_date,
       case when i.status in ('Done', 'Collected') then 'Done' when i.status = 'Cancelled' then 'Cancelled' else 'Open' end,
       coalesce(i.created_by, i.owner), i.created_at, i.created_at::date, i.done_at, 'Normal'
  from public.project_items i where i.kind = 'task';
delete from public.project_items where kind = 'task';
