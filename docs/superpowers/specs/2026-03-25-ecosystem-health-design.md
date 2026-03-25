# Ecosystem Health — Design Spec

## Overview

Ecosystem health is a composite 0–100 score plus per-category status labels (excellent/good/fair/poor) for each package. It serves two audiences: consumers who want to assess package quality at a glance, and maintainers who want visibility into their package's standing.

**Phase 1 scope**: schema, badge on package page, health panel on homepage. No maintainer dashboard.

---

## Signal Categories

Each package gets a health record computed from four categories:

| Category | Weight | Examples |
|---|---|---|
| Maintenance | 30% | Days since last release, release frequency, open issues |
| Popularity | 25% | Download velocity, star count, dependent count |
| Quality | 25% | Has README, has tests, has changelog, known vulnerabilities |
| Compliance | 20% | License compatibility, Ink version compatibility, deprecated deps |

Each category maps to a status: `excellent` / `good` / `fair` / `poor` / `unknown`.

The composite 0–100 score is the weighted sum of normalized category scores.

---

## Schema

### `package_health` table

```sql
create table package_health (
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
  downloads_7d          bigint not null default 0,
  downloads_30d         bigint not null default 0,
  star_count             int not null default 0,
  dependent_count        int not null default 0,

  -- Quality (0–100)
  quality_score          int not null default 0,
  quality_status         text not null default 'unknown',
  has_readme            boolean not null default false,
  has_tests             boolean not null default false,
  has_changelog         boolean not null default false,
  known_vuln_count      int not null default 0,
  has_badge             boolean not null default false,

  -- Compliance (0–100)
  compliance_score       int not null default 0,
  compliance_status      text not null default 'unknown',
  license_compatible    boolean not null default false,
  ink_version_ok         boolean not null default false,
  deprecated_dep_count   int not null default 0,

  -- Composite (materialized)
  health_score           int not null default 0,
  health_status          text not null default 'unknown'
);
```

RLS: public read, service role upsert.

```sql
alter table package_health enable row level security;

create policy "public read package_health"
  on package_health for select using (true);

create policy "service upsert package_health"
  on package_health for upsert using (auth.role() = 'service_role');
```

---

## Scoring Logic

### Category score → status mapping

| Score range | Status |
|---|---|
| 80–100 | excellent |
| 60–79 | good |
| 40–59 | fair |
| 20–39 | poor |
| 0–19 | unknown |

### Maintenance score (0–100)

| Signal | Logic |
|---|---|
| Last release | <30d = 100, <90d = 75, <180d = 50, <365d = 25, >365d = 0 |
| Release frequency | Median days between releases; <30d = 100, <90d = 75, <180d = 50, <365d = 25, >365d = 0 |
| Open issues | Inverse: 0 = 100, <10 = 80, <25 = 60, <50 = 40, >=50 = 0 |

Weighted: last_release 50%, release_frequency 25%, open_issues 25%.

### Popularity score (0–100)

All signals normalized against the ecosystem maximum observed at computation time.

| Signal | Weight |
|---|---|
| 7-day download velocity | 40% |
| 30-day download velocity | 25% |
| Star count | 20% |
| Dependent count | 15% |

Formula: `(signal_value / ecosystem_max) * 100`, then weighted sum.

### Quality score (0–100)

| Signal | Points |
|---|---|
| has_readme | 25 |
| has_tests | 25 |
| has_changelog | 20 |
| has_badge | 10 |
| known_vuln_count | max(0, 100 - vuln_count * 15) — each known vuln deducts 15, min 0 |

Total capped at 100.

### Compliance score (0–100)

| Signal | Points |
|---|---|
| license_compatible | 40 |
| ink_version_ok | 40 |
| deprecated_dep_count == 0 | 20 |

### Composite score

```
health_score = round(maintenance_score * 0.30
                   + popularity_score * 0.25
                   + quality_score * 0.25
                   + compliance_score * 0.20)
```

`health_status` derived from `health_score` using the status mapping table above.

---

## Computation

### Nightly cron job

A `pg_cron` job runs at 3am daily to recompute all health records:

```sql
select cron.schedule(
  'compute-package-health',
  '0 3 * * *',
  $$
  select compute_all_package_health();
  $$
);
```

### `compute_all_package_health()`

Iterates all packages and calls `compute_package_health(name)` for each.

For large ecosystems, process in batches of 100 packages ordered by name to avoid long-running transactions.

### `compute_package_health(pkg_name text)`

Upserts a row into `package_health` for the given package. Called by:

1. The nightly cron job (full recompute)
2. A database trigger on `package_versions` after insert/update (incremental — whenever a version is published)
3. A database trigger on `package_stars` after insert/delete (incremental — popularity signals change)
4. A database trigger on `advisories` after insert (incremental — compliance/quality signals change)

### Data sources

