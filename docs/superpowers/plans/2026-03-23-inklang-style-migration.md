# Inklang Style Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the Lectern Astro site's visual style to match inklang.vercel.app — adopting its typography scale, centered hero, card components, and violet accent color.

**Architecture:** Pure CSS/markup changes across five existing Astro files. No new files, no new dependencies, no logic changes. Shared design tokens live in `Base.astro`; per-page layout changes live in each page file.

**Tech Stack:** Astro 6, vanilla CSS custom properties, Node adapter (no Tailwind)

**Spec:** `docs/superpowers/specs/2026-03-23-lectern-inklang-style-design.md`

---

> **Note on testing:** This is a pure CSS/layout migration with no JavaScript logic changes. There are no unit tests to write. Verification steps are visual — run `npm run dev` and inspect in a browser.

---

## Chunk 1: Base tokens, nav, and layout

---

### Task 1: Update design tokens in `Base.astro`

**Files:**
- Modify: `src/layouts/Base.astro` (`:root` block, lines 18–27)

- [ ] **Step 1: Update `:root` CSS variables**

In `src/layouts/Base.astro`, replace the `:root` block (currently lines 18–27) with:

```css
:root {
  --bg: #09090b;
  --surface: #18181b;
  --border: #3f3f46;
  --text: #fafafa;
  --muted: #a1a1aa;
  --muted-2: #71717a;
  --accent: #8b5cf6;
  --font-mono: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, monospace;
  --font-sans: ui-sans-serif, system-ui, -apple-system, sans-serif;
}
```

Changes: `--border` `#27272a`→`#3f3f46`, `--muted` `#71717a`→`#a1a1aa`, `--muted-2` `#52525b`→`#71717a`, new `--accent: #8b5cf6`.

- [ ] **Step 2: Verify dev server starts**

```bash
npm run dev
```

Expected: server starts without errors at `http://localhost:4321`. Open the homepage — overall dark look preserved, borders and muted text should appear slightly lighter.

- [ ] **Step 3: Commit**

```bash
git add src/layouts/Base.astro
git commit -m "style: update design tokens to match inklang zinc/violet palette"
```

---

### Task 2: Update nav and main container in `Base.astro`

**Files:**
- Modify: `src/layouts/Base.astro` (header, `.header-left`, `#login-btn`, `main` selectors)

- [ ] **Step 1: Update `.header-left` gap**

Find the `.header-left` rule (currently `gap: 2rem`) and change gap to `1.5rem`:

```css
.header-left {
  display: flex;
  align-items: center;
  gap: 1.5rem;
}
```

- [ ] **Step 2: Update wordmark font-size**

Find `header a.wordmark` and change `font-size: 0.95rem` → `font-size: 1rem`:

```css
header a.wordmark {
  font-family: var(--font-mono);
  font-size: 1rem;
  font-weight: 600;
  color: var(--text);
  text-decoration: none;
  letter-spacing: -0.02em;
}
```

- [ ] **Step 3: Update nav link letter-spacing**

Find `header nav a` and add `letter-spacing: 0.01em`:

```css
header nav a {
  font-size: 0.875rem;
  color: var(--muted);
  text-decoration: none;
  padding: 0.25rem 0.75rem;
  border-radius: 6px;
  transition: color 0.15s, background 0.15s;
  letter-spacing: 0.01em;
}
```

- [ ] **Step 4: Update login button radius and hover border**

Find `#login-btn` and change `border-radius: 6px` → `border-radius: 8px`. Find `#login-btn:hover` and change `border-color: var(--muted-2)` → `border-color: var(--accent)`:

```css
#login-btn {
  font-size: 0.8125rem;
  padding: 0.35rem 0.875rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font-family: var(--font-sans);
  text-decoration: none;
  transition: background 0.15s, border-color 0.15s;
}

#login-btn:hover {
  background: var(--surface);
  border-color: var(--accent);
}
```

- [ ] **Step 5: Update main container**

Find the `main` rule and change `max-width: 780px` → `max-width: 860px` and `padding: 2.5rem 2rem` → `padding: 4rem 2rem`:

```css
main {
  flex: 1;
  max-width: 860px;
  width: 100%;
  margin: 0 auto;
  padding: 4rem 2rem;
}
```

- [ ] **Step 6: Verify visually**

Reload `http://localhost:4321`. Check:
- Nav links spaced slightly closer to the wordmark
- Content area slightly wider with more top/bottom breathing room
- Login button has a violet border on hover

- [ ] **Step 7: Commit**

```bash
git add src/layouts/Base.astro
git commit -m "style: update nav spacing, main container, login button to match inklang"
```

