# Lectern Unified Platform Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the lectern package registry, web homepage (Next.js), and docs into a single Astro app with Starlight for docs.

**Architecture:** Astro SSR app (existing) + Starlight for `/docs/*` + unified Nav/Footer layout + migrated home page + placeholder routes for forum/blog.

**Tech Stack:** Astro 6, Starlight, Vercel adapter, existing Supabase auth

---

## File Inventory

| Action | Files |
|--------|-------|
| Install | `package.json` — add Starlight + expressive-code + MDX |
| Modify | `astro.config.mjs` — add Starlight integration |
| Create | `src/content/config.ts` — blog content collection only (docs managed by Starlight) |
| Create | `src/content/blog/.gitkeep` — marks blog collection directory |
| Create | `src/content/docs/` — migrate content from `~/dev/web/src/app/docs/` |
| Create | `src/pages/blog/[slug].astro` — blog post catch-all (placeholder) |
| Create | `src/pages/blog/index.astro` — blog index (placeholder) |
| Create | `src/pages/forum/index.astro` — forum placeholder |
| Create | `src/components/Nav.astro` — unified navigation (responsive, Supabase auth) |
| Create | `src/components/Footer.astro` — unified footer (with social links) |
| Modify | `src/layouts/Base.astro` — replace inline nav/footer with Nav + Footer components |
| Modify | `src/pages/index.astro` — redesign with hero + existing packages/activity |
| Modify | existing pages — update to use Base.astro with new nav |

---

## Chunk 1: Starlight Foundation

### Task 1: Install Starlight dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add Starlight and dependencies**

Run:
```bash
npm install @astrojs/starlight starlight-expressive-code @astrojs/mdx
```

Expected: Starlight and expressive-code installed, `package.json` updated.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add Starlight, expressive-code, and MDX integrations

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

---

### Task 2: Configure Starlight in astro.config.mjs

**Files:**
- Modify: `astro.config.mjs`

- [ ] **Step 1: Update astro.config.mjs to add Starlight**

Read `astro.config.mjs` first, then replace it with:

```js
// @ts-check
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'url';
import path from 'path';
import vercel from '@astrojs/vercel';
import starlight from '@astrojs/starlight';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: vercel(),
  integrations: [
    starlight({
      title: 'Ink',
      logo: {
        src: './src/assets/logo.svg',
        replacesPageTitle: false,
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/inklang/ink' },
      ],
      expressiveCode: {
        themes: ['github-dark-default', 'github-light-default'],
      },
      editLink: {
        baseUrl: 'https://github.com/inklang/lectern/edit/master/',
      },
      sidebar: [
        {
          label: 'Start',
          link: '/docs/start',
        },
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'docs/guides/overview' },
            { label: 'Installation', slug: 'docs/guides/installation' },
            { label: 'Quick Start', slug: 'docs/guides/quickstart' },
          ],
        },
        {
          label: 'Core Concepts',
          items: [
            { label: 'Project Structure', slug: 'docs/guides/project-structure' },
            { label: 'Configuration', slug: 'docs/guides/configuration' },
            { label: 'Routing', slug: 'docs/guides/routing' },
            { label: 'Components', slug: 'docs/guides/components' },
          ],
        },
        {
          label: 'Features',
          items: [
            { label: 'Content Management', slug: 'docs/guides/content' },
            { label: 'Styling', slug: 'docs/guides/styling' },
            { label: 'API Integration', slug: 'docs/guides/api' },
            { label: 'Deployment', slug: 'docs/guides/deployment' },
          ],
        },
        {
          label: 'Reference',
          link: '/docs/reference',
        },
      ],
    }),
  ],
  vite: {
    resolve: {
      alias: {
        '~': path.resolve(__dirname, 'src'),
      },
    },
  },
});
```

**Note:** The sidebar config above is a reasonable initial structure. It will be updated in Chunk 6 (Task 11, Step 2) once the actual Ink docs content is migrated from the web repo and its structure is known.

- [ ] **Step 2: Verify build still works**

Run:
```bash
npm run build 2>&1 | tail -30
```

Expected: Build completes without errors (Starlight routes are auto-generated).

- [ ] **Step 3: Commit**

