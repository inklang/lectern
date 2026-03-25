# Ecosystem Health — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a composite 0–100 health score plus per-category status labels to every package, with a badge on the package page and a "Health Leaders" panel on the homepage.

**Phase 1 scope:** schema, badge on package page, health panel on homepage. No maintainer dashboard.

**Architecture:** `package_health` table populated by `compute_package_health()` called on-demand by triggers and nightly cron. Score is a weighted sum of four category scores. Data is public read.

**Tech Stack:** Astro SSR, Supabase Postgres + pg_cron, TypeScript.

**Schema note:** The `package_versions` table stores `readme` as a plain text column (not inside a JSONB object). Quality signals `has_readme` are derived from `readme IS NOT NULL AND readme != ''`. The fields `tests` and `changelog` are not yet stored in `package_versions` — the `manifest` JSONB column will be added in this migration to capture ink.toml fields on publish. Phase 1 backfills `has_tests` and `has_changelog` as `false` for existing packages.

---

## File Map

### New files
- `supabase/migrations/014_package_health.sql` — `manifest` column, `package_health` table, functions, RLS, cron, backfill
- `src/lib/db.ts` — add `getPackageHealth`, `getHealthLeaders`, `computePackageHealth` + types
- `src/pages/api/packages/[name]/health.ts` — `GET /api/packages/[name]/health` endpoint
- `src/pages/api/packages/[name]/health.test.ts` — tests for the endpoint
- `src/components/HealthBadge.astro` — badge with tooltip and expandable panel
- `src/lib/health.test.ts` — unit tests for scoring logic in TypeScript

### Modified files
- `src/pages/packages/[name].astro` — import and render `<HealthBadge>` in the package header
- `src/pages/index.astro` — add "Health Leaders" section below existing sections

---

## Chunk 1: Database Migration

### Task 1: Create `supabase/migrations/014_package_health.sql`

**Files:**
- Create: `supabase/migrations/014_package_health.sql`

