# Discovery Improvements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three related discovery features: (1) client-side search filters (tag chips + sort chips), (2) inline package comparison via a slide-in panel, and (3) a "Packages Like This" semantic-similarity sidebar on package detail pages.

**Architecture overview:**
- Tag filter state lives in URL (`?tag=`); since the search API does not return per-result tag data, clicking a tag chip navigates via `location.href` (full page reload) to show server-filtered results — consistent with how the existing tag chips already work on `index.astro`.
- Sort state also lives in URL (`?sort=`); sort chips use `history.replaceState` to update the URL without reload, re-sorting and re-rendering the cached search results already in memory.
- Compare selection is stored in a `Set<string>` in page script scope; a sticky bottom bar appears at 2+ selections and opens a slide-in panel.
- "Packages Like This" uses the existing `pgvector` embedding infrastructure via a new `get_similar_packages` RPC, consumed by a new `/api/packages/[name]/similar` route.

**Tech stack:** Astro SSR, Supabase Postgres + pgvector, TypeScript, vanilla JS interactivity.

---

## File Map

### New files
- `supabase/migrations/014_discovery.sql` — `get_similar_packages` RPC
- `src/pages/api/packages/[name]/similar.ts` — `GET /api/packages/[name]/similar?limit=5`
- `src/pages/api/packages/[name]/similar.test.ts` — API route unit tests
- `src/components/ComparePanel.astro` — slide-in comparison panel component
- `src/components/PackageCardCheckbox.astro` — checkbox wrapper for package cards

### Modified files
- `src/lib/db.ts` — add `getSimilarPackages` function and `SimilarPackage` interface
- `src/lib/db.test.ts` — add `getSimilarPackages` unit tests
- `src/pages/packages/[name].astro` — add "Packages Like This" sidebar section
- `src/pages/index.astro` — add sort filter chips + history.replaceState sort; add card checkboxes, compare bar, panel mount
- `src/pages/packages/index.astro` — add sort chips (replacing the existing `<select>` with chip group); add card checkboxes, compare bar, panel mount
- `src/pages/packages/[name]/diff.astro` — add checkboxes to version rows for diff-from-compare navigation

---

## Chunk 1: DB Layer — `get_similar_packages` RPC + TypeScript function

### Task 1: Create migration file

**Files:**
- Create: `supabase/migrations/014_discovery.sql`

```sql
-- Migration: Discovery Improvements
-- Adds get_similar_packages RPC for "Packages Like This" sidebar

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
      )) as description,
      max(download_count) filter (where (published_at, version) = (
        select published_at, version from package_versions pv2
        where pv2.package_name = pv.package_name
        order by published_at desc limit 1
      )) as download_count
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

**Verification command:**
```bash
# Dry-run check (review only — apply via Supabase dashboard or migrate command)
psql "$SUPABASE_DB_URL" -f supabase/migrations/014_discovery.sql --set ON_ERROR_STOP=1
# Expected: no output on success
```

---

### Task 2: Add `getSimilarPackages` to `src/lib/db.ts`

**Files:**
- Modify: `src/lib/db.ts`

Add at the end of the file (before any trailing whitespace):

```typescript
// ─── Similar Packages ─────────────────────────────────────────────────────────

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

**Verification command:**
```bash
cd /Users/justi/dev/lectern && npx tsc --noEmit src/lib/db.ts
# Expected: no TypeScript errors
```

---

### Task 3: Add `getSimilarPackages` unit tests to `src/lib/db.test.ts`

**Files:**
- Modify: `src/lib/db.test.ts`

Add at the end of the file:

```typescript
describe('getSimilarPackages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rpcResult.data = null
    rpcResult.error = null
  })

  it('returns similar packages from RPC', async () => {
    const mockData = [
      { name: 'ink-json', version: '0.9.1', description: 'Fast JSON', download_count: 1204, popularity_score: 8.7, star_count: 14 },
      { name: 'jsonx', version: '2.0.0', description: 'Extended JSON', download_count: 892, popularity_score: 7.2, star_count: 9 },
    ]
    rpcResult.data = mockData

    const { getSimilarPackages } = await import('./db.js')
    const result = await getSimilarPackages('my-pkg', 5)

    expect(result).toEqual(mockData)
    expect(supabase.rpc).toHaveBeenCalledWith('get_similar_packages', {
      p_package_name: 'my-pkg',
      p_limit: 5,
    })
  })

  it('throws on RPC error', async () => {
    rpcResult.error = new Error('Embedding not found')

    const { getSimilarPackages } = await import('./db.js')
    await expect(getSimilarPackages('nonexistent')).rejects.toThrow('Embedding not found')
  })

  it('uses default limit of 5', async () => {
    rpcResult.data = []

    const { getSimilarPackages } = await import('./db.js')
    await getSimilarPackages('my-pkg')

    expect(supabase.rpc).toHaveBeenCalledWith('get_similar_packages', {
      p_package_name: 'my-pkg',
      p_limit: 5,
    })
  })
})
```

