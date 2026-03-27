# Plan: Dependency Visualization

## Context

A prototype deps page exists at `src/pages/[user]/[slug]/deps.astro` with a custom SVG force-directed graph. It has no interactivity (no tooltips, no zoom/drag), and `getPackageDependents()` is inefficient (loads ALL rows, filters in JS). The GIN index exists but isn't used. D3.js is not currently used in the project.

## What Exists

- `src/pages/[user]/[slug]/deps.astro` — prototype force-directed SVG graph (custom, 100-iteration simulation)
- `src/lib/db.ts` — `getPackageDependents()`, `getVersionDependencies()`
- `src/pages/[user]/[slug].astro` — package detail page with "View dependency graph" link
- `supabase/migrations/006_deps_graph.sql` — GIN index on `dependencies` column

## What to Build

### 1. Fix `getPackageDependents()` (db.ts)

Replace the client-side filter with a proper GIN index query:

```typescript
// New: getPackageDependentsFast — uses GIN index
export async function getPackageDependentsFast(pkgName: string): Promise<PackageDependentsResult[]>
// Uses: WHERE dependencies @> jsonb_build_object($1, '')
```

### 2. Add `getTransitiveDeps()` (db.ts)

For future expand-on-click (v2, not v1):
```typescript
// v2 only
export async function getTransitiveDeps(pkgName: string, depth?: number): Promise<TransitiveDepResult[]>
```

### 3. New `DepsGraph.astro` component (new file)

Replaces the prototype in `deps.astro`. Uses D3.js v7 (`d3-force`, `d3-zoom`, `d3-drag`).

**Props**: `dependsOn: PackageNode[]`, `dependedBy: PackageNode[]`, `centerName: string`

**Layout modes** (toggle between):
- **Force-directed** (default): D3 force simulation, center node pinned
- **Hierarchical/tree**: left-pointing tree for "depends on", right-pointing for "depended by"

**Node interactions:**
- Hover: tooltip card (name, version constraint, downloads, latest version)
- Click: navigate to `/[user]/[slug]`
- Highlight: connected edges brighten, others fade on node hover

**Edge styling:**
- "Depends on": muted dashed line, arrow pointing to dependency
- "Depended by": amber line at 50% opacity, arrow pointing to center

**Graph controls:**
- Zoom/pan via D3 zoom behavior
- Drag nodes individually
- Filter buttons: `both` | `depends-on` | `depended-by` (refine existing)
- Depth indicator badge (for future transitive)

**Performance:**
- Cap direct dependents at 50, show "+N more"
- Lazy-load transitive expansion (v2)

### 4. Empty states

| Case | Message |
|---|---|
| 0 deps, 0 dependents | "No dependencies and no dependents yet." |
| 0 deps only | "No dependencies. This package is self-contained." |
| 0 dependents only | "No packages depend on this yet." |

Empty state is centered message inside graph container.

### 5. Mini inline graph preview (package detail page)

On `[user]/[slug].astro`: add a small static preview of direct deps graph (static SVG, no D3) linking to the full `/deps` page. Shows the dependency tree at a glance.

## Files to Modify/Create

- `src/lib/db.ts` — add `getPackageDependentsFast()`, `getTransitiveDeps()` (v2)
- `src/components/DepsGraph.astro` — **new** D3-powered graph component
- `src/pages/[user]/[slug]/deps.astro` — replace prototype with `<DepsGraph>`
- `src/pages/[user]/[slug].astro` — add mini inline graph preview link

## Complexity: Medium (v1: force graph + tooltips + zoom/drag + GIN query fix)

## Done When

- [ ] `getPackageDependentsFast()` uses GIN index
- [ ] `<DepsGraph>` renders with D3 force-directed layout
- [ ] Nodes have working hover tooltips
- [ ] Click navigates to package page
- [ ] Zoom and drag work
- [ ] Filter buttons (both/depends-on/depended-by) work
- [ ] Empty states handled
- [ ] Mini inline graph preview on detail page
- [ ] Transitive deps NOT built (v2)
