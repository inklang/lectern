-- Create public users table/view for profile lookups
-- This mirrors auth.users with a user_name column for easy lookup

-- Create users table if it doesn't exist
create table if not exists public.users (
  id         uuid primary key references auth.users on delete cascade,
  user_name  text unique not null,
  email      text,
  created_at timestamptz default now()
);

-- Create index for fast username lookups
create index if not exists idx_users_user_name on public.users(user_name);

-- RLS: public read, users can update their own profile
alter table public.users enable row level security;

-- Policy: anyone can read users (for profile lookups)
create policy "public read users" on public.users for select using (true);

-- Policy: users can update their own profile
create policy "users update own profile" on public.users for update using (auth.uid() = id);

-- Policy: users can insert their own profile (on signup)
create policy "users insert own profile" on public.users for insert with check (auth.uid() = id);

-- Create or replace function to sync user meta to public.users
-- This should be called by a trigger on auth.users
create or replace function sync_user_to_public_users()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.users (id, user_name, email)
  values (
    new.id,
    new.raw_user_meta_data->>'preferred_username',
    new.email
  )
  on conflict (id) do update set
    user_name = excluded.user_name,
    email = excluded.email;
  return new;
end;
$$;

-- Create trigger to automatically sync auth.users to public.users
drop trigger if exists on_auth_user_changes on auth.users;
create trigger on_auth_user_changes
  after insert or update on auth.users
  for each row execute function sync_user_to_public_users();

-- Backfill existing auth.users into public.users
insert into public.users (id, user_name, email)
select
  id,
  raw_user_meta_data->>'preferred_username',
  email
from auth.users
on conflict (id) do update set
  user_name = excluded.user_name,
  email = excluded.email;