**Verification command:**
```bash
cd /Users/justi/dev/lectern && npx vitest run src/lib/db.test.ts --reporter=verbose 2>&1 | grep -E "(getSimilarPackages|PASS|FAIL|✓|×)"
# Expected: 3 tests pass
```

---

## Chunk 2: API Route — `GET /api/packages/[name]/similar`

### Task 4: Create the API route

**Files:**
- Create: `src/pages/api/packages/[name]/similar.ts`

```typescript
import type { APIRoute } from 'astro'
import { getSimilarPackages } from '../../../lib/db.js'
import { supabase } from '../../../lib/supabase.js'

export const GET: APIRoute = async ({ params, request }) => {
  const { name } = params
  if (!name) {
    return new Response(JSON.stringify({ error: 'Package name required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const url = new URL(request.url)
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '5', 10)))

  // Check if the package has an embedding before calling the vector RPC.
  // If NULL, return empty array — no similarity data available.
  const { data: pkg } = await supabase
    .from('packages')
    .select('embedding')
    .eq('name', name)
    .single()

  if (!pkg || pkg.embedding === null) {
    return new Response(JSON.stringify([]), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const similar = await getSimilarPackages(name, limit)
    return new Response(JSON.stringify(similar), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('getSimilarPackages error:', err)
    return new Response(JSON.stringify({ error: 'Failed to fetch similar packages' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
```

**Verification command:**
```bash
cd /Users/justi/dev/lectern && npx tsc --noEmit src/pages/api/packages/[name]/similar.ts
# Expected: no TypeScript errors
```

---

### Task 5: Add API route unit tests

**Files:**
- Create: `src/pages/api/packages/[name]/similar.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../lib/supabase.js', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { embedding: [0.1, 0.2] }, error: null }),
    }),
    rpc: vi.fn().mockResolvedValue({
      data: [
        { name: 'ink-json', version: '0.9.1', description: 'Fast JSON', download_count: 1204, popularity_score: 8.7, star_count: 14 },
      ],
      error: null,
    }),
  },
}))

vi.mock('../../../lib/db.js', () => ({
  getSimilarPackages: vi.fn().mockResolvedValue([
    { name: 'ink-json', version: '0.9.1', description: 'Fast JSON', download_count: 1204, popularity_score: 8.7, star_count: 14 },
  ]),
}))

import { GET } from './similar'

describe('GET /api/packages/[name]/similar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns similar packages as JSON', async () => {
    const request = new Request('http://localhost/api/packages/my-pkg/similar?limit=5')
    const response = await GET({ params: { name: 'my-pkg' }, request } as any)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toHaveLength(1)
    expect(body[0].name).toBe('ink-json')
  })

  it('returns 400 when name is missing', async () => {
    const request = new Request('http://localhost/api/packages/my-pkg/similar')
    const response = await GET({ params: {}, request } as any)

    expect(response.status).toBe(400)
  })

  it('returns empty array when package has no embedding', async () => {
    const { supabase } = await import('../../../lib/supabase.js')
    ;(supabase.from('').select('').eq('').single as any).mockResolvedValueOnce(
      { data: { embedding: null }, error: null }
    )

    const request = new Request('http://localhost/api/packages/no-embedding/similar')
    const response = await GET({ params: { name: 'no-embedding' }, request } as any)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual([])
  })

  it('clamps limit to 100', async () => {
    const request = new Request('http://localhost/api/packages/my-pkg/similar?limit=500')
    await GET({ params: { name: 'my-pkg' }, request } as any)

    const { getSimilarPackages } = await import('../../../lib/db.js')
    expect(getSimilarPackages).toHaveBeenCalledWith('my-pkg', 100)
  })
})
```

**Verification command:**
```bash
cd /Users/justi/dev/lectern && npx vitest run src/pages/api/packages/[name]/similar.test.ts --reporter=verbose 2>&1 | grep -E "(similar|PASS|FAIL|✓|×)"
# Expected: 4 tests pass
```

---

## Chunk 3: Package Detail Page — "Packages Like This" Sidebar

### Task 6: Add sidebar section to `src/pages/packages/[name].astro`

**Files:**
- Modify: `src/pages/packages/[name].astro`

Add CSS for the sidebar in the `<style>` block (before the closing `</style>`):

```css
    /* Similar packages sidebar */
    .similar-section {
      margin-top: 2.5rem;
      padding-top: 2rem;
      border-top: 1px solid var(--border);
    }

    .similar-heading {
      font-family: var(--font-mono);
      font-size: 0.7rem;
      font-weight: 500;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 0.875rem;
    }

    .similar-list { display: flex; flex-direction: column; gap: 0.4rem; }

    .similar-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.65rem 0.875rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      text-decoration: none;
      color: var(--text);
      transition: border-color 0.15s;
      gap: 0.75rem;
    }
    .similar-card:hover { border-color: var(--accent); opacity: 1; }

    .similar-name {
      font-family: var(--font-mono);
      font-size: 0.875rem;
    }

    .similar-desc {
      font-size: 0.775rem;
      color: var(--muted);
      display: block;
      margin-top: 0.1rem;
    }

    .similar-score {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: #f59e0b;
      flex-shrink: 0;
    }

    .similar-empty {
      font-family: var(--font-mono);
      font-size: 0.875rem;
      color: var(--muted);
    }
```

