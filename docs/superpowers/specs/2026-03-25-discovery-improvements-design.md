# Design: Discovery Improvements

**Date:** 2026-03-25

## Overview

This spec covers three related improvements to package discovery on Lectern:

1. **Search filters** -- refine search results by tag and sort order directly in the results UI
2. **Inline compare** -- select multiple packages via checkboxes and open a side-by-side comparison panel
3. **Packages Like This** -- a sticky sidebar on package detail pages showing semantically similar packages

All three ship together in v1. Semantic search (NVIDIA embeddings + RRF) already exists and is reused throughout.

---

## 1. Search Filters

### Goal

Let users who arrive with a vague intent ("I want to parse JSON") narrow results without a new API call.

### UI

Filter chips appear above the search results on the homepage and the browse page. Two chip groups:

**Tag chips** -- one chip per available tag. Clicking a chip filters results to only packages with that tag. Multiple tags cannot be selected simultaneously in v1 (single-select tag filter).

**Sort chips** -- `relevance | popular | recent | trending`. Only one active at a time.

```
[all] [parsing] [http] [cli] [json] ...
[relevance] [popular] [recent] [trending]
```

Active chips show accent border + text color and a subtle tinted background, matching the existing filter chip style in `index.astro`.

### URL shape

```
/?q=json&tag=parsing&sort=popular
```

All filter state is reflected in URL params so results are shareable. The page loads with the correct chips pre-selected by reading `location.searchParams`.

### Client-side filtering

All filtering (tag + sort) happens client-side against the results already loaded by the existing search fetch. No additional API call is made when a chip is clicked.

When the user types a new query, the active tag and sort chips persist (they are not reset).

### Empty state

If a filter produces no results, show:
```
No packages found for "json" tagged "parsing".
```
Below the message, a "clear filters" link resets tag and sort to defaults and shows all results for the current query.

### Files touched

- `src/pages/index.astro` -- add filter chip markup and client-side filter logic
- `src/pages/packages.astro` -- same additions for the browse page

---

## 2. Inline Compare

### Goal

Allow users to select 2 or more packages from search or browse results and open a side-by-side comparison panel, without navigating away from the page.

### Card checkboxes

Every package card in search results and browse listings gains a small checkbox in the top-left corner. It appears on hover (desktop) and is always visible on mobile.

```
[ ] package-name    v1.2.0   "JSON parser for Ink"
[v] ink-json        v0.9.1   "Fast JSON parsing"
[v] jsonx           v2.0.0   "Extended JSON with schemas"
```

Checkbox state is stored in a `Set<string>` of selected package names in the page's script scope.

### Compare bar

When 2 or more packages are selected, a sticky bar slides in from the bottom of the viewport:

```
Compare (2 packages)                       [View Compare]  [×]
```

- Fixed to bottom, full width, above the page footer
- "View Compare" opens the slide-in panel (see below)
- "×" clears all selections and hides the bar
- Bar animates in with `transform: translateY(100%)` → `translateY(0)` over 200ms ease-out

### Slide-in panel

The panel slides in from the right side of the viewport (not a full modal). It is 480px wide on desktop, full-width on mobile.

```
┌─────────────────────────────────────────────┐
│  Compare packages                    [Close] │
├──────────────┬──────────────┬───────────────┤
│              │  ink-json    │  jsonx        │
│  version     │  v0.9.1     │  v2.0.0       │
│  description │  Fast JSON… │  Extended…    │
│  tags        │  [json]      │  [json][schema]│
│  downloads   │  1,204      │  892          │
│  popularity  │  8.7        │  7.2          │
│  author      │  @bob       │  @alice       │
│  published   │  2025-03-01 │  2025-11-20  │
│  deps        │  ink v2+    │  ink v3+      │
│  license     │  MIT        │  Apache-2     │
├──────────────┴──────────────┴───────────────┤
│  [Diff versions of ink-json → jsonx]          │  ← only shown when exactly 2 packages selected
└─────────────────────────────────────────────┘
```

**Columns:** one column per selected package. Maximum 5 packages at once.

**Rows:** version, description, tags, downloads, popularity score, author, published date, dependencies (latest version), license.

**Diff link:** when exactly 2 packages are selected, a "Diff versions" link appears below the table. Clicking it navigates to the existing `/packages/[name]/diff` page, using the package of the first-selected column as the base. The second package's name and shared version (if any) are not used for cross-package diffs in this link -- the diff route only handles single-package version diffs. The link is present as a hint to the user that intra-package version diffs are also available.

**Cross-package version diff:** not in scope for v1. The diff route handles one package across two versions. Cross-package comparison is display-only in the panel.

**Panel close:** clicking "Close", pressing Escape, or clicking the backdrop closes the panel.

**Comparison with existing diff page:** The compare panel is a new component. It does not call the `/diff` route internally for cross-package comparison. It reuses the table-layout CSS patterns and color conventions (added=green, removed=red) from `src/pages/packages/[name]/diff.astro` for visual consistency.