```bash
git add astro.config.mjs
git commit -m "config: add Starlight integration for /docs/* routes

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

---

## Chunk 2: Unified Navigation & Layout

### Task 3: Create unified Nav component

**Files:**
- Create: `src/components/Nav.astro`

- [ ] **Step 1: Create Nav.astro**

```astro
---
import { createServerClient, parseCookieHeader } from '@supabase/ssr'

const supabase = createServerClient(
  import.meta.env.SUPABASE_URL ?? '',
  import.meta.env.SUPABASE_PUBLISHABLE_KEY ?? '',
  {
    cookies: {
      getAll() {
        return parseCookieHeader(Astro.request.headers.get('Cookie') ?? '')
      },
      setAll() {},
    },
  }
)

const { data: { session } } = await supabase.auth.getSession()
const avatar = session?.user.user_metadata?.avatar_url ?? null
const username = session?.user.user_metadata?.user_name ?? null

const { pathname } = Astro.url

const navLinks = [
  { href: '/', label: 'Home' },
  { href: '/docs', label: 'Docs' },
  { href: '/packages', label: 'Packages' },
  { href: '/blog', label: 'Blog' },
  { href: '/forum', label: 'Forum' },
]

function isActive(href: string) {
  if (href === '/') return pathname === '/'
  return pathname.startsWith(href)
}
---

<nav class="nav">
  <a href="/" class="wordmark">ink</a>
  <button class="hamburger" aria-label="Toggle menu" id="nav-toggle">
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect y="3" width="20" height="2" rx="1" fill="currentColor"/>
      <rect y="9" width="20" height="2" rx="1" fill="currentColor"/>
      <rect y="15" width="20" height="2" rx="1" fill="currentColor"/>
    </svg>
  </button>
  <div class="nav-links" id="nav-links">
    {navLinks.map(link => (
      <a
        href={link.href}
        class:list={['nav-link', { active: isActive(link.href) }]}
      >
        {link.label}
      </a>
    ))}
  </div>
  <div class="nav-right">
    {session ? (
      <a href="/profile" class="nav-avatar" title={username ?? 'profile'}>
        {avatar
          ? <img src={avatar} alt={username ?? 'avatar'} />
          : <span class="avatar-fallback">{(username ?? 'U')[0].toUpperCase()}</span>
        }
      </a>
    ) : (
      <a href="/login" class="nav-login">login</a>
    )}
  </div>
</nav>

<script>
  const toggle = document.getElementById('nav-toggle')
  const links = document.getElementById('nav-links')
  toggle?.addEventListener('click', () => {
    links?.classList.toggle('open')
  })
</script>

<style>
  .nav {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    padding: 0 2rem;
    height: 3.5rem;
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 10;
  }

  .wordmark {
    font-family: var(--font-mono);
    font-size: 1rem;
    font-weight: 600;
    color: var(--text);
    text-decoration: none;
    letter-spacing: -0.02em;
  }

  .hamburger {
    display: none;
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 0.25rem;
    border-radius: 4px;
  }

  .hamburger:hover {
    color: var(--text);
    background: var(--surface);
  }

  .nav-links {
    display: flex;
    gap: 0.25rem;
    flex: 1;
  }

  .nav-link {
    font-size: 0.875rem;
    color: var(--muted);
    text-decoration: none;
    padding: 0.25rem 0.75rem;
    border-radius: 6px;
    transition: color 0.15s, background 0.15s;
    letter-spacing: 0.01em;
  }

  .nav-link:hover {
    color: var(--text);
    background: var(--surface);
  }

  .nav-link.active {
    color: var(--text);
    background: var(--surface);
  }

  .nav-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .nav-login {
    font-size: 0.8125rem;
    padding: 0.35rem 0.875rem;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    text-decoration: none;
    transition: background 0.15s, border-color 0.15s;
  }

  .nav-login:hover {
    background: var(--surface);
    border-color: var(--accent);
  }

  .nav-avatar {
    display: flex;
    align-items: center;
    text-decoration: none;
    border-radius: 50%;
    border: 2px solid transparent;
    transition: border-color 0.15s;
  }

  .nav-avatar:hover {
    border-color: var(--accent);
  }

  .nav-avatar img {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    display: block;
  }

  .avatar-fallback {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    background: var(--surface);
    border: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    color: var(--muted);
  }

  @media (max-width: 768px) {
    .hamburger {
      display: flex;
    }

    .nav-links {
      display: none;
      position: absolute;
      top: 3.5rem;
      left: 0;
      right: 0;
      flex-direction: column;
      background: var(--bg);
      border-bottom: 1px solid var(--border);
      padding: 0.5rem 2rem 1rem;
      gap: 0;
    }

    .nav-links.open {
      display: flex;
    }

    .nav-link {
      padding: 0.5rem 0;
    }
  }