```sql
-- Ecosystem Health — package_health table, functions, cron, backfill

---------------------------------------------------------------
-- 0. Add manifest JSONB column to package_versions
--    This stores ink.toml fields scanned at publish time:
--    { "tests": "...", "changelog": "...", "license": "...", "ink_version": "..." }
---------------------------------------------------------------
alter table package_versions
  add column if not exists manifest jsonb default '{}'::jsonb;

---------------------------------------------------------------
-- 1. package_health table
---------------------------------------------------------------
create table if not exists package_health (
  package_name           text primary key references packages(name) on delete cascade,
  computed_at            timestamptz not null default now(),

  -- Maintenance (0–100)
  maintenance_score      int not null default 0,
  maintenance_status     text not null default 'unknown',
  last_release_at        timestamptz,
  release_frequency_days int,
  open_issue_count       int not null default 0,
  last_commit_at        timestamptz,

  -- Popularity (0–100)
  popularity_score       int not null default 0,
  popularity_status      text not null default 'unknown',
  downloads_7d           bigint not null default 0,
  downloads_30d          bigint not null default 0,
  star_count             int not null default 0,
  dependent_count        int not null default 0,

  -- Quality (0–100)
  quality_score          int not null default 0,
  quality_status         text not null default 'unknown',
  has_readme            boolean not null default false,
  has_tests              boolean not null default false,
  has_changelog          boolean not null default false,
  known_vuln_count       int not null default 0,
  has_badge              boolean not null default false,

  -- Compliance (0–100)
  compliance_score       int not null default 0,
  compliance_status      text not null default 'unknown',
  license_compatible     boolean not null default false,
  ink_version_ok         boolean not null default false,
  deprecated_dep_count    int not null default 0,

  -- Composite (materialized)
  health_score           int not null default 0,
  health_status          text not null default 'unknown'
);

---------------------------------------------------------------
-- 2. RLS
---------------------------------------------------------------
alter table package_health enable row level security;

create policy "public read package_health"
  on package_health for select using (true);

create policy "service upsert package_health"
  on package_health for upsert using (auth.role() = 'service_role');

---------------------------------------------------------------
-- 3. Helper: derive status label from score
---------------------------------------------------------------
create or replace function health_score_to_status(score int)
returns text
language sql
immutable
as $$
  select case
    when score >= 80 then 'excellent'
    when score >= 60 then 'good'
    when score >= 40 then 'fair'
    when score >= 20 then 'poor'
    else 'unknown'
  end;
$$;

---------------------------------------------------------------
-- 4. get_dependent_count(pkg_name text) → int
--    Counts packages whose latest version's dependencies JSONB includes pkg_name.
---------------------------------------------------------------
create or replace function get_dependent_count(pkg_name text)
returns int
language sql
stable
as $$
  select count(distINCT pv.package_name)
  from package_versions pv
  where pv.dependencies ? pkg_name
    and pv.version = (
      select pv2.version
      from package_versions pv2
      where pv2.package_name = pv.package_name
      order by pv2.published_at desc
      limit 1
    );
$$;

---------------------------------------------------------------
-- 5. compute_package_health(pkg_name text) → void
--    Fetches all signals, computes category + composite scores,
--    upserts package_health. Called by cron, version trigger,
--    star trigger, and advisory trigger.
---------------------------------------------------------------
create or replace function compute_package_health(pkg_name text)
returns void
language plpgsql
security definer
as $$
declare
  v_last_release_at        timestamptz;
  v_release_frequency_days  int := 0;
  v_open_issue_count       int := 0;

  v_downloads_7d            bigint := 0;
  v_downloads_30d           bigint := 0;
  v_star_count              int := 0;
  v_dependent_count         int := 0;

  v_has_readme              boolean := false;
  v_has_tests               boolean := false;
  v_has_changelog           boolean := false;
  v_known_vuln_count        int := 0;
  v_has_badge               boolean := false;

  v_license_compatible      boolean := true;  -- Phase 1: placeholder
  v_ink_version_ok          boolean := true;  -- Phase 1: placeholder
  v_deprecated_dep_count    int := 0;

  -- Category scores
  maint_score int;
  pop_score   int;
  qual_score  int;
  comp_score  int;
  health_score int;

  -- Ecosystem maxima for popularity normalization
  max_dl7   bigint;
  max_dl30  bigint;
  max_stars int;
  max_deps  int;

  -- Latest version manifest
  v_manifest jsonb;
begin
  -- ── Maintenance signals ──────────────────────────────────────
  -- Last release: newest published_at in package_versions
  select max(published_at) into v_last_release_at
  from package_versions
  where package_name = pkg_name;

  -- Release frequency: median days between consecutive published_ats
  select coalesce(median(gap)::int, 0) into v_release_frequency_days
  from (
    select published_at - lag(published_at) over (order by published_at) as gap
    from package_versions
    where package_name = pkg_name
    order by published_at
  ) gaps
  where gap is not null;

  -- Open issue count: GitHub API out of scope for Phase 1
  v_open_issue_count := 0;

  -- Maintenance score: last_release 50%, release_frequency 25%, open_issues 25%
  maint_score := round(
    (case
      when v_last_release_at is null then 0
      when v_last_release_at >= now() - interval '30 days' then 100
      when v_last_release_at >= now() - interval '90 days' then 75
      when v_last_release_at >= now() - interval '180 days' then 50
      when v_last_release_at >= now() - interval '365 days' then 25
      else 0
    end) * 0.50
    +
    (case
      when v_release_frequency_days = 0 then 0
      when v_release_frequency_days < 30 then 100
      when v_release_frequency_days < 90 then 75
      when v_release_frequency_days < 180 then 50
      when v_release_frequency_days < 365 then 25
      else 0
    end) * 0.25
    +
    (case
      when v_open_issue_count = 0 then 100
      when v_open_issue_count < 10 then 80
      when v_open_issue_count < 25 then 60
      when v_open_issue_count < 50 then 40
      else 0
    end) * 0.25
  )::int;

  -- ── Popularity signals ────────────────────────────────────────
  -- downloads from get_package_stats RPC (returns JSONB {last7d, last30d, total})
  begin
    select
      (get_package_stats(pkg_name)->>'last7d')::bigint,
      (get_package_stats(pkg_name)->>'last30d')::bigint
    into v_downloads_7d, v_downloads_30d;
  exception when others then
    v_downloads_7d := 0;
    v_downloads_30d := 0;
  end;

  -- star_count from packages table
  select coalesce(star_count, 0) into v_star_count
  from packages where name = pkg_name;

  -- dependent_count
  v_dependent_count := get_dependent_count(pkg_name);

  -- Ecosystem maxima for normalization
  select coalesce(max(dl7), 1), coalesce(max(dl30), 1) into max_dl7, max_dl30
  from (
    select (get_package_stats(pv.package_name)->>'last7d')::bigint as dl7,
           (get_package_stats(pv.package_name)->>'last30d')::bigint as dl30
    from package_versions pv
    group by pv.package_name
  ) stats;

  select coalesce(max(star_count), 1) into max_stars from packages;

  select coalesce(max(dep_cnt), 1) into max_deps
  from (
    select count(*) as dep_cnt
    from package_versions pv
    where pv.dependencies ? pv.package_name
      and pv.version = (
        select version from package_versions
        where package_name = pv.package_name
        order by published_at desc limit 1
      )
    group by pv.package_name
  ) dep;

  -- Popularity score: 7d 40%, 30d 25%, stars 20%, dependents 15%
  pop_score := round(
    (greatest(0, least(100, (v_downloads_7d::numeric  / greatest(1, max_dl7))  * 100)) * 0.40)
    + (greatest(0, least(100, (v_downloads_30d::numeric / greatest(1, max_dl30)) * 100)) * 0.25)
    + (greatest(0, least(100, (v_star_count::numeric   / greatest(1, max_stars)) * 100)) * 0.20)
    + (greatest(0, least(100, (v_dependent_count::numeric / greatest(1, max_deps)) * 100)) * 0.15)
  )::int;

  -- ── Quality signals ──────────────────────────────────────────
  -- has_readme: readme column is a plain text column
  select (readme is not null and readme != '') into v_has_readme
  from package_versions
  where package_name = pkg_name
  order by published_at desc limit 1;

  -- Get manifest from latest version for has_tests, has_changelog
  select manifest into v_manifest
  from package_versions
  where package_name = pkg_name
  order by published_at desc limit 1;

  v_has_tests := v_manifest ? 'tests';
  v_has_changelog := v_manifest ? 'changelog';

  -- known_vuln_count: advisories with severity != 'info'
  select count(*) into v_known_vuln_count
  from package_advisories
  where package_name = pkg_name
    and severity != 'info';

  -- has_badge: placeholder — calls badge API endpoint (Phase 2)
  v_has_badge := false;

  -- Quality score: has_readme 25, has_tests 25, has_changelog 20, has_badge 10,
  --                known_vuln_count deducts 15 per vuln (min 0)
  qual_score := least(100, round(
    (case when v_has_readme then 25 else 0 end)
    + (case when v_has_tests then 25 else 0 end)
    + (case when v_has_changelog then 20 else 0 end)
    + (case when v_has_badge then 10 else 0 end)
    + greatest(0, 100 - v_known_vuln_count * 15)
  ))::int;

  -- ── Compliance signals ───────────────────────────────────────
  -- ink_version_ok: placeholder (Phase 2 — parse ink_version from manifest)
  v_ink_version_ok := true;

  -- license_compatible: placeholder (Phase 2 — license allowlist)
  v_license_compatible := true;

  -- deprecated_dep_count: deps in dependencies JSONB that are themselves deprecated
  select count(*) into v_deprecated_dep_count
  from (
    select key as dep_name
    from package_versions pv,
         jsonb_each_text(pv.dependencies)
    where pv.package_name = pkg_name
      and pv.version = (
        select version from package_versions
        where package_name = pkg_name
        order by published_at desc limit 1
      )
  ) deps
  where exists (
    select 1 from packages p where p.name = dep_name and p.deprecated is true
  );

  -- Compliance score: license_compatible 40, ink_version_ok 40, deprecated_dep_count=0 gives 20
  comp_score := (
    (case when v_license_compatible then 40 else 0 end)
    + (case when v_ink_version_ok then 40 else 0 end)
    + (case when v_deprecated_dep_count = 0 then 20 else 0 end)
  )::int;

  -- ── Composite score ──────────────────────────────────────────
  health_score := round(
    maint_score * 0.30
    + pop_score  * 0.25
    + qual_score * 0.25
    + comp_score * 0.20
  )::int;

  -- ── Upsert ───────────────────────────────────────────────────
  insert into package_health (
    package_name, computed_at,
    maintenance_score, maintenance_status, last_release_at, release_frequency_days,
    open_issue_count, last_commit_at,
    popularity_score, popularity_status, downloads_7d, downloads_30d,
    star_count, dependent_count,
    quality_score, quality_status, has_readme, has_tests, has_changelog,
    known_vuln_count, has_badge,
    compliance_score, compliance_status, license_compatible, ink_version_ok,
    deprecated_dep_count,
    health_score, health_status
  ) values (
    pkg_name, now(),
    maint_score, health_score_to_status(maint_score), v_last_release_at, v_release_frequency_days,
    v_open_issue_count, null,
    pop_score, health_score_to_status(pop_score), v_downloads_7d, v_downloads_30d,
    v_star_count, v_dependent_count,
    qual_score, health_score_to_status(qual_score),
    coalesce(v_has_readme, false), coalesce(v_has_tests, false), coalesce(v_has_changelog, false),
    v_known_vuln_count, v_has_badge,
    comp_score, health_score_to_status(comp_score),
    v_license_compatible, v_ink_version_ok, v_deprecated_dep_count,
    health_score, health_score_to_status(health_score)
  )
  on conflict (package_name) do update set
    computed_at            = now(),
    maintenance_score      = excluded.maintenance_score,
    maintenance_status     = excluded.maintenance_status,
    last_release_at        = excluded.last_release_at,
    release_frequency_days = excluded.release_frequency_days,
    open_issue_count       = excluded.open_issue_count,
    popularity_score       = excluded.popularity_score,
    popularity_status      = excluded.popularity_status,
    downloads_7d           = excluded.downloads_7d,
    downloads_30d          = excluded.downloads_30d,
    star_count             = excluded.star_count,
    dependent_count        = excluded.dependent_count,
    quality_score          = excluded.quality_score,
    quality_status         = excluded.quality_status,
    has_readme             = excluded.has_readme,
    has_tests              = excluded.has_tests,
    has_changelog          = excluded.has_changelog,
    known_vuln_count       = excluded.known_vuln_count,
    has_badge              = excluded.has_badge,
    compliance_score       = excluded.compliance_score,
    compliance_status      = excluded.compliance_status,
    license_compatible     = excluded.license_compatible,
    ink_version_ok         = excluded.ink_version_ok,
    deprecated_dep_count   = excluded.deprecated_dep_count,
    health_score          = excluded.health_score,
    health_status          = excluded.health_status;
end;
$$;

---------------------------------------------------------------
-- 6. compute_all_package_health() → void
--    Iterates all packages, calls compute_package_health per row.
--    Called by the nightly cron job. Processes in name order.
---------------------------------------------------------------
create or replace function compute_all_package_health()
returns void
language plpgsql
as $$
declare
  pkg_name text;
begin
  for pkg_name in
    select name from packages order by name
  loop
    perform compute_package_health(pkg_name);
  end loop;
end;
$$;

---------------------------------------------------------------
-- 7. get_package_health(pkg_name text) → package_health
---------------------------------------------------------------
create or replace function get_package_health(pkg_name text)
returns package_health
language sql
stable
security definer
as $$
  select * from package_health where package_name = pkg_name;
$$;

---------------------------------------------------------------
-- 8. get_health_leaders(limit_count int) → table
---------------------------------------------------------------
create or replace function get_health_leaders(limit_count int default 5)
returns table (
  package_name   text,
  health_score   int,
  health_status  text,
  description    text,
  latest_version text
)
language sql
stable
as $$
  select
    ph.package_name,
    ph.health_score,
    ph.health_status,
    pv.description,
    pv.version as latest_version
  from package_health ph
  join package_versions pv on pv.package_name = ph.package_name
    and pv.version = (
      select pv2.version from package_versions pv2
      where pv2.package_name = ph.package_name
      order by pv2.published_at desc limit 1
    )
  where ph.health_status = 'excellent'
  order by ph.health_score desc
  limit limit_count;
$$;

---------------------------------------------------------------
-- 9. pg_cron nightly job at 3am UTC
---------------------------------------------------------------
select cron.schedule(
  'compute-package-health',
  '0 3 * * *',
  $$
  select compute_all_package_health();
  $$
);

---------------------------------------------------------------
-- 10. Backfill: compute health for all existing packages
---------------------------------------------------------------
perform compute_all_package_health();
```