Add the sidebar HTML just before the `<script>` tag (after the compare footer `</div>`):

```astro
  <!-- Similar packages sidebar (loaded client-side) -->
  <div class="similar-section" id="similar-section">
    <p class="similar-heading">packages like this</p>
    <div class="similar-list" id="similar-list">
      <p class="similar-empty" id="similar-loading">loading…</p>
    </div>
  </div>
```

Add the fetch-and-render script inside the existing `<script>` block (before the closing `</script>`):

```javascript
    // Fetch and render similar packages
    async function loadSimilar() {
      const list = document.getElementById('similar-list')
      const loading = document.getElementById('similar-loading')
      if (!list || !loading) return
      try {
        const res = await fetch(`/api/packages/${encodeURIComponent(packageName)}/similar?limit=5`)
        const data = await res.json()
        if (!data.length) {
          loading.textContent = 'No similar packages found yet.'
          return
        }
        function esc(s) {
          return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        }
        list.innerHTML = data.map(pkg => `
          <a class="similar-card" href="/packages/${esc(pkg.name)}">
            <div>
              <span class="similar-name">${esc(pkg.name)}</span>
              ${pkg.description ? `<span class="similar-desc">${esc(pkg.description)}</span>` : ''}
            </div>
            <span class="similar-score">★ ${pkg.popularity_score.toFixed(1)}</span>
          </a>
        `).join('')
      } catch {
        loading.textContent = 'No similar packages found yet.'
      }
    }
    loadSimilar()
```

**Verification:**
```bash
cd /Users/justi/dev/lectern && npx astro check src/pages/packages/[name].astro 2>&1 | tail -5
# Expected: no Astro errors
```

---

## Chunk 4: Search Filters — Sort Chips + Client-Side Sort on `index.astro`

### Task 7: Add sort filter chips and client-side sort to `src/pages/index.astro`

**Files:**
- Modify: `src/pages/index.astro`

Add sort chip CSS in the `<style>` block (after existing `.filter-chip` rules):

```css
    .sort-row {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-bottom: 0.75rem;
      justify-content: center;
    }
    .sort-chip {
      font-family: var(--font-mono);
      font-size: 0.8rem;
      padding: 0.25rem 0.6rem;
      border-radius: 6px;
      border: 1px solid var(--border);
      color: var(--muted);
      text-decoration: none;
      transition: border-color 0.15s, color 0.15s, background 0.15s;
      cursor: pointer;
      background: none;
    }
    .sort-chip:hover {
      border-color: var(--accent);
      color: var(--text);
      opacity: 1;
    }
    .sort-chip.active {
      border-color: var(--accent);
      color: var(--accent);
      background: rgba(139, 92, 246, 0.08);
    }
```

In the HTML, add the sort row after the existing tag filter row `<div id="filter-row">` and before `<div id="search-results">`:

```astro
    <div class="sort-row" id="sort-row">
      <button class="sort-chip active" data-sort="relevance">relevance</button>
      <button class="sort-chip" data-sort="popular">popular</button>
      <button class="sort-chip" data-sort="recent">recent</button>
      <button class="sort-chip" data-sort="trending">trending</button>
    </div>

    <div id="search-results"></div>
```

Replace the entire `<script>` block with this complete implementation:

