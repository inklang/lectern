# Design: Org Ownership for Lectern

**Date:** 2026-03-24

## Overview

Add organizations (orgs) as package owners alongside individual users. Packages can be owned by a user or an org. Orgs have teams with members, and each team gets granular per-package permissions (`read`, `write`, `admin`).

Model follows GitHub's approach: users and orgs share a flat namespace, collision prevented at org creation time.

---

## 1. Data Model

### New tables

```sql
-- Orgs: shared namespace for packages
create table orgs (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,         -- URL-safe name, e.g. "inklang"
  name        text not null,                -- display name, e.g. "Inklang Team"
  description text,
  creator_id  uuid references auth.users not null,
  created_at  timestamptz default now()
);

-- Org membership: one row per user per org, tracks their highest org-level role
create table org_members (
  org_id    uuid references orgs on delete cascade,
  user_id   uuid references auth.users on delete cascade,
  role      text check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz default now(),
  primary key (org_id, user_id)
);

-- Teams within an org
create table org_teams (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid references orgs on delete cascade not null,
  name     text not null,                   -- e.g. "owners", "core", "contributors"
  created_at timestamptz default now(),
  unique (org_id, name)
);

-- Team membership
create table org_team_members (
  team_id  uuid references org_teams on delete cascade,
  user_id  uuid references auth.users on delete cascade,
  joined_at timestamptz default now(),
  primary key (team_id, user_id)
);

-- Per-package permissions granted to a team
create table org_package_permissions (
  team_id        uuid references org_teams on delete cascade,
  package_name   text not null,
  permission     text check (permission in ('read', 'write', 'admin')),
  primary key (team_id, package_name)
);
```

### Changes to existing tables

```sql
-- Add owner_type discriminator to packages
alter table packages add column owner_type text not null default 'user'
  check (owner_type in ('user', 'org'));

-- owner_id still references auth.users, but for org-owned packages
-- it holds the user_id of the org creator (the actor)
```

### Migration: existing packages

All packages where `owner_id` is set keep `owner_type = 'user'`. No data change needed.

### RLS

```sql
alter table orgs enable row level security;
alter table org_members enable row level security;
alter table org_teams enable row level security;
alter table org_team_members enable row level security;
alter table org_package_permissions enable row level security;

-- Orgs: anyone can read; creator (owner) can update/delete
create policy "public read orgs" on orgs for select using (true);
create policy "owners manage orgs" on orgs for update using (auth.uid() = creator_id);

-- Org members: anyone can see member list; members manage themselves
create policy "public read org_members" on org_members for select using (true);
create policy "admins manage members" on org_members
  for all using (
    exists (select 1 from org_members where org_id = org_members.org_id and user_id = auth.uid() and role in ('owner', 'admin'))
  );

-- Teams: org members can read team list
create policy "members read teams" on org_teams
  for select using (
    exists (select 1 from org_members where org_id = org_teams.org_id and user_id = auth.uid())
  );

-- Only admins/owners can manage teams
create policy "admins manage teams" on org_teams
  for all using (
    exists (select 1 from org_members where org_id = org_teams.org_id and user_id = auth.uid() and role in ('owner', 'admin'))
  );

-- Team members: org members can see who's on a team
create policy "members read team members" on org_team_members
  for select using (
    exists (select 1 from org_members where org_id in (select org_id from org_teams where id = team_id) and user_id = auth.uid())
  );

-- Only team admins/owners can manage team membership
create policy "admins manage team members" on org_team_members
  for all using (
    exists (
      select 1 from org_teams t
      join org_members m on m.org_id = t.org_id and m.user_id = auth.uid()
      where t.id = team_id and m.role in ('owner', 'admin')
    )
  );

-- Package permissions: org members can read
create policy "members read package permissions" on org_package_permissions
  for select using (
    exists (
      select 1 from org_teams t
      join org_members m on m.org_id = t.org_id and m.user_id = auth.uid()
      where t.id = team_id
    )
  );

-- Only admin team members can manage package permissions
create policy "admins manage package permissions" on org_package_permissions
  for all using (
    exists (
      select 1 from org_teams t
      join org_members m on m.org_id = t.org_id and m.user_id = auth.uid()
      where t.id = team_id and m.role in ('owner', 'admin')
    )
  );
```

---

## 2. Ownership & Publish Authorization

### Resolving publish permission

When `quill publish` sends a token and tries to publish `pkg-name@version`:

1. Resolve token → `userId`
2. Get `packages` row for `pkg-name`
3. If `owner_type = 'user'`: allow iff `owner_id = userId`
4. If `owner_type = 'org'`: check org membership:
   - User must be in `org_members` with any role
   - AND user must be on a team that has `permission` ≥ `write` for this `package_name`
   - If no per-package entry exists, deny (no implicit access)

### New `db.ts` functions

