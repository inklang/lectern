# Plan: Discoverability - Download Stats, Trending, Tags, Badges

## Feature Description

Four related features: download statistics tracking, trending packages, category/tag system, and embeddable SVG badges.

## Implementation Phases

### Phase 1: Download Tracking (Foundational)
1. Create migration `004_download_tracking.sql`:
   - Add `download_count` column to `package_versions`
   - Create `download_logs` table with indexes
   - Create RLS policies
2. Modify `GET /api/packages/[name]/[version]` to:
   - Log download event to `download_logs`
   - Increment `download_count` atomically
3. Add `GET /api/packages/[name]/stats` endpoint returning `{ total, last7d, last30d }`
4. Add `getPackageStats()` to `src/lib/db.ts`

### Phase 2: Trending Packages
1. Create RPC function `get_trending_packages(window_days, limit_count)` in migration
2. Add `GET /api/packages/trending` endpoint
3. Add "Trending" section to homepage (`src/pages/index.astro`)

### Phase 3: Tag System
1. Create migration `005_tags.sql`:
   - Create `tags` table
   - Create `package_tags` junction table
   - RLS policies and indexes
2. Modify `PUT /api/packages/[name]/[version]` to accept `tags` field
3. Add `POST /api/packages/[name]/tags` endpoint
4. Add `DELETE /api/packages/[name]/tags/[tag]` endpoint
5. Add `GET /api/tags` endpoint listing all tags with counts
6. Create `/tags/index.astro` page - browse all tags
7. Create `/tags/[tag].astro` page - packages filtered by tag
8. Update `/packages/index.astro` - add tag filter sidebar
9. Update `/packages/[name].astro` - display tag chips

### Phase 4: Embeddable Badges
1. Create `GET /api/badges/[name]/[version].svg` - version number shield
2. Create `GET /api/badges/[name]/downloads.svg` - download count shield
3. Update `/packages/[name].astro` - add "Badges" section with copy-paste markdown

## Critical Files
- `src/pages/api/packages/[name]/[version].ts` - download tracking
- `src/lib/db.ts` - new query functions
- `src/pages/api/packages/trending.ts`
- `src/pages/api/badges/[name]/[version].ts`
- `src/pages/index.astro`
- `src/pages/packages/index.astro`
- `src/pages/packages/[name].astro`
- `src/pages/tags/index.astro` (new)
- `src/pages/tags/[tag].astro` (new)

## Dependencies
- Phase 2 depends on Phase 1
- Phase 4 badges download count depends on Phase 1

## Complexity
Medium (all phases)