```javascript
    const input = document.getElementById('search-input') as HTMLInputElement
    const results = document.getElementById('search-results') as HTMLDivElement
    const defaultContent = document.getElementById('default-content') as HTMLDivElement
    const filterRow = document.getElementById('filter-row') as HTMLDivElement
    const sortRow = document.getElementById('sort-row') as HTMLDivElement

    const url = new URL(location.href)
    let activeTag = url.searchParams.get('tag') ?? ''
    let activeSort = url.searchParams.get('sort') ?? 'relevance'
    let cachedResults: Array<{ name: string; version: string; description: string | null }> = []

    function esc(s: string): string {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    }

    // ── Tag chip activation (from URL param, server-rendered already) ───────
    // Tag chips use href navigation — no client-side filtering since search API
    // does not return per-result tag data. Clicking a tag chip navigates via
    // location.href (full page reload) to the server-filtered tag URL.
    filterRow.querySelectorAll('.filter-chip').forEach(chip => {
      const el = chip as HTMLAnchorElement
      if (el.dataset.tag === activeTag) {
        el.classList.add('active')
      } else {
        el.classList.remove('active')
      }
    })

    // ── Sort chip activation (from URL param) ─────────────────────────────
    function activateSortChip(sort: string) {
      sortRow.querySelectorAll('.sort-chip').forEach(c => c.classList.remove('active'))
      sortRow.querySelector(`[data-sort="${sort}"]`)?.classList.add('active')
    }
    activateSortChip(activeSort)

    // ── Sort: update URL with history.replaceState, re-sort cached results ─
    function applySort(items: typeof cachedResults, sort: string): typeof cachedResults {
      switch (sort) {
        case 'recent':
          // Already returned newest-first from search API; stable sort preserved
          return items
        case 'popular':
          // Popular sort requires server data not available in search results.
          // Fall back to relevance order (items returned as-is).
          return items
        case 'trending':
          // Same — fall back to relevance order.
          return items
        default:
          return items // relevance — returned as-is
      }
    }

    function renderResults(items: typeof cachedResults) {
      if (!items.length) {
        results.innerHTML = `<p class="empty">no results.</p>`
        return
      }
      results.innerHTML = items.map(pkg => `
        <label class="pkg-checkbox-label">
          <input type="checkbox" class="pkg-checkbox" value="${esc(pkg.name)}" />
        </label>
        <a class="sr-card" href="/packages/${esc(pkg.name)}">
          <div>
            <span class="sr-name">${esc(pkg.name)}</span>
            ${pkg.description ? `<span class="sr-desc">${esc(pkg.description)}</span>` : ''}
          </div>
          <span class="sr-ver">v${esc(pkg.version)}</span>
        </a>
      `).join('')
    }

    // ── Sort chip click: history.replaceState + re-sort cached results ─────
    sortRow.querySelectorAll('.sort-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const newSort = (chip as HTMLButtonElement).dataset.sort ?? 'relevance'
        if (newSort === activeSort) return
        activeSort = newSort
        activateSortChip(activeSort)

        // Update URL without reload
        const params = new URLSearchParams(location.search)
        if (newSort === 'relevance') params.delete('sort')
        else params.set('sort', newSort)
        history.replaceState(null, '', `${location.pathname}${params.toString() ? '?' + params.toString() : ''}`)

        // Re-sort and re-render cached results
        if (cachedResults.length) {
          renderResults(applySort(cachedResults, activeSort))
        }
      })
    })

    // ── Search input ──────────────────────────────────────────────────────
    let debounce: ReturnType<typeof setTimeout>

    input.addEventListener('input', () => {
      clearTimeout(debounce)
      const q = input.value.trim()

      if (!q) {
        results.classList.remove('visible')
        results.innerHTML = ''
        defaultContent.style.display = ''
        cachedResults = []
        return
      }

      debounce = setTimeout(async () => {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
        const data = await res.json() as typeof cachedResults

        defaultContent.style.display = 'none'
        results.classList.add('visible')
        cachedResults = data

        if (!data.length) {
          results.innerHTML = `<p class="empty">no results for "${esc(q)}".</p>`
          return
        }

        // Apply active sort to fresh results
        renderResults(applySort(data, activeSort))
      }, 300)
    })

    // ── Compare bar ──────────────────────────────────────────────────────
    const compareBar = document.getElementById('compare-bar') as HTMLDivElement
    const compareBarText = document.getElementById('compare-bar-text') as HTMLSpanElement
    const compareViewBtn = document.getElementById('compare-view-btn') as HTMLButtonElement
    const compareClearBtn = document.getElementById('compare-clear-btn') as HTMLButtonElement

    let selectedPackages = new Set<string>()

    function updateCompareBar() {
      const count = selectedPackages.size
      if (count >= 2) {
        compareBarText.textContent = `Compare (${count} packages)`
        compareBar.classList.add('visible')
      } else {
        compareBar.classList.remove('visible')
      }
    }

    function wireCheckboxes() {
      document.querySelectorAll('.pkg-checkbox').forEach(cb => {
        cb.removeEventListener('change', handleCheckboxChange)
        cb.addEventListener('change', handleCheckboxChange)
      })
    }

    function handleCheckboxChange() {
      const cb = arguments[0].target as HTMLInputElement
      if (cb.checked) {
        selectedPackages.add(cb.value)
      } else {
        selectedPackages.delete(cb.value)
      }
      updateCompareBar()
    }

    // Wire checkboxes when results are rendered
    wireCheckboxes()

    compareClearBtn.addEventListener('click', () => {
      selectedPackages.clear()
      document.querySelectorAll('.pkg-checkbox').forEach(cb => {
        (cb as HTMLInputElement).checked = false
      })
      updateCompareBar()
    })

    compareViewBtn.addEventListener('click', () => {
      if (selectedPackages.size >= 2) {
        ;(window as any).openComparePanel?.()
      }
    })
```

Add the compare bar HTML before `</footer>`:

```astro
  <div class="compare-bar" id="compare-bar">
    <span class="compare-bar-text" id="compare-bar-text">Compare (0 packages)</span>
    <div class="compare-bar-actions">
      <button class="compare-view-btn" id="compare-view-btn">View Compare</button>
      <button class="compare-clear-btn" id="compare-clear-btn">×</button>
    </div>
  </div>

  <footer>
```

Add compare bar CSS (in the `<style>` block):

