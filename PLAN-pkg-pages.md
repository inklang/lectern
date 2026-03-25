# Plan: Package Pages with Descriptions and README Rendering

## Feature Description

Enhance package detail pages with download counts, author/license metadata, and improved version history display.

## Current State

- `src/pages/packages/[name].astro` - existing page with README rendering via `marked` + `sanitize-html`
- `src/lib/markdown.ts` - existing markdown rendering
- `package_versions` table has: `package_name`, `version`, `description`, `readme`, `dependencies`, `tarball_url`, `published_at`

## Missing

- Download counts (no table or tracking)
- Author metadata (not in schema)
- License metadata (not in schema)

## Implementation Phases

### Phase 1: Database Schema Changes
1. Create migration `004_package_stats.sql`
2. Add `download_count` column to `package_versions` table
3. Add `author` and `license` columns to `package_versions`

### Phase 2: Download Tracking in GET Endpoint
1. Modify `GET /api/packages/[name]/[version]` to increment `download_count` before redirect
2. Add `getPackageStats()` function to `src/lib/db.ts`

### Phase 3: Author/License on Publish
1. Modify `PUT /api/packages/[name]/[version]` to accept `author` and `license` fields

### Phase 4: Enhanced Package Page UI
1. Display author badge on `/packages/[name]`
2. Display license badge on `/packages/[name]`
3. Display download count per version
4. Display total package downloads in header

## Critical Files
- `src/pages/packages/[name].astro`
- `src/pages/api/packages/[name]/[version].ts`
- `src/lib/db.ts`
- `supabase/migrations/001_initial.sql`

## Dependencies
- None - all foundational pieces already exist

## Complexity
Medium