| Signal | Source |
|---|---|
| last_release_at, release_frequency_days | `package_versions` (latest `published_at`, median gap between all `published_at`s) |
| open_issue_count | GitHub API via package's `issues_url` or 0 if not set |
| downloads_7d, downloads_30d | `get_package_stats()` RPC (existing) |
| star_count | `get_star_count()` (existing) |
| dependent_count | New: `get_dependent_count()` — counts packages whose `dependencies` JSONB array contains this package |
| has_readme, has_tests, has_changelog | Package manifest (ink.toml) fields scanned on publish |
| known_vuln_count | `advisories` table count where `package_name = pkg` and `severity != 'info'` |
| license_compatible | Package manifest `license` field checked against allowlist |
| ink_version_ok | Package manifest `ink_version` compared against supported versions |
| deprecated_dep_count | `dependencies` JSONB array intersected with deprecated packages set |
| has_badge | True if package has a badge embedded (badge API endpoint called successfully) |

### New functions

```sql
-- Returns number of packages that list this package as a direct dependency
create or replace function get_dependent_count(pkg_name text)
returns int
language sql
stable
as $$
  select count(*)
  from packages
  where dependencies::text like '%' || pkg_name || '%';
$$;

-- Upserts health record for one package
create or replace function compute_package_health(pkg_name text)
returns void
language plpgsql
as $$
  -- fetch all signals, compute scores, upsert package_health
$$;

-- Upserts health records for all packages (nightly job)
create or replace function compute_all_package_health()
returns void
language plpgsql
as $$
  -- iterate all packages, call compute_package_health for each
$$;

-- Public RPC to read health
create or replace function get_package_health(pkg_name text)
returns package_health
language sql
stable
security definer
as $$
  select * from package_health where package_name = pkg_name;
$$;
```

---

## API

### `GET /api/packages/[name]/health`

Returns the full `package_health` record for one package.

```json
{
  "health_score": 78,
  "health_status": "good",
  "maintenance": {
    "score": 85,
    "status": "excellent",
    "last_release_at": "2026-01-15T00:00:00Z",
    "release_frequency_days": 21,
    "open_issue_count": 3
  },
  "popularity": {
    "score": 72,
    "status": "good",
    "downloads_7d": 1200,
    "downloads_30d": 4800,
    "star_count": 340,
    "dependent_count": 12
  },
  "quality": {
    "score": 80,
    "status": "excellent",
    "has_readme": true,
    "has_tests": true,
    "has_changelog": true,
    "known_vuln_count": 0,
    "has_badge": true
  },
  "compliance": {
    "score": 100,
    "status": "excellent",
    "license_compatible": true,
    "ink_version_ok": true,
    "deprecated_dep_count": 0
  }
}
```

### `GET /api/health` (optional, not in Phase 1)

Paginated list of packages sorted/filtered by health signals. Not needed for Phase 1 — homepage and package page are sufficient.

---

## UI — Package Page Badge

A health badge displayed next to the package name:

- **Score pill**: `78` with background color by status:
  - excellent: green
  - good: teal/blue
  - fair: yellow/amber
  - poor: red
  - unknown: gray

- **Hover tooltip**: shows category breakdown as a mini table (maintenance/popularity/quality/compliance each as a row with score and status).

- **Click**: expands into a full health panel inline on the page, showing all signals with explanations.

Implementation: a `<HealthBadge>` Astro component that calls `get_package_health` and renders the badge. Uses `auth.getUser()` only to optionally show a "you starred this" state — health data itself is public.

---

## UI — Homepage Health Panel

On the homepage (`/`), below the existing "Recently Published" and "Trending This Week" sections, add a new section **"Health Leaders"** showing the top 5 packages by `health_score` where `health_status = 'excellent'`. Each entry shows the package name, health score pill, and a one-line description of the top category strength (e.g., "Highly maintained" or "Fastest growing").

Fetched via a new `get_health_leaders(limit int)` RPC:

```sql
create or replace function get_health_leaders(limit_count int default 5)
returns table (
  package_name    text,
  health_score    int,
  health_status   text,
  description     text,
  latest_version  text
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
  where ph.health_status = 'excellent'
  order by ph.health_score desc
  limit limit_count;
$$;
```

---

## Migration

New migration file: `supabase/migrations/014_package_health.sql`

- Creates `package_health` table with RLS
- Creates `get_dependent_count`, `compute_package_health`, `compute_all_package_health`, `get_package_health`, `get_health_leaders` functions
- Schedules `pg_cron` job
- Calls `compute_all_package_health()` to backfill all existing packages

---

## Phase 1 Checklist

- [ ] Migration `014_package_health.sql`
- [ ] `get_dependent_count()` function
- [ ] `compute_package_health()` function
- [ ] `compute_all_package_health()` function
- [ ] `get_package_health()` RPC
- [ ] `get_health_leaders()` RPC
- [ ] Cron job scheduled
- [ ] Backfill computed on migration
- [ ] `GET /api/packages/[name]/health` API route
- [ ] `<HealthBadge>` Astro component
- [ ] Health badge on package page (`src/pages/packages/[name].astro`)
- [ ] "Health Leaders" panel on homepage (`src/pages/index.astro`)

---

## Future Phases (out of scope)

- **Phase 2**: Maintainer dashboard tab (`/[org]/settings/packages/[name]/health`) with historical chart and improvement suggestions
- **Phase 3**: `ink_version_ok` signal (requires ink.toml parsing), reverse-dependency graph health
- **Phase 4**: Health score drop alerts and notification hooks
- **Phase 5**: Filter/sort by health on `/explore` page