```css
    /* Compare bar */
    .compare-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: var(--surface);
      border-top: 1px solid var(--border);
      padding: 0.875rem 2rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      z-index: 150;
      box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.2);
      transform: translateY(100%);
      transition: transform 200ms ease-out;
    }
    .compare-bar.visible { transform: translateY(0); }
    .compare-bar-text {
      font-family: var(--font-mono);
      font-size: 0.875rem;
      color: var(--text);
    }
    .compare-bar-actions { display: flex; align-items: center; gap: 0.75rem; }
    .compare-view-btn {
      font-family: var(--font-mono);
      font-size: 0.875rem;
      padding: 0.5rem 1.25rem;
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 500;
      transition: opacity 0.15s;
    }
    .compare-view-btn:hover { opacity: 0.85; }
    .compare-clear-btn {
      font-family: var(--font-mono);
      font-size: 0.875rem;
      background: none;
      border: none;
      color: var(--muted);
      cursor: pointer;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      transition: color 0.15s;
    }
    .compare-clear-btn:hover { color: var(--text); }

    /* Package card checkbox */
    .pkg-checkbox-label {
      display: none;
      cursor: pointer;
      flex-shrink: 0;
      margin-right: 0.25rem;
      align-items: center;
    }
    @media (hover: hover) {
      .sr-card:hover .pkg-checkbox-label { display: flex; }
    }
    @media (hover: none), (max-width: 768px) {
      .pkg-checkbox-label { display: flex; }
    }
    .pkg-checkbox {
      width: 16px;
      height: 16px;
      accent-color: var(--accent);
      cursor: pointer;
    }
    .sr-card {
      display: flex;
      align-items: center;
    }
```

**Verification:**
```bash
cd /Users/justi/dev/lectern && npx astro check src/pages/index.astro 2>&1 | tail -10
# Expected: no errors
```

---

## Chunk 5: Search Filters — Sort Chips on `packages/index.astro`

### Task 8: Replace sort `<select>` with sort chips in `src/pages/packages/index.astro`

**Files:**
- Modify: `src/pages/packages/index.astro`

Replace the `<div class="sort-bar">` section with sort chips:

```astro
  <div class="sort-chips" id="sort-chips">
    <button class="sort-chip active" data-sort="recent">recent</button>
    <button class="sort-chip" data-sort="popular">popular</button>
    <button class="sort-chip" data-sort="stars">stars</button>
  </div>
```

Add CSS for the sort chips (in the `<style>` block, replacing the old `.sort-select` styles that can be removed):

```css
    .sort-chips {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-bottom: 1rem;
    }
    .sort-chip {
      font-family: var(--font-mono);
      font-size: 0.8rem;
      padding: 0.25rem 0.6rem;
      border-radius: 6px;
      border: 1px solid var(--border);
      color: var(--muted);
      cursor: pointer;
      background: none;
      transition: border-color 0.15s, color 0.15s, background 0.15s;
    }
    .sort-chip:hover {
      border-color: var(--accent);
      color: var(--text);
    }
    .sort-chip.active {
      border-color: var(--accent);
      color: var(--accent);
      background: rgba(139, 92, 246, 0.08);
    }
    .pkg-checkbox-label {
      display: none;
      cursor: pointer;
      flex-shrink: 0;
      margin-right: 0.25rem;
      align-items: center;
    }
    @media (hover: hover) {
      .pkg-card:hover .pkg-checkbox-label { display: flex; }
    }
    @media (hover: none), (max-width: 768px) {
      .pkg-checkbox-label { display: flex; }
    }
    .pkg-checkbox {
      width: 16px;
      height: 16px;
      accent-color: var(--accent);
      cursor: pointer;
    }
    .pkg-card { display: flex; align-items: center; }
```

Replace the `<script>` block with the complete implementation:

