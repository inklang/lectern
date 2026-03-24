# Lectern — inklang Style Migration

**Date:** 2026-03-23
**Status:** Approved
**Source reference:** https://inklang.vercel.app

---

## Overview

Update the Lectern Astro site to match the visual style of inklang.vercel.app. Both sites already share a zinc-950 dark background and monospace accents; this migration tightens the match by adopting inklang's typography scale, centered hero layout, card components, and violet accent color.

No Astro logic, routing, or data-fetching code changes. All changes are CSS and markup structure only.

---

## Design Tokens (`Base.astro`)

| Token | Current | New | Notes |
|---|---|---|---|
| `--bg` | `#09090b` | `#09090b` | unchanged |
| `--surface` | `#18181b` | `#18181b` | unchanged |
| `--border` | `#27272a` | `#3f3f46` | zinc-700, matches inklang card borders |
| `--text` | `#fafafa` | `#fafafa` | unchanged |
| `--muted` | `#71717a` | `#a1a1aa` | zinc-400, slightly lighter |
| `--muted-2` | `#52525b` | `#71717a` | zinc-500 |
| `--accent` | _(none)_ | `#8b5cf6` | violet-500, new — append after `--muted-2` |

Font stacks (`--font-sans`, `--font-mono`) are unchanged.

---

## Base Layout (`Base.astro`)

### `<main>` container
- `max-width`: `780px` → `860px`
- `padding`: `2.5rem 2rem` → `4rem 2rem`

### Header / nav
- Wordmark font-size: `0.95rem` → `1rem`; keep font-mono, weight 600
- Nav link font-size stays `0.875rem`; add `letter-spacing: 0.01em`
- Gap between wordmark and nav: `2rem` → `1.5rem`
- Login button `border-radius`: `6px` → `8px`; on hover, `border-color: var(--accent)` instead of `var(--muted-2)`

### Footer
No changes needed; already matches inklang's minimal mono style.

---

## Homepage (`src/pages/index.astro`)

### Hero section
- `.hero`: add `display: flex; flex-direction: column; align-items: center; text-align: center`
- `h1` font-size: `2rem` → `3.5rem`; keep weight 600, letter-spacing `-0.04em`
- `.hero p` (subtitle) `max-width`: `480px` → `440px`; add `margin: 0 auto`; color stays `var(--muted)`
- `.install-box`: change `display: inline-flex` → `display: flex`; add `margin: 1.75rem auto 0` (auto left/right centers it as a block); keep other existing styles
- `.stats`: add `justify-content: center`; gap: `2.5rem` → `3rem`
- `.stat-num` font-size: `1.5rem` → `2rem`
- `.hero` padding-bottom: `3rem` → `4rem`; margin-bottom: `3rem` → `4rem`

### Package rows → cards (homepage `.pkg-row`)
Replace flat separator rows with rounded bordered cards:
- `.pkg-row`: add `background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 1rem 1.25rem; margin-bottom: 0.5rem`
- Remove existing `border-bottom: 1px solid var(--border)` separator from `.pkg-row`
- Hover: replace `opacity: 0.7` with `border-color: var(--accent); opacity: 1`
- Remove `.pkg-row:last-child { border-bottom: none }` rule (no longer needed)
- The `.pkg-list` `display: flex; flex-direction: column` stays

---

## Packages List Page (`src/pages/packages/index.astro`)

- Page `h1` font-size: `1.1rem` → `1.25rem`
- `.pkg-card`: same card treatment as homepage `.pkg-row` above — add `background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 1rem 1.25rem; margin-bottom: 0.5rem`; remove `border-bottom` separator; replace hover opacity with `border-color: var(--accent); opacity: 1`; remove `.pkg-card:last-child` rule
- `.page-btn.active`: `background: var(--accent); border-color: var(--accent); color: #fff` (replaces current white fill)
- `.page-btn:hover`: add `border-color: var(--accent)` (alongside existing `background: var(--surface); color: var(--text)`)

---

## Package Detail Page (`src/pages/packages/[name].astro`)

- `.badge.latest`: change `border-color` and `color` from `var(--text)` to `var(--accent)`
- `.version-tag` (latest badge): change `border: 1px solid var(--text); color: var(--text)` → `border: 1px solid var(--accent); color: var(--accent)`
- `.code-block` `border-radius`: `8px` → `10px`
- `.version-row` separator: no code change needed — the `--border` token update in `Base.astro` propagates automatically via `var(--border)`
- `.pkg-header` border-bottom: same, token update propagates automatically

---

## Login Page (`src/pages/login.astro`)

- Cards (`.card`, `.identity-box`, `.cli-note`): already have `border-radius: 10px` ✓; border color updates automatically via `--border` token — no code change needed in these selectors
- Primary `.btn`: change `background: var(--text); color: var(--bg); border: 1px solid var(--border)` → `background: var(--accent); color: #fff; border-color: var(--accent)`
- `.btn:hover`: change `opacity: 0.85` → `opacity: 0.9`
- `.btn-outline` hover: add a new `.btn-outline:hover` rule — `border-color: var(--accent); color: var(--accent); opacity: 1` (the `opacity: 1` override prevents the inherited `.btn:hover` opacity from dimming the color change)

---

## Files Changed

1. `src/layouts/Base.astro` — tokens, nav, main sizing
2. `src/pages/index.astro` — hero centering + scale, package row cards
3. `src/pages/packages/index.astro` — package cards, pagination accent
4. `src/pages/packages/[name].astro` — accent badges, consistent border radius
5. `src/pages/login.astro` — accent buttons, new `.btn-outline:hover` rule

---

## Out of Scope

- No changes to API routes, auth logic, or data layer
- No Tailwind CSS introduction
- No new pages or components
- No changes to public assets
