-- Enable pguuid if not already
create extension if not exists "pgcrypto";

-- Orgs: shared namespace for packages
create table orgs (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  description text,
  creator_id  uuid references auth.users not null,
  created_at  timestamptz default now()
);

-- Org membership: one row per user per org
create table org_members (
  org_id    uuid references orgs on delete cascade,
  user_id   uuid references auth.users on delete cascade,
  role      text not null check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz default now(),
  primary key (org_id, user_id)
);

-- Teams within an org
create table org_teams (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid references orgs on delete cascade not null,
  name      text not null,
  created_at timestamptz default now(),
  unique (org_id, name)
);

-- Team membership
create table org_team_members (
  team_id   uuid references org_teams on delete cascade,
  user_id   uuid references auth.users on delete cascade,
  joined_at timestamptz default now(),
  primary key (team_id, user_id)
);

-- Per-package permissions granted to a team
create table org_package_permissions (
  team_id      uuid references org_teams on delete cascade,
  package_name text not null,
  permission   text check (permission in ('read', 'write', 'admin')),
  primary key (team_id, package_name)
);

-- Invite links
create table org_invites (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid references orgs on delete cascade not null,
  token      text unique not null,
  created_by uuid references auth.users not null,
  created_at timestamptz default now(),
  expires_at timestamptz,
  max_uses   integer,
  use_count  integer default 0
);

-- Add owner_type to packages (non-null default 'user' for existing rows)
alter table packages add column owner_type text not null default 'user'
  check (owner_type in ('user', 'org'));

-- RLS
alter table orgs enable row level security;
alter table org_members enable row level security;
alter table org_teams enable row level security;
alter table org_team_members enable row level security;
alter table org_package_permissions enable row level security;
alter table org_invites enable row level security;

-- Orgs: public read; creator (owner) can update
create policy "public read orgs" on orgs for select using (true);
create policy "public insert orgs" on orgs for insert with check (auth.uid() = creator_id);

-- Org members: public read; admins/owners manage
create policy "public read org_members" on org_members for select using (true);
create policy "admins manage org_members" on org_members
  for all using (
    exists (select 1 from org_members m2 where m2.org_id = org_members.org_id and m2.user_id = auth.uid() and m2.role in ('owner', 'admin'))
  );

-- Teams: public read; admins/owners manage
create policy "public read org_teams" on org_teams for select using (true);
create policy "admins manage org_teams" on org_teams
  for all using (
    exists (select 1 from org_members where org_id = org_teams.org_id and user_id = auth.uid() and role in ('owner', 'admin'))
  );

-- Team members: public read; admins/owners manage
create policy "public read org_team_members" on org_team_members for select using (true);
create policy "admins manage org_team_members" on org_team_members
  for all using (
    exists (
      select 1 from org_teams t
      join org_members m on m.org_id = t.org_id and m.user_id = auth.uid()
      where t.id = team_id and m.role in ('owner', 'admin')
    )
  );

-- Package permissions: public read; admins/owners manage
create policy "public read org_package_permissions" on org_package_permissions for select using (true);
create policy "admins manage org_package_permissions" on org_package_permissions
  for all using (
    exists (
      select 1 from org_teams t
      join org_members m on m.org_id = t.org_id and m.user_id = auth.uid()
      where t.id = team_id and m.role in ('owner', 'admin')
    )
  );

-- Invites: admins/owners can create; anyone authenticated can use (via token lookup)
create policy "admins create invites" on org_invites
  for insert with check (
    exists (select 1 from org_members where org_id = org_invites.org_id and user_id = auth.uid() and role in ('owner', 'admin'))
  );
create policy "admins read invites" on org_invites
  for select using (
    exists (select 1 from org_members where org_id = org_invites.org_id and user_id = auth.uid() and role in ('owner', 'admin'))
  );