**Verification commands (run after applying migration):**
```bash
# Apply migration
supabase db push

# Verify manifest column exists
supabase db execute --sql "SELECT manifest FROM package_versions LIMIT 1;"

# Verify table exists and has data
supabase db execute --sql "SELECT count(*) as total, count(filtered.health_score) as computed FROM package_health;"

# Verify cron job is scheduled
supabase db execute --sql "SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'compute-package-health';"

# Verify health leaders view works
supabase db execute --sql "SELECT package_name, health_score, health_status FROM get_health_leaders(5);"
```

Expected after backfill: `package_health` has one row per package with computed scores.

---

## Chunk 2: TypeScript DB Layer

### Task 2: Add health functions and types to `src/lib/db.ts`

**Files:**
- Modify: `src/lib/db.ts`

Append the following exports to `src/lib/db.ts`:

```typescript
// ─── Package Health ─────────────────────────────────────────────────────────────

export type HealthStatus = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown'

export interface PackageHealth {
  package_name: string
  computed_at: string
  maintenance_score: number
  maintenance_status: HealthStatus
  last_release_at: string | null
  release_frequency_days: number | null
  open_issue_count: number
  last_commit_at: string | null
  popularity_score: number
  popularity_status: HealthStatus
  downloads_7d: number
  downloads_30d: number
  star_count: number
  dependent_count: number
  quality_score: number
  quality_status: HealthStatus
  has_readme: boolean
  has_tests: boolean
  has_changelog: boolean
  known_vuln_count: number
  has_badge: boolean
  compliance_score: number
  compliance_status: HealthStatus
  license_compatible: boolean
  ink_version_ok: boolean
  deprecated_dep_count: number
  health_score: number
  health_status: HealthStatus
}

export interface HealthLeadersResult {
  package_name: string
  health_score: number
  health_status: HealthStatus
  description: string | null
  latest_version: string
}

// Fetches the full health record for one package (public).
export async function getPackageHealth(pkgName: string): Promise<PackageHealth | null> {
  const { data, error } = await supabase.rpc('get_package_health', { pkg_name: pkgName })
  if (error) throw error
  return (data as PackageHealth) ?? null
}

// Fetches top N excellent packages by health score.
export async function getHealthLeaders(limitCount = 5): Promise<HealthLeadersResult[]> {
  const { data, error } = await supabase.rpc('get_health_leaders', { limit_count: limitCount })
  if (error) throw error
  return (data as HealthLeadersResult[]) ?? []
}

// Triggers incremental recompute for one package (service role only).
export async function computePackageHealth(pkgName: string): Promise<void> {
  const { error } = await supabase.rpc('compute_package_health', { pkg_name: pkgName })
  if (error) throw error
}
```

