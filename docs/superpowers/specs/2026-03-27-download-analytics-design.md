# Download Analytics Dashboard — Enhanced Design

**Spec ID:** 2026-03-27-download-analytics-design
**Date:** 2026-03-27
**Status:** Approved
**Feature:** Enhanced Download Analytics Dashboard
**Stack:** Astro SSR + Supabase (auth + DB) + Vercel adapter

---

## 1. Overview

The existing analytics dashboard at `/[user]/[slug]/analytics` shows a sparkline and basic 7d/30d totals. This spec covers a full overhaul with:

- Detailed line/bar charts (timeline, version breakdown, referrer breakdown, geographic distribution)
- Time range picker: 7d / 30d / 90d / All time
- CSV export for each dimension
- Owner-only access (existing auth pattern)

---

## 2. Enhanced Download Logging

### 2.1 `logDownload()` Signature Change

**File:** `src/lib/db.ts`

The existing `logDownload()` is extended to accept optional `country` and `referrer` parameters:

```typescript
export async function logDownload(
  name: string,
  version: string,
  authHeader: string | null,
  country?: string,   // ISO 3166-1 alpha-2 country code, e.g. "US"
  referrer?: string,  // normalized referrer URL or "direct"
): Promise<void>
```

Both fields are optional — the function continues to work for existing callers that pass neither.

### 2.2 Cloudflare Integration

**File:** `src/pages/api/download/[...path].ts` (or wherever the tarball download is served)

The Astro download handler already runs behind Cloudflare. It extracts:

- `CF-IPCountry` request header → passed as `country` to `logDownload()`
- `Referer` request header → passed as `referrer` to `logDownload()`, normalized:
  - Strip protocol, trailing slash
  - Store `"direct"` if absent or empty
  - Truncate to 500 characters max

---

## 3. Database Migration

### 3.1 Schema Changes

**Table:** `download_logs`

```sql
-- Add new columns (nullable, default null for existing rows)
ALTER TABLE download_logs ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE download_logs ADD COLUMN IF NOT EXISTS referrer TEXT;

-- Indexes for analytics queries
CREATE INDEX IF NOT EXISTS idx_download_logs_country ON download_logs(country);
CREATE INDEX IF NOT EXISTS idx_download_logs_referrer ON download_logs(referrer);
CREATE INDEX IF NOT EXISTS idx_download_logs_package_downloaded ON download_logs(package_name, downloaded_at);
CREATE INDEX IF NOT EXISTS idx_download_logs_package_version ON download_logs(package_name, version);
```

These changes are safe to apply as additive migrations — no existing data is modified, no rows are deleted.

### 3.2 Migration File

Create `supabase/migrations/20260327_enhance_download_logs.sql` with the above DDL.

---

## 4. Extended Analytics API

### 4.1 Endpoint

```
GET /api/packages/[name]/analytics
```

Existing query params are unchanged. One new query param is added:

| Param | Values | Default | Description |
|-------|---------|---------|-------------|
| `dimension` | `timeline` \| `versions` \| `referrers` \| `geo` | `timeline` | Data dimension to return |
| `days` | `7` \| `30` \| `90` \| `all` | `30` | Time range (all = no limit) |

When `dimension` is omitted, the response is identical to the current v1 response (backward compatible).

### 4.2 Response Shapes

#### `dimension=timeline` (default)

```json
{
  "timeline": [
    { "date": "2026-03-20", "count": 42 },
    { "date": "2026-03-21", "count": 38 },
    ...
  ],
  "total": 1840,
  "periodDownloads": 312
}
```

#### `dimension=versions`

```json
{
  "versions": [
    { "version": "1.2.0", "count": 900, "percentage": 48.9 },
    { "version": "1.1.0", "count": 620, "percentage": 33.7 },
    ...
  ]
}
```

#### `dimension=referrers`

```json
{
  "referrers": [
    { "referrer": "github.com/user/repo", "count": 450 },
    { "referrer": "direct", "count": 312 },
    ...
  ]
}
```

#### `dimension=geo`

```json
{
  "geo": [
    { "country": "US", "count": 820 },
    { "country": "DE", "count": 210 },
    ...
  ]
}
```

### 4.3 Implementation

A new internal helper `getDownloadAnalytics()` in `src/lib/db.ts` handles all four dimensions:

```typescript
export async function getDownloadAnalytics(
  packageName: string,
  dimension: 'timeline' | 'versions' | 'referrers' | 'geo',
  days: number | 'all'
): Promise<TimelineResult | VersionsResult | ReferrersResult | GeoResult>
```

The existing `getDownloadTimeline()` remains unchanged for backward compatibility.

The API route `src/pages/api/packages/[name]/analytics.ts` is updated to:
1. Parse `dimension` and `days` from `request.url`
2. Call `getDownloadAnalytics()` for non-timeline dimensions
3. Merge new data into the existing response structure

