-- Add deprecation fields to packages table
alter table packages add column if not exists deprecated boolean not null default false;
alter table packages add column if not exists deprecation_message text;
alter table packages add column if not exists deprecated_at timestamptz;
alter table packages add column if not exists deprecated_by uuid references auth.users;

-- RLS already enabled on packages table (from 001_initial.sql)
-- Existing policies: public read, owner insert
-- Add owner update policy for deprecation fields
create policy "owner can update deprecation"
  on packages for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);