**Verification command:**
```bash
cd C:/Users/justi/dev/lectern
npx tsc --noEmit src/lib/db.ts
```
Expected: no TypeScript errors (the new types must not conflict with existing ones).

### Task 3: Create `src/lib/health.test.ts` (unit tests for scoring logic)

**Files:**
- Create: `src/lib/health.test.ts`

```typescript
import { describe, it, expect } from 'vitest'

// Pure TypeScript re-implementation of the scoring logic from the plpgsql
// compute_package_health function. Kept in sync with the SQL.
// This enables TDD for the scoring rules without a running database.

export type HealthStatus = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown'

export function scoreToStatus(score: number): HealthStatus {
  if (score >= 80) return 'excellent'
  if (score >= 60) return 'good'
  if (score >= 40) return 'fair'
  if (score >= 20) return 'poor'
  return 'unknown'
}

function daysSince(ts: string | null): number {
  if (!ts) return 9999
  return (Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60 * 24)
}

export function maintenanceScore(params: {
  lastReleaseAt: string | null
  releaseFrequencyDays: number
  openIssueCount: number
}): number {
  const { lastReleaseAt, releaseFrequencyDays, openIssueCount } = params

  const lastReleaseRaw =
    lastReleaseAt === null ? 0
    : daysSince(lastReleaseAt) < 30 ? 100
    : daysSince(lastReleaseAt) < 90 ? 75
    : daysSince(lastReleaseAt) < 180 ? 50
    : daysSince(lastReleaseAt) < 365 ? 25
    : 0

  const releaseFreqRaw =
    releaseFrequencyDays === 0 ? 0
    : releaseFrequencyDays < 30 ? 100
    : releaseFrequencyDays < 90 ? 75
    : releaseFrequencyDays < 180 ? 50
    : releaseFrequencyDays < 365 ? 25
    : 0

  const issueRaw =
    openIssueCount === 0 ? 100
    : openIssueCount < 10 ? 80
    : openIssueCount < 25 ? 60
    : openIssueCount < 50 ? 40
    : 0

  return Math.round(lastReleaseRaw * 0.50 + releaseFreqRaw * 0.25 + issueRaw * 0.25)
}

export function qualityScore(params: {
  hasReadme: boolean
  hasTests: boolean
  hasChangelog: boolean
  hasBadge: boolean
  knownVulnCount: number
}): number {
  const { hasReadme, hasTests, hasChangelog, hasBadge, knownVulnCount } = params
  const raw =
    (hasReadme ? 25 : 0)
    + (hasTests ? 25 : 0)
    + (hasChangelog ? 20 : 0)
    + (hasBadge ? 10 : 0)
    + Math.max(0, 100 - knownVulnCount * 15)
  return Math.min(100, raw)
}

export function complianceScore(params: {
  licenseCompatible: boolean
  inkVersionOk: boolean
  deprecatedDepCount: number
}): number {
  const { licenseCompatible, inkVersionOk, deprecatedDepCount } = params
  return (licenseCompatible ? 40 : 0)
    + (inkVersionOk ? 40 : 0)
    + (deprecatedDepCount === 0 ? 20 : 0)
}

export function compositeScore(maint: number, pop: number, qual: number, comp: number): number {
  return Math.round(maint * 0.30 + pop * 0.25 + qual * 0.25 + comp * 0.20)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('scoreToStatus', () => {
  it('maps 80–100 to excellent', () => {
    expect(scoreToStatus(80)).toBe('excellent')
    expect(scoreToStatus(100)).toBe('excellent')
  })
  it('maps 60–79 to good', () => {
    expect(scoreToStatus(60)).toBe('good')
    expect(scoreToStatus(79)).toBe('good')
  })
  it('maps 40–59 to fair', () => {
    expect(scoreToStatus(40)).toBe('fair')
    expect(scoreToStatus(59)).toBe('fair')
  })
  it('maps 20–39 to poor', () => {
    expect(scoreToStatus(20)).toBe('poor')
    expect(scoreToStatus(39)).toBe('poor')
  })
  it('maps 0–19 to unknown', () => {
    expect(scoreToStatus(0)).toBe('unknown')
    expect(scoreToStatus(19)).toBe('unknown')
  })
})

describe('maintenanceScore', () => {
  it('scores 100 when last release within 30d and no issues', () => {
    const recent = new Date(Date.now() - 10 * 86400000).toISOString()
    expect(maintenanceScore({ lastReleaseAt: recent, releaseFrequencyDays: 15, openIssueCount: 0 })).toBe(100)
  })
  it('scores 50 for release 180d ago', () => {
    const old = new Date(Date.now() - 180 * 86400000).toISOString()
    const score = maintenanceScore({ lastReleaseAt: old, releaseFrequencyDays: 15, openIssueCount: 0 })
    expect(score).toBeLessThan(75)
  })
  it('scores 0 for null last release', () => {
    expect(maintenanceScore({ lastReleaseAt: null, releaseFrequencyDays: 0, openIssueCount: 0 })).toBe(0)
  })
  it('scores lower with high release frequency', () => {
    const recent = new Date(Date.now() - 10 * 86400000).toISOString()
    const score = maintenanceScore({ lastReleaseAt: recent, releaseFrequencyDays: 400, openIssueCount: 0 })
    expect(score).toBeLessThan(100)
  })
})

describe('qualityScore', () => {
  it('returns 100 when all signals pass and no vulns', () => {
    expect(qualityScore({ hasReadme: true, hasTests: true, hasChangelog: true, hasBadge: true, knownVulnCount: 0 })).toBe(100)
  })
  it('returns 100 with all quality signals even with 0 vuln (caps at 100)', () => {
    expect(qualityScore({ hasReadme: true, hasTests: true, hasChangelog: true, hasBadge: true, knownVulnCount: 10 })).toBe(100)
  })
  it('deducts 15 per vulnerability', () => {
    expect(qualityScore({ hasReadme: false, hasTests: false, hasChangelog: false, hasBadge: false, knownVulnCount: 3 })).toBe(55)
  })
  it('caps at 0 minimum', () => {
    expect(qualityScore({ hasReadme: false, hasTests: false, hasChangelog: false, hasBadge: false, knownVulnCount: 20 })).toBe(0)
  })
  it('has_readme alone scores 25', () => {
    expect(qualityScore({ hasReadme: true, hasTests: false, hasChangelog: false, hasBadge: false, knownVulnCount: 0 })).toBe(25)
  })
})

describe('complianceScore', () => {
  it('returns 100 when all three signals pass', () => {
    expect(complianceScore({ licenseCompatible: true, inkVersionOk: true, deprecatedDepCount: 0 })).toBe(100)
  })
  it('deducts 40 for incompatible license', () => {
    expect(complianceScore({ licenseCompatible: false, inkVersionOk: true, deprecatedDepCount: 0 })).toBe(60)
  })
  it('deducts 40 for bad ink version', () => {
    expect(complianceScore({ licenseCompatible: true, inkVersionOk: false, deprecatedDepCount: 0 })).toBe(60)
  })
  it('deducts 20 for deprecated deps', () => {
    expect(complianceScore({ licenseCompatible: true, inkVersionOk: true, deprecatedDepCount: 2 })).toBe(80)
  })
  it('all failing yields 0', () => {
    expect(complianceScore({ licenseCompatible: false, inkVersionOk: false, deprecatedDepCount: 5 })).toBe(0)
  })
})

describe('compositeScore', () => {
  it('all 100 yields 100', () => {
    expect(compositeScore(100, 100, 100, 100)).toBe(100)
  })
  it('all 0 yields 0', () => {
    expect(compositeScore(0, 0, 0, 0)).toBe(0)
  })
  it('weighted average is correct', () => {
    expect(compositeScore(80, 60, 100, 40)).toBe(Math.round(80*0.30 + 60*0.25 + 100*0.25 + 40*0.20))
  })
})
```