</style>
```

---

### Task 4: Create Footer component

**Files:**
- Create: `src/components/Footer.astro`

- [ ] **Step 1: Create Footer.astro**

```astro
---
const year = new Date().getFullYear()
---

<footer class="footer">
  <div class="footer-content">
    <div class="footer-section">
      <p class="footer-brand">ink</p>
      <p class="footer-tagline">A compiled scripting language for the modern VM.</p>
      <div class="footer-social">
        <a href="https://github.com/inklang/ink" target="_blank" rel="noopener" aria-label="GitHub">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
          </svg>
        </a>
        <a href="https://discord.gg/ink" target="_blank" rel="noopener" aria-label="Discord">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03z"/>
          </svg>
        </a>
      </div>
    </div>
    <div class="footer-section">
      <p class="footer-heading">Resources</p>
      <a href="/docs">Documentation</a>
      <a href="/packages">Packages</a>
      <a href="/blog">Blog</a>
      <a href="/forum">Forum</a>
    </div>
    <div class="footer-section">
      <p class="footer-heading">Community</p>
      <a href="https://github.com/inklang/ink" target="_blank" rel="noopener">GitHub</a>
      <a href="/activity">Activity</a>
    </div>
  </div>
  <div class="footer-bottom">
    <p>ink &copy; {year}</p>
  </div>
</footer>

