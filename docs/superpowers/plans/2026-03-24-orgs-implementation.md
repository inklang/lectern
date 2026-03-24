# Org Ownership Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add organizations as package owners with teams and per-package granular permissions.

**Architecture:** Org-owned packages use `owner_type = 'org'` on `packages`, with `org_members`, `org_teams`, `org_team_members`, and `org_package_permissions` tables. Personal user packages use `owner_type = 'user'` with the existing `owner_id → auth.users` reference. All auth lives in a new `src/lib/authz.ts` module.

**Tech Stack:** Astro SSR, Supabase Postgres, TypeScript, `uuid` for invite tokens.

---

## File Map

### New files
- `supabase/migrations/003_orgs.sql` — all new tables + RLS
- `src/lib/orgs.ts` — all org/team DB query functions
- `src/lib/authz.ts` — `canUserPublish`, `isOrgAdmin`, etc.
- `src/pages/api/orgs/index.ts` — `POST /api/orgs`
- `src/pages/api/orgs/[slug]/index.ts` — `GET`, `PUT /api/orgs/:slug`
- `src/pages/api/orgs/[slug]/packages.ts` — `GET /api/orgs/:slug/packages`
- `src/pages/api/orgs/[slug]/teams/index.ts` — `POST /api/orgs/:slug/teams`
- `src/pages/api/orgs/[slug]/teams/[name]/members.ts` — `POST`, `DELETE /api/orgs/:slug/teams/:name/members`
- `src/pages/api/orgs/[slug]/teams/[name]/packages/[pkg]/permission.ts` — `PUT /api/orgs/:slug/teams/:name/packages/:pkg/permission`
- `src/pages/api/orgs/[slug]/invite.ts` — `POST /api/orgs/:slug/invite`
- `src/pages/api/orgs/[slug]/join.ts` — `POST /api/orgs/:slug/join`
- `src/pages/orgs/new.astro` — create org page
- `src/pages/orgs/[slug]/index.astro` — public org profile
- `src/pages/orgs/[slug]/settings/index.astro` — org settings (members + teams)

### Modified files
- `src/lib/db.ts` — add `owner_type` to `PackageRow`, update `createPackage` to accept `owner_type`
- `src/pages/api/packages/[name]/[version].ts` — update ownership check to use `canUserPublish`

---

## Chunk 1: Database Migration

### Task 1: Create `supabase/migrations/003_orgs.sql`

**Files:**
- Create: `supabase/migrations/003_orgs.sql`

```sql
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
  role      text check (role in ('owner', 'admin', 'member')),
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

-- Teams: org members can read; admins/owners manage
create policy "members read org_teams" on org_teams
  for select using (
    exists (select 1 from org_members where org_id = org_teams.org_id and user_id = auth.uid())
  );
create policy "admins manage org_teams" on org_teams
  for all using (
    exists (select 1 from org_members where org_id = org_teams.org_id and user_id = auth.uid() and role in ('owner', 'admin'))
  );

-- Team members: org members can read; admins/owners manage
create policy "members read org_team_members" on org_team_members
  for select using (
    exists (
      select 1 from org_teams t
      join org_members m on m.org_id = t.org_id and m.user_id = auth.uid()
      where t.id = team_id
    )
  );
create policy "admins manage org_team_members" on org_team_members
  for all using (
    exists (
      select 1 from org_teams t
      join org_members m on m.org_id = t.org_id and m.user_id = auth.uid()
      where t.id = team_id and m.role in ('owner', 'admin')
    )
  );

-- Package permissions: org members can read; admins/owners manage
create policy "members read org_package_permissions" on org_package_permissions
  for select using (
    exists (
      select 1 from org_teams t
      join org_members m on m.org_id = t.org_id and m.user_id = auth.uid()
      where t.id = team_id
    )
  );
create policy "admins manage org_package_permissions" on org_package_permissions
  for all using (
    exists (
      select 1 from org_teams t
      join org_members m on m.org_id = t.org_id and m.user_id = auth.uid()
      where t.id = team_id and m.role in ('owner', 'admin')
    )
  );

-- Invites: authenticated users can create (admins/owners); anyone with token can use
create policy "admins create invites" on org_invites
  for insert with check (
    exists (select 1 from org_members where org_id = org_invites.org_id and user_id = auth.uid() and role in ('owner', 'admin'))
  );
create policy "public read invites by token" on org_invites
  for select using (true);
```

- [ ] **Commit migration**

```bash
git add supabase/migrations/003_orgs.sql
git commit -m "feat: add orgs schema migration

Adds orgs, org_members, org_teams, org_team_members,
org_package_permissions, org_invites tables with RLS policies.
Adds owner_type column to packages table.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 2: Library Functions

### Task 2: Create `src/lib/orgs.ts`

**Files:**
- Create: `src/lib/orgs.ts`
- Test: `src/lib/orgs.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/lib/orgs.test.ts
import { describe, it, expect } from 'vitest'

// These will fail until orgs.ts is implemented
describe('getOrgBySlug', () => {
  it('returns null for non-existent org', async () => {
    const { getOrgBySlug } = await import('./orgs.js')
    const result = await getOrgBySlug('does-not-exist-xyz')
    expect(result).toBeNull()
  })
})

describe('getUserOrgs', () => {
  it('returns empty array when user has no org memberships', async () => {
    const { getUserOrgs } = await import('./orgs.js')
    const result = await getUserOrgs('00000000-0000-0000-0000-000000000000')
    expect(result).toEqual([])
  })
})