---

## Chunk 2: Homepage hero and package cards

---

### Task 3: Center and scale the homepage hero

**Files:**
- Modify: `src/pages/index.astro` (`.hero`, `h1`, `.hero p`, `.install-box`, `.stats`, `.stat-num` CSS rules)

- [ ] **Step 1: Update `.hero` to centered flex column**

Find the `.hero` rule and replace with:

```css
.hero {
  padding-bottom: 4rem;
  margin-bottom: 4rem;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
```

- [ ] **Step 2: Scale up the h1**

Find `.hero h1` and change `font-size: 2rem` → `font-size: 3.5rem`:

```css
.hero h1 {
  font-family: var(--font-mono);
  font-size: 3.5rem;
  font-weight: 600;
  letter-spacing: -0.04em;
  margin-bottom: 0.75rem;
  line-height: 1.2;
}
```

- [ ] **Step 3: Update subtitle paragraph**

Find `.hero p` and change `max-width: 480px` → `max-width: 440px`, add `margin: 0 auto`:

```css
.hero p {
  color: var(--muted);
  font-size: 0.9375rem;
  max-width: 440px;
  line-height: 1.65;
  margin: 0 auto;
}
```

- [ ] **Step 4: Center the install box**

Find `.install-box` and change `display: inline-flex` → `display: flex`, add `margin: 1.75rem auto 0`:

```css
.install-box {
  margin: 1.75rem auto 0;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: var(--surface);
  border: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: 0.875rem;
  padding: 0.6rem 1rem;
  border-radius: 8px;
  color: var(--text);
}
```

- [ ] **Step 5: Center and space the stats row**

Find `.stats` and add `justify-content: center`, change `gap: 2.5rem` → `gap: 3rem`:

```css
.stats {
  display: flex;
  gap: 3rem;
  margin-top: 2rem;
  justify-content: center;
}
```

- [ ] **Step 6: Scale up stat numbers**

Find `.stat-num` and change `font-size: 1.5rem` → `font-size: 2rem`:

```css
.stat-num {
  font-family: var(--font-mono);
  font-size: 2rem;
  font-weight: 600;
  letter-spacing: -0.02em;
}
```

- [ ] **Step 7: Verify visually**

Reload `http://localhost:4321`. Check:
- Hero heading is large and centered
- Install box centered below heading
- Stats row centered with generous spacing

- [ ] **Step 8: Commit**

```bash
git add src/pages/index.astro
git commit -m "style: center and scale homepage hero to match inklang"
```

---

### Task 4: Convert homepage package rows to cards

**Files:**
- Modify: `src/pages/index.astro` (`.pkg-row`, `.pkg-row:hover`, `.pkg-row:last-child` rules)

- [ ] **Step 1: Replace `.pkg-row` with card style**

Find `.pkg-row` and replace entirely with:

```css
.pkg-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  margin-bottom: 0.5rem;
  text-decoration: none;
  color: var(--text);
  transition: border-color 0.15s;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
}
```

- [ ] **Step 2: Update hover state**

Find `.pkg-row:hover` and replace:

```css
.pkg-row:hover {
  border-color: var(--accent);
  opacity: 1;
}
```

- [ ] **Step 3: Remove the last-child rule**

Delete the `.pkg-row:last-child { border-bottom: none; }` rule entirely — it is no longer needed since cards use margin separation instead of borders.

- [ ] **Step 4: Verify visually**

Reload `http://localhost:4321`. Check:
- Package entries are now rounded cards with a subtle border
- Hovering a card highlights it with a violet border glow
- No separator line at the bottom of the last card

- [ ] **Step 5: Commit**

```bash
git add src/pages/index.astro
git commit -m "style: convert homepage package rows to inklang-style cards"
```

---

## Chunk 3: Packages list, package detail, and login pages

---

### Task 5: Update packages list page

**Files:**
- Modify: `src/pages/packages/index.astro` (`.page-header h1`, `.pkg-card`, `.pkg-card:hover`, `.pkg-card:last-child`, `.page-btn.active`, `.page-btn:hover`)

- [ ] **Step 1: Scale up the page heading**

Find `.page-header h1` and change `font-size: 1.1rem` → `font-size: 1.25rem`:

```css
.page-header h1 {
  font-family: var(--font-mono);
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.02em;
}
```

- [ ] **Step 2: Replace `.pkg-card` with card style**

Find `.pkg-card` and replace entirely with:

```css
.pkg-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  margin-bottom: 0.5rem;
  text-decoration: none;
  color: var(--text);
  gap: 1rem;
  transition: border-color 0.15s;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
}
```