### Opening the panel from the version diff page

Within a single package's version list (on the package detail page), each version row gets a checkbox. Checking 2 versions and clicking "Compare versions" navigates to the existing `/packages/[name]/diff?v1=X&v2=Y` route. This reuses the existing diff behavior rather than the new compare panel.

### Files touched

- `src/components/ComparePanel.astro` -- new, the slide-in panel component
- `src/components/PackageCardCheckbox.astro` -- new, checkbox wrapper added to each card in search/browse results
- `src/pages/index.astro` -- add checkboxes to search result cards, add compare bar, initialize panel mount
- `src/pages/packages.astro` -- same as above for browse listings
- `src/pages/packages/[name]/diff.astro` -- add checkboxes to version rows on the diff page

---

## 3. Packages Like This (Similar Packages Sidebar)

### Goal

Help users discover relevant packages while browsing a package detail page, using semantic similarity powered by the existing embedding infrastructure.

### Placement

On `/packages/[name].astro`, a sidebar section appears in the right column on desktop (alongside the main package info). On mobile it appears below the main content.

### API endpoint

```
GET /api/packages/[name]/similar?limit=5
```

**Response:**
```json
[
  {
    "name": "ink-json",
    "version": "0.9.1",
    "description": "Fast JSON parsing for Ink",
    "download_count": 1204,
    "popularity_score": 8.7,
    "star_count": 14
  }
]
```

**Implementation:** Uses the existing semantic search pipeline. The query uses vector embedding distance:

```sql
SELECT name, latest_version, description, download_count, popularity_score, star_count
FROM packages
WHERE name != $1
  AND name IN (SELECT package_name FROM package_versions)
ORDER BY embedding <-> (SELECT embedding FROM packages WHERE name = $1)
LIMIT $2
```

The `embedding <->` operator is the cosine distance operator added by the `pgvector` extension (already used by the main search). This is the same approach used by the existing `searchPackages` function.

If no embedding exists for the package (embedding is NULL), return an empty array with an empty state in the UI.

### Empty state

If no similar packages are found (empty result or no embedding data):

```
similar packages

No similar packages found yet.
```

The section heading is always rendered. The body is the empty state message.

### Files touched

- `src/pages/api/packages/[name]/similar.ts` -- new API route
- `src/lib/db.ts` -- add `getSimilarPackages(name, limit)` function
- `src/pages/packages/[name].astro` -- import and render the sidebar section

---

## 4. DB Layer

### New function: `getSimilarPackages`

```typescript
// src/lib/db.ts

export interface SimilarPackage {
  name: string
  version: string
  description: string | null
  download_count: number
  popularity_score: number
  star_count: number
}

export async function getSimilarPackages(
  packageName: string,
  limit = 5
): Promise<SimilarPackage[]> {
  const { data, error } = await supabase.rpc('get_similar_packages', {
    p_package_name: packageName,
    p_limit: limit,
  })
  if (error) throw error
  return (data as SimilarPackage[]) ?? []
}
```

### New RPC: `get_similar_packages`

```sql
create or replace function get_similar_packages(
  p_package_name text,
  p_limit        int default 5
)
returns table (
  name             text,
  version          text,
  description      text,
  download_count   bigint,
  popularity_score numeric,
  star_count       bigint
)
language plpgsql
stable
as $$
begin
  return query
  select
    pv.package_name,
    pv.latest_version,
    pv.description,
    coalesce(sum(pv.download_count), 0)::bigint,
    coalesce(ps.popularity_score, 0),
    coalesce(ps.star_count, 0)
  from (
    select
      package_name,
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
    from package_versions pv
    group by package_name
  ) pv
  join packages p on p.name = pv.package_name
  left join package_stars ps on ps.package_name = pv.package_name
  where
    pv.package_name != p_package_name
    and p.embedding is not null
  order by p.embedding <-> (select embedding from packages where name = p_package_name)
  limit p_limit;
end;
$$;
```

> **Note:** If the source package has a NULL embedding, the `order by embedding <->` clause will cause the query to fail at the RPC level. Handle this in the API route by checking for NULL embedding before calling the RPC, and return an empty array if NULL.

---

## 5. Implementation Order

Suggested implementation sequence:

1. **DB + API** -- add `get_similar_packages` RPC and `getSimilarPackages` db function, then the API route
2. **Sidebar** -- add "Packages Like This" to the package detail page
3. **Search filters** -- add filter chips + client-side logic to index and packages pages
4. **Compare panel** -- add checkboxes to cards, compare bar, then the slide-in panel component

---

## 6. Out of Scope

- Cross-package version diff (diff route handles one package, two versions)
- Personalization based on starred packages (similarity is embedding-only in v1)
- Tag multi-select (single-select tag filter only in v1)
- Search intent chips / intent-based result grouping
- Dependency graph visualization
- Client-side caching of similar packages results