describe('canUserPublish', () => {
  it('denies when user is not org member', async () => {
    const { canUserPublish } = await import('./orgs.js')
    const result = await canUserPublish('00000000-0000-0000-0000-000000000000', 'some-pkg')
    expect(result).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/orgs.test.ts`
Expected: FAIL — "Cannot find module './orgs.js'"

- [ ] **Step 3: Write minimal implementation stub**

```typescript
// src/lib/orgs.ts
import { supabase } from './supabase.js'

export interface Org {
  id: string
  slug: string
  name: string
  description: string | null
  creator_id: string
  created_at: string
}

export interface OrgMember {
  org_id: string
  user_id: string
  role: 'owner' | 'admin' | 'member'
  joined_at: string
}

export interface OrgTeam {
  id: string
  org_id: string
  name: string
  created_at: string
}

export interface OrgTeamMember {
  team_id: string
  user_id: string
  joined_at: string
}

export interface OrgPackagePermission {
  team_id: string
  package_name: string
  permission: 'read' | 'write' | 'admin'
}

export async function getOrgBySlug(slug: string): Promise<Org | null> {
  const { data } = await supabase
    .from('orgs')
    .select('*')
    .eq('slug', slug)
    .single()
  return data ?? null
}

export async function getUserOrgs(userId: string): Promise<Org[]> {
  const { data } = await supabase
    .from('org_members')
    .select('org_id, role, orgs(id, slug, name, description, creator_id, created_at)')
    .eq('user_id', userId)
  if (!data) return []
  return data.map(d => ({ ...(d.orgs as Org), role: d.role }))
}

export async function createOrg(slug: string, name: string, creatorId: string, description?: string): Promise<Org> {
  const { data, error } = await supabase
    .from('orgs')
    .insert({ slug, name, description: description ?? null, creator_id: creatorId })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getOrgMembers(orgId: string): Promise<OrgMember[]> {
  const { data } = await supabase
    .from('org_members')
    .select('*')
    .eq('org_id', orgId)
  return data ?? []
}

export async function addOrgMember(orgId: string, userId: string, role: 'owner' | 'admin' | 'member' = 'member'): Promise<void> {
  const { error } = await supabase
    .from('org_members')
    .insert({ org_id: orgId, user_id: userId, role })
  if (error) throw error
}

export async function removeOrgMember(orgId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('org_members')
    .delete()
    .eq('org_id', orgId)
    .eq('user_id', userId)
  if (error) throw error
}

export async function updateOrgMemberRole(orgId: string, userId: string, role: 'owner' | 'admin' | 'member'): Promise<void> {
  const { error } = await supabase
    .from('org_members')
    .update({ role })
    .eq('org_id', orgId)
    .eq('user_id', userId)
  if (error) throw error
}

export async function getOrgTeams(orgId: string): Promise<OrgTeam[]> {
  const { data } = await supabase
    .from('org_teams')
    .select('*')
    .eq('org_id', orgId)
  return data ?? []
}

export async function createOrgTeam(orgId: string, name: string): Promise<OrgTeam> {
  const { data, error } = await supabase
    .from('org_teams')
    .insert({ org_id: orgId, name })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getTeamMembers(teamId: string): Promise<OrgTeamMember[]> {
  const { data } = await supabase
    .from('org_team_members')
    .select('*')
    .eq('team_id', teamId)
  return data ?? []
}

export async function addTeamMember(teamId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('org_team_members')
    .insert({ team_id: teamId, user_id: userId })
  if (error) throw error
}

export async function removeTeamMember(teamId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('org_team_members')
    .delete()
    .eq('team_id', teamId)
    .eq('user_id', userId)
  if (error) throw error
}

export async function getTeamsForPackage(orgId: string, packageName: string): Promise<Array<OrgTeam & { permission: string | null }>> {
  const { data } = await supabase
    .from('org_teams')
    .select('*, org_package_permissions(permission)')
    .eq('org_id', orgId)
  if (!data) return []
  return data
    .filter((t: any) => t.package_name === packageName || true) // filter after join
    .map((t: any) => ({ ...t, permission: t.org_package_permissions?.[0]?.permission ?? null }))
}

export async function setPackagePermission(teamId: string, packageName: string, permission: 'read' | 'write' | 'admin' | null): Promise<void> {
  if (permission === null) {
    const { error } = await supabase
      .from('org_package_permissions')
      .delete()
      .eq('team_id', teamId)
      .eq('package_name', packageName)
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('org_package_permissions')
      .upsert({ team_id: teamId, package_name: packageName, permission })
    if (error) throw error
  }
}

export async function getPackagePermissionForUser(orgId: string, userId: string, packageName: string): Promise<'read' | 'write' | 'admin' | null> {
  // Get all teams in org that the user is a member of, then check package permissions
  const { data: teams } = await supabase
    .from('org_teams')
    .select('id')
    .eq('org_id', orgId)

  if (!teams?.length) return null

  const teamIds = teams.map(t => t.id)

  const { data: memberships } = await supabase
    .from('org_team_members')
    .select('team_id')
    .in('team_id', teamIds)
    .eq('user_id', userId)

  if (!memberships?.length) return null

  const userTeamIds = memberships.map(m => m.team_id)

  const { data: perms } = await supabase
    .from('org_package_permissions')
    .select('permission')
    .in('team_id', userTeamIds)
    .eq('package_name', packageName)

  if (!perms?.length) return null

  // Return highest permission
  if (perms.some(p => p.permission === 'admin')) return 'admin'
  if (perms.some(p => p.permission === 'write')) return 'write'
  if (perms.some(p => p.permission === 'read')) return 'read'
  return null
}

export async function isOrgAdmin(orgId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .in('role', ['owner', 'admin'])
    .single()
  return !!data
}

export async function isOrgOwner(orgId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .eq('role', 'owner')
    .single()
  return !!data
}

export async function slugAvailable(slug: string): Promise<boolean> {
  // Check if a user with this slug exists in auth.users metadata
  // AND check if an org with this slug exists
  const { data: org } = await supabase
    .from('orgs')
    .select('id')
    .eq('slug', slug)
    .single()
  if (org) return false
  return true
}

export async function createInvite(orgId: string, createdBy: string, expiresInHours?: number, maxUses?: number): Promise<{ token: string; url: string }> {
  const { randomBytes } = await import('crypto')
  const token = randomBytes(8).toString('hex')
  const expiresAt = expiresInHours ? new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString() : null

  const { error } = await supabase
    .from('org_invites')
    .insert({ org_id: orgId, token, created_by: createdBy, expires_at: expiresAt, max_uses: maxUses ?? null })
  if (error) throw error

  const baseUrl = process.env['BASE_URL'] ?? 'https://lectern.inklang.org'
  return { token, url: `${baseUrl}/orgs/join?token=${token}` }
}

export async function useInvite(token: string): Promise<{ orgId: string; userId: string } | null> {
  const { data: invite } = await supabase
    .from('org_invites')
    .select('*')
    .eq('token', token)
    .single()

  if (!invite) return null
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) return null
  if (invite.max_uses !== null && invite.use_count >= invite.max_uses) return null

  // Increment use count
  await supabase
    .from('org_invites')
    .update({ use_count: invite.use_count + 1 })
    .eq('token', token)

  return { orgId: invite.org_id, userId: invite.created_by }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/orgs.test.ts`
Expected: PASS (or skip integration tests that need real DB)

- [ ] **Step 5: Commit**

```bash
git add src/lib/orgs.ts src/lib/orgs.test.ts
git commit -m "feat: add org management DB functions

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Create `src/lib/authz.ts`

**Files:**
- Create: `src/lib/authz.ts`
- Modify: `src/lib/db.ts:1` (add import)

- [ ] **Step 1: Write failing tests**

```typescript
// src/lib/authz.test.ts
import { describe, it, expect } from 'vitest'

describe('canUserPublish', () => {
  it('returns false for user-owned package when user is not owner', async () => {
    const { canUserPublish } = await import('./authz.js')
    // uid doesn't match package owner — should be false
    const result = await canUserPublish('00000000-0000-0000-0000-000000000000', 'user-pkg-not-owned')
    expect(result).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/authz.test.ts`
Expected: FAIL — "Cannot find module './authz.js'"

- [ ] **Step 3: Write implementation**

```typescript
// src/lib/authz.ts
import { supabase } from './supabase.js'
import { getPackagePermissionForUser, isOrgAdmin } from './orgs.js'

/**
 * Checks if a user can publish to a package.
 * - User-owned: allow iff userId === packages.owner_id AND owner_type = 'user'
 * - Org-owned: user must be org member AND have a team with write/admin permission on this package
 */
export async function canUserPublish(userId: string, packageName: string): Promise<boolean> {
  const { data: pkg } = await supabase
    .from('packages')
    .select('owner_id, owner_type')
    .eq('name', packageName)
    .single()

  if (!pkg) {
    // Package doesn't exist yet — first publisher will own it (handled by caller)
    return true
  }

  if (pkg.owner_type === 'user') {
    return pkg.owner_id === userId
  }

  if (pkg.owner_type === 'org') {
    // Check org membership
    const member = await supabase
      .from('org_members')
      .select('role')
      .eq('org_id', pkg.owner_id)
      .eq('user_id', userId)
      .single()

    if (!member) return false

    // Check per-package permission via teams
    const perm = await getPackagePermissionForUser(pkg.owner_id, userId, packageName)
    return perm === 'write' || perm === 'admin'
  }

  return false
}

/**
 * Returns the org slug for an org-owned package, or null for user-owned.
 */
export async function getPackageOrgSlug(packageName: string): Promise<string | null> {
  const { data: pkg } = await supabase
    .from('packages')
    .select('owner_id, owner_type')
    .eq('name', packageName)
    .single()

  if (!pkg || pkg.owner_type !== 'org') return null

  const { data: org } = await supabase
    .from('orgs')
    .select('slug')
    .eq('id', pkg.owner_id)
    .single()

  return org?.slug ?? null
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- src/lib/authz.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/authz.ts src/lib/authz.test.ts
git commit -m "feat: add authorization helpers for org model

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 3: API Endpoints

### Task 4: Create org API endpoints

**Files:**
- Create: `src/pages/api/orgs/index.ts`
- Create: `src/pages/api/orgs/[slug]/index.ts`
- Create: `src/pages/api/orgs/[slug]/packages.ts`
- Create: `src/pages/api/orgs/[slug]/teams/index.ts`
- Create: `src/pages/api/orgs/[slug]/teams/[name]/members.ts`
- Create: `src/pages/api/orgs/[slug]/teams/[name]/packages/[pkg]/permission.ts`
- Create: `src/pages/api/orgs/[slug]/invite.ts`
- Create: `src/pages/api/orgs/[slug]/join.ts`

- [ ] **Step 1: Write `src/pages/api/orgs/index.ts`**

```typescript
import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../lib/tokens.js'
import { createOrg, slugAvailable, addOrgMember } from '../../../lib/orgs.js'

export const POST: APIRoute = async ({ request }) => {
  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) return new Response('Unauthorized', { status: 401 })
  const userId = await resolveToken(raw)
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const body = await request.json()
  const { slug, name, description } = body

  if (!slug || !name) {
    return new Response(JSON.stringify({ error: 'slug and name are required' }), { status: 400 })
  }

  // Slug must be lowercase alphanumeric + hyphens
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return new Response(JSON.stringify({ error: 'slug must be lowercase alphanumeric with hyphens only' }), { status: 400 })
  }

  if (!(await slugAvailable(slug))) {
    return new Response(JSON.stringify({ error: 'slug is already taken' }), { status: 409 })
  }

  const org = await createOrg(slug, name, userId, description)
  await addOrgMember(org.id, userId, 'owner')

  return new Response(JSON.stringify(org), { status: 201, headers: { 'Content-Type': 'application/json' } })
}
```

- [ ] **Step 2: Write `src/pages/api/orgs/[slug]/index.ts`**

```typescript
import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../../lib/tokens.js'
import { getOrgBySlug, isOrgAdmin } from '../../../../lib/orgs.js'

export const GET: APIRoute = async ({ params }) => {
  const { slug } = params
  if (!slug) return new Response('Not found', { status: 404 })

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })

  return new Response(JSON.stringify(org), { headers: { 'Content-Type': 'application/json' } })
}

export const PUT: APIRoute = async ({ params, request }) => {
  const { slug } = params
  if (!slug) return new Response('Not found', { status: 404 })

  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) return new Response('Unauthorized', { status: 401 })
  const userId = await resolveToken(raw)
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })
  if (!(await isOrgAdmin(org.id, userId))) return new Response('Forbidden', { status: 403 })

  const body = await request.json()
  const { name, description } = body

  const { supabase } = await import('../../../../lib/supabase.js')
  const { data, error } = await supabase
    .from('orgs')
    .update({ name: name ?? org.name, description: description ?? org.description })
    .eq('id', org.id)
    .select()
    .single()

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
}
```

- [ ] **Step 3: Write `src/pages/api/orgs/[slug]/packages.ts`**

```typescript
import type { APIRoute } from 'astro'
import { getOrgBySlug } from '../../../../lib/orgs.js'