<style>
  .footer {
    border-top: 1px solid var(--border);
    padding: 3rem 2rem 1.5rem;
    font-size: 0.875rem;
  }

  .footer-content {
    max-width: 860px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: 2fr 1fr 1fr;
    gap: 2rem;
    margin-bottom: 2rem;
  }

  .footer-brand {
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: 1rem;
    margin-bottom: 0.5rem;
  }

  .footer-tagline {
    color: var(--muted);
    max-width: 24ch;
    line-height: 1.5;
  }

  .footer-social {
    display: flex;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .footer-social a {
    color: var(--muted-2);
    transition: color 0.15s;
  }

  .footer-social a:hover {
    color: var(--text);
  }

  .footer-heading {
    color: var(--muted);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.75rem;
  }

  .footer-section a {
    display: block;
    color: var(--muted-2);
    text-decoration: none;
    margin-bottom: 0.5rem;
    transition: color 0.15s;
  }

  .footer-section a:hover {
    color: var(--text);
  }

  .footer-bottom {
    max-width: 860px;
    margin: 0 auto;
    padding-top: 1.5rem;
    border-top: 1px solid var(--border);
    color: var(--muted-2);
    font-family: var(--font-mono);
    font-size: 0.75rem;
  }

  @media (max-width: 640px) {
    .footer-content {
      grid-template-columns: 1fr 1fr;
    }

    .footer-section:first-child {
      grid-column: 1 / -1;
    }
  }
</style>
```

- [ ] **Step 2: Commit Nav and Footer**

```bash
git add src/components/Nav.astro src/components/Footer.astro
git commit -m "feat: add unified Nav and Footer components

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

---

### Task 5: Update Base.astro to use Nav + Footer

**Files:**
- Modify: `src/layouts/Base.astro`

- [ ] **Step 1: Read current Base.astro**

Read `src/layouts/Base.astro` in full before editing.

- [ ] **Step 2: Replace inline header/nav with Nav component, add Footer**

In `Base.astro`, replace the entire `<header>` block (which contains inline nav markup) with:

```astro
  <header class="site-header">
    <Nav>
      <a href="/login" slot="nav-right" class="nav-login">login</a>
    </Nav>
  </header>
```

Replace the existing inline `<style>` block's header/main/footer rules with:

```css
  .site-header {
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 10;
  }

  .site-footer {
    margin-top: auto;
  }

  main {
    flex: 1;
    width: 100%;
  }
```

The `<footer>` block (the plain `<footer>lectern — the ink package registry</footer>`) should be replaced with:

```astro
  <footer class="site-footer">
    <Footer />
  </footer>
```

Also remove the `<link rel="alternate" type="application/atom+xml"...>` line from `<head>` if it references "lectern" specifically — update the title template to use "ink" not "lectern".

**Note:** Remove all the old `header { ... }`, `header nav { ... }`, `.header-left { ... }`, `.header-right { ... }`, `.nav-login { ... }`, `.nav-avatar { ... }`, `main { ... }`, `footer { ... }` CSS rules since those are now handled by `Nav.astro` and `Footer.astro`.

- [ ] **Step 3: Commit**

```bash
git add src/layouts/Base.astro
git commit -m "refactor: extract Nav and Footer to separate components

Base.astro now uses the shared Nav.astro and Footer.astro components
instead of inline header/footer markup and styles.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

---

## Chunk 3: Migrate Home Page from Web Repo

### Task 6: Migrate home page content from Next.js web repo

**Files:**
- Create: `src/pages/index.astro` (replace existing)

The existing `src/pages/index.astro` has featured packages + activity feed. The web repo (`~/dev/web/src/app/page.tsx`) has a hero section with:
- Title: "ink"
- Subtitle: "A compiled scripting language for PaperMC servers."
- CTA buttons: "Get Started" → `/docs`, "Learn More" → `/docs/intro`
- Code preview showing Ink syntax

- [ ] **Step 1: Read the existing index.astro** (already exists at `src/pages/index.astro`)

- [ ] **Step 2: Redesign index.astro to include hero + merge existing content**

The new `index.astro` should have:

1. **Hero section** (from web repo) — title "ink", tagline, Get Started / Learn More buttons
2. **Featured packages** (existing — keep `FeaturedPackages` component)
3. **Activity feed link** (existing)

Keep using `Base.astro` layout. The hero goes above the existing featured packages section.

The hero code preview from web repo shows:
```tsx
<pre className="text-sm text-zinc-300">
  <code>{EXAMPLE_CODE}</code>
</pre>
```

Convert this to Astro. The `EXAMPLE_CODE` constant is:
```
import spawn_mob, Zombie from mobs;

mob Dragon {
    name: "Boss"
    health: 500
}

on event:player_death(player) {
    spawn_mob(Zombie, player.location)
}
```

Replace `src/pages/index.astro` with a new version that has:
- Hero section with "ink" title, tagline, two CTA buttons
- Code preview block with syntax-highlighted Ink code
- Featured packages section (existing)
- Activity section (existing)

Use the existing dark theme CSS variables from Base.astro. Keep the hero centered and impactful.

- [ ] **Step 3: Commit**

```bash
git add src/pages/index.astro
git commit -m "feat: redesign home page with hero section migrated from web repo

- Add hero with ink title, tagline, and CTA buttons
- Migrate code preview from Next.js web repo
- Keep existing featured packages and activity sections
- Use unified Nav/Footer from Base layout

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

---

## Chunk 4: Placeholder Routes for Forum and Blog

### Task 7: Create placeholder forum and blog routes

**Files:**
- Create: `src/pages/forum/index.astro`
- Create: `src/pages/blog/index.astro`
- Create: `src/pages/blog/[slug].astro`
- Create: `src/content/blog/.gitkeep` — empty marker for blog collection directory

- [ ] **Step 1: Create forum placeholder**

```astro
---
import Base from '~/layouts/Base.astro'
---

<Base title="Forum">
  <section class="placeholder-page">
    <h1>Forum</h1>
    <p>The Ink community forum is coming soon.</p>
    <p>In the meantime, join the discussion on <a href="https://github.com/inklang/ink/discussions" target="_blank" rel="noopener">GitHub Discussions</a>.</p>
  </section>
</Base>

<style>
  .placeholder-page {
    max-width: 40ch;
    margin: 0 auto;
    text-align: center;
    padding: 4rem 0;
  }

  h1 {
    font-size: 2rem;
    font-weight: 700;
    margin-bottom: 1rem;
  }

  p {
    color: var(--muted);
    margin-bottom: 1rem;
    line-height: 1.6;
  }

  a {
    color: var(--accent);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }
</style>
```

- [ ] **Step 2: Create blog index placeholder**

```astro
---
import Base from '~/layouts/Base.astro'
---

<Base title="Blog">
  <section class="placeholder-page">
    <h1>Blog</h1>
    <p>The Ink blog is coming soon. Stay tuned for updates, tutorials, and announcements.</p>
  </section>
</Base>

<style>
  .placeholder-page {
    max-width: 40ch;
    margin: 0 auto;
    text-align: center;
    padding: 4rem 0;
  }

  h1 {
    font-size: 2rem;
    font-weight: 700;
    margin-bottom: 1rem;
  }

  p {
    color: var(--muted);
    line-height: 1.6;
  }
</style>
```

- [ ] **Step 3: Create blog post catch-all (Phase 2 will replace this)**

```astro
---
import Base from '~/layouts/Base.astro'

const { slug } = Astro.params
---

<Base title="Blog Post">
  <section class="placeholder-page">
    <h1>Blog Post</h1>
    <p>Post <code>{slug}</code> will appear here when the blog is built in Phase 2.</p>
    <a href="/blog">← Back to blog</a>
  </section>
</Base>

<style>
  .placeholder-page {
    max-width: 40ch;
    margin: 0 auto;
    text-align: center;
    padding: 4rem 0;
  }

  h1 {
    font-size: 2rem;
    font-weight: 700;
    margin-bottom: 1rem;
  }

  p {
    color: var(--muted);
    margin-bottom: 1rem;
    line-height: 1.6;
  }

  a {
    color: var(--accent);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }

  code {
    font-family: var(--font-mono);
    background: var(--surface);
    padding: 0.1em 0.4em;
    border-radius: 4px;
    font-size: 0.875em;
  }
</style>
```

- [ ] **Step 4: Create content collection config for blog only**

**Important:** Do NOT define a `docs` collection here — Starlight auto-manages the `docs` collection from `src/content/docs/`. Defining a `docs` collection manually will conflict with Starlight's built-in behavior.

Create `src/content/config.ts`:

```ts
// @ts-check
import { defineCollection, z } from 'astro:content'

// Note: docs collection is managed automatically by Starlight.
// Do not define it here.

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    publishedAt: z.date().optional(),
  }),
})

export const collections = {
  blog,
}
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/forum/index.astro src/pages/blog/index.astro src/pages/blog/[slug].astro src/content/config.ts
git commit -m "feat: add placeholder routes for /forum and /blog

- /forum: placeholder page with link to GitHub Discussions
- /blog: placeholder index + catch-all [slug] page
- Blog content collection configured (docs managed by Starlight)
- Content collections configured for blog only (docs is Starlight-managed)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

---

## Chunk 5: Verify and Update Existing Pages

### Task 8: Update existing package pages to use Base.astro properly

**Files:**
- Modify: `src/pages/packages/index.astro`
- Modify: `src/pages/[user]/[...path].astro`

Check if these pages already use `Base.astro`. If they do, they should automatically get the new Nav + Footer. If they use a different layout, update them.

- [ ] **Step 1: Check which layout package pages use**

```bash
grep -l "layout" src/pages/packages/*.astro src/pages/[user]/*.astro 2>/dev/null
```

Run this and check the output. Then read each file to confirm it imports and uses `Base.astro`.

- [ ] **Step 2: If a page uses a different layout or no layout, add Base.astro import and usage**

The pattern should be:

```astro
---
import Base from '~/layouts/Base.astro'
---
<Base title="Packages">
  <!-- existing content -->
</Base>
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/packages/ src/pages/[user]/
git commit -m "chore: update package pages to use Base.astro layout

Ensures all package pages use the unified Nav + Footer layout.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

---

### Task 9: Final build verification

- [ ] **Step 1: Run full build**

```bash
npm run build 2>&1
```

Expected: Build completes successfully with no errors. Starlight generates `/docs/*` routes, existing package routes work, placeholder routes work.

- [ ] **Step 2: Start dev server and verify pages**

```bash
npm run dev &
sleep 5
# Test these routes manually or with a quick curl:
curl -s http://localhost:4321/ | grep -c "<"
curl -s http://localhost:4321/docs | grep -c "<"
curl -s http://localhost:4321/packages | grep -c "<"
curl -s http://localhost:4321/forum | grep -c "<"
curl -s http://localhost:4321/blog | grep -c "<"
```

Expected: All routes return HTML content (count > 0).

- [ ] **Step 3: Kill dev server and commit any remaining changes**

```bash
# Kill the dev server
pkill -f "astro dev" 2>/dev/null || true
git add -A
git commit -m "chore: final verification - build passes and all routes respond

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

---

## Chunk 6: Docs Content Migration (from web repo)

**Note:** This chunk should be done AFTER confirming the Starlight build works in Chunk 1. The source content lives in `~/dev/web/src/app/docs/` (Next.js route components, not MDX). They need to be converted to Starlight-compatible MDX.

### Task 10: Investigate web repo docs structure

**Files:** None — investigation only

- [ ] **Step 1: Understand how web docs load content**

Run:
```bash
cat ~/dev/web/src/app/docs/[slug]/page.tsx
```

Expected: A Next.js page component. Note whether the content is:
- (a) Hardcoded JSX in the page file
- (b) Loaded from a separate content layer (markdown files, CMS, etc.)

- [ ] **Step 2: Read the docs index page**

Run:
```bash
cat ~/dev/web/src/app/docs/page.tsx
```

Expected: A docs landing/index page. This shows the entry points for the docs structure.

- [ ] **Step 3: Read the docs layout**

Run:
```bash
cat ~/dev/web/src/app/docs/layout.tsx
```

Expected: A shared layout for docs pages. This may show shared navigation, styling, or content loading logic used across all docs pages.

Based on the results of Steps 1-3, document:
1. The list of actual doc page slugs that exist (e.g. `intro`, `getting-started`, `language-reference`, etc.)
2. Whether content is hardcoded JSX or loaded from separate files
3. Any shared components or patterns used across docs pages

Save this as a comment block at the top of `src/content/docs/` as a README, or as inline notes — the next task depends on this investigation.

---

### Task 11: Migrate docs content to Starlight MDX

**Files:** (listing depends on investigation above — files below are the expected ones based on the web repo's docs index page linking to `intro`, `getting-started`, `language-reference`, `examples`)
- Create: `src/content/docs/intro.mdx`
- Create: `src/content/docs/getting-started.mdx`
- Create: `src/content/docs/language-reference.mdx`
- Create: `src/content/docs/examples.mdx`
- Additional docs as discovered in Task 10 investigation

**Prerequisite:** Task 10 must be completed first.

- [ ] **Step 1: Create each doc MDX file**

For each doc identified in Task 10:

Convert the content to Starlight MDX format:

```mdx
---
title: Introduction
description: What is ink and why use it?
---

# Introduction

[Converted content here]

{/* Remove any React-specific components (Link, Button, Card, etc.) and
    replace with standard Markdown or Starlight components */}
