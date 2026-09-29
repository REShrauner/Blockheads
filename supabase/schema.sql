-- Blockheads Quilting Bee - Supabase schema
-- Run this once in your Supabase project's SQL Editor (Dashboard > SQL Editor > New query > paste > Run).
-- Then also run the "Storage bucket" section's instructions below (creating a
-- bucket itself has to be done from Storage > New bucket, SQL can't do that part).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Profiles: one row per signed-in person, holding their role. Rows are
-- created by the create-user Edge Function when a membership request is
-- approved (or when the superuser creates an admin directly) - never by the
-- client, so there is deliberately no insert policy below for regular users.
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'member' check (role in ('superuser', 'admin', 'member')),
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Looks up the signed-in user's role. security definer so this can read
-- profiles even from inside profiles' own RLS policies without recursing.
create or replace function my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

alter table profiles enable row level security;

-- Everyone signed in can see their own profile; admins and the superuser
-- can see everyone's (needed for the Members screen).
create policy "Read your own profile, or all of them as admin/superuser"
on profiles for select
to authenticated
using (id = auth.uid() or my_role() in ('admin', 'superuser'));

-- Only the superuser changes roles (e.g. promoting/demoting an admin) or
-- removes a profile.
create policy "Superuser can update any profile"
on profiles for update
to authenticated
using (my_role() = 'superuser')
with check (my_role() = 'superuser');

create policy "Superuser can delete a profile"
on profiles for delete
to authenticated
using (my_role() = 'superuser');

-- ---------------------------------------------------------------------------
-- Membership requests: the public "Request Access" form writes here before
-- anyone has a login, so the insert policy below deliberately allows the
-- anonymous role too.
-- ---------------------------------------------------------------------------
create table if not exists membership_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  -- Chosen by the requester on the form, same as the Guild Auction app's
  -- account-request flow. The create-user Edge Function uses it to create
  -- their real login the moment an admin approves - so there's no email
  -- deliverability step in between and nothing else to configure.
  password text not null,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz
);

alter table membership_requests enable row level security;

create policy "Anyone can submit a request"
on membership_requests for insert
to anon, authenticated
with check (status = 'pending' and decided_by is null and decided_at is null);

create policy "Admins and superuser can read requests"
on membership_requests for select
to authenticated
using (my_role() in ('admin', 'superuser'));

create policy "Admins and superuser can decide requests"
on membership_requests for update
to authenticated
using (my_role() in ('admin', 'superuser'))
with check (my_role() in ('admin', 'superuser'));

create policy "Superuser can delete a request"
on membership_requests for delete
to authenticated
using (my_role() = 'superuser');

-- ---------------------------------------------------------------------------
-- Projects: the icon-based menu. icon_path points at a file in the
-- project-files storage bucket (see below); project files themselves live
-- in that same bucket, listed by prefix rather than tracked in a table.
-- ---------------------------------------------------------------------------
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  icon_path text,
  created_by uuid references auth.users(id),
  -- Set by the client at insert time from the creating admin's own profile,
  -- so the detail page can show "Added by ___" without needing every member
  -- to have read access to other people's profile rows.
  created_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists projects_name_idx on projects (name);

alter table projects enable row level security;

create policy "Everyone signed in can read projects"
on projects for select
to authenticated
using (true);

create policy "Admins and superuser manage projects"
on projects for all
to authenticated
using (my_role() in ('admin', 'superuser'))
with check (my_role() in ('admin', 'superuser'));

-- ---------------------------------------------------------------------------
-- Calendar events: meeting dates, each optionally tied to a project.
-- ---------------------------------------------------------------------------
create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  start_time time,
  end_time time,
  title text not null,
  project_id uuid references projects(id) on delete set null,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists calendar_events_date_idx on calendar_events (event_date);

-- Added later: optional start/end times (blank = all-day). Safe to re-run.
alter table calendar_events add column if not exists start_time time;
alter table calendar_events add column if not exists end_time time;

alter table calendar_events enable row level security;

create policy "Everyone signed in can read calendar events"
on calendar_events for select
to authenticated
using (true);

create policy "Admins and superuser manage calendar events"
on calendar_events for all
to authenticated
using (my_role() in ('admin', 'superuser'))
with check (my_role() in ('admin', 'superuser'));

-- ---------------------------------------------------------------------------
-- Storage bucket: project-files
--
-- Do this part by hand first (SQL can't create a bucket):
--   Dashboard > Storage > New bucket > name it exactly "project-files" >
--   leave it PRIVATE (not public) - access is controlled by the policies
--   below, same as every other table here.
--
-- Path convention the app uses:
--   <project id>/icon/<filename>   - the project's icon photo
--   <project id>/files/<filename>  - everything else attached to it
--
-- Then run the policies below.
-- ---------------------------------------------------------------------------
create policy "Everyone signed in can read project files"
on storage.objects for select
to authenticated
using (bucket_id = 'project-files');

create policy "Admins and superuser manage project files"
on storage.objects for all
to authenticated
using (bucket_id = 'project-files' and my_role() in ('admin', 'superuser'))
with check (bucket_id = 'project-files' and my_role() in ('admin', 'superuser'));
