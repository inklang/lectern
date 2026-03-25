# Design: Package Popularity Score

**Date:** 2026-03-25

## Overview

Introduce a **popularity score** — a composite metric that combines download volume, star count, and publication recency — to rank packages on the `/packages` browse page instead of the current chronological sort. The score also powers a "Top packages" section on the homepage.

---

## 1. Signals & Formula

### Signals

| Signal | Source | Description |
|--------|--------|-------------|
| Downloads (all-time) | `package_versions.download_count` | Total accumulated downloads across all versions |
| Downloads (recent) | `download_logs` | Downloads in the last 30 days |
| Stars | `package_stars.star_count` (new table) | User-supplied star votes |
| Recency | `packages.created_at` | How recently a package was first published |

### Formula

```
score = (download_weight * normalized_downloads)
      + (star_weight * normalized_stars)
      + (recency_weight * recency_decay)
```

Where:

- **`normalized_downloads`** = log10(1 + total_downloads) / log10(1 + max_downloads_seen)
  - Log scaling prevents top packages from dominating indefinitely
  - Capped at 1.0

- **`normalized_stars`** = star_count / max_star_count_seen
  - Also capped at 1.0

- **`recency_decay`** = e^(-lambda * days_since_created)
  - `lambda` = 0.02 (half-life ~35 days)
  - Packages published in the last week get a ~15% recency boost
  - Boost fades to <5% after 90 days

### Default weights

```typescript
const WEIGHTS = {
  downloads: 0.60,   // dominant signal
  stars:     0.30,   // meaningful but secondary
  recency:   0.10,   // small recency nudge
}
```

Weights are constants in the RPC; they can be tuned without schema changes.

---

## 2. Storage Strategy: Computed-on-Query vs. Materialized

### Decision: **Computed on query**

Rationale:
- Scores change on every download and star event — materializing would require frequent updates
- The RPC approach already used by `getTrendingPackages` is well-established in this codebase
- Supabase/Postgres is fast enough for this computation at query time with proper indexes
- No stale-score problem

### Trade-offs acknowledged:
- Slightly higher query latency vs. reading a pre-computed column
- Not suitable if the browse page needs to sort thousands of packages per request without caching
- Mitigation: add a Redis/in-memory cache layer in the future if p95 latency becomes a problem

---

## 3. Database Changes

### New table: `package_stars`

```sql
create table package_stars (
  package_name text primary key references packages(name) on delete cascade,
  star_count   bigint not null default 0,
  updated_at   timestamptz default now()
);
```

- One row per package (denormalized count). Star mutations use `INSERT ... ON CONFLICT DO UPDATE` to atomically increment/decrement `star_count`.
- RLS: anyone can read; authenticated users can star/unstar.

```sql
alter table package_stars enable row level security;

create policy "public read package_stars" on package_stars for select using (true);

create policy "authenticated star" on package_stars
  for insert with check (auth.uid() is not null);

create policy "authenticated unstar" on package_stars
  for update using (auth.uid() is not null);
```

> **Note:** Star authentication (preventing vote fraud) is out of scope for this spec. A future phase can add a `package_star_votes` table to track who voted.

### Index for score sorting

```sql
-- Supports ORDER BY download_count DESC on package_versions
create index on package_versions (download_count desc);

-- Supports join with package_stars
create index on package_stars (star_count desc);
```

---

## 4. RPC Changes

### New RPC: `get_popular_packages`