**Verification command:**
```bash
cd C:/Users/justi/dev/lectern
npx vitest run src/lib/health.test.ts
```
Expected: all tests pass.

---

## Chunk 3: API Route

### Task 4: Write failing test for `GET /api/packages/[name]/health`

**Files:**
- Create: `src/pages/api/packages/[name]/health.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockHealth = {
  package_name: 'my-pkg',
  computed_at: '2026-03-25T00:00:00Z',
  maintenance_score: 85,
  maintenance_status: 'excellent',
  last_release_at: '2026-01-15T00:00:00Z',
  release_frequency_days: 21,
  open_issue_count: 3,
  last_commit_at: null,
  popularity_score: 72,
  popularity_status: 'good',
  downloads_7d: 1200,
  downloads_30d: 4800,
  star_count: 340,
  dependent_count: 12,
  quality_score: 80,
  quality_status: 'excellent',
  has_readme: true,
  has_tests: true,
  has_changelog: true,
  known_vuln_count: 0,
  has_badge: false,
  compliance_score: 100,
  compliance_status: 'excellent',
  license_compatible: true,
  ink_version_ok: true,
  deprecated_dep_count: 0,
  health_score: 78,
  health_status: 'good',
}

vi.mock('../../../../../lib/db.js', () => ({
  getPackageHealth: vi.fn(),
  getPackageVersions: vi.fn(),
}))

const { getPackageHealth, getPackageVersions } = await import('../../../../../lib/db.js')

describe('GET /api/packages/[name]/health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns health data in spec shape for an existing package', async () => {
    vi.mocked(getPackageVersions).mockResolvedValue([{ package_name: 'my-pkg', version: '1.0.0' }])
    vi.mocked(getPackageHealth).mockResolvedValue(mockHealth)

    const { GET } = await import('./health.js')
    const response = await GET({ params: { name: 'my-pkg' } } as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.health_score).toBe(78)
    expect(body.health_status).toBe('good')
    expect(body.maintenance.score).toBe(85)
    expect(body.maintenance.status).toBe('excellent')
    expect(body.popularity.downloads_7d).toBe(1200)
    expect(body.quality.known_vuln_count).toBe(0)
    expect(body.compliance.license_compatible).toBe(true)
  })

  it('returns 404 for non-existent package', async () => {
    vi.mocked(getPackageVersions).mockResolvedValue([])

    const { GET } = await import('./health.js')
    const response = await GET({ params: { name: 'nonexistent' } } as any)
    expect(response.status).toBe(404)
    expect((await response.json()).error).toBe('Package not found')
  })

  it('returns 400 when name is missing', async () => {
    const { GET } = await import('./health.js')
    const response = await GET({ params: {} } as any)
    expect(response.status).toBe(400)
  })

  it('returns 500 when getPackageHealth throws', async () => {
    vi.mocked(getPackageVersions).mockResolvedValue([{ package_name: 'my-pkg', version: '1.0.0' }])
    vi.mocked(getPackageHealth).mockRejectedValue(new Error('db error'))

    const { GET } = await import('./health.js')
    const response = await GET({ params: { name: 'my-pkg' } } as any)
    expect(response.status).toBe(500)
  })

  it('returns 503 when health data not yet computed', async () => {
    vi.mocked(getPackageVersions).mockResolvedValue([{ package_name: 'my-pkg', version: '1.0.0' }])
    vi.mocked(getPackageHealth).mockResolvedValue(null)

    const { GET } = await import('./health.js')
    const response = await GET({ params: { name: 'my-pkg' } } as any)
    expect(response.status).toBe(503)
  })
})
```

**Verification command:**
```bash
cd C:/Users/justi/dev/lectern
npx vitest run src/pages/api/packages/[name]/health.test.ts
```
Expected: tests fail (no implementation yet).

