-- Blockheads - Coming Attractions (run once in Supabase: SQL Editor > New query > paste > Run).
-- Safe to re-run. The same statements are also appended to schema.sql for new installs.

-- Attractions: programs / speakers shown on the Coming Attractions page.
-- Speaker and date are optional. Everyone signed in reads; only admins and
-- the superuser write.
create table if not exists attractions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  speaker text,
  attraction_date date,
  created_by uuid references auth.users(id),
  created_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists attractions_date_idx on attractions (attraction_date);

alter table attractions enable row level security;

drop policy if exists "Everyone signed in can read attractions" on attractions;
create policy "Everyone signed in can read attractions"
on attractions for select
to authenticated
using (true);

drop policy if exists "Admins and superuser manage attractions" on attractions;
create policy "Admins and superuser manage attractions"
on attractions for all
to authenticated
using (my_role() in ('admin', 'superuser'))
with check (my_role() in ('admin', 'superuser'));

-- Attraction notes: private scratchpad for admins about possible attractions.
-- Members cannot read these.
create table if not exists attraction_notes (
  id uuid primary key default gen_random_uuid(),
  body text not null,
  created_by uuid references auth.users(id),
  created_by_name text,
  created_at timestamptz not null default now()
);

alter table attraction_notes enable row level security;

drop policy if exists "Admins and superuser manage attraction notes" on attraction_notes;
create policy "Admins and superuser manage attraction notes"
on attraction_notes for all
to authenticated
using (my_role() in ('admin', 'superuser'))
with check (my_role() in ('admin', 'superuser'));
