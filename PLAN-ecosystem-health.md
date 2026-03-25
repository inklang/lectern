# Plan: Ecosystem Health - Dependency Graph, Deprecation, Advisories

## Feature Description

Three features: dependency graph visualization, package deprecation notices, and security advisories integration.

## Implementation Phases

### Phase 1: Dependency Graph
1. Create migration `006_deps_graph.sql`:
   - Add GIN index on `package_versions.dependencies` for efficient reverse lookups
2. Add `GET /api/packages/[name]/dependents` endpoint:
   - Query `package_versions` where `dependencies @> '{"pkgName": "any"}'::jsonb`
   - Returns list of packages/versions that depend on this package
3. Add `GET /api/packages/[name]/dependencies` endpoint (if useful):
   - Parse and return the dependency tree
4. Update `/packages/[name].astro`:
   - Add "Dependents" section showing count and sample
   - Link to full graph view
5. Create `/packages/[name]/deps.astro` page:
   - Graph visualization using D3.js or similar
   - Two views: "depends on" (forward) and "depended by" (reverse)

### Phase 2: Package Deprecation
1. Create migration `007_deprecation.sql`:
   - Add columns to `packages` table: `deprecated`, `deprecation_message`, `deprecated_at`, `deprecated_by`
   - RLS policies
2. Add `PUT /api/packages/[name]/deprecate` endpoint:
   - Auth: Bearer token (package owner only)
   - Body: `{ deprecated: boolean, message?: string }`
3. Add `canUserDeprecate()` to `src/lib/authz.ts`
4. Update `/packages/[name].astro`:
   - Show deprecation banner if `deprecated === true`
   - Amber/yellow warning styling
5. Consider: deprecation badge in package listing

### Phase 3: Security Advisories
1. Create migration `008_advisories.sql`:
   - Create `package_advisories` table
   - Indexes and RLS policies
2. Add `PUT /api/packages/[name]/advisories` endpoint:
   - Auth: Bearer token, org admin permission
   - Body: advisory fields
3. Add `GET /api/packages/[name]/advisories` endpoint:
   - Returns cached advisories for this package
4. Add `GET /api/advisories` endpoint (all advisories)
5. Update `/packages/[name].astro`:
   - Add "Security Advisories" section
   - Color-coded severity badges (critical=red, high=orange, medium=yellow, low=gray)
   - Link to full advisory URL
6. Optional: Background sync with GitHub Advisory Database API

## Critical Files
- `src/pages/api/packages/[name]/dependents.ts` (new)
- `src/pages/api/packages/[name]/deprecate.ts` (new)
- `src/pages/api/packages/[name]/advisories.ts` (new)
- `src/lib/authz.ts` - add `canUserDeprecate`
- `src/lib/db.ts` - add advisory query functions
- `src/pages/packages/[name].astro`
- `src/pages/packages/[name]/deps.astro` (new)

## Dependencies
- Phase 2 and 3 are independent of each other
- Both can start after Phase 1 is complete

## Complexity
- Phase 1: Medium (API simple, graph UI complex)
- Phase 2: Low
- Phase 3: High (external API integration, version matching)