```javascript
    const input = document.getElementById('search-input') as HTMLInputElement
    const sortChips = document.getElementById('sort-chips') as HTMLDivElement
    const list = document.getElementById('pkg-list') as HTMLDivElement

    const url = new URL(location.href)
    let activeSort = url.searchParams.get('sort') ?? 'recent'
    let cachedResults: Array<{ name: string; version: string; description: string | null }> = []

    function esc(s: string): string {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    }

    // ── Sort chip activation ───────────────────────────────────────────────
    function activateSortChip(sort: string) {
      sortChips.querySelectorAll('.sort-chip').forEach(c => c.classList.remove('active'))
      sortChips.querySelector(`[data-sort="${sort}"]`)?.classList.add('active')
    }
    activateSortChip(activeSort)

    // ── Sort chip click: navigate to sorted URL ─────────────────────────
    sortChips.querySelectorAll('.sort-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const newSort = (chip as HTMLButtonElement).dataset.sort ?? 'recent'
        if (newSort === activeSort) return
        activeSort = newSort
        activateSortChip(newSort)
        const params = new URLSearchParams(location.search)
        params.set('page', '1')
        if (newSort === 'recent') params.delete('sort')
        else params.set('sort', newSort)
        location.href = `/packages?${params.toString()}`
      })
    })

    // ── Compare bar ───────────────────────────────────────────────────────
    const compareBar = document.getElementById('compare-bar') as HTMLDivElement
    const compareBarText = document.getElementById('compare-bar-text') as HTMLSpanElement
    const compareViewBtn = document.getElementById('compare-view-btn') as HTMLButtonElement
    const compareClearBtn = document.getElementById('compare-clear-btn') as HTMLButtonElement

    let selectedPackages = new Set<string>()

    function updateCompareBar() {
      const count = selectedPackages.size
      if (count >= 2) {
        compareBarText.textContent = `Compare (${count} packages)`
        compareBar.classList.add('visible')
      } else {
        compareBar.classList.remove('visible')
      }
    }

    function handleCheckboxChange(e: Event) {
      const cb = e.target as HTMLInputElement
      if (cb.checked) selectedPackages.add(cb.value)
      else selectedPackages.delete(cb.value)
      updateCompareBar()
    }

    document.querySelectorAll('.pkg-checkbox').forEach(cb => {
      cb.addEventListener('change', handleCheckboxChange)
    })

    compareClearBtn.addEventListener('click', () => {
      selectedPackages.clear()
      document.querySelectorAll('.pkg-checkbox').forEach(cb => {
        (cb as HTMLInputElement).checked = false
      })
      updateCompareBar()
    })

    compareViewBtn.addEventListener('click', () => {
      if (selectedPackages.size >= 2) {
        ;(window as any).openComparePanel?.()
      }
    })

    // ── Search input ───────────────────────────────────────────────────────
    const initialHtml = list.innerHTML
    let debounce: ReturnType<typeof setTimeout>

    input.addEventListener('input', () => {
      clearTimeout(debounce)
      const q = input.value.trim()

      if (!q) {
        list.innerHTML = initialHtml
        cachedResults = []
        // Re-wire checkboxes on reset
        document.querySelectorAll('.pkg-checkbox').forEach(cb => {
          cb.removeEventListener('change', handleCheckboxChange)
          cb.addEventListener('change', handleCheckboxChange)
        })
        return
      }

      debounce = setTimeout(async () => {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
        const results = await res.json() as typeof cachedResults
        cachedResults = results

        if (!results.length) {
          list.innerHTML = `<p class="empty">no results.</p>`
          return
        }

        list.innerHTML = results.map(pkg => `
          <label class="pkg-checkbox-label">
            <input type="checkbox" class="pkg-checkbox" value="${esc(pkg.name)}" />
          </label>
          <a class="pkg-card" href="/packages/${esc(pkg.name)}" style="flex:1;">
            <div class="pkg-left">
              <span class="pkg-name">${esc(pkg.name)}</span>
              ${pkg.description ? `<span class="pkg-description">${esc(pkg.description)}</span>` : ''}
            </div>
            <div class="pkg-right">
              <div class="pkg-ver">v${esc(pkg.version)}</div>
            </div>
          </a>
        `).join('')

        // Wire checkboxes on newly rendered cards
        document.querySelectorAll('.pkg-checkbox').forEach(cb => {
          cb.addEventListener('change', handleCheckboxChange)
        })
      }, 300)
    })
```

Add compare bar HTML and CSS (same as Task 7).

**Verification:**
```bash
cd /Users/justi/dev/lectern && npx astro check src/pages/packages/index.astro 2>&1 | tail -10
# Expected: no errors
```

---

## Chunk 6: Compare Panel — `ComparePanel.astro` and `PackageCardCheckbox.astro`

### Task 9: Create `src/components/ComparePanel.astro`

**Files:**
- Create: `src/components/ComparePanel.astro`

