-- Add verified column to orgs table
-- Verified orgs display a badge on their packages
alter table orgs add column verified boolean not null default false;

-- Add verified column to packages table
-- This allows verified status to be set per-package (for user-owned packages)
-- or inherited from org ownership
alter table packages add column verified boolean not null default false;

-- RLS for verified column (public read, only owners/admins can update)
alter table orgs enable row level security;
alter table packages enable row level security;

-- Policy: everyone can read verified status
create policy "public read org verified" on orgs for select using (true);
create policy "public read package verified" on packages for select using (true);

-- Policy: org admins/owners can update verified status
create policy "admins manage org verified" on orgs
  for update using (
    exists (select 1 from org_members where org_id = orgs.id and user_id = auth.uid() and role in ('owner', 'admin'))
  );

-- Policy: package owners can update verified status
create policy "owners manage package verified" on packages
  for update using (auth.uid() = owner_id);

-- Add comment to help others understand the verification process
comment on column orgs.verified is 'Org has been verified by Lectern administrators. Verified orgs display a badge on their packages.';
comment on column packages.verified is 'Package is from a verified publisher. Set automatically for org-owned packages when org.verified=true, or manually for user-owned packages.';