```

For any React components found:
- `<Link href="...">` → remove (Markdown links work automatically)
- `<Card>` → remove (use plain text or Starlight `Aside` if needed)
- `<Button>` → remove or convert to plain Markdown links
- Custom components → remove entirely unless they render content that needs preserving

Docusaurus-style admonitions (`:::note`, `:::tip`) are Starlight-compatible and can stay as-is.

- [ ] **Step 2: Update Starlight sidebar in astro.config.mjs**

Based on the actual doc pages found in Task 10, update the `sidebar` array in `astro.config.mjs`. The sidebar should reflect the actual Ink documentation structure. Example:

```js
sidebar: [
  {
    label: 'Start',
    items: [
      { label: 'Introduction', slug: 'docs/intro' },
    ],
  },
  {
    label: 'Getting Started',
    items: [
      { label: 'Getting Started', slug: 'docs/getting-started' },
    ],
  },
  // ... add entries for each actual doc page
  {
    label: 'Reference',
    items: [
      { label: 'Language Reference', slug: 'docs/language-reference' },
    ],
  },
],
```

- [ ] **Step 3: Commit docs migration**

```bash
git add src/content/docs/ astro.config.mjs
git commit -m "feat: migrate docs content from web repo to Starlight

Converted Next.js page components to Starlight MDX format.
Updated sidebar configuration to match actual Ink documentation structure.
Docs that were hardcoded JSX were converted to Markdown with frontmatter.
React-specific components (Link, Button, Card) were removed.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```