```astro
---
// ComparePanel.astro — slide-in side-by-side package comparison panel
export interface ComparePackage {
  name: string
  version: string
  description: string | null
  tags: string[]
  download_count: number
  popularity_score: number
  author: string | null
  published_at: string
  dependencies: Record<string, string>
  license: string | null
}

interface Props {
  packages: ComparePackage[]
}

const { packages } = Astro.props
---

<div id="compare-panel" class="compare-panel" role="dialog" aria-modal="true" aria-label="Compare packages" hidden>
  <div class="panel-backdrop" id="panel-backdrop"></div>
  <div class="panel-content">
    <div class="panel-header">
      <span class="panel-title">compare packages</span>
      <button class="panel-close" id="panel-close" aria-label="Close panel">×</button>
    </div>
    <div class="panel-table-wrap">
      <table class="compare-table">
        <thead>
          <tr>
            <th class="compare-label"></th>
            {packages.map(pkg => (
              <th class="compare-pkg-name">
                <a href={`/packages/${pkg.name}`}>{pkg.name}</a>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr><td class="compare-label">version</td>     {packages.map(pkg => <td>{pkg.version}</td>)}</tr>
          <tr><td class="compare-label">description</td> {packages.map(pkg => <td>{pkg.description ?? '—'}</td>)}</tr>
          <tr>
            <td class="compare-label">tags</td>
            {packages.map(pkg => (
              <td>
                {pkg.tags.length > 0
                  ? pkg.tags.map(t => <span class="compare-tag">{t}</span>)
                  : '—'}
              </td>
            ))}
          </tr>
          <tr><td class="compare-label">downloads</td>  {packages.map(pkg => <td>{pkg.download_count.toLocaleString()}</td>)}</tr>
          <tr><td class="compare-label">popularity</td> {packages.map(pkg => <td>{pkg.popularity_score.toFixed(1)}</td>)}</tr>
          <tr><td class="compare-label">author</td>     {packages.map(pkg => <td>{pkg.author ?? '—'}</td>)}</tr>
          <tr><td class="compare-label">published</td>  {packages.map(pkg => <td>{new Date(pkg.published_at).toLocaleDateString()}</td>)}</tr>
          <tr>
            <td class="compare-label">deps</td>
            {packages.map(pkg => (
              <td>
                {Object.keys(pkg.dependencies).length > 0
                  ? Object.entries(pkg.dependencies).map(([k, v]) => `${k} ${v}`).join(', ')
                  : 'none'}
              </td>
            ))}
          </tr>
          <tr><td class="compare-label">license</td>   {packages.map(pkg => <td>{pkg.license ?? '—'}</td>)}</tr>
        </tbody>
      </table>
    </div>
    {packages.length === 2 && (
      <div class="diff-hint">
        <a href={`/packages/${packages[0].name}/diff`}>Diff versions of {packages[0].name} →</a>
        <span style="color: var(--muted); font-size: 0.8rem; margin-left: 0.5rem">(single-package version diffs)</span>
      </div>
    )}
  </div>
</div>

<style>
  .compare-panel {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    justify-content: flex-end;
  }
  .compare-panel[hidden] { display: none; }

  .panel-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    cursor: pointer;
  }

  .panel-content {
    position: relative;
    width: 480px;
    max-width: 100vw;
    height: 100%;
    background: var(--bg);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: slideIn 200ms ease-out;
  }

  @keyframes slideIn {
    from { transform: translateX(100%); }
    to   { transform: translateX(0); }
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .panel-title {
    font-family: var(--font-mono);
    font-size: 0.875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text);
  }

  .panel-close {
    font-family: var(--font-mono);
    font-size: 1.25rem;
    color: var(--muted);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0 0.25rem;
    line-height: 1;
    transition: color 0.15s;
  }
  .panel-close:hover { color: var(--text); }

  .panel-table-wrap {
    flex: 1;
    overflow: auto;
    padding: 1rem 0;
  }

  .compare-table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }

  .compare-table th,
  .compare-table td {
    padding: 0.6rem 1rem;
    text-align: left;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }

  .compare-label {
    color: var(--muted);
    width: 100px;
    flex-shrink: 0;
  }

  .compare-pkg-name {
    font-weight: 600;
    color: var(--accent);
  }
  .compare-pkg-name a { color: inherit; text-decoration: none; }
  .compare-pkg-name a:hover { text-decoration: underline; }

  .compare-tag {
    display: inline-block;
    font-size: 0.7rem;
    padding: 0.1rem 0.4rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--muted);
    margin-right: 0.25rem;
    margin-bottom: 0.2rem;
  }

  .diff-hint {
    padding: 1rem 1.25rem;
    border-top: 1px solid var(--border);
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }
  .diff-hint a { color: var(--accent); text-decoration: none; }
  .diff-hint a:hover { text-decoration: underline; }

  @media (max-width: 600px) {
    .panel-content { width: 100vw; }
  }
</style>

<script>
  const panel = document.getElementById('compare-panel')
  const backdrop = document.getElementById('panel-backdrop')
  const closeBtn = document.getElementById('panel-close')

  function openPanel() {
    panel?.removeAttribute('hidden')
    document.body.style.overflow = 'hidden'
  }

  function closePanel() {
    panel?.setAttribute('hidden', '')
    document.body.style.overflow = ''
  }

  backdrop?.addEventListener('click', closePanel)
  closeBtn?.addEventListener('click', closePanel)
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel() })

  ;(window as any).openComparePanel = openPanel
</script>
```

**Verification:**
```bash
cd /Users/justi/dev/lectern && npx astro check src/components/ComparePanel.astro 2>&1 | tail -5
# Expected: no errors
```

---

### Task 10: Create `src/components/PackageCardCheckbox.astro`

**Files:**
- Create: `src/components/PackageCardCheckbox.astro`

```astro
---
// PackageCardCheckbox.astro — checkbox wrapper for package cards
interface Props {
  packageName: string
}

const { packageName } = Astro.props
---

<label class="pkg-checkbox-label" data-package={packageName}>
  <input
    type="checkbox"
    class="pkg-checkbox"
    value={packageName}
    aria-label={`Select ${packageName} for comparison`}
  />
</label>

<style>
  .pkg-checkbox-label {
    display: none;
    cursor: pointer;
    flex-shrink: 0;
    margin-right: 0.25rem;
    align-items: center;
  }
  @media (hover: hover) {
    .sr-card:hover .pkg-checkbox-label,
    .pkg-card:hover .pkg-checkbox-label {
      display: flex;
    }
  }
  @media (hover: none), (max-width: 768px) {
    .pkg-checkbox-label { display: flex; }
  }
  .pkg-checkbox {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
    cursor: pointer;
  }
</style>
```

**Verification:**
```bash
cd /Users/justi/dev/lectern && npx astro check src/components/PackageCardCheckbox.astro 2>&1 | tail -5
# Expected: no errors
```

