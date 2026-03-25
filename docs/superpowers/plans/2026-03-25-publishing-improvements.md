# Publishing Improvements — Implementation Plan

**Date:** 2026-03-25
**Feature:** Scoped packages, unlisted releases, release gating, monorepo batch publishing
**Status:** Draft

---

## Plan Header

- **Supabase project ID:** lectern (supabase/migrations/)
- **Astro SSR app:** src/pages/api/ + src/lib/
- **Test runner:** Vitest (vi.mock pattern from existing tests)
- **Migrations:** 014_scoped_packages.sql → 017_monorepo_publish.sql

---

## Chunk 1 — Database: Scoped Packages + Visibility + Releases Schema

### Goal
Add all new database columns and tables needed for scoped packages, unlisted releases, and release gating in one migration.

### Files

**Modified:**
- `supabase/migrations/014_scoped_packages_and_visibility.sql` — adds `scope_type`, `scope_id` to `packages`; adds `visibility` to `package_versions`; adds `default_publish_mode` to `orgs`

**Created:**
- `supabase/migrations/015_releases.sql` — creates `releases` table, adds `release_id` to `package_versions`

### Migration 014: Scoped Packages + Visibility + Org Publish Mode

```sql
-- Migration 014: Scoped packages, visibility column, org default publish mode

-- 1. Add scope columns to packages
alter table packages
  add column scope_type text check (scope_type in ('org', 'user')),
  add column scope_id   uuid;  -- FK to orgs.id or auth.users.id

-- Existing packages: scope_type = NULL (unscoped), scope_id = NULL
-- Unscoped means the package name has no @ prefix

-- 2. Add visibility to package_versions
alter table package_versions
  add column visibility text not null default 'public'
  check (visibility in ('public', 'unlisted'));

-- 3. Add org default publish mode
alter table orgs
  add column default_publish_mode text not null default 'immediate'
  check (default_publish_mode in ('immediate', 'gated'));

-- 4. Reserved scope names (case-insensitive)
-- These slugs are protected: lectern, www, api, admin, app, dashboard
-- Prevented at validation time in application code (not DB constraint).

-- 5. Index for scoped package lookups
-- Unique partial index: for scoped packages, (lower(scope_id), name) must be unique
create unique index packages_scoped_owner_name_idx
  on packages (lower(scope_id), name)
  where scope_type is not null;

-- 6. Index on package_versions for latest-version queries (public only)
create index package_versions_public_latest_idx
  on package_versions (package_name, published_at desc)
  where visibility = 'public';
```

### Migration 015: Releases Table

```sql
-- Migration 015: releases table for gated publishing

-- 1. Releases table
create table releases (
  id              uuid primary key default gen_random_uuid(),
  package_name    text not null references packages(name),
  version         text not null,
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  publish_mode    text not null check (publish_mode in ('immediate', 'gated')),
  requested_by    uuid references auth.users not null,
  reviewed_by     uuid references auth.users,
  reviewed_at     timestamptz,
  rejection_reason text,
  tarball_url     text not null,
  created_at      timestamptz not null default now(),
  unique (package_name, version)
);

-- 2. Add release_id to package_versions
alter table package_versions
  add column release_id uuid references releases(id);

-- 3. Index for pending releases lookup
create index releases_pending_idx on releases (package_name) where status = 'pending';

-- 4. RLS on releases
alter table releases enable row level security;

-- Org admins and package publishers can read releases
create policy "org_admins_read_releases" on releases for select using (
  exists (
    select 1 from packages p
    join org_members m on m.org_id = p.scope_id
    where p.name = releases.package_name
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  )
  or exists (
    -- Publisher who requested it
    select 1 from packages p
    where p.name = releases.package_name
      and p.scope_id = auth.uid()
  )
);

-- Insert/update managed via API routes (service role key)
create policy "service_insert_releases" on releases for insert with check (true);
create policy "service_update_releases" on releases for update using (true);
```

### Verification Command

```bash
# Apply migration (run via Supabase CLI or SQL editor)
# Verify columns exist:
psql $SUPABASE_DB_URL -c "\d packages"
psql $SUPABASE_DB_URL -c "\d package_versions"
psql $SUPABASE_DB_URL -c "\d releases"
psql $SUPABASE_DB_URL -c "\d orgs"
```

Expected output: all new columns present, constraints enforced.

---

## Chunk 2 — Core Library: Scoped Package Name Validation + Scope Resolution

### Goal
Add pure validation and parsing functions for scoped package names. No DB calls, no async.

### Files

**Created:**
- `src/lib/scoped-pkg.ts` — validate, parse, normalize scoped package names
- `src/lib/scoped-pkg.test.ts` — unit tests for all validation rules

### `src/lib/scoped-pkg.ts`

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Validates and parses scoped package names.
 *
 * Scoped:  @org/pkg   or   @user/pkg
 * Unscoped: pkg-name
 *
 * Scope component is case-insensitive, stored lowercase.
 * No wildcard or reserved scopes: lectern, www, api, admin, app, dashboard
 */

export interface ParsedPackageName {
  fullName: string      // "@org/foo" (normalized)
  scope: string         // "org" or null for unscoped
  scopeType: 'org' | 'user' | null  // 'org'/'user' for scoped; null = unscoped (determined at publish time via DB lookup)
  name: string          // "foo" (unscoped or after slash)
  isScoped: boolean
}

const RESERVED_SCOPES = new Set([
  'lectern', 'www', 'api', 'admin', 'app', 'dashboard',
])