- [ ] **Step 3: Update `.pkg-card:hover`**

Find `.pkg-card:hover` and replace:

```css
.pkg-card:hover {
  border-color: var(--accent);
  opacity: 1;
}
```

- [ ] **Step 4: Remove `.pkg-card:last-child`**

Delete the `.pkg-card:last-child { border-bottom: none; }` rule entirely.

- [ ] **Step 5: Update pagination active button**

Find `.page-btn.active` and replace:

```css
.page-btn.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
```

- [ ] **Step 6: Update pagination hover**

Find `.page-btn:hover` and add `border-color: var(--accent)`:

```css
.page-btn:hover {
  background: var(--surface);
  color: var(--text);
  opacity: 1;
  border-color: var(--accent);
}
```

- [ ] **Step 7: Verify visually**

Navigate to `http://localhost:4321/packages`. Check:
- Package entries are rounded cards matching the homepage style
- Hovering shows violet border
- Page heading is slightly larger
- Active pagination button is violet (if there are multiple pages)

- [ ] **Step 8: Commit**

```bash
git add src/pages/packages/index.astro
git commit -m "style: update packages list page with inklang cards and violet pagination"
```

---

### Task 6: Update package detail page

**Files:**
- Modify: `src/pages/packages/[name].astro` (`.badge.latest`, `.version-tag`, `.code-block`)

- [ ] **Step 1: Update `.badge.latest` accent**

Find `.badge.latest` and change `border-color` and `color` from `var(--text)` to `var(--accent)`:

```css
.badge.latest {
  border-color: var(--accent);
  color: var(--accent);
}
```

- [ ] **Step 2: Update `.version-tag` accent**

Find `.version-tag` and change both `border` and `color` to use `--accent`:

```css
.version-tag {
  display: inline-block;
  font-size: 0.7rem;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  border: 1px solid var(--accent);
  color: var(--accent);
}
```

- [ ] **Step 3: Update `.code-block` border-radius**

Find `.code-block` and change `border-radius: 8px` → `border-radius: 10px`:

```css
.code-block {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  background: var(--surface);
  border: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: 0.875rem;
  padding: 0.65rem 1rem;
  border-radius: 10px;
  color: var(--text);
}
```

- [ ] **Step 4: Verify visually**

Navigate to `http://localhost:4321/packages/ink.mobs` (or any available package). Check:
- Latest version badge is violet
- "latest" tag next to a version is violet
- Install code block has slightly rounder corners

- [ ] **Step 5: Commit**

```bash
git add "src/pages/packages/[name].astro"
git commit -m "style: update package detail badges and code block to inklang accent"
```

---

### Task 7: Update login page buttons

**Files:**
- Modify: `src/pages/login.astro` (`.btn`, `.btn:hover`, add `.btn-outline:hover`)

- [ ] **Step 1: Update primary `.btn` to violet**

Find `.btn` and change background, color, and border:

```css
.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1.1rem;
  border-radius: 7px;
  font-size: 0.875rem;
  font-family: var(--font-sans);
  cursor: pointer;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #fff;
  font-weight: 500;
  transition: opacity 0.15s;
}
```

- [ ] **Step 2: Update `.btn:hover` opacity**

Find `.btn:hover` and change `opacity: 0.85` → `opacity: 0.9`:

```css
.btn:hover { opacity: 0.9; }
```

- [ ] **Step 3: Add `.btn-outline:hover` rule**

After the existing `.btn-outline` rule, add a new hover rule. The `opacity: 1` override prevents the inherited `.btn:hover` from dimming the color:

```css
.btn-outline:hover {
  border-color: var(--accent);
  color: var(--accent);
  opacity: 1;
}
```

- [ ] **Step 4: Verify visually**

Navigate to `http://localhost:4321/login`. Check:
- "generate & login" button is violet
- Hovering the "logout" outline button shows violet border and text
- No visual regressions on the identity card or CLI note card

- [ ] **Step 5: Commit**

```bash
git add src/pages/login.astro
git commit -m "style: update login page buttons to inklang violet accent"
```

---

## Final verification

- [ ] **Step 1: Full visual pass**

With `npm run dev` running, check all four pages:
1. `/` — centered hero, large heading, stat numbers, package cards with violet hover
2. `/packages` — package cards, violet pagination active state
3. `/packages/<name>` — violet version badges, rounded code block
4. `/login` — violet generate button, outline button hover effect

Confirm no regressions: text is readable, dark background intact, mono font on headings and code, footer unchanged.

- [ ] **Step 2: Build check**

```bash
npm run build
```

Expected: build completes with no errors.