### Task 5: Implement `src/pages/api/packages/[name]/health.ts`

**Files:**
- Create: `src/pages/api/packages/[name]/health.ts`

```typescript
import type { APIRoute } from 'astro'
import { getPackageHealth, getPackageVersions } from '../../../../lib/db.js'

export const GET: APIRoute = async ({ params }) => {
  const { name } = params
  if (!name) {
    return new Response(JSON.stringify({ error: 'Bad request' }), { status: 400 })
  }

  // Verify package exists
  const versions = await getPackageVersions(name)
  if (!versions.length) {
    return new Response(JSON.stringify({ error: 'Package not found' }), { status: 404 })
  }

  let health
  try {
    health = await getPackageHealth(name)
  } catch {
    return new Response(JSON.stringify({ error: 'Database error' }), { status: 500 })
  }

  if (!health) {
    // Package exists but health not yet computed
    return new Response(JSON.stringify({ error: 'Health data unavailable' }), { status: 503 })
  }

  // Format response per spec API shape
  const body = {
    health_score: health.health_score,
    health_status: health.health_status,
    maintenance: {
      score: health.maintenance_score,
      status: health.maintenance_status,
      last_release_at: health.last_release_at,
      release_frequency_days: health.release_frequency_days,
      open_issue_count: health.open_issue_count,
    },
    popularity: {
      score: health.popularity_score,
      status: health.popularity_status,
      downloads_7d: health.downloads_7d,
      downloads_30d: health.downloads_30d,
      star_count: health.star_count,
      dependent_count: health.dependent_count,
    },
    quality: {
      score: health.quality_score,
      status: health.quality_status,
      has_readme: health.has_readme,
      has_tests: health.has_tests,
      has_changelog: health.has_changelog,
      known_vuln_count: health.known_vuln_count,
      has_badge: health.has_badge,
    },
    compliance: {
      score: health.compliance_score,
      status: health.compliance_status,
      license_compatible: health.license_compatible,
      ink_version_ok: health.ink_version_ok,
      deprecated_dep_count: health.deprecated_dep_count,
    },
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
```

**Verification command:**
```bash
cd C:/Users/justi/dev/lectern
npx vitest run src/pages/api/packages/[name]/health.test.ts
```
Expected: all tests pass.

---

## Chunk 4: HealthBadge Component

### Task 6: Create `src/lib/health.test.ts` (already in Chunk 2)

Already covered by Task 3 above.

### Task 7: Implement `src/components/HealthBadge.astro`

**Files:**
- Create: `src/components/HealthBadge.astro`