```sql
create or replace function get_popular_packages(
  p_limit   int    default 20,
  p_offset   int    default 0,
  p_window_days int default 30  -- for recent-download portion of score
)
returns table (
  package_name    text,
  popularity_score numeric,  -- the composite score, useful for debugging
  download_count  bigint,
  star_count      bigint,
  latest_version  text,
  description     text,
  created_at      timestamptz
)
language plpgsql
stable
as $$
declare
  max_dl bigint;
  max_stars bigint;
begin
  -- Find global maxima for normalization (cached via stable volatility)
  select coalesce(max(download_count), 1) into max_dl
  from package_versions;

  select coalesce(max(star_count), 1) into max_stars
  from package_stars;

  return query
  select
    pv.package_name,
    (
      (0.60 * (log(greatest(1, pv.total_dl)) / log(greatest(2, max_dl))))
      + (0.30 * (greatest(0, ps.star_count::numeric) / greatest(1, max_stars)))
      + (0.10 * exp(-0.02 * extract(epoch from (now() - p.created_at)) / 86400))
    )::numeric(10, 6) as popularity_score,
    pv.total_dl,
    coalesce(ps.star_count, 0),
    pv.latest_version,
    pv.description,
    p.created_at
  from (
    select
      package_name,
      sum(download_count)::bigint as total_dl,
      max(version) filter (where (published_at, version) = (
        select published_at, version from package_versions pv2
        where pv2.package_name = pv.package_name
        order by published_at desc limit 1
      )) as latest_version,
      max(description) filter (where (published_at, version) = (
        select published_at, version from package_versions pv2
        where pv2.package_name = pv.package_name
        order by published_at desc limit 1
      )) as description
    from package_versions
    group by package_name
  ) pv
  join packages p on p.name = pv.package_name
  left join package_stars ps on ps.package_name = pv.package_name
  order by popularity_score desc
  limit p_limit
  offset p_offset;
end;
$$;
```

> **Optimization note:** The `latest_version` and `description` subquery in the FROM is repeated. A future version can extract this into a CTE `latest_versions` first, then join once.

### New RPC: `get_package_score`

```sql
create or replace function get_package_score(p_package_name text)
returns numeric(10, 6)
language plpgsql
stable
as $$
declare
  max_dl    bigint;
  max_stars bigint;
  dl        bigint;
  stars     bigint;
  created   timestamptz;
begin
  select coalesce(max(download_count), 1), max(created_at)
    into max_dl, created
  from package_versions pv
  join packages p on p.name = pv.package_name
  where pv.package_name = p_package_name
  group by pv.package_name;

  select coalesce(max(star_count), 1) into max_stars from package_stars where package_name = p_package_name;
  select coalesce(sum(download_count), 0) into dl from package_versions where package_name = p_package_name;
  select star_count into stars from package_stars where package_name = p_package_name;

  return (
    (0.60 * (log(greatest(1, dl)) / log(greatest(2, max_dl))))
    + (0.30 * (greatest(0, coalesce(stars, 0))::numeric / greatest(1, max_stars)))
    + (0.10 * exp(-0.02 * extract(epoch from (now() - created)) / 86400))
  )::numeric(10, 6);
end;
$$;
```

### Existing RPC: no changes required

`get_trending_packages` continues to exist and work as-is. It measures a different thing (download velocity in a time window) vs. popularity score (weighted composite with recency).

---

## 5. `db.ts` Changes

### New functions

```typescript
export interface PopularPackage {
  package_name: string
  popularity_score: number
  download_count: number
  star_count: number
  latest_version: string
  description: string | null
  created_at: string
}

// Get paginated popular packages (for browse page sort)
export async function getPopularPackages(
  limit = 20,
  offset = 0
): Promise<PopularPackage[]> {
  const { data, error } = await supabase.rpc('get_popular_packages', {
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw error
  return (data as PopularPackage[]) ?? []
}

// Get score for a single package
export async function getPackageScore(name: string): Promise<number> {
  const { data, error } = await supabase.rpc('get_package_score', {
    p_package_name: name,
  })
  if (error) throw error
  return (data as number) ?? 0
}

// Star/unstar (for future use)
export async function setPackageStar(
  packageName: string,
  starred: boolean
): Promise<void> {
  // Upsert: insert or update star_count atomically
  const { error } = await supabase.rpc('set_package_star', {
    p_package_name: packageName,
    p_starred: starred,
  })
  if (error) throw error
}
```

### New RPC for star mutation

```sql
create or replace function set_package_star(p_package_name text, p_starred boolean)
returns void
language plpgsql
security definer
as $$
begin
  if p_starred then
    insert into package_stars (package_name, star_count)
    values (p_package_name, 1)
    on conflict (package_name) do update set star_count = package_stars.star_count + 1;
  else
    update package_stars set star_count = greatest(0, star_count - 1)
    where package_name = p_package_name;
  end if;
end;
$$;
```