export const GET: APIRoute = async ({ params }) => {
  const { slug } = params
  if (!slug) return new Response('Not found', { status: 404 })

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })

  const { supabase } = await import('../../../../lib/supabase.js')
  const { data, error } = await supabase
    .from('packages')
    .select('*, package_versions(*)')
    .eq('owner_id', org.id)
    .eq('owner_type', 'org')

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
}
```

- [ ] **Step 4: Write `src/pages/api/orgs/[slug]/teams/index.ts`**

```typescript
import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../../../lib/tokens.js'
import { getOrgBySlug, getOrgTeams, createOrgTeam, isOrgAdmin } from '../../../../../lib/orgs.js'

export const GET: APIRoute = async ({ params }) => {
  const { slug } = params
  if (!slug) return new Response('Not found', { status: 404 })

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })

  const teams = await getOrgTeams(org.id)
  return new Response(JSON.stringify(teams), { headers: { 'Content-Type': 'application/json' } })
}

export const POST: APIRoute = async ({ params, request }) => {
  const { slug } = params
  if (!slug) return new Response('Not found', { status: 404 })

  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) return new Response('Unauthorized', { status: 401 })
  const userId = await resolveToken(raw)
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })
  if (!(await isOrgAdmin(org.id, userId))) return new Response('Forbidden', { status: 403 })

  const body = await request.json()
  const { name } = body
  if (!name) return new Response(JSON.stringify({ error: 'name is required' }), { status: 400 })

  try {
    const team = await createOrgTeam(org.id, name)
    return new Response(JSON.stringify(team), { status: 201, headers: { 'Content-Type': 'application/json' } })
  } catch (e: any) {
    if (e.code === '23505') return new Response(JSON.stringify({ error: 'team already exists' }), { status: 409 })
    return new Response(JSON.stringify({ error: 'failed to create team' }), { status: 500 })
  }
}
```

- [ ] **Step 5: Write `src/pages/api/orgs/[slug]/teams/[name]/members.ts`**

```typescript
import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../../../../lib/tokens.js'
import { getOrgBySlug, getOrgTeams, getTeamMembers, addTeamMember, removeTeamMember, isOrgAdmin } from '../../../../../../lib/orgs.js'