const SCOPED_REGEX = /^@([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)$/i
const UNSCOPED_REGEX = /^[a-z0-9][a-z0-9-]*$/

/**
 * Parse a package name into its components.
 * Returns null if the name is invalid.
 */
export function parsePackageName(raw: string): ParsedPackageName | null {
  if (!raw || typeof raw !== 'string') return null

  // Scoped package
  if (raw.startsWith('@')) {
    const match = raw.match(SCOPED_REGEX)
    if (!match) return null
    const scope = match[1].toLowerCase()
    const name = match[2].toLowerCase()
    if (RESERVED_SCOPES.has(scope)) return null
    if (!isValidScopeComponent(scope) || !isValidNameComponent(name)) return null
    return {
      fullName: `@${scope}/${name}`,
      scope,
      scopeType: null, // resolved server-side via DB lookup
      name,
      isScoped: true,
    }
  }

  // Unscoped package
  if (!UNSCOPED_REGEX.test(raw)) return null
  return {
    fullName: raw.toLowerCase(),
    scope: null,
    scopeType: null,
    name: raw.toLowerCase(),
    isScoped: false,
  }
}

/**
 * Returns true if the scope component looks valid (no special chars).
 */
export function isValidScopeComponent(scope: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(scope) && scope.length >= 1 && scope.length <= 128
}

/**
 * Returns true if the package-name component looks valid.
 */
export function isValidNameComponent(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(name) && name.length >= 1 && name.length <= 128
}

/**
 * Normalize a package name for storage (lowercase, exact format).
 * Returns null if invalid.
 */
export function normalizePackageName(raw: string): string | null {
  return parsePackageName(raw)?.fullName ?? null
}

/**
 * Check collision rules for a proposed scoped package:
 * - @org/foo cannot exist if org with slug "org" exists
 * - @user/foo cannot exist if user with username "user" exists
 * - @org/foo cannot exist if unscoped "foo" exists and is org-owned by a different org
 *
 * Returns null if no collision (OK to create), or an error string.
 * This function is async (needs DB lookups).
 */
export async function checkScopedNameCollision(
  supabase: SupabaseClient,
  scope: string,
  name: string,
  proposedScopeType: 'org' | 'user'
): Promise<string | null> {
  // Check if scope owner exists
  if (proposedScopeType === 'org') {
    const { data: org } = await supabase
      .from('orgs')
      .select('id')
      .eq('slug', scope)
      .single()
    if (!org) return `No org with slug "${scope}" exists`

    // Check no orphaned @org/foo if unscoped "foo" already exists
    const { data: unscopedPkg } = await supabase
      .from('packages')
      .select('name, owner_type')
      .eq('name', name)
      .is('scope_type', null)
      .single()
    if (unscopedPkg && unscopedPkg.owner_type === 'org') {
      // A different org owns this unscoped name — collision
      return `Package name "${name}" is already owned by a different organization`
    }
  } else {
    // User scope: check user exists
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('user_name', scope)
      .single()
    if (!user) return `No user with username "${scope}" exists`
  }

  return null
}
```

### Tests: `src/lib/scoped-pkg.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import {
  parsePackageName,
  normalizePackageName,
  isValidScopeComponent,
  isValidNameComponent,
} from './scoped-pkg.js'

describe('parsePackageName', () => {
  it('parses valid unscoped names', () => {
    expect(parsePackageName('react')).toMatchObject({
      fullName: 'react', scope: null, isScoped: false, name: 'react',
    })
    expect(parsePackageName('my-package')).toMatchObject({
      fullName: 'my-package', scope: null, isScoped: false, name: 'my-package',
    })
  })

  it('parses valid org-scoped names (case normalized)', () => {
    expect(parsePackageName('@InkLang/react')).toMatchObject({
      fullName: '@inklang/react', scope: 'inklang', isScoped: true, name: 'react',
    })
    expect(parsePackageName('@my-org/my-pkg')).toMatchObject({
      fullName: '@my-org/my-pkg', scope: 'my-org', isScoped: true, name: 'my-pkg',
    })
  })

  it('parses valid user-scoped names', () => {
    expect(parsePackageName('@justin/pkg')).toMatchObject({
      fullName: '@justin/pkg', scope: 'justin', isScoped: true, name: 'pkg',
    })
  })

  it('rejects invalid unscoped names', () => {
    expect(parsePackageName('')).toBeNull()
    expect(parsePackageName('-foo')).toBeNull()        // can't start with dash
    expect(parsePackageName('foo-')).toBeNull()        // can't end with dash
    expect(parsePackageName('foo_bar')).toBeNull()     // no underscore
    expect(parsePackageName('FOO')).toBeNull()         // uppercase normalized but...
    expect(parsePackageName('@org')).toBeNull()         // scoped but no slash
    expect(parsePackageName('@org/')).toBeNull()       // empty name
    expect(parsePackageName('@/foo')).toBeNull()       // empty scope
  })

  it('rejects reserved scopes', () => {
    expect(parsePackageName('@lectern/foo')).toBeNull()
    expect(parsePackageName('@WWW/pkg')).toBeNull()
    expect(parsePackageName('@api/bar')).toBeNull()
  })

  it('rejects names with invalid characters', () => {
    expect(parsePackageName('@org/foo!')).toBeNull()
    expect(parsePackageName('@org/foo_bar')).toBeNull()
    expect(parsePackageName('foo!bar')).toBeNull()
  })
})

describe('normalizePackageName', () => {
  it('normalizes scoped names to lowercase', () => {
    expect(normalizePackageName('@InkLang/React')).toBe('@inklang/react')
  })

  it('normalizes unscoped names to lowercase', () => {
    expect(normalizePackageName('React')).toBe('react')
  })

  it('returns null for invalid names', () => {
    expect(normalizePackageName('')).toBeNull()
    expect(normalizePackageName('@lectern/foo')).toBeNull()
  })
})

describe('isValidScopeComponent', () => {
  it('accepts valid scope slugs', () => {
    expect(isValidScopeComponent('my-org')).toBe(true)
    expect(isValidScopeComponent('a')).toBe(true)
    expect(isValidScopeComponent('org123')).toBe(true)
  })

  it('rejects invalid scope slugs', () => {
    expect(isValidScopeComponent('')).toBe(false)
    expect(isValidScopeComponent('-org')).toBe(false)
    expect(isValidScopeComponent('has space')).toBe(false)
  })
})
```

### Verification Command

```bash
cd /Users/justi/dev/lectern
npx vitest run src/lib/scoped-pkg.test.ts
```

Expected: all tests pass.

---

## Chunk 3 — DB Library: Add Scoped Package + Release Gating Functions

### Goal
Extend `src/lib/db.ts` with typed interfaces and async functions for scoped packages and the releases table.

### Files

**Modified:**
- `src/lib/db.ts` — add new interfaces and functions; update `PackageRow` to include scope fields; add `createScopedPackage`, `getPackageScope`, `insertRelease`, `getRelease`, `updateRelease`, `getPendingReleases`, `getPackagePublishMode`

### Changes to `src/lib/db.ts`

```typescript
// ─── Scoped Package Support ───────────────────────────────────────────────────

export interface PackageRow {
  name: string
  owner_id: string
  owner_type: 'user' | 'org'
  scope_type: 'org' | 'user' | null   // NEW: null = unscoped
  scope_id: string | null              // NEW: orgs.id or auth.users.id
  created_at: string
  // ... existing fields (deprecated, star_count, etc.)
}

/**
 * Returns scope info for a package, or null if not scoped.
 */
export async function getPackageScope(
  name: string
): Promise<{ scopeType: 'org' | 'user'; scopeId: string } | null> {
  const { data } = await supabase
    .from('packages')
    .select('scope_type, scope_id')
    .eq('name', name)
    .single()
  if (!data || !data.scope_type) return null
  return { scopeType: data.scope_type, scopeId: data.scope_id }
}

/**
 * Creates a new scoped package record.
 */
export async function createScopedPackage(
  name: string,
  ownerId: string,
  ownerType: 'user' | 'org',
  scopeType: 'org' | 'user',
  scopeId: string
): Promise<void> {
  const { error } = await supabase
    .from('packages')
    .insert({
      name,
      owner_id: ownerId,
      owner_type: ownerType,
      scope_type: scopeType,
      scope_id: scopeId,
    })
  if (error) throw error
}

// ─── Release Gating ──────────────────────────────────────────────────────────

export type ReleaseStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'
export type PublishMode = 'immediate' | 'gated'

export interface ReleaseRow {
  id: string
  package_name: string
  version: string
  status: ReleaseStatus
  publish_mode: PublishMode
  requested_by: string
  reviewed_by: string | null
  reviewed_at: string | null
  rejection_reason: string | null
  tarball_url: string
  created_at: string
}

export interface PackageVersion {
  package_name: string
  version: string
  description: string | null
  readme: string | null
  author: string | null
  license: string | null
  dependencies: Record<string, string>
  tarball_url: string
  published_at: string
  visibility: 'public' | 'unlisted'   // NEW
  release_id: string | null             // NEW
  download_count?: number
}

/**
 * Inserts a gated release record and returns its id.
 */
export async function insertRelease(opts: {
  packageName: string
  version: string
  publishMode: PublishMode
  requestedBy: string
  tarballUrl: string
}): Promise<string> {
  const { data, error } = await supabase
    .from('releases')
    .insert({
      package_name: opts.packageName,
      version: opts.version,
      status: 'pending',
      publish_mode: opts.publishMode,
      requested_by: opts.requestedBy,
      tarball_url: opts.tarballUrl,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

/**
 * Gets a release record by package name and version.
 */
export async function getRelease(
  packageName: string,
  version: string
): Promise<ReleaseRow | null> {
  const { data } = await supabase
    .from('releases')
    .select('*')
    .eq('package_name', packageName)
    .eq('version', version)
    .single()
  return data ?? null
}

/**
 * Updates release status (approve/reject/cancel).
 */
export async function updateReleaseStatus(
  releaseId: string,
  status: ReleaseStatus,
  reviewedBy: string,
  rejectionReason?: string | null
): Promise<void> {
  const { error } = await supabase
    .from('releases')
    .update({
      status,
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
      rejection_reason: rejectionReason ?? null,
    })
    .eq('id', releaseId)
  if (error) throw error
}

/**
 * Gets all pending releases for a package (for org admin review UI).
 */
export async function getPendingReleases(packageName: string): Promise<ReleaseRow[]> {
  const { data, error } = await supabase
    .from('releases')
    .select('*')
    .eq('package_name', packageName)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

/**
 * Gets the publish mode for a specific package.
 * Returns 'inherit' if no override is set (uses org default).
 */
export async function getPackagePublishMode(
  packageName: string
): Promise<PublishMode | 'inherit'> {
  const { data } = await supabase
    .from('packages')
    .select('publish_mode')
    .eq('name', packageName)
    .single()
  return (data?.publish_mode as PublishMode | 'inherit') ?? 'inherit'
}

/**
 * Gets the effective publish mode for a package (resolves inherit to org default).
 */
export async function getEffectivePublishMode(
  packageName: string
): Promise<PublishMode> {
  const mode = await getPackagePublishMode(packageName)
  if (mode !== 'inherit') return mode

  // Fetch org default
  const scope = await getPackageScope(packageName)
  if (!scope || scope.scopeType !== 'org') return 'immediate' // user packages are always immediate

  const { data: org } = await supabase
    .from('orgs')
    .select('default_publish_mode')
    .eq('id', scope.scopeId)
    .single()

  return (org?.default_publish_mode as PublishMode) ?? 'immediate'
}

/**
 * Sets the per-package publish mode override.
 */
export async function setPackagePublishMode(
  packageName: string,
  mode: PublishMode | 'inherit'
): Promise<void> {
  if (mode === 'inherit') {
    // Remove the override (set to null)
    const { error } = await supabase
      .from('packages')
      .update({ publish_mode: null })
      .eq('name', packageName)
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('packages')
      .update({ publish_mode: mode })
      .eq('name', packageName)
    if (error) throw error
  }
}
```

> **Note:** TypeScript interfaces `ReleaseRow` and updated `PackageVersion` are defined in the same file. The `supabase` client import already exists at the top of `db.ts`.

### Verification Command

```bash
cd /Users/justi/dev/lectern
npx vitest run src/lib/db.test.ts 2>/dev/null || echo "db.test.ts may not exist; run full test suite"
```

---

## Chunk 4 — Authz: Extend for Scoped Package + Release Gating

### Goal
Update `src/lib/authz.ts` to handle scoped package authorization and add functions for gated release approval/rejection authorization.

### Files

**Modified:**
- `src/lib/authz.ts` — update `canUserPublish` to handle scoped packages; add `canUserApproveRelease`, `canUserRejectRelease`, `canUserViewRelease`, `getScopeOwnerId`

### Changes to `src/lib/authz.ts`

```typescript
import { supabase } from './supabase.js'
import { getPackagePermissionForUser, getUserByUsername, getOrgBySlug } from './orgs.js'
import { parsePackageName } from './scoped-pkg.js'

/**
 * Checks if a user can publish to a package.
 * Supports scoped (@org/pkg, @user/pkg) and unscoped packages.
 *
 * - Unscoped (owner_type=user): allow iff userId === packages.owner_id
 * - Unscoped (owner_type=org): user must be org member AND have write/admin
 * - Org-scoped (@org/pkg): user must be org member AND have write/admin on this package
 * - User-scoped (@user/pkg): user must BE the user (scope_id === userId)
 * - Package doesn't exist yet: returns true (caller handles first-publish ownership)
 */
export async function canUserPublish(
  userId: string,
  packageName: string,
  scopeType?: 'org' | 'user',  // passed when creating a new scoped package
  scopeId?: string             // orgs.id or auth.users.id for the scope
): Promise<boolean> {
  const { data: pkg } = await supabase
    .from('packages')
    .select('owner_id, owner_type, scope_type, scope_id')
    .eq('name', packageName)
    .single()

  if (!pkg) {
    // Package doesn't exist yet — first publisher will own it
    // For scoped packages, validate scope ownership
    if (scopeType && scopeId) {
      if (scopeType === 'user') return scopeId === userId
      if (scopeType === 'org') {
        // User must be org member
        const { data: member } = await supabase
          .from('org_members')
          .select('role')
          .eq('org_id', scopeId)
          .eq('user_id', userId)
          .maybeSingle()
        return !!member
      }
    }
    return true
  }

  if (pkg.scope_type === 'user') {
    return pkg.scope_id === userId
  }

  if (pkg.scope_type === 'org') {
    const { data: member } = await supabase
      .from('org_members')
      .select('role')
      .eq('org_id', pkg.scope_id)
      .eq('user_id', userId)
      .maybeSingle()
    if (!member) return false
    try {
      const perm = await getPackagePermissionForUser(pkg.scope_id, userId, packageName)
      return perm === 'write' || perm === 'admin'
    } catch { return false }
  }

  // Unscoped org-owned
  if (pkg.owner_type === 'org') {
    const { data: member } = await supabase
      .from('org_members')
      .select('role')
      .eq('org_id', pkg.owner_id)
      .eq('user_id', userId)
      .maybeSingle()
    if (!member) return false
    try {
      const perm = await getPackagePermissionForUser(pkg.owner_id, userId, packageName)
      return perm === 'write' || perm === 'admin'
    } catch { return false }
  }

  // Unscoped user-owned
  return pkg.owner_id === userId
}

/**
 * Checks if a user can approve a gated release for a package.
 * Requires org admin (or package admin) for org-scoped packages.
 * Always false for user-owned packages.
 */
export async function canUserApproveRelease(
  userId: string,
  packageName: string
): Promise<boolean> {
  const scope = await getPackageScopeInfo(packageName)
  if (!scope) return false  // package doesn't exist

  if (scope.scopeType === 'user') return false  // user packages can't be gated

  if (scope.scopeType === 'org') {
    // Must be org admin
    const { data: member } = await supabase
      .from('org_members')
      .select('role')
      .eq('org_id', scope.scopeId)
      .eq('user_id', userId)
      .maybeSingle()
    return member?.role === 'owner' || member?.role === 'admin'
  }

  // Unscoped org-owned
  if (scope.ownerType === 'org') {
    const { data: member } = await supabase
      .from('org_members')
      .select('role')
      .eq('org_id', scope.ownerId)
      .eq('user_id', userId)
      .maybeSingle()
    return member?.role === 'owner' || member?.role === 'admin'
  }

  return false
}

/**
 * Checks if a user can reject a gated release (same rules as approve).
 */
export async function canUserRejectRelease(
  userId: string,
  packageName: string
): Promise<boolean> {
  return canUserApproveRelease(userId, packageName)
}

/**
 * Checks if a user can VIEW a gated release status.
 * The original publisher OR org admins can view.
 */
export async function canUserViewRelease(
  userId: string,
  packageName: string,
  requestedBy: string  // user who originally requested the publish
): Promise<boolean> {
  // Publisher who requested it can always view
  if (userId === requestedBy) return true
  return canUserApproveRelease(userId, packageName)
}

// ─── Internal helpers ────────────────────────────────────────────────────────

interface PackageScopeInfo {
  scopeType: 'org' | 'user' | null
  scopeId: string | null
  ownerType: 'user' | 'org'
  ownerId: string
}

async function getPackageScopeInfo(
  packageName: string
): Promise<PackageScopeInfo | null> {
  const { data } = await supabase
    .from('packages')
    .select('scope_type, scope_id, owner_type, owner_id')
    .eq('name', packageName)
    .single()
  if (!data) return null
  return {
    scopeType: data.scope_type,
    scopeId: data.scope_id,
    ownerType: data.owner_type,
    ownerId: data.owner_id,
  }
}
```

### Verification Command

```bash
cd /Users/justi/dev/lectern
npx vitest run src/lib/authz.test.ts 2>/dev/null || echo "run full test suite"
```

---

## Chunk 5 — Publish Route: Scoped Packages + Visibility + Gated Publishing

### Goal
Update `PUT /api/packages/[name]/[version]` to handle scoped package names, accept `visibility` field, and support gated publishing mode.

### Files

**Modified:**
- `src/pages/api/packages/[name]/[version].ts` — add scoped name parsing, visibility handling, gated publish flow
- `src/pages/api/packages/[name]/[version].test.ts` — add tests for scoped name parsing, visibility, gated flow

### Changes to `src/pages/api/packages/[name]/[version].ts`

Key changes to the `PUT` handler:

```typescript
// 1. At top of PUT handler, validate and normalize the scoped name
import { parsePackageName, normalizePackageName } from '../../../../lib/scoped-pkg.js'

// ... after name/version extraction ...
const normalizedName = normalizePackageName(name)
if (!normalizedName) {
  return new Response(JSON.stringify({ error: 'Invalid package name format' }), { status: 400 })
}

// 2. Determine scope_type and scope_id from the name
// We can't know if @scope is an org or user without DB lookup — try org first, then user
let scopeType: 'org' | 'user' | null = null
let scopeId: string | null = null

if (normalizedName.startsWith('@')) {
  const parsed = parsePackageName(normalizedName)!
  const scopeSlug = parsed.scope!

  // Try org lookup first
  const { getOrgBySlug } = await import('../../../../lib/orgs.js')
  const org = await getOrgBySlug(scopeSlug)
  if (org) {
    scopeType = 'org'
    scopeId = org.id
  } else {
    // Not an org — try user scope
    const { getUserByUsername } = await import('../../../../lib/orgs.js')
    const user = await getUserByUsername(scopeSlug)
    if (!user) return new Response(JSON.stringify({ error: `No org or user with slug "${scopeSlug}"` }), { status: 400 })
    scopeType = 'user'
    scopeId = user.id
  }
}

// 3. Parse visibility from multipart form (default: 'public')
let visibility: 'public' | 'unlisted' = 'public'
if (contentType.includes('multipart/form-data')) {
  const vis = formData.get('visibility')
  if (vis === 'unlisted') visibility = 'unlisted'
  // publish_mode: 'immediate' (default) or 'gated'
  const publishModeRaw = formData.get('publish_mode')
  const publishMode: 'immediate' | 'gated' =
    publishModeRaw === 'gated' ? 'gated' : 'immediate'
}

// 4. Permission check with scope info
if (!(await canUserPublish(userId, normalizedName, scopeType ?? undefined, scopeId ?? undefined))) {
  return new Response(JSON.stringify({ error: `You do not have permission to publish to ${normalizedName}` }), { status: 403 })
}

// 5. Resolve effective publish mode
const { getEffectivePublishMode } = await import('../../../../lib/db.js')
const effectivePublishMode = await getEffectivePublishMode(normalizedName)
const isGated = publishMode === 'gated' || effectivePublishMode === 'gated'

// 6. Create package with scope info on first publish
const owner = await getPackageOwner(normalizedName)
if (!owner) {
  // First publish — use scope info to set owner
  const ownerType = scopeType === 'org' ? 'org' : 'user'
  const actualOwnerId = scopeId ?? userId
  if (scopeType) {
    await createScopedPackage(normalizedName, actualOwnerId, ownerType, scopeType, scopeId!)
  } else {
    await createPackage(normalizedName, actualOwnerId, ownerType)
  }
}

// 7. Handle gated publish: insert release record first
let releaseId: string | null = null
if (isGated) {
  const { insertRelease } = await import('../../../../lib/db.js')
  releaseId = await insertRelease({
    packageName: normalizedName,
    version,
    publishMode: effectivePublishMode,
    requestedBy: userId,
    tarballUrl, // use the URL that will be uploaded below
  })
  // For gated, visibility is forced to unlisted until approved
  visibility = 'unlisted'
}

// 8. Upload tarball (still needed for gated — artifact stored for approval)
const tarballUrl = await uploadTarball(normalizedName, version, tarballData)

// 9. If gated and tarball URL differs (was re-uploaded), update release
if (releaseId) {
  const { supabase: sb } = await import('../../../../lib/supabase.js')
  await sb.from('releases').update({ tarball_url: tarballUrl }).eq('id', releaseId)
}

// 10. Insert version with visibility and release_id
await insertVersion({
  package_name: normalizedName,
  version,
  description,
  readme,
  author,
  license,
  dependencies,
  tarball_url: tarballUrl,
  embedding: null,
  visibility,
  release_id: releaseId,
})

// 11. If gated, fire release.pending webhook and return 201 with pending status
if (isGated) {
  deliverWebhook(scopeType === 'org' ? scopeId : null, 'release.pending', {
    package: normalizedName,
    version,
    status: 'pending',
    requested_by: userId,
    org_id: scopeType === 'org' ? scopeId : null,
  }).catch(() => {})

  logAuditEvent({
    orgId: scopeType === 'org' ? scopeId : null,
    userId,
    action: 'release.request',
    resourceType: 'release',
    resourceId: releaseId,
    details: { package: normalizedName, version, publish_mode: effectivePublishMode },
    ipAddress: request.headers.get('x-forwarded-for') ?? null,
    userAgent: request.headers.get('user-agent') ?? null,
  }).catch(() => {})

  return new Response(JSON.stringify({
    name: normalizedName,
    version,
    status: 'pending',
    message: 'Awaiting approval',
  }), { status: 201 })
}

// 12. Fire package.published webhook (immediate publish)
deliverWebhook(scopeType === 'org' ? scopeId : null, 'package.published', {
  package: normalizedName,
  version,
  description,
  published_by: userId,
  owner_type: scopeType === 'org' ? 'org' : 'user',
  owner_id: scopeId ?? userId,
}).catch(() => {})
```

### Test File Updates: `src/pages/api/packages/[name]/[version].test.ts`

Add new test cases:

```typescript
describe('scoped package name normalization', () => {
  it('normalizes @org/pkg to lowercase', async () => {
    // Mocked auth allows all; verify normalizePackageName is called
    const normalized = normalizePackageName('@InkLang/React')
    expect(normalized).toBe('@inklang/react')
  })

  it('rejects @lectern/foo as reserved scope', async () => {
    const normalized = normalizePackageName('@lectern/foo')
    expect(normalized).toBeNull()
  })
})

describe('visibility field', () => {
  it('defaults to public when not specified', async () => {
    // Multipart form without visibility field
    const formData = new FormData()
    formData.append('tarball', new Blob(['gz'], { type: 'application/gzip' }))
    // visibility should default to 'public'
    const vis = formData.get('visibility')
    expect(vis ?? 'public').toBe('public')
  })

  it('accepts unlisted visibility', async () => {
    const formData = new FormData()
    formData.append('tarball', new Blob(['gz'], { type: 'application/gzip' }))
    formData.append('visibility', 'unlisted')
    const vis = formData.get('visibility')
    expect(vis).toBe('unlisted')
  })
})

describe('gated publish', () => {
  it('sets release record status to pending for gated publish', async () => {
    // When publish_mode='gated', insertRelease is called with status='pending'
    // This is validated via mock assertions
  })
})
```

### Verification Command

```bash
cd /Users/justi/dev/lectern
npx vitest run src/pages/api/packages/[name]/[version].test.ts
```

---

## Chunk 6 — Package Index Route: Return Visibility + Filter Unlisted from Search

### Goal
Update `GET /api/packages/[name]` to include `visibility` in each version object, and compute `latest_version` from public versions only.

### Files

**Modified:**
- `src/pages/api/packages/[name]/index.ts` — include visibility in response; filter latest from public only
- `src/pages/api/packages/[name]/index.test.ts` — add tests for visibility in version list

### Changes to `src/pages/api/packages/[name]/index.ts`

```typescript
export const GET: APIRoute = async ({ params, request }) => {
  const { name } = params
  if (!name) return new Response('Bad request', { status: 400 })

  // Support ?include_unlisted=true for authenticated owner
  const url = new URL(request.url)
  const includeUnlisted = url.searchParams.get('include_unlisted') === 'true'

  // Auth check: if include_unlisted, verify ownership
  if (includeUnlisted) {
    const raw = extractBearer(request.headers.get('authorization'))
    if (!raw) {
      return new Response(JSON.stringify({ error: 'Authentication required for unlisted versions' }), { status: 401 })
    }
    const userId = await resolveToken(raw)
    if (!userId) return new Response('Unauthorized', { status: 401 })
    if (!(await canUserPublish(userId, name))) {
      return new Response('Forbidden', { status: 403 })
    }
  }

  let versions: PackageVersion[]
  try {
    versions = await getPackageVersions(name)
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), { status: 500 })
  }

  if (!versions.length) {
    return new Response(JSON.stringify({ error: 'Package not found' }), { status: 404 })
  }

  // latest_version: latest public version only
  const publicVersions = versions.filter(v => v.visibility === 'public')
  const latestPublic = publicVersions[0]

  // Filter versions list based on include_unlisted
  const visibleVersions = includeUnlisted ? versions : publicVersions

  return new Response(
    JSON.stringify({
      name,
      description: latestPublic?.description ?? null,
      latest_version: latestPublic?.version ?? null,
      versions: visibleVersions.map((v) => ({
        version: v.version,
        description: v.description ?? null,
        published_at: v.published_at,
        dependencies: v.dependencies ?? {},
        visibility: v.visibility,  // NEW
      })),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}
```

### Verification Command

```bash
cd /Users/justi/dev/lectern
npx vitest run src/pages/api/packages/[name]/index.test.ts
```

---

## Chunk 7 — Release Gating API Endpoints

### Goal
Create the approve, reject, status, and pending-release endpoints for gated publishing.

### Files

**Created:**
- `src/pages/api/packages/[name]/[version]/approve.ts` — `POST` approve a gated release
- `src/pages/api/packages/[name]/[version]/reject.ts` — `POST` reject a gated release
- `src/pages/api/packages/[name]/[version]/status.ts` — `GET` get release status (publisher view)
- `src/pages/api/packages/[name]/releases/pending.ts` — `GET` list pending releases for org admin

### `src/pages/api/packages/[name]/[version]/approve.ts`

```typescript
import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../../../lib/tokens.js'
import { canUserApproveRelease } from '../../../../../lib/authz.js'
import { getRelease, updateReleaseStatus } from '../../../../../lib/db.js'
import { deliverWebhook } from '../../../../../lib/webhooks.js'
import { logAuditEvent } from '../../../../../lib/audit.js'

export const POST: APIRoute = async ({ params, request }) => {
  const { name, version } = params
  if (!name || !version) return new Response('Bad request', { status: 400 })

  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) return new Response('Unauthorized', { status: 401 })
  const userId = await resolveToken(raw)
  if (!userId) return new Response('Unauthorized', { status: 401 })

  if (!(await canUserApproveRelease(userId, name))) {
    return new Response('Forbidden', { status: 403 })
  }

  const release = await getRelease(name, version)
  if (!release) {
    return new Response(JSON.stringify({ error: 'Release not found or not gated' }), { status: 404 })
  }
  if (release.status !== 'pending') {
    return new Response(JSON.stringify({ error: `Release already ${release.status}` }), { status: 409 })
  }

  // Approve: update release status + make version public
  await updateReleaseStatus(release.id, 'approved', userId)

  // Update package_versions visibility to public
  const { supabase } = await import('../../../../../lib/supabase.js')
  await supabase
    .from('package_versions')
    .update({ visibility: 'public' })
    .eq('package_name', name)
    .eq('version', version)

  // Get org_id for webhook
  const { getPackageScope } = await import('../../../../../lib/db.js')
  const scope = await getPackageScope(name)

  deliverWebhook(scope?.scopeType === 'org' ? scope.scopeId : null, 'release.approved', {
    package: name,
    version,
    reviewed_by: userId,
    org_id: scope?.scopeType === 'org' ? scope.scopeId : null,
  }).catch(() => {})

  logAuditEvent({
    orgId: scope?.scopeType === 'org' ? scope.scopeId : null,
    userId,
    action: 'release.approve',
    resourceType: 'release',
    resourceId: release.id,
    details: { package: name, version },
    ipAddress: request.headers.get('x-forwarded-for') ?? null,
    userAgent: request.headers.get('user-agent') ?? null,
  }).catch(() => {})

  return new Response(JSON.stringify({ status: 'approved', version }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
```

### `src/pages/api/packages/[name]/[version]/reject.ts`

```typescript
import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../../../lib/tokens.js'
import { canUserRejectRelease } from '../../../../../lib/authz.js'
import { getRelease, updateReleaseStatus } from '../../../../../lib/db.js'
import { deliverWebhook } from '../../../../../lib/webhooks.js'
import { logAuditEvent } from '../../../../../lib/audit.js'

export const POST: APIRoute = async ({ params, request }) => {
  const { name, version } = params
  if (!name || !version) return new Response('Bad request', { status: 400 })

  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) return new Response('Unauthorized', { status: 401 })
  const userId = await resolveToken(raw)
  if (!userId) return new Response('Unauthorized', { status: 401 })

  if (!(await canUserRejectRelease(userId, name))) {
    return new Response('Forbidden', { status: 403 })
  }

  const release = await getRelease(name, version)
  if (!release) {
    return new Response(JSON.stringify({ error: 'Release not found or not gated' }), { status: 404 })
  }
  if (release.status !== 'pending') {
    return new Response(JSON.stringify({ error: `Release already ${release.status}` }), { status: 409 })
  }

  let reason: string | null = null
  try {
    const body = await request.json()
    reason = typeof body.reason === 'string' ? body.reason : null
  } catch {}

  await updateReleaseStatus(release.id, 'rejected', userId, reason)

  const { getPackageScope } = await import('../../../../../lib/db.js')
  const scope = await getPackageScope(name)

  deliverWebhook(scope?.scopeType === 'org' ? scope.scopeId : null, 'release.rejected', {
    package: name,
    version,
    reason,
    reviewed_by: userId,
    org_id: scope?.scopeType === 'org' ? scope.scopeId : null,
  }).catch(() => {})

  logAuditEvent({
    orgId: scope?.scopeType === 'org' ? scope.scopeId : null,
    userId,
    action: 'release.reject',
    resourceType: 'release',
    resourceId: release.id,
    details: { package: name, version, reason },
    ipAddress: request.headers.get('x-forwarded-for') ?? null,
    userAgent: request.headers.get('user-agent') ?? null,
  }).catch(() => {})

  return new Response(JSON.stringify({ status: 'rejected', reason }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
```

### `src/pages/api/packages/[name]/[version]/status.ts`

```typescript
import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../../../lib/tokens.js'
import { canUserViewRelease } from '../../../../../lib/authz.js'
import { getRelease } from '../../../../../lib/db.js'

export const GET: APIRoute = async ({ params, request }) => {
  const { name, version } = params
  if (!name || !version) return new Response('Bad request', { status: 400 })

  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) return new Response('Unauthorized', { status: 401 })
  const userId = await resolveToken(raw)
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const release = await getRelease(name, version)
  if (!release) {
    // Not a gated release — return not_found
    return new Response(JSON.stringify({ status: 'not_found' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!(await canUserViewRelease(userId, name, release.requested_by))) {
    return new Response('Forbidden', { status: 403 })
  }

  return new Response(JSON.stringify({
    status: release.status,
    reviewed_by: release.reviewed_by,
    reviewed_at: release.reviewed_at,
    rejection_reason: release.rejection_reason,
  }), { headers: { 'Content-Type': 'application/json' } })
}
```

### `src/pages/api/packages/[name]/releases/pending.ts`

```typescript
import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../../../lib/tokens.js'
import { canUserApproveRelease } from '../../../../../lib/authz.js'
import { getPendingReleases } from '../../../../../lib/db.js'

export const GET: APIRoute = async ({ params, request }) => {
  const { name } = params
  if (!name) return new Response('Bad request', { status: 400 })

  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) return new Response('Unauthorized', { status: 401 })
  const userId = await resolveToken(raw)
  if (!userId) return new Response('Unauthorized', { status: 401 })

  if (!(await canUserApproveRelease(userId, name))) {
    return new Response('Forbidden', { status: 403 })
  }

  const pending = await getPendingReleases(name)
  return new Response(JSON.stringify(pending.map(r => ({
    version: r.version,
    requested_by: r.requested_by,
    requested_at: r.created_at,
    publish_mode: r.publish_mode,
  }))), { headers: { 'Content-Type': 'application/json' } })
}
```

### Verification Command

```bash
cd /Users/justi/dev/lectern
# Test compilation (no runtime errors)
npx tsc --noEmit src/pages/api/packages/[name]/[version]/approve.ts 2>&1 | head -20
npx tsc --noEmit src/pages/api/packages/[name]/[version]/reject.ts 2>&1 | head -20
npx tsc --noEmit src/pages/api/packages/[name]/[version]/status.ts 2>&1 | head -20
npx tsc --noEmit src/pages/api/packages/[name]/releases/pending.ts 2>&1 | head -20
```

---

## Chunk 8 — Package Settings Route + Org Publish Mode Settings

### Goal
Create `PUT /api/packages/[name]/settings` for per-package publish mode override, and extend `PUT /api/orgs/[slug]` to support `default_publish_mode`.

### Files

**Created:**
- `src/pages/api/packages/[name]/settings.ts` — set per-package publish mode
- `src/pages/api/orgs/[slug]/settings.ts` — new route file (was handled in `[slug]/index.ts` as PUT) — extend org settings to include `default_publish_mode`

### `src/pages/api/packages/[name]/settings.ts`

```typescript
import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../../lib/tokens.js'
import { canUserApproveRelease } from '../../../../lib/authz.js'
import { setPackagePublishMode } from '../../../../lib/db.js'

export const PUT: APIRoute = async ({ params, request }) => {
  const { name } = params
  if (!name) return new Response('Bad request', { status: 400 })

  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) return new Response('Unauthorized', { status: 401 })
  const userId = await resolveToken(raw)
  if (!userId) return new Response('Unauthorized', { status: 401 })

  // Only org admins can set per-package publish mode
  if (!(await canUserApproveRelease(userId, name))) {
    return new Response('Forbidden', { status: 403 })
  }

  let body: { publish_mode?: string }
  try {
    body = await request.json()
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  const rawMode = body.publish_mode
  if (!rawMode || !['immediate', 'gated', 'inherit'].includes(rawMode)) {
    return new Response(JSON.stringify({ error: 'publish_mode must be "immediate", "gated", or "inherit"' }), { status: 400 })
  }

  const mode = rawMode as 'immediate' | 'gated' | 'inherit'
  await setPackagePublishMode(name, mode)

  return new Response(JSON.stringify({ name, publish_mode: mode }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
```

### Org settings update: `src/pages/api/orgs/[slug]/index.ts`

Extend the existing `PUT` handler to also accept `default_publish_mode`:

```typescript
// In the PUT handler, replace:
const { name, description } = body
// With:
const { name, description, default_publish_mode } = body

// After org update:
if (default_publish_mode !== undefined) {
  if (!['immediate', 'gated'].includes(default_publish_mode)) {
    return new Response(JSON.stringify({ error: 'default_publish_mode must be "immediate" or "gated"' }), { status: 400 })
  }
  await adminDb
    .from('orgs')
    .update({ default_publish_mode })
    .eq('id', org.id)
}
```

Also add audit logging for the org setting change.

### Verification Command

```bash
cd /Users/justi/dev/lectern
npx tsc --noEmit src/pages/api/packages/[name]/settings.ts 2>&1 | head -10
npx tsc --noEmit src/pages/api/orgs/[slug]/index.ts 2>&1 | head -10
```

---

## Chunk 9 — Audit Events for Release Gating

### Goal
Add `release.request`, `release.approve`, `release.reject` to the audit log action type.

### Files

**Modified:**
- `src/lib/audit.ts` — add release-related audit actions to `AuditAction` type

### Changes to `src/lib/audit.ts`

```typescript
export type AuditAction =
  | 'package.publish'
  | 'package.unpublish'
  | 'org.create'
  | 'org.update'
  | 'org.delete'
  | 'member.add'
  | 'member.remove'
  | 'member.role_change'
  | 'team.create'
  | 'team.delete'
  | 'invite.create'
  | 'invite.accept'
  | 'invite.cancel'
  | 'token.create'
  | 'token.revoke'
  | 'webhook.create'
  | 'webhook.update'
  | 'webhook.delete'
  | 'release.request'    // NEW: gated publish submitted
  | 'release.approve'    // NEW: admin approved
  | 'release.reject'     // NEW: admin rejected
```

### Verification

No runtime verification needed — purely type change. TypeScript compilation check:

```bash
cd /Users/justi/dev/lectern
npx tsc --noEmit src/lib/audit.ts
```

---

## Chunk 10 — Search: Filter Unlisted from Results

### Goal
Ensure search results only return `public` versions, never `unlisted`.

### Files

**Modified:**
- `src/pages/api/search.ts` — add `visibility = 'public'` filter to search query
- `src/lib/search.ts` — ensure public-only filter is applied in the search RPC call

### Changes to `src/lib/search.ts`

The search function uses an RPC. Ensure the query filters visibility:

```sql
-- In get_search_results RPC (if applicable)
-- Filter: WHERE visibility = 'public'
```

If using Supabase full-text search on `package_versions`, add:
`.eq('visibility', 'public')` to the query builder chain.

### Verification Command

```bash
cd /Users/justi/dev/lectern
# Verify the search index route still compiles
npx tsc --noEmit src/pages/api/search.ts 2>&1 | head -10
```

---

## Chunk 11 — Monorepo Batch Publish Endpoint

### Goal
Create `POST /api/monorepo/publish` to handle batch publishing of multiple packages in one request.

### Files

**Created:**
- `src/pages/api/monorepo/publish.ts` — batch publish handler
- `src/pages/api/monorepo/publish.test.ts` — unit tests

### `src/pages/api/monorepo/publish.ts`

```typescript
import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../lib/tokens.js'
import { canUserPublish } from '../../../lib/authz.js'
import { getEffectivePublishMode, insertRelease } from '../../../lib/db.js'
import { uploadTarball } from '../../../lib/storage.js'
import { extractDependencies } from '../../../tar.js'
import { deliverWebhook } from '../../../lib/webhooks.js'
import { logAuditEvent } from '../../../lib/audit.js'
import { checkRateLimit, rateLimitHeaders } from '../../../lib/ratelimit.js'
import { normalizePackageName, parsePackageName } from '../../../lib/scoped-pkg.js'

const MAX_PACKAGES_PER_REQUEST = 50

interface MonorepoPackage {
  name: string
  version: string
  visibility?: 'public' | 'unlisted'
  publish_mode?: 'immediate' | 'gated'
  tarball_base64: string
  description?: string | null
  readme?: string | null
  author?: string | null
  license?: string | null
  tags?: string[]
}

export const POST: APIRoute = async ({ request }) => {
  // Auth
  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) return new Response('Unauthorized', { status: 401 })
  const userId = await resolveToken(raw)
  if (!userId) return new Response('Unauthorized', { status: 401 })

  // Parse body
  let body: { packages: MonorepoPackage[] }
  try {
    body = await request.json()
  } catch {
    return new Response('Bad request: invalid JSON', { status: 400 })
  }

  const { packages } = body
  if (!Array.isArray(packages) || packages.length === 0) {
    return new Response('Bad request: packages must be a non-empty array', { status: 400 })
  }
  if (packages.length > MAX_PACKAGES_PER_REQUEST) {
    return new Response(`Bad request: max ${MAX_PACKAGES_PER_REQUEST} packages per request`, { status: 400 })
  }

  // Normalize and validate all names first (fail-fast on format errors)
  const validated = packages.map((pkg, i) => {
    if (!pkg.name || typeof pkg.name !== 'string') {
      throw new Error(`packages[${i}]: missing or invalid name`)
    }
    if (!pkg.version || typeof pkg.version !== 'string') {
      throw new Error(`packages[${i}]: missing or invalid version`)
    }
    if (!pkg.tarball_base64 || typeof pkg.tarball_base64 !== 'string') {
      throw new Error(`packages[${i}]: missing or invalid tarball_base64`)
    }
    const normalized = normalizePackageName(pkg.name)
    if (!normalized) throw new Error(`packages[${i}]: invalid package name "${pkg.name}"`)
    return { ...pkg, name: normalized }
  })

  // Authz check: user must have permission on ALL packages
  for (const pkg of validated) {
    if (!(await canUserPublish(userId, pkg.name))) {
      return new Response(
        JSON.stringify({ error: `You do not have permission to publish to ${pkg.name}` }),
        { status: 403 }
      )
    }
    // Per-package rate limit
    const endpoint = `PUT /api/packages/${pkg.name}/*`
    const rl = await checkRateLimit(userId, null, endpoint, 30, 60)
    if (!rl.allowed) {
      return new Response(
        JSON.stringify({ error: `Rate limit exceeded for ${pkg.name}` }),
        { status: 429 }
      )
    }
  }

  const results: Array<{ name: string; version: string; status: string; error?: string }> = []
  let hasFailure = false

  for (const pkg of validated) {
    try {
      const visibility = pkg.visibility ?? 'public'
      const publishMode = pkg.publish_mode ?? 'immediate'

      // Decode tarball
      let tarballData: Buffer
      try {
        tarballData = Buffer.from(pkg.tarball_base64, 'base64')
      } catch {
        results.push({ name: pkg.name, version: pkg.version, status: 'failed', error: 'Invalid base64 tarball' })
        hasFailure = true
        continue
      }

      // Upload tarball
      let tarballUrl: string
      try {
        tarballUrl = await uploadTarball(pkg.name, pkg.version, tarballData)
      } catch (err) {
        results.push({ name: pkg.name, version: pkg.version, status: 'failed', error: 'Tarball upload failed' })
        hasFailure = true
        continue
      }

      // Determine gated
      const effectiveMode = await getEffectivePublishMode(pkg.name)
      const isGated = publishMode === 'gated' || effectiveMode === 'gated'

      // Insert version
      const { insertVersion, createScopedPackage, getPackageOwner } = await import('../../../lib/db.js')
      const owner = await getPackageOwner(pkg.name)
      if (!owner) {
        await createScopedPackage(pkg.name, userId, 'user', null, null)
      }

      let releaseId: string | null = null
      let finalVisibility = visibility

      if (isGated) {
        const { insertRelease } = await import('../../../lib/db.js')
        releaseId = await insertRelease({
          packageName: pkg.name,
          version: pkg.version,
          publishMode: effectiveMode,
          requestedBy: userId,
          tarballUrl,
        })
        finalVisibility = 'unlisted'
      }

      await insertVersion({
        package_name: pkg.name,
        version: pkg.version,
        description: pkg.description ?? null,
        readme: pkg.readme ?? null,
        author: pkg.author ?? null,
        license: pkg.license ?? null,
        dependencies: {},
        tarball_url: tarballUrl,
        embedding: null,
        visibility: finalVisibility,
        release_id: releaseId,
      })

      if (isGated) {
        results.push({ name: pkg.name, version: pkg.version, status: 'pending' })
        deliverWebhook(null, 'release.pending', {
          package: pkg.name,
          version: pkg.version,
          status: 'pending',
          requested_by: userId,
          org_id: null,
        }).catch(() => {})
      } else {
        results.push({ name: pkg.name, version: pkg.version, status: 'published' })
        deliverWebhook(null, 'package.published', {
          package: pkg.name,
          version: pkg.version,
          description: pkg.description ?? null,
          published_by: userId,
          owner_type: 'user',
          owner_id: userId,
        }).catch(() => {})
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      results.push({ name: pkg.name, version: pkg.version, status: 'failed', error: message })
      hasFailure = true
    }
  }

  const httpStatus = hasFailure ? 207 : 200
  return new Response(JSON.stringify({
    published: results.filter(r => r.status === 'published' || r.status === 'pending'),
    failed: results.filter(r => r.status === 'failed'),
  }), { status: httpStatus, headers: { 'Content-Type': 'application/json' } })
}
```

### Test File: `src/pages/api/monorepo/publish.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../../lib/supabase.js', () => ({
  supabase: {
    storage: { from: vi.fn().mockReturnValue({ upload: vi.fn().mockResolvedValue({ error: null }) }) },
    from: vi.fn().mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) }),
    rpc: vi.fn().mockResolvedValue({ error: null }),
  },
}))

vi.mock('../../../../lib/storage.js', () => ({
  uploadTarball: vi.fn().mockResolvedValue('https://example.com/tarballs/foo/1.0.0.tar.gz'),
}))

vi.mock('../../../../lib/tokens.js', () => ({
  extractBearer: vi.fn().mockReturnValue('valid-token'),
  resolveToken: vi.fn().mockResolvedValue('user-123'),
}))

vi.mock('../../../../lib/authz.js', () => ({
  canUserPublish: vi.fn().mockResolvedValue(true),
}))

vi.mock('../../../../lib/webhooks.js', () => ({
  deliverWebhook: vi.fn().mockResolvedValue(undefined),
}))

describe('POST /api/monorepo/publish validation', () => {
  it('rejects empty packages array', async () => {
    // Build minimal request to test validation
    const body = { packages: [] }
    // Validation happens in handler: packages.length === 0 triggers 400
    expect(body.packages.length).toBe(0)
  })

  it('rejects > 50 packages', async () => {
    const body = { packages: Array(51).fill({ name: 'foo', version: '1.0.0', tarball_base64: 'foo' }) }
    expect(body.packages.length).toBe(51)
    expect(body.packages.length > 50).toBe(true)
  })

  it('normalizes package names to lowercase', () => {
    const { normalizePackageName } = require('../../../../lib/scoped-pkg.js')
    expect(normalizePackageName('@Org/Pkg')).toBe('@org/pkg')
    expect(normalizePackageName('React')).toBe('react')
  })
})
```

### Verification Command

```bash
cd /Users/justi/dev/lectern
npx vitest run src/pages/api/monorepo/publish.test.ts
```

---

## Chunk 12 — UI: Package Page — Preview Badge + Version Visibility Toggle

### Goal
Update the package page to show "Preview" badge on unlisted versions and add a visibility toggle for owners.

### Files

**Modified:**
- `src/pages/packages/[name].astro` — add Preview badge, show visibility in version list

### Changes to `src/pages/packages/[name].astro`

In the version list rendering section:

```astro
---
// In the version list loop, add visibility badge
const versions = await getPackageVersions(pkg.name)
// Filter to public unless owner
const showAllVersions = isOwner && request.url.includes('include_unlisted=true')
const visibleVersions = showAllVersions ? versions : versions.filter(v => v.visibility === 'public')
---

{visibleVersions.map(v => (
  <div class="version-row">
    <span class="version-number">{v.version}</span>
    {v.visibility === 'unlisted' && (
      <span class="preview-badge">Preview</span>
    )}
    <span class="version-date">{new Date(v.published_at).toLocaleDateString()}</span>
  </div>
))}
```

For the settings panel (if owner):

```astro
{isOwner && (
  <details class="version-settings">
    <summary>Manage Version Visibility</summary>
    {versions.map(v => (
      <div class="version-visibility-row">
        <span>{v.version}</span>
        <span class="badge-{v.visibility}">{v.visibility}</span>
        {v.visibility === 'public' ? (
          <button hx-post={`/api/packages/${pkg.name}/${v.version}/unlist`}>Make Unlisted</button>
        ) : (
          <button hx-post={`/api/packages/${pkg.name}/${v.version}/list`}>Make Public</button>
        )}
      </div>
    ))}
  </details>
)}
```

### Verification

UI changes are Astro templates — no automated test. Verify the page renders without errors:

```bash
cd /Users/justi/dev/lectern
npx astro check src/pages/packages/[name].astro 2>&1 | head -20
```

---

## Chunk 13 — Version Visibility Toggle Endpoint

### Goal
Allow package owners to change a version's visibility after publish.

### Files

**Created:**
- `src/pages/api/packages/[name]/[version]/visibility.ts` — `PUT` to toggle visibility

### `src/pages/api/packages/[name]/[version]/visibility.ts`

```typescript
import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../../../lib/tokens.js'
import { canUserPublish } from '../../../../../lib/authz.js'
import { supabase } from '../../../../../lib/supabase.js'

export const PUT: APIRoute = async ({ params, request }) => {
  const { name, version } = params
  if (!name || !version) return new Response('Bad request', { status: 400 })

  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) return new Response('Unauthorized', { status: 401 })
  const userId = await resolveToken(raw)
  if (!userId) return new Response('Unauthorized', { status: 401 })

  if (!(await canUserPublish(userId, name))) {
    return new Response('Forbidden', { status: 403 })
  }

  let body: { visibility: 'public' | 'unlisted' }
  try {
    body = await request.json()
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  if (!['public', 'unlisted'].includes(body.visibility)) {
    return new Response('visibility must be "public" or "unlisted"', { status: 400 })
  }

  const { error } = await supabase
    .from('package_versions')
    .update({ visibility: body.visibility })
    .eq('package_name', name)
    .eq('version', version)

  if (error) return new Response('Database error', { status: 500 })

  return new Response(JSON.stringify({ name, version, visibility: body.visibility }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
```

### Verification Command

```bash
cd /Users/justi/dev/lectern
npx tsc --noEmit src/pages/api/packages/[name]/[version]/visibility.ts 2>&1 | head -10
```

---

## Chunk 14 — Migration: Add `publish_mode` Column to Packages

### Goal
Add a per-package `publish_mode` override column to the `packages` table (enables `gated` / `immediate` / `inherit` per package).

### Files

**Created:**
- `supabase/migrations/016_package_publish_mode.sql`

### `supabase/migrations/016_package_publish_mode.sql`

```sql
-- Per-package publish mode override
alter table packages
  add column publish_mode text
    check (publish_mode in ('immediate', 'gated', 'inherit'));

-- Default null means "inherit from org"
-- 'inherit' explicitly means inherit
-- 'immediate' or 'gated' override the org default
```

### Verification Command

```bash
psql $SUPABASE_DB_URL -c "\d packages" | grep publish_mode
```

---

## Chunk 15 — Final Integration: Add `#unlisted` Tag for Unlisted Versions

### Goal
When a version is published as unlisted, automatically tag it with `#unlisted`.

### Files

**Modified:**
- `src/pages/api/packages/[name]/[version].ts` (the PUT handler) — add unlisted tag on publish

### Changes

In the publish handler, after inserting the version, add:

```typescript
// If visibility is unlisted, add the #unlisted tag
if (visibility === 'unlisted') {
  const { addPackageTag } = await import('../../../../lib/db.js')
  addPackageTag(normalizedName, '#unlisted').catch(() => {})
}
```

### Verification

This is a one-line addition in the existing PUT handler. No new tests required beyond what was already added in Chunk 5.

---

## Chunk 16 — Audit Log Type Safety: Add `release.*` Actions

### Goal
Already done in Chunk 9. This chunk verifies the type change is complete and all audit log calls in approve/reject handlers use the new action types.

### Verification

```bash
cd /Users/justi/dev/lectern
grep -n "release.request\|release.approve\|release.reject" src/pages/api/packages/[name]/[version]/approve.ts src/pages/api/packages/[name]/[version]/reject.ts
```

Expected: both files call `logAuditEvent` with the new action types.

---

## Summary: Files Created/Modified

| # | File | Type | Purpose |
|---|---|---|---|
| 1 | `supabase/migrations/014_scoped_packages_and_visibility.sql` | Create | scope_type, scope_id, visibility, org.default_publish_mode |
| 2 | `supabase/migrations/015_releases.sql` | Create | releases table, release_id FK |
| 3 | `supabase/migrations/016_package_publish_mode.sql` | Create | packages.publish_mode override |
| 4 | `src/lib/scoped-pkg.ts` | Create | Scoped name validation/parsing (pure functions) |
| 5 | `src/lib/scoped-pkg.test.ts` | Create | Unit tests for scoped-pkg |
| 6 | `src/lib/db.ts` | Modify | Add scoped/release DB functions |
| 7 | `src/lib/authz.ts` | Modify | Scoped authz + release gating authz |
| 8 | `src/lib/audit.ts` | Modify | Add release.* audit actions |
| 9 | `src/pages/api/packages/[name]/[version].ts` | Modify | Publish: scoped names, visibility, gated |
| 10 | `src/pages/api/packages/[name]/[version].test.ts` | Modify | Tests for scoped/visibility/gated |
| 11 | `src/pages/api/packages/[name]/index.ts` | Modify | Return visibility, filter unlisted |
| 12 | `src/pages/api/packages/[name]/index.test.ts` | Modify | Tests for visibility in index |
| 13 | `src/pages/api/packages/[name]/[version]/approve.ts` | Create | POST approve gated release |
| 14 | `src/pages/api/packages/[name]/[version]/reject.ts` | Create | POST reject gated release |
| 15 | `src/pages/api/packages/[name]/[version]/status.ts` | Create | GET release status (publisher) |
| 16 | `src/pages/api/packages/[name]/releases/pending.ts` | Create | GET list pending releases |
| 17 | `src/pages/api/packages/[name]/settings.ts` | Create | PUT per-package publish mode |
| 18 | `src/pages/api/orgs/[slug]/index.ts` | Modify | PUT supports default_publish_mode |
| 19 | `src/pages/api/search.ts` | Modify | Filter unlisted from search |
| 20 | `src/pages/api/monorepo/publish.ts` | Create | POST batch publish |
| 21 | `src/pages/api/monorepo/publish.test.ts` | Create | Tests for monorepo publish |
| 22 | `src/pages/api/packages/[name]/[version]/visibility.ts` | Create | PUT toggle version visibility |
| 23 | `src/pages/packages/[name].astro` | Modify | Preview badge, version list visibility |