---

## 5. Analytics Page Overhaul

**File:** `src/pages/[user]/[slug]/analytics.astro`

### 5.1 Page Structure

```
┌─────────────────────────────────────────────────────┐
│  [Owner Badge]  /  [slug]  Analytics                │
│  ← Back to package                    [Export CSV]  │
├─────────────────────────────────────────────────────┤
│  [7d] [30d] [90d] [All]   ← time range picker      │
├─────────────────────────────────────────────────────┤
│  [Timeline] [Versions] [Referrers] [Geo]  ← tabs   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  <Chart area>                                       │
│                                                     │
├─────────────────────────────────────────────────────┤
│  Total: N  |  Period: N  |  Peak: N (date)          │
└─────────────────────────────────────────────────────┘
```

### 5.2 Tabs

Each tab fetches its dimension data independently via the analytics API endpoint.

| Tab | Dimension | Chart Type |
|-----|-----------|------------|
| Timeline | `timeline` | Line chart (daily downloads over time) |
| Versions | `versions` | Horizontal bar chart (sorted by count) |
| Referrers | `referrers` | Horizontal bar chart (sorted by count) |
| Geo | `geo` | Horizontal bar chart (country code + flag emoji + count) |

### 5.3 Time Range Picker

- Four buttons: **7d**, **30d**, **90d**, **All**
- Active state: filled background
- Clicking a button re-fetches data for the selected `days` value and re-renders the active tab's chart
- Default: **30d**

### 5.4 CSV Export

- One **Export CSV** button in the page header
- Exports the currently active tab's data as a CSV file
- Filename format: `{slug}-analytics-{dimension}-{days}.csv`
- Implementation: client-side — fetch the JSON, transform to CSV string, trigger `<a download>` blob URL
- No server-side endpoint required

### 5.5 Loading State

- On tab switch or time range change, show a subtle pulsing skeleton placeholder matching the chart dimensions
- No full-page spinner

---

## 6. Chart Components

**File:** `src/components/charts/DownloadLineChart.astro`
**File:** `src/components/charts/DownloadBarChart.astro`

### 6.1 DownloadLineChart (Timeline)

- Inline SVG, no JavaScript
- X-axis: dates (labeled every 5th day or fewer to avoid crowding)
- Y-axis: download count (auto-scaled, 5 gridlines)
- Single polyline path with gradient fill below
- Hover: CSS `:hover` on data points shows a `<title>` tooltip (native SVG)
- Responsive: `viewBox` with fixed aspect ratio, `width="100%"`

### 6.2 DownloadBarChart (Versions / Referrers / Geo)

- Inline SVG, no JavaScript
- Horizontal bars, sorted descending by count
- Bars are `<rect>` elements with CSS transition on width (optional animation on mount via CSS `@keyframes`)
- Label on the left, count on the right
- Top 20 items only (API already limits)
- Country bars include a flag emoji derived from the country code

### 6.3 Shared Style Guidelines

- Colors: use CSS custom properties (`--chart-primary`, `--chart-secondary`, `--chart-grid`) to match the existing site theme
- Chart container: white card with subtle shadow, consistent with existing card style on the site
- Font: system font stack (matches site)

---

## 7. Auth & Access Control

- Unchanged from existing behavior
- The analytics API route `GET /api/packages/[name]/analytics` requires a valid Bearer token
- Only the package owner (verified via `canUserPublish()`) can access the data
- The analytics Astro page server-renders a 403 card if the visitor is not the owner

---

## 8. File Summary

| File | Change |
|------|--------|
| `supabase/migrations/20260327_enhance_download_logs.sql` | New: add country/referrer columns + indexes |
| `src/lib/db.ts` | Modify: `logDownload()` signature; add `getDownloadAnalytics()` |
| `src/pages/api/download/[...path].ts` | Modify: pass CF-IPCountry and Referer headers to `logDownload()` |
| `src/pages/api/packages/[name]/analytics.ts` | Modify: parse `dimension`/`days` params, call new DB helpers |
| `src/pages/[user]/[slug]/analytics.astro` | Modify: overhaul with tabs, time picker, charts, export |
| `src/components/charts/DownloadLineChart.astro` | New: inline SVG line chart |
| `src/components/charts/DownloadBarChart.astro` | New: inline SVG horizontal bar chart |

---

## 9. Backward Compatibility

- `logDownload()` callers that pass no country/referrer continue to work (those fields will be null in the DB)
- Existing sparkline on the package page is unaffected
- `GET /api/packages/[name]/analytics` without `dimension`/`days` returns the exact same JSON as before
- No breaking changes to any public API or page

---

## 10. Future Considerations (Out of Scope)

- Animated / interactive charts (Chart.js or similar) — not needed at this scale
- Comparison with previous period ("vs last period") — add later as a toggle
- Email digest / weekly reports — separate feature
- Real-time download counter — separate feature