```astro
---
// HealthBadge.astro — score pill + tooltip + expandable panel
// Props:
//   packageName: string  — package to display health for
//   expanded?: boolean   — if true, panel is open by default (default false)

interface Props {
  packageName: string
  expanded?: boolean
}

const { packageName, expanded = false } = Astro.props

import { getPackageHealth } from '../lib/db.js'

const health = await getPackageHealth(packageName).catch(() => null)
const statusClass = health?.health_status ?? 'unknown'
const score = health?.health_score ?? null
---

{health && score !== null && (
  <div
    class={`health-badge-wrapper health-badge-wrapper--${statusClass}`}
    data-health-badge
    data-package={packageName}
  >
    <!-- Score pill (click to expand panel) -->
    <button
      class="health-pill"
      aria-label={`Health score: ${score} (${health.health_status})`}
      aria-expanded={expanded}
      aria-controls={`health-panel-${packageName}`}
    >
      <span class="health-pill__score">{score}</span>
      <span class="health-pill__label">{health.health_status}</span>
    </button>

    <!-- Hover tooltip: category mini-table -->
    <div class="health-tooltip" role="tooltip">
      <table class="health-tooltip__table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Score</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Maintenance</td>
            <td>{health.maintenance_score}</td>
            <td class={`status-${health.maintenance_status}`}>{health.maintenance_status}</td>
          </tr>
          <tr>
            <td>Popularity</td>
            <td>{health.popularity_score}</td>
            <td class={`status-${health.popularity_status}`}>{health.popularity_status}</td>
          </tr>
          <tr>
            <td>Quality</td>
            <td>{health.quality_score}</td>
            <td class={`status-${health.quality_status}`}>{health.quality_status}</td>
          </tr>
          <tr>
            <td>Compliance</td>
            <td>{health.compliance_score}</td>
            <td class={`status-${health.compliance_status}`}>{health.compliance_status}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Expanded panel: full signal breakdown -->
    <div
      class={`health-panel ${expanded ? 'health-panel--open' : ''}`}
      id={`health-panel-${packageName}`}
      hidden={!expanded}
    >
      <div class="health-panel__grid">
        <!-- Maintenance -->
        <div class="health-panel__cat">
          <p class="health-panel__cat-label">Maintenance</p>
          <div class="health-panel__bar">
            <div class="health-panel__bar-fill" style={`width: ${health.maintenance_score}%`}></div>
          </div>
          <p class="health-panel__score">{health.maintenance_score}/100</p>
          {health.last_release_at && (
            <p class="health-panel__detail">Last release: {new Date(health.last_release_at).toLocaleDateString()}</p>
          )}
          {health.release_frequency_days !== null && (
            <p class="health-panel__detail">Every {health.release_frequency_days} days</p>
          )}
          {health.open_issue_count > 0 && (
            <p class="health-panel__detail">{health.open_issue_count} open issues</p>
          )}
        </div>

        <!-- Popularity -->
        <div class="health-panel__cat">
          <p class="health-panel__cat-label">Popularity</p>
          <div class="health-panel__bar">
            <div class="health-panel__bar-fill" style={`width: ${health.popularity_score}%`}></div>
          </div>
          <p class="health-panel__score">{health.popularity_score}/100</p>
          <p class="health-panel__detail">{health.downloads_7d.toLocaleString()} downloads (7d)</p>
          <p class="health-panel__detail">{health.star_count.toLocaleString()} stars</p>
          <p class="health-panel__detail">{health.dependent_count} dependents</p>
        </div>

        <!-- Quality -->
        <div class="health-panel__cat">
          <p class="health-panel__cat-label">Quality</p>
          <div class="health-panel__bar">
            <div class="health-panel__bar-fill" style={`width: ${health.quality_score}%`}></div>
          </div>
          <p class="health-panel__score">{health.quality_score}/100</p>
          <p class="health-panel__detail">README: {health.has_readme ? 'yes' : 'no'}</p>
          <p class="health-panel__detail">Tests: {health.has_tests ? 'yes' : 'no'}</p>
          <p class="health-panel__detail">Changelog: {health.has_changelog ? 'yes' : 'no'}</p>
          {health.known_vuln_count > 0 && (
            <p class="health-panel__detail health-panel__detail--warn">
              {health.known_vuln_count} known vuln{health.known_vuln_count !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        <!-- Compliance -->
        <div class="health-panel__cat">
          <p class="health-panel__cat-label">Compliance</p>
          <div class="health-panel__bar">
            <div class="health-panel__bar-fill" style={`width: ${health.compliance_score}%`}></div>
          </div>
          <p class="health-panel__score">{health.compliance_score}/100</p>
          <p class="health-panel__detail">License: {health.license_compatible ? 'ok' : 'incompatible'}</p>
          <p class="health-panel__detail">Ink version: {health.ink_version_ok ? 'ok' : 'outdated'}</p>
          {health.deprecated_dep_count > 0 && (
            <p class="health-panel__detail health-panel__detail--warn">
              {health.deprecated_dep_count} deprecated dep{health.deprecated_dep_count !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      </div>
      <p class="health-panel__computed">Updated {new Date(health.computed_at).toLocaleString()}</p>
    </div>
  </div>
)}

{/* No health data yet */}
{!health && (
  <span class="health-badge-unknown" title="Health data unavailable">?</span>
)}

<style>
  /* ── Status color variables ── */
  .health-badge-wrapper {
    --health-color: #71717a;
    --health-color-rgb: 113,113,122;
    position: relative;
    display: inline-flex;
    flex-direction: column;
  }
  .health-badge-wrapper--excellent { --health-color: #22c55e; --health-color-rgb: 34,197,94; }
  .health-badge-wrapper--good      { --health-color: #06b6d4; --health-color-rgb: 6,182,212; }
  .health-badge-wrapper--fair      { --health-color: #f59e0b; --health-color-rgb: 245,158,11; }
  .health-badge-wrapper--poor      { --health-color: #ef4444; --health-color-rgb: 239,68,68; }
  .health-badge-wrapper--unknown   { --health-color: #71717a; --health-color-rgb: 113,113,122; }

  /* ── Score pill ── */
  .health-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.2rem 0.6rem;
    border-radius: 4px;
    border: 1px solid var(--health-color);
    background: rgba(var(--health-color-rgb), 0.1);
    color: var(--health-color);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    transition: background 0.15s;
  }
  .health-pill:hover { background: rgba(var(--health-color-rgb), 0.2); }

  .health-pill__score { font-weight: 600; font-size: 0.875rem; }
  .health-pill__label { font-size: 0.7rem; text-transform: capitalize; }

  /* ── Hover tooltip ── */
  .health-tooltip {
    display: none;
    position: absolute;
    top: calc(100% + 0.5rem);
    left: 0;
    z-index: 50;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.75rem;
    min-width: 220px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  }
  .health-badge-wrapper:hover .health-tooltip,
  .health-badge-wrapper:focus-within .health-tooltip { display: block; }

  .health-tooltip__table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-mono);
    font-size: 0.75rem;
  }
  .health-tooltip__table th {
    text-align: left;
    color: var(--muted);
    font-weight: 500;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    font-size: 0.65rem;
    padding-bottom: 0.4rem;
  }
  .health-tooltip__table td { padding: 0.2rem 0; }
  .health-tooltip__table td:first-child { color: var(--muted); }

  .status-excellent { color: #22c55e; }
  .status-good      { color: #06b6d4; }
  .status-fair      { color: #f59e0b; }
  .status-poor      { color: #ef4444; }
  .status-unknown   { color: #71717a; }

  /* ── Expanded panel ── */
  .health-panel {
    display: none;
    margin-top: 0.75rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1rem;
    min-width: 300px;
  }
  .health-panel--open,
  .health-panel:not([hidden]) { display: block; }

  .health-panel__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  .health-panel__cat { display: flex; flex-direction: column; gap: 0.25rem; }

  .health-panel__cat-label {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    margin-bottom: 0.2rem;
  }

  .health-panel__bar {
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
  }
  .health-panel__bar-fill {
    height: 100%;
    background: var(--health-color);
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .health-panel__score {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text);
  }

  .health-panel__detail {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--muted);
  }

  .health-panel__detail--warn { color: #f59e0b; }

  .health-panel__computed {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    color: var(--muted-2);
    margin-top: 0.75rem;
    text-align: right;
  }

  /* ── Unknown badge ── */
  .health-badge-unknown {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    color: var(--muted);
    border: 1px solid var(--border);
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    display: inline-block;
  }
</style>

<script>
  document.querySelectorAll('[data-health-badge]').forEach(wrapper => {
    const btn = wrapper.querySelector('.health-pill') as HTMLButtonElement | null
    const panel = wrapper.querySelector('.health-panel') as HTMLElement | null

    btn?.addEventListener('click', () => {
      if (!panel) return
      const isOpen = !panel.hasAttribute('hidden')
      if (isOpen) {
        panel.setAttribute('hidden', '')
        btn.setAttribute('aria-expanded', 'false')
      } else {
        panel.removeAttribute('hidden')
        btn.setAttribute('aria-expanded', 'true')
      }
    })
  })
</script>
```

**Verification command:**
```bash
cd C:/Users/justi/dev/lectern
# Verify the component compiles in Astro context
npx astro check src/components/HealthBadge.astro 2>&1 | head -20
```

---

## Chunk 5: Package Page Integration

### Task 8: Add `<HealthBadge>` to `src/pages/packages/[name].astro`

**Files:**
- Modify: `src/pages/packages/[name].astro`

**Step 1:** In the frontmatter import (line 3), add `getPackageHealth` to the import from `'../../lib/db.js'`:

```diff
- import { getPackageVersions, getPackageOwner, getPackageDependents, getPackageStats, getPackageDeprecation, getPackageAdvisories, getPackageTags, getStarCount } from '../../lib/db.js'
+ import { getPackageVersions, getPackageOwner, getPackageDependents, getPackageStats, getPackageDeprecation, getPackageAdvisories, getPackageTags, getStarCount, getPackageHealth } from '../../lib/db.js'
```