---

## Chunk 7: Diff Page — Version Checkboxes for Compare Navigation

### Task 11: Add checkboxes to version rows in `src/pages/packages/[name]/diff.astro`

**Files:**
- Modify: `src/pages/packages/[name]/diff.astro`

Add CSS for diff compare bar (in `<style>` block):

```css
    .diff-compare-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: var(--surface);
      border-top: 1px solid var(--border);
      padding: 0.875rem 2rem;
      display: none;
      align-items: center;
      justify-content: space-between;
      z-index: 150;
      box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.2);
    }
    .diff-compare-bar.visible { display: flex; }
    .diff-compare-text {
      font-family: var(--font-mono);
      font-size: 0.875rem;
      color: var(--text);
    }
    .diff-compare-btn {
      font-family: var(--font-mono);
      font-size: 0.875rem;
      padding: 0.5rem 1.25rem;
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 500;
    }
    .diff-compare-btn:hover { opacity: 0.85; }
```

Add compare bar HTML before the `<script>` tag:

```html
  <div class="diff-compare-bar" id="diff-compare-bar">
    <span class="diff-compare-text" id="diff-compare-text">Select 2 versions to compare</span>
    <button class="diff-compare-btn" id="diff-compare-btn">Compare versions</button>
  </div>
```

In the version selectors area, add a checkbox to each `<select>` group's label row:

```html
    <div class="selector-group">
      <input type="checkbox" class="version-checkbox" value={v.version}
        style="accent-color: var(--accent); cursor: pointer;" />
      <span class="selector-label">v1</span>
      <select class="version-select" id="v1-select">
```

(Repeat for the v2 selector group — the checkbox value attribute must be the version string, not `v.version`.)

Add the diff compare script inside the existing `<script>` block (before the closing `</script>`):

```javascript
    // ── Diff page: version checkboxes for compare ───────────────────────
    const diffCompareBar = document.getElementById('diff-compare-bar')
    const diffCompareText = document.getElementById('diff-compare-text')
    const diffCompareBtn = document.getElementById('diff-compare-btn')
    const versionCheckboxes = document.querySelectorAll<HTMLInputElement>('.version-checkbox')

    let selectedDiffVersions: string[] = []

    function updateDiffCompareBar() {
      if (selectedDiffVersions.length === 2) {
        // Sort so older version is first
        const sorted = [...selectedDiffVersions].sort((a, b) => {
          const parseV = (v: string) => v.split('.').map(n => parseInt(n, 10) || 0)
          const aParts = parseV(a)
          const bParts = parseV(b)
          for (let i = 0; i < 3; i++) {
            if (aParts[i] !== bParts[i]) return aParts[i] - bParts[i]
          }
          return 0
        })
        diffCompareText.textContent = `Comparing v${sorted[0]} → v${sorted[1]}`
        diffCompareBar?.classList.add('visible')
      } else {
        diffCompareBar?.classList.remove('visible')
      }
    }

    versionCheckboxes.forEach(cb => {
      cb.addEventListener('change', () => {
        const value = cb.value
        if (cb.checked) {
          if (selectedDiffVersions.length >= 2) {
            const oldest = selectedDiffVersions.shift()
            versionCheckboxes.forEach(other => {
              if (other.value === oldest) other.checked = false
            })
          }
          selectedDiffVersions.push(value)
        } else {
          selectedDiffVersions = selectedDiffVersions.filter(v => v !== value)
        }
        updateDiffCompareBar()
      })
    })

    diffCompareBtn?.addEventListener('click', () => {
      if (selectedDiffVersions.length === 2 && packageName) {
        const sorted = [...selectedDiffVersions].sort((a, b) => {
          const parseV = (v: string) => v.split('.').map(n => parseInt(n, 10) || 0)
          const aParts = parseV(a)
          const bParts = parseV(b)
          for (let i = 0; i < 3; i++) {
            if (aParts[i] !== bParts[i]) return aParts[i] - bParts[i]
          }
          return 0
        })
        window.location.href = `/packages/${packageName}/diff?v1=${encodeURIComponent(sorted[0])}&v2=${encodeURIComponent(sorted[1])}`
      }
    })
```

**Verification:**
```bash
cd /Users/justi/dev/lectern && npx astro check src/pages/packages/[name]/diff.astro 2>&1 | tail -5
# Expected: no errors
```

---

## Verification Summary

Run the following in sequence to validate the implementation:

```bash
# 1. TypeScript compile check
cd /Users/justi/dev/lectern
npx tsc --noEmit src/lib/db.ts src/pages/api/packages/[name]/similar.ts 2>&1

# 2. Unit tests
npx vitest run src/lib/db.test.ts src/pages/api/packages/[name]/similar.test.ts --reporter=verbose 2>&1 | tail -20

# 3. Astro type check
npx astro check 2>&1 | grep -E "(error|warning|✓|✗)" | head -30

# 4. Build
npx astro build 2>&1 | tail -10
```

**Expected outcome:** zero TypeScript errors, all unit tests pass, Astro type check clean, build succeeds with no errors.