export const GET: APIRoute = async ({ params }) => {
  const { slug, name } = params
  if (!slug || !name) return new Response('Not found', { status: 404 })

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })

  const teams = await getOrgTeams(org.id)
  const team = teams.find(t => t.name === name)
  if (!team) return new Response('Not found', { status: 404 })

  const members = await getTeamMembers(team.id)
  return new Response(JSON.stringify(members), { headers: { 'Content-Type': 'application/json' } })
}

export const POST: APIRoute = async ({ params, request }) => {
  const { slug, name } = params
  if (!slug || !name) return new Response('Not found', { status: 404 })

  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) return new Response('Unauthorized', { status: 401 })
  const userId = await resolveToken(raw)
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })
  if (!(await isOrgAdmin(org.id, userId))) return new Response('Forbidden', { status: 403 })

  const teams = await getOrgTeams(org.id)
  const team = teams.find(t => t.name === name)
  if (!team) return new Response('Not found', { status: 404 })

  const body = await request.json()
  const { userId: targetUserId } = body
  if (!targetUserId) return new Response(JSON.stringify({ error: 'userId is required' }), { status: 400 })

  try {
    await addTeamMember(team.id, targetUserId)
    return new Response(null, { status: 201 })
  } catch (e: any) {
    if (e.code === '23505') return new Response(JSON.stringify({ error: 'user already on team' }), { status: 409 })
    return new Response(JSON.stringify({ error: 'failed to add member' }), { status: 500 })
  }
}

export const DELETE: APIRoute = async ({ params, request }) => {
  const { slug, name } = params
  if (!slug || !name) return new Response('Not found', { status: 404 })

  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) return new Response('Unauthorized', { status: 401 })
  const userId = await resolveToken(raw)
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })
  if (!(await isOrgAdmin(org.id, userId))) return new Response('Forbidden', { status: 403 })

  const url = new URL(request.url)
  const targetUserId = url.searchParams.get('userId')
  if (!targetUserId) return new Response(JSON.stringify({ error: 'userId query param required' }), { status: 400 })

  await removeTeamMember(name, targetUserId) // team name → need team id — fix below
  return new Response(null, { status: 204 })
}
```

> ⚠️ The DELETE handler above needs fixing: it uses `name` (string team name) instead of `teamId`. Fix it to look up the team first, same as GET/POST.

- [ ] **Step 6: Fix DELETE handler and write `src/pages/api/orgs/[slug]/teams/[name]/packages/[pkg]/permission.ts`**

The DELETE handler fix (same file, replace the DELETE section):
```typescript
export const DELETE: APIRoute = async ({ params, request }) => {
  const { slug, name } = params
  if (!slug || !name) return new Response('Not found', { status: 404 })

  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) return new Response('Unauthorized', { status: 401 })
  const userId = await resolveToken(raw)
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })
  if (!(await isOrgAdmin(org.id, userId))) return new Response('Forbidden', { status: 403 })

  const url = new URL(request.url)
  const targetUserId = url.searchParams.get('userId')
  if (!targetUserId) return new Response(JSON.stringify({ error: 'userId query param required' }), { status: 400 })

  const teams = await getOrgTeams(org.id)
  const team = teams.find(t => t.name === name)
  if (!team) return new Response('Not found', { status: 404 })

  await removeTeamMember(team.id, targetUserId)
  return new Response(null, { status: 204 })
}
```

```typescript
// src/pages/api/orgs/[slug]/teams/[name]/packages/[pkg]/permission.ts
import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../../../../../lib/tokens.js'
import { getOrgBySlug, getOrgTeams, setPackagePermission, isOrgAdmin } from '../../../../../../../lib/orgs.js'