```typescript
// Get all orgs a user is a member of
getUserOrgs(userId: string): Promise<Org[]>

// Check if user can publish to a package (returns true/false)
canUserPublish(userId: string, packageName: string): Promise<boolean>

// Get org by slug
getOrgBySlug(slug: string): Promise<Org | null>

// Get org members
getOrgMembers(orgId: string): Promise<OrgMember[]>

// Get teams in org
getOrgTeams(orgId: string): Promise<OrgTeam[]>

// Get team members
getTeamMembers(teamId: string): Promise<OrgTeamMember[]>

// Get all packages in an org
getOrgPackages(orgId: string): Promise<PackageRow[]>

// Get teams + their package permissions for a specific package
getTeamsForPackage(orgId: string, packageName: string): Promise<{ team: OrgTeam; permission: string }[]>
```

---

## 3. Invite System

Orgs generate invite links. Anyone with the link can join as `member` role.

```sql
create table org_invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references orgs on delete cascade not null,
  token       text unique not null,         -- random 16-char hex
  created_by   uuid references auth.users not null,
  created_at  timestamptz default now(),
  expires_at  timestamptz,                   -- null = never expires
  max_uses    integer,                      -- null = unlimited
  use_count   integer default 0
);
```

```sql
-- Invite link: anyone authenticated can use it (if not expired / under limit)
create policy "auth users use invites" on org_invites
  for update using (true);  -- just for incrementing use_count
```

### API

- `POST /api/orgs/:slug/invite` — generate invite link (owner/admin only). Body: `{ expiresIn?: number, maxUses?: number }`. Returns `{ token, url }`.
- `POST /api/orgs/:slug/join` — join org with invite token. Body: `{ token }`. Returns `{ org }`.

---

## 4. API Endpoints

### `POST /api/orgs`
Create an org. User must be authenticated.

Request:
```json
{ "slug": "inklang", "name": "Inklang Team" }
```

Response `201`: `{ "slug": "inklang", "name": "Inklang Team", ... }`

Errors:
- `400` slug already taken (by user or org)
- `409` slug invalid or reserved

On creation: creator is added to `org_members` with role `owner`.

### `GET /api/orgs/:slug`
Get org profile (public). Returns org info + member count + package count.

### `GET /api/orgs/:slug/packages`
List all packages owned by this org.

### `PUT /api/packages/:name/:version`
Updated auth logic (see section 2).

### `POST /api/orgs/:slug/teams`
Create a team. Owner/admin only.

Request: `{ "name": "core" }`

### `POST /api/orgs/:slug/teams/:name/members`
Add a user to a team. Owner/admin only.

Request: `{ "userId": "uuid" }` — user must already be an org member.

### `PUT /api/orgs/:slug/teams/:name/packages/:pkg/package_permission`
Set a team's permission for a package. Owner/admin only.

Request: `{ "permission": "write" }` — `permission` can be `read`, `write`, `admin`, or `null` to remove.

### `DELETE /api/orgs/:slug/teams/:name/members/:userId`
Remove a user from a team. Owner/admin only. Cannot remove the last owner.

---

## 5. Pages

### `/orgs/new`
Form fields: `slug`, `name`, optional `description`. Submit → `POST /api/orgs`.

Slug field validates in real-time: checks if taken, shows error inline.

### `/orgs/:slug`
Public org profile page.

Layout:
- Org name + description
- Member count, team count
- Tabs: **Packages** | **Teams**
- Packages tab: grid of package cards (name, description, latest version)
- Teams tab: list of teams, each showing members + package permissions

### `/orgs/:slug/settings` (or nested `/settings/teams`)
Private — requires `owner` or `admin` role.

Tabs: **General** | **Members** | **Teams**

- **General**: edit name, description
- **Members**: list members with role badges, remove buttons, change role dropdowns
- **Teams**: create team, click team → manage members + package permissions

---

## 6. CLI Changes (quill)

New commands:

- `quill org create --name "Inklang Team" --slug inklang` — create org, sets as active org
- `quill org invite` — generate invite link, prints URL
- `quill org join <url>` — join via invite link
- `quill org switch <slug>` — set active org for publishing

Publish command updated:
- `quill publish` uses current org (or user's personal namespace if no active org)
- `quill publish --org inklang` explicitly sets org

---

## 7. Out of Scope

- Org deletion UI (owner can drop via direct DB action for now)
- Transferring package ownership between orgs or user↔org
- Changing a team's name after creation
- Bulk package permission assignment (assign to multiple packages at once)
- Email-based invites (only link-based for now)
- Two-factor auth for orgs
- Audit log

---

## 8. Env / Config Changes

No new environment variables. `quillrc` gets a new optional field:

```json
{
  "token": "...",
  "username": "github-username",
  "registry": "https://lectern.inklang.org",
  "activeOrg": "inklang"
}
```