---

## 6. UI Changes

### Sort options on `/packages`

Add a `sort` query parameter to the browse page. Valid values:

| `sort=` value | Label | Behavior |
|---------------|-------|----------|
| `recent` (default) | Recently published | Current chronological sort |
| `popular` | Most popular | Sort by `get_popular_packages()` |
| `downloads` | Most downloads | Sort by total `download_count` desc |

URL shape: `/packages?sort=popular`

Update `src/pages/packages/index.astro`:

```typescript
// Before (line 8):
const page = Math.max(1, parseInt(Astro.url.searchParams.get('page') ?? '1'))

// Add:
const sort = Astro.url.searchParams.get('sort') ?? 'recent'
```

When `sort=popular`:
- Call `getPopularPackages(PAGE_SIZE, (page-1) * PAGE_SIZE)` instead of `listAllPackages()`
- Adjust the card to show star count alongside downloads

### New "Top packages" section on homepage

In `src/pages/index.astro`, add a third column alongside "recently published" and "trending this week":

```typescript
const popular = await getPopularPackages(5).catch(() => [])
```

Markup:

```html
<div class="home-section">
  <p class="section-heading">top packages</p>
  {popular.length === 0
    ? <p class="empty">no packages yet.</p>
    : <div class="popular-list">
        {popular.map((pkg, i) => (
          <a class="popular-row" href={`/packages/${pkg.package_name}`}>
            <span class="popular-rank">#{i + 1}</span>
            <span class="popular-name">{pkg.package_name}</span>
            <span class="popular-score">{pkg.popularity_score.toFixed(2)}</span>
          </a>
        ))}
      </div>
  }
</div>
```

CSS (reuse `.trending-row` / `.trending-rank` styles from existing homepage).

### Package detail page (`/packages/[name].astro`)

Show the popularity score and a "Star" button (future).

---

## 7. Performance Considerations

### Query cost

`get_popular_packages` does:
- A grouped aggregation on `package_versions` (one row per package — cheap)
- A join with `packages` (primary key — cheap)
- A left join with `package_stars` (indexed — cheap)
- A sort on `popularity_score` (in-memory, but limited to `LIMIT 20`)

Expected latency: <50ms for typical registry sizes (<10k packages).

### Indexes required

```sql
-- Already exists from migration 004_download_tracking
create index on package_versions (download_count desc);

-- New
create index on package_stars (star_count desc);
```

### Caching (future)

If p95 latency exceeds SLAs, add a Supabase Edge Function or Redis layer that:
1. Computes `get_popular_packages(50)` on a schedule (e.g., every 15 minutes)
2. Caches the result
3. Serves reads from cache

The browse page sort is not latency-critical enough to warrant this now.

### Recency decay and the `stable` volatility

Both RPCs use `STABLE` volatility so the Postgres planner can cache results within a transaction. The `max_dl` and `max_stars` lookups inside the function body are re-evaluated per call but this is acceptable at current scale.

---

## 8. Out of Scope

- Star authentication (who voted) — a `package_star_votes` table for fraud prevention
- Weighted tuning UI (admin knobs to adjust weights)
- Personalized popularity (your stars weighted higher)
- Popularity score on package detail page (display only — shown on browse for now)
- Cache layer (add if latency becomes an issue)
- Star button UI — the star mutation API is defined but no frontend button is built in this phase

---

## 9. Migration Checklist

- [ ] Create `supabase/migrations/012_package_stars.sql` with `package_stars` table + RLS + RPCs
- [ ] Add `get_popular_packages` RPC to `supabase/migrations/012_package_stars.sql`
- [ ] Add `get_package_score` RPC to `supabase/migrations/012_package_stars.sql`
- [ ] Add `set_package_star` RPC to `supabase/migrations/012_package_stars.sql`
- [ ] Add `getPopularPackages` and `getPackageScore` to `src/lib/db.ts`
- [ ] Update `src/pages/packages/index.astro` to support `sort=popular`
- [ ] Add "Top packages" section to `src/pages/index.astro`
- [ ] Add `popular` sort option styles (reuse trending styles)