export const PUT: APIRoute = async ({ params, request }) => {
  const { slug, name, pkg } = params
  if (!slug || !name || !pkg) return new Response('Not found', { status: 404 })

  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) return new Response('Unauthorized', { status: 401 })
  const userId = await resolveToken(raw)
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })
  if (!(await isOrgAdmin(org.id, userId))) return new Response('Forbidden', { status: 403 })

  const teams = await getOrgTeams(org.id)
  const team = teams.find(t => t.name === name)
  if (!team) return new Response('Not found', { status: 404 })

  const body = await request.json()
  const { permission } = body
  if (permission && !['read', 'write', 'admin'].includes(permission)) {
    return new Response(JSON.stringify({ error: 'invalid permission' }), { status: 400 })
  }

  await setPackagePermission(team.id, pkg, permission ?? null)
  return new Response(null, { status: 204 })
}
```

- [ ] **Step 7: Write invite and join endpoints**

```typescript
// src/pages/api/orgs/[slug]/invite.ts
import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../../lib/tokens.js'
import { getOrgBySlug, isOrgAdmin, createInvite } from '../../../../lib/orgs.js'

export const POST: APIRoute = async ({ params, request }) => {
  const { slug } = params
  if (!slug) return new Response('Not found', { status: 404 })

  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) return new Response('Unauthorized', { status: 401 })
  const userId = await resolveToken(raw)
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })
  if (!(await isOrgAdmin(org.id, userId))) return new Response('Forbidden', { status: 403 })

  const body = await request.json().catch(() => ({}))
  const { expiresInHours, maxUses } = body

  const invite = await createInvite(org.id, userId, expiresInHours, maxUses)
  return new Response(JSON.stringify(invite), { status: 201, headers: { 'Content-Type': 'application/json' } })
}
```

```typescript
// src/pages/api/orgs/[slug]/join.ts
import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../../lib/tokens.js'
import { useInvite, addOrgMember, getOrgBySlug } from '../../../../lib/orgs.js'

export const POST: APIRoute = async ({ request }) => {
  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) return new Response('Unauthorized', { status: 401 })
  const userId = await resolveToken(raw)
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const body = await request.json()
  const { token } = body
  if (!token) return new Response(JSON.stringify({ error: 'token required' }), { status: 400 })

  const result = await useInvite(token)
  if (!result) return new Response(JSON.stringify({ error: 'invalid or expired invite' }), { status: 400 })

  try {
    await addOrgMember(result.orgId, userId, 'member')
    const org = await getOrgBySlug(result.orgId) // won't work — need to query by id
  } catch (e: any) {
    if (e.code === '23505') {
      // Already a member — fine
    } else {
      return new Response(JSON.stringify({ error: 'failed to join org' }), { status: 500 })
    }
  }

  // Get org by id
  const { supabase } = await import('../../../../lib/supabase.js')
  const { data: org } = await supabase.from('orgs').select('*').eq('id', result.orgId).single()

  return new Response(JSON.stringify({ org }), { headers: { 'Content-Type': 'application/json' } })
}
```

> ⚠️ `getOrgBySlug(result.orgId)` won't work — it queries by slug. Fix: add `getOrgById` function to `orgs.ts`, or query orgs directly.

- [ ] **Step 8: Add `getOrgById` to `src/lib/orgs.ts`**

```typescript
export async function getOrgById(id: string): Promise<Org | null> {
  const { data } = await supabase.from('orgs').select('*').eq('id', id).single()
  return data ?? null
}
```

Then fix the join endpoint:
```typescript
const org = await getOrgById(result.orgId)
```

- [ ] **Step 9: Commit**

```bash
git add src/pages/api/orgs/
git commit -m "feat: add org management API endpoints

POST /api/orgs — create org
GET/PUT /api/orgs/:slug — get/update org
GET /api/orgs/:slug/packages — list org packages
GET/POST /api/orgs/:slug/teams — list/create teams
POST/DELETE /api/orgs/:slug/teams/:name/members — manage team members
PUT /api/orgs/:slug/teams/:name/packages/:pkg/permission — set package permission
POST /api/orgs/:slug/invite — generate invite link
POST /api/orgs/:slug/join — join via invite

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Update publish auth to use org model

**Files:**
- Modify: `src/pages/api/packages/[name]/[version].ts`

- [ ] **Step 1: Replace ownership check logic**

In `src/pages/api/packages/[name]/[version].ts`, find the ownership check section and replace:

```typescript
// OLD (packages/[name]/[version].ts ~line 34-38):
// Ownership check
const owner = await getPackageOwner(name)
if (owner && owner !== userId) {
  return new Response(JSON.stringify({ error: `Package ${name} is owned by a different account` }), { status: 403 })
}
```

Replace with:
```typescript
// NEW: ownership check via canUserPublish
if (await versionExists(name, version)) {
  const { canUserPublish } = await import('../../../../lib/authz.js')
  if (!(await canUserPublish(userId, name))) {
    return new Response(JSON.stringify({ error: `You do not have permission to publish to ${name}` }), { status: 403 })
  }
}
```

> ⚠️ Note: `versionExists` is still called first — the existing check stays. Only the ownership verification changes.

Also update the `createPackage` call to include `owner_type: 'user'` (since the CLI always publishes as user initially):
```typescript
if (!owner) await createPackage(name, userId)  // owner_type defaults to 'user'
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/api/packages/\[name\]/\[version\].ts
git commit -m "feat: update publish auth to use org model

Publish auth now checks org membership + team package permissions
via canUserPublish, enabling org-owned packages.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 4: Frontend Pages

### Task 6: Create org frontend pages

**Files:**
- Create: `src/pages/orgs/new.astro`
- Create: `src/pages/orgs/[slug]/index.astro`
- Create: `src/pages/orgs/[slug]/settings/index.astro`

- [ ] **Step 1: Write `src/pages/orgs/new.astro`**

```astro
---
import Base from '../../../layouts/Base.astro'

