-- v58 · Field visits become Meetings: where it happens (our office, their place, another venue, online),
-- the venue with its state and district, and the reasons list (initial meet, demo, workshop, MoU signing, event participation …)
alter table public.visits add column if not exists meet_place text;
alter table public.visits add column if not exists venue text;
alter table public.visits add column if not exists state text;
alter table public.visits add column if not exists district text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'visits_meet_place_chk') then
    alter table public.visits add constraint visits_meet_place_chk check (meet_place is null or meet_place in ('our_office', 'client_place', 'other_venue', 'online'));
  end if;
end $$;
update public.visits set meet_place = 'client_place' where meet_place is null;
-- older visits had no link rule exceptions; events, workshops and trainings may now stand alone
insert into public.settings (key, value) values ('visit_purposes',
  '["Initial meet","Demo","Workshop","MoU signing","Event participation","Proposal discussion","Follow-up","Training","Lab survey","Other"]')
on conflict (key) do update set value = excluded.value;