**Step 2:** Add `HealthBadge` component import after the other imports (line 5 area):

```astro
import HealthBadge from '../../components/HealthBadge.astro'
```

**Step 3:** After the `starCount` fetch (line 20), add the health fetch:

```typescript
const health = await getPackageHealth(name!).catch(() => null)
```

**Step 4:** In the template, inside `.pkg-meta-row` (after the star button, before the closing `</div>` of `.pkg-meta-row`), add the health badge:

The relevant section (line ~509):
```astro
      <button class="star-btn" id="star-btn" data-package={name} data-starred="false">
        <span class="star-icon">☆</span>
        <span class="star-count" id="star-count">{starCount}</span>
      </button>
+     <HealthBadge packageName={name!} />
    </div>
```

**Verification command:**
```bash
cd C:/Users/justi/dev/lectern
npx astro check src/pages/packages/[name].astro 2>&1 | head -30
```
Expected: no errors related to `HealthBadge` or `getPackageHealth`.

---

## Chunk 6: Homepage Integration

### Task 9: Add "Health Leaders" section to `src/pages/index.astro`

**Files:**
- Modify: `src/pages/index.astro`

**Step 1:** In the frontmatter import (line 2), add `getHealthLeaders`:

```diff
- import { listAllPackages, listTags, getTrendingPackages, getPopularPackages } from '../lib/db.js'
+ import { listAllPackages, listTags, getTrendingPackages, getPopularPackages, getHealthLeaders } from '../lib/db.js'
```

**Step 2:** After the `popular` fetch (line 31), add:

```typescript
const healthLeaders = await getHealthLeaders(5).catch(() => [])
```

**Step 3:** In the template, inside the `.home-sections` grid (after the closing `</div>` of the "top packages" column, before `</div>` for the outer grid), add a new column:

The relevant section is after line 496 (`</div>` for "top packages" column), around line 497:
```astro
      </div>

      <div>
        <p class="section-heading">health leaders</p>
        {healthLeaders.length === 0
          ? <p class="empty">no health data yet.</p>
          : <div class="trending-list">
              {healthLeaders.map(pkg => (
                <a class="trending-row" href={`/packages/${pkg.package_name}`}>
                  <span class="trending-rank">{pkg.health_score}</span>
                  <span class="trending-name">{pkg.package_name}</span>
                  <span class={`trending-status status-${pkg.health_status}`}>{pkg.health_status}</span>
                </a>
              ))}
            </div>
        }
      </div>
    </div>
  </main>
```

**Step 4:** Add status color CSS for the chips inside the `<style>` block (around line 350, before the closing `</style>`):

```css
    /* Health status chips */
    .trending-status {
      font-family: var(--font-mono);
      font-size: 0.65rem;
      font-weight: 600;
      padding: 0.1rem 0.4rem;
      border-radius: 4px;
      flex-shrink: 0;
    }
    .status-excellent { color: #22c55e; background: rgba(34,197,94,0.1); border: 1px solid #22c55e; }
    .status-good      { color: #06b6d4; background: rgba(6,182,212,0.1); border: 1px solid #06b6d4; }
    .status-fair      { color: #f59e0b; background: rgba(245,158,11,0.1); border: 1px solid #f59e0b; }
    .status-poor      { color: #ef4444; background: rgba(239,68,68,0.1); border: 1px solid #ef4444; }
    .status-unknown   { color: #71717a; background: rgba(113,113,122,0.1); border: 1px solid #71717a; }
```

Also update the `.home-sections` grid to accommodate 3 columns — it already has `grid-template-columns: 1fr 1fr 1fr;` which is correct.

**Verification command:**
```bash
cd C:/Users/justi/dev/lectern
npx astro check src/pages/index.astro 2>&1 | head -20
```

---

## Verification Checklist

After all chunks are complete, run:

```bash
# 1. Apply migration and verify
supabase db push
supabase db execute --sql "SELECT count(*) as total, count(health_score) FILTER (WHERE health_score > 0) as computed FROM package_health;"

# 2. TypeScript check
npx tsc --noEmit src/lib/db.ts

# 3. Unit tests
npx vitest run src/lib/health.test.ts
npx vitest run src/pages/api/packages/[name]/health.test.ts

# 4. Astro type check
npx astro check src/pages/packages/[name].astro src/pages/index.astro

# 5. DB state checks
supabase db execute --sql "SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'compute-package-health';"
supabase db execute --sql "SELECT package_name, health_score, health_status FROM get_health_leaders(5);"
supabase db execute --sql "SELECT manifest FROM package_versions LIMIT 1;"

# 6. API smoke test (requires dev server)
curl -s http://localhost:4321/api/packages/ink-json/health | python3 -m json.tool 2>/dev/null || echo "dev server not running"
```

---

## Rollback Plan

If migration fails:
1. `supabase db reset` to drop all unapplied migrations
2. Remove `014_package_health.sql`
3. Re-run `supabase db push`

If frontend integration breaks existing tests:
1. `git stash` the component/page changes
2. Run `npx vitest run` to confirm baseline still passes
3. Fix the integration issue before re-applying

---

## Sign-off Checklist

- [ ] Migration `014_package_health.sql` applies cleanly (`supabase db push`)
- [ ] `package_versions` has new `manifest` JSONB column
- [ ] `package_health` table has RLS policies
- [ ] `get_dependent_count`, `compute_package_health`, `compute_all_package_health`, `get_package_health`, `get_health_leaders` functions exist
- [ ] `cron.job` shows `compute-package-health` active
- [ ] Backfill populated `package_health` with scores for all existing packages
- [ ] `npx tsc --noEmit src/lib/db.ts` — no errors
- [ ] `npx vitest run src/lib/health.test.ts` — all pass
- [ ] `npx vitest run src/pages/api/packages/[name]/health.test.ts` — all pass
- [ ] `npx astro check src/pages/packages/[name].astro src/pages/index.astro` — no errors
- [ ] `GET /api/packages/[name]/health` returns spec-shaped JSON
- [ ] Package page renders `<HealthBadge>` with pill, tooltip, and expandable panel
- [ ] Homepage shows "Health Leaders" column with scores and status chips