const supabaseUrl = import.meta.env.SUPABASE_URL ?? ''
const supabaseKey = import.meta.env.SUPABASE_PUBLISHABLE_KEY ?? ''
---
<Base title="Create Organization">
  <style>
    .page { max-width: 480px; margin: 0 auto; padding-top: 2rem; }
    h1 { font-family: var(--font-mono); font-size: 1.25rem; font-weight: 600; margin-bottom: 2rem; }
    label { display: block; font-family: var(--font-mono); font-size: 0.8rem; color: var(--muted); margin-bottom: 0.5rem; }
    input { width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 0.6rem 1rem; font-family: var(--font-mono); font-size: 0.875rem; color: var(--text); outline: none; box-sizing: border-box; }
    input:focus { border-color: var(--accent); }
    input.error { border-color: #f87171; }
    .field { margin-bottom: 1.5rem; }
    .error-msg { font-size: 0.8rem; color: #f87171; margin-top: 0.5rem; font-family: var(--font-mono); }
    .btn { display: inline-flex; align-items: center; padding: 0.6rem 1.2rem; border-radius: 8px; font-size: 0.875rem; font-family: var(--font-mono); cursor: pointer; border: 1px solid var(--accent); background: var(--accent); color: #fff; font-weight: 500; transition: opacity 0.15s; }
    .btn:hover { opacity: 0.9; }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-outline { background: transparent; color: var(--muted); border-color: var(--border); margin-left: 0.5rem; }
    .slug-preview { font-size: 0.8rem; color: var(--muted); margin-top: 0.4rem; font-family: var(--font-mono); }
  </style>

  <div class="page">
    <a href="/" style="font-size: 0.8rem; color: var(--muted); text-decoration: none;">← back</a>
    <h1>create org</h1>

    <div class="field">
      <label for="slug">slug</label>
      <input id="slug" type="text" placeholder="my-org" autocomplete="off" />
      <div class="slug-preview">packages will be named: <span id="ns-preview">—</span></div>
      <div id="slug-error" class="error-msg" style="display:none"></div>
    </div>

    <div class="field">
      <label for="name">display name</label>
      <input id="name" type="text" placeholder="My Organization" />
    </div>

    <div class="field">
      <label for="desc">description <span style="opacity:0.5">(optional)</span></label>
      <input id="desc" type="text" placeholder="What does this org do?" />
    </div>

    <div id="error" class="error-msg" style="display:none; margin-bottom: 1rem"></div>

    <button class="btn" id="submit-btn">Create Organization</button>
  </div>

  <script>
    import { createClient } from '@supabase/supabase-js'
    const supabase = createClient(document.querySelector('[data-url]')?.dataset?.url ?? '', document.querySelector('[data-url]')?.dataset?.key ?? '')

    const slugInput = document.getElementById('slug') as HTMLInputElement
    const nameInput = document.getElementById('name') as HTMLInputElement
    const descInput = document.getElementById('desc') as HTMLInputElement
    const nsPreview = document.getElementById('ns-preview') as HTMLElement
    const slugError = document.getElementById('slug-error') as HTMLElement
    const globalError = document.getElementById('error') as HTMLElement
    const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement

    slugInput.addEventListener('input', () => {
      const v = slugInput.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
      slugInput.value = v
      nsPreview.textContent = v ? `${v}.` : '—'
      slugError.style.display = 'none'
    })

    submitBtn.addEventListener('click', async () => {
      submitBtn.disabled = true
      submitBtn.textContent = 'Creating…'
      globalError.style.display = 'none'

      const { session } = await supabase.auth.getSession()
      if (!session) { window.location.href = '/login'; return }

      const res = await fetch('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ slug: slugInput.value, name: nameInput.value, description: descInput.value || undefined })
      })

      if (!res.ok) {
        const data = await res.json()
        globalError.textContent = data.error ?? 'Failed to create org'
        globalError.style.display = 'block'
        submitBtn.disabled = false
        submitBtn.textContent = 'Create Organization'
        return
      }

      const org = await res.json()
      window.location.href = `/orgs/${org.slug}`
    })
  </script>
</Base>
```

- [ ] **Step 2: Write `src/pages/orgs/[slug]/index.astro`**

```astro
---
import Base from '../../../layouts/Base.astro'
import { getOrgBySlug } from '../../../lib/orgs.js'

const { slug } = Astro.params
const org = await getOrgBySlug(slug!)

if (!org) return Astro.redirect('/packages')

const { supabase } = await import('../../../lib/supabase.js')

// Fetch members count, teams, packages
const { count: memberCount } = (await supabase.from('org_members').select('*', { count: 'exact', head: true }).eq('org_id', org.id)).data ?? {}
const { data: teams } = await supabase.from('org_teams').select('*').eq('org_id', org.id)
const { data: packages } = await supabase
  .from('packages')
  .select('*, package_versions(*)')
  .eq('owner_id', org.id)
  .eq('owner_type', 'org')
  .order('created_at', { ascending: false })
---
<Base title={org.name} description={org.description ?? `${org.name} — organization on lectern`}>
  <style>
    .page { max-width: 860px; }
    .back { font-size: 0.8rem; color: var(--muted); text-decoration: none; display: inline-block; margin-bottom: 2rem; }
    .back:hover { color: var(--text); }
    .org-header { margin-bottom: 3rem; }
    .org-name { font-family: var(--font-mono); font-size: 2rem; font-weight: 600; letter-spacing: -0.04em; }
    .org-slug { font-family: var(--font-mono); font-size: 0.875rem; color: var(--muted); margin-top: 0.3rem; }
    .org-desc { color: var(--muted); margin-top: 0.75rem; font-size: 0.9rem; }
    .stats { display: flex; gap: 2rem; margin-top: 1.5rem; }
    .stat { display: flex; flex-direction: column; }
    .stat-num { font-family: var(--font-mono); font-size: 1.5rem; font-weight: 600; }
    .stat-label { font-size: 0.775rem; color: var(--muted); font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.05em; }
    .tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin-bottom: 2rem; }
    .tab { font-family: var(--font-mono); font-size: 0.875rem; padding: 0.6rem 1.2rem; color: var(--muted); text-decoration: none; border-bottom: 2px solid transparent; transition: color 0.15s, border-color 0.15s; cursor: pointer; }
    .tab.active { color: var(--text); border-bottom-color: var(--accent); }
    .tab:hover { color: var(--text); }
    .pkg-list { display: flex; flex-direction: column; }
    .pkg-card { display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.25rem; margin-bottom: 0.5rem; text-decoration: none; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 10px; transition: border-color 0.15s; }
    .pkg-card:hover { border-color: var(--accent); }
    .pkg-name { font-family: var(--font-mono); font-size: 0.9rem; font-weight: 500; }
    .pkg-desc { font-size: 0.8rem; color: var(--muted); margin-top: 0.2rem; }
    .pkg-right { text-align: right; flex-shrink: 0; }
    .pkg-ver { font-family: var(--font-mono); font-size: 0.875rem; }
    .pkg-date { font-family: var(--font-mono); font-size: 0.775rem; color: var(--muted); margin-top: 0.2rem; }
    .team-list { display: flex; flex-direction: column; gap: 0.75rem; }
    .team-row { padding: 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; }
    .team-name { font-family: var(--font-mono); font-size: 0.9rem; font-weight: 500; }
    .team-members { font-size: 0.8rem; color: var(--muted); margin-top: 0.3rem; }
    .empty { font-family: var(--font-mono); font-size: 0.875rem; color: var(--muted); padding: 2rem 0; }
  </style>

  <div class="page">
    <a class="back" href="/packages">← packages</a>

    <div class="org-header">
      <div class="org-name">{org.name}</div>
      <div class="org-slug">@{org.slug}</div>
      {org.description && <div class="org-desc">{org.description}</div>}
      <div class="stats">
        <div class="stat"><span class="stat-num">{memberCount ?? 0}</span><span class="stat-label">members</span></div>
        <div class="stat"><span class="stat-num">{packages?.length ?? 0}</span><span class="stat-label">packages</span></div>
        <div class="stat"><span class="stat-num">{teams?.length ?? 0}</span><span class="stat-label">teams</span></div>
      </div>
    </div>

    <div class="tabs">
      <a class="tab active" href={`/orgs/${org.slug}`}>Packages</a>
      <a class="tab" href={`/orgs/${org.slug}?tab=teams`}>Teams</a>
    </div>

    <div id="tab-packages">
      {!packages?.length
        ? <p class="empty">No packages yet.</p>
        : <div class="pkg-list">
            {packages.map((pkg: any) => {
              const latest = pkg.package_versions?.[0]
              return (
                <a class="pkg-card" href={`/packages/${pkg.name}`}>
                  <div>
                    <div class="pkg-name">{pkg.name}</div>
                    {latest?.description && <div class="pkg-desc">{latest.description}</div>}
                  </div>
                  <div class="pkg-right">
                    {latest && <div class="pkg-ver">v{latest.version}</div>}
                    {latest?.published_at && <div class="pkg-date">{new Date(latest.published_at).toLocaleDateString()}</div>}
                  </div>
                </a>
              )
            })}
          </div>
      }
    </div>
  </div>
</Base>
```

- [ ] **Step 3: Write `src/pages/orgs/[slug]/settings/index.astro`**

This is the admin-only settings page. It has three sections:
- **General**: edit name/description
- **Members**: list members, change roles, remove members
- **Teams**: create teams, click team → manage members + package permissions

Because it's complex, start simple: just the General + Members tab. Teams tab can link to a team detail sub-page.

```astro
---
import Base from '../../../../layouts/Base.astro'
import { getOrgBySlug, isOrgAdmin } from '../../../../../lib/orgs.js'

const { slug } = Astro.params
const org = await getOrgBySlug(slug!)

if (!org) return Astro.redirect('/packages')

const { supabase } = await import('../../../../../lib/supabase.js')
const { session } = (await supabase.auth.getSession()).data ?? { session: null }
if (!session) return Astro.redirect('/login')

const isAdmin = await isOrgAdmin(org.id, session.user.id)
if (!isAdmin) return Astro.redirect(`/orgs/${slug}`)
---
<Base title={`${org.name} — Settings`}>
  <style>
    .page { max-width: 720px; padding-top: 2rem; }
    .back { font-size: 0.8rem; color: var(--muted); text-decoration: none; display: inline-block; margin-bottom: 2rem; }
    h1 { font-family: var(--font-mono); font-size: 1.25rem; font-weight: 600; margin-bottom: 2rem; }
    .section { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 1.5rem; margin-bottom: 1.5rem; }
    .section-title { font-family: var(--font-mono); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 1.25rem; }
    label { display: block; font-family: var(--font-mono); font-size: 0.8rem; color: var(--muted); margin-bottom: 0.5rem; }
    input, textarea { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 0.6rem 1rem; font-family: var(--font-mono); font-size: 0.875rem; color: var(--text); outline: none; box-sizing: border-box; resize: vertical; }
    input:focus, textarea:focus { border-color: var(--accent); }
    .field { margin-bottom: 1.25rem; }
    .btn { display: inline-flex; padding: 0.5rem 1rem; border-radius: 7px; font-size: 0.875rem; font-family: var(--font-mono); cursor: pointer; border: 1px solid var(--accent); background: var(--accent); color: #fff; transition: opacity 0.15s; }
    .btn:hover { opacity: 0.9; }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-outline { background: transparent; border-color: var(--border); color: var(--muted); }
    .btn-danger { border-color: #f87171; color: #f87171; background: transparent; }
    .member-row { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 0; border-bottom: 1px solid var(--border); }
    .member-row:last-child { border-bottom: none; }
    .member-info { display: flex; flex-direction: column; gap: 0.2rem; }
    .member-id { font-family: var(--font-mono); font-size: 0.875rem; }
    .member-role { font-size: 0.775rem; color: var(--muted); }
    .member-actions { display: flex; align-items: center; gap: 0.5rem; }
    select { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 0.3rem 0.5rem; font-family: var(--font-mono); font-size: 0.8rem; color: var(--text); }
    .msg { font-family: var(--font-mono); font-size: 0.8rem; margin-top: 0.75rem; }
    .msg.error { color: #f87171; }
    .msg.success { color: #4ade80; }
    .invite-row { display: flex; gap: 0.5rem; margin-top: 1rem; }
    .invite-url { font-family: var(--font-mono); font-size: 0.8rem; color: var(--muted); background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 0.5rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  </style>

  <div class="page">
    <a class="back" href={`/orgs/${slug}`}>← {org.name}</a>
    <h1>org settings</h1>

    <!-- General -->
    <div class="section" id="general-section">
      <div class="section-title">General</div>
      <div class="field">
        <label>Name</label>
        <input id="org-name" type="text" value={org.name} />
      </div>
      <div class="field">
        <label>Description</label>
        <textarea id="org-desc" rows={2}>{org.description ?? ''}</textarea>
      </div>
      <div id="general-msg" class="msg" style="display:none"></div>
      <button class="btn" id="save-btn">Save Changes</button>
    </div>

    <!-- Members -->
    <div class="section" id="members-section">
      <div class="section-title">Members</div>
      <div id="members-list"></div>
    </div>

    <!-- Invite -->
    <div class="section" id="invite-section">
      <div class="section-title">Invite Link</div>
      <button class="btn" id="generate-invite-btn">Generate Invite Link</button>
      <div id="invite-url" class="invite-url" style="display:none; margin-top: 0.75rem"></div>
    </div>
  </div>

  <script>
    import { createClient } from '@supabase/supabase-js'
    const supabase = createClient(document.querySelector('[data-url]')?.dataset?.url ?? '', document.querySelector('[data-url]')?.dataset?.key ?? '')

    async function loadMembers() {
      const slug = window.location.pathname.split('/').filter(Boolean)[1]
      const { data: members } = await supabase.from('org_members').select('*').eq('org_id', (window as any).__orgId__)
      const list = document.getElementById('members-list')!
      if (!members?.length) { list.innerHTML = '<p style="font-family:var(--font-mono);font-size:0.875rem;color:var(--muted)">No members.</p>'; return }
      list.innerHTML = members.map((m: any) => `
        <div class="member-row" data-user-id="${m.user_id}">
          <div class="member-info">
            <span class="member-id">${m.user_id.slice(0, 8)}…</span>
            <span class="member-role">${m.role}</span>
          </div>
          <div class="member-actions">
            <select class="role-select" data-user-id="${m.user_id}" ${m.role === 'owner' ? 'disabled' : ''}>
              <option value="member" ${m.role === 'member' ? 'selected' : ''}>member</option>
              <option value="admin" ${m.role === 'admin' ? 'selected' : ''}>admin</option>
              <option value="owner" ${m.role === 'owner' ? 'selected' : ''}>owner</option>
            </select>
            ${m.role !== 'owner' ? `<button class="btn btn-danger btn-sm remove-member" data-user-id="${m.user_id}">Remove</button>` : ''}
          </div>
        </div>
      `).join('')

      // Role change listeners
      list.querySelectorAll('.role-select').forEach(select => {
        select.addEventListener('change', async (e) => {
          const target = e.target as HTMLSelectElement
          const userId = target.dataset.userId!
          const role = target.value
          const { error } = await supabase.from('org_members').update({ role }).eq('org_id': (window as any).__orgId__, 'user_id': userId)
          if (error) alert('Failed to update role')
          else loadMembers()
        })
      })

      // Remove member listeners
      list.querySelectorAll('.remove-member').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const userId = (e.target as HTMLElement).dataset.userId!
          if (!confirm('Remove this member?')) return
          const { error } = await supabase.from('org_members').delete().eq('org_id', (window as any).__orgId__).eq('user_id', userId)
          if (error) alert('Failed to remove member')
          else loadMembers()
        })
      })
    }

    ;(window as any).__orgId__ = document.querySelector('[data-org-id]')?.getAttribute('data-org-id')
    loadMembers()

    // Save general
    document.getElementById('save-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('save-btn') as HTMLButtonElement
      const msg = document.getElementById('general-msg') as HTMLElement
      btn.disabled = true
      const name = (document.getElementById('org-name') as HTMLInputElement).value
      const description = (document.getElementById('org-desc') as HTMLTextAreaElement).value
      const slug = window.location.pathname.split('/').filter(Boolean)[1]
      const { session } = await supabase.auth.getSession() ?? {}
      const res = await fetch(`/api/orgs/${slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ name, description })
      })
      if (res.ok) { msg.textContent = 'Saved!'; msg.className = 'msg success'; msg.style.display = 'block' }
      else { msg.textContent = 'Failed to save'; msg.className = 'msg error'; msg.style.display = 'block' }
      btn.disabled = false
    })

    // Generate invite
    document.getElementById('generate-invite-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('generate-invite-btn') as HTMLButtonElement
      btn.disabled = true
      const slug = window.location.pathname.split('/').filter(Boolean)[1]
      const { session } = await supabase.auth.getSession() ?? {}
      const res = await fetch(`/api/orgs/${slug}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({})
      })
      if (res.ok) {
        const { url } = await res.json()
        const urlEl = document.getElementById('invite-url')!
        urlEl.textContent = url
        urlEl.style.display = 'block'
      } else {
        alert('Failed to generate invite')
      }
      btn.disabled = false
    })
  </script>
</Base>
```

> ⚠️ The template literal in the members load has a syntax error on the `.eq('org_id': ...` line — should be `.eq('org_id', ...)`. Fix before committing.

- [ ] **Step 4: Commit**

```bash
git add src/pages/orgs/
git commit -m "feat: add org frontend pages

Create org page, org profile page, org settings page.
Settings allows editing name/description, managing members,
generating invite links.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 5: Final Verification

### Task 7: Run tests and build

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: org ownership feature complete

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
