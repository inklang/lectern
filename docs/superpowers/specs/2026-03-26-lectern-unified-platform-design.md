# Lectern Unified Platform Design

## Context & Goals

Lectern currently serves as the package registry frontend for the Ink programming language (package listings, Giscus comments on packages, activity feed). The Ink project has three separate repos:

- **lectern** — package registry frontend (this repo)
- **docs** — Docusaurus-based language documentation
- **web** — Ink homepage

These should be merged into a single Astro application, with Starlight handling docs. The goal is a unified platform at `inklang.org` covering:

- Home page
- Language documentation
- Package registry
- Forums (future)
- Blog (future)

## Design Principles

1. **One repo, one deployment** — everything under `lectern`, deployed together
2. **Starlight for docs** — proven docs solution, keeps us on Astro, minimal maintenance
3. **Minimal custom UI** — use Starlight's built-in components, only build custom UI where the existing package registry requires it
4. **Unified navigation** — single top nav across all sections, highlights active section
5. **Phased approach** — Phase 1 is docs migration + unified shell; forums and blog come later

## Architecture

### Framework: Astro + Starlight

Astro handles routing and page rendering. Starlight handles all `/docs/*` routes via content collections.

### Sections

| Section | Route | Implementation |
|---|---|---|
| Home | `/` | Redesigned `src/pages/index.astro` |
| Docs | `/docs/*` | Starlight content collection |
| Packages | `/packages/*` and `/[owner]/*` | Existing `src/pages/packages/`, `src/pages/[user]/` |
| Forum | `/forum/*` | Placeholder routes (Phase 3) |
| Blog | `/blog/*` | Placeholder routes (Phase 2) |
| Activity | `/activity` | Existing `src/pages/activity.astro` |
| Auth | `/login`, `/signup`, `/cli-auth`, `/mfa-verify` | Existing pages |
| API | `/api/*` | Existing API routes |

### URL Structure

- `inklang.org/` — home page
- `inklang.org/docs/*` — Starlight docs (migrated)
- `inklang.org/packages` — package listing
- `inklang.org/ink.mobs` — package page (`/[owner]/*`)
- `inklang.org/forum` — placeholder
- `inklang.org/blog` — placeholder
- `inklang.org/activity` — activity feed

## Directory Structure

```
lectern/src/
  content/
    docs/               # Starlight docs (migrated from Docusaurus)
      intro.md
      basics/
      getting-started/
      tutorial-basics/
      tutorial-extras/
  pages/
    index.astro        # Redesigned home page
    docs/              # Starlight pages (auto-generated)
    packages/          # Existing package listing pages
    [user]/            # Existing package user pages
    forum/             # Placeholder
    blog/              # Placeholder
    activity.astro     # Existing
    api/               # Existing API routes
    auth/              # Existing auth pages
  components/
    Nav.astro          # Unified navigation
    Footer.astro
    PackageCard.astro   # Existing, reused
    Giscus.astro       # Existing, reused
    ...existing components
  layouts/
    Base.astro         # Base layout with Nav + Footer
    ...existing layouts
```

## Migration Details

### Docusaurus → Starlight

1. Copy `docs/docs/*.md` → `src/content/docs/`
2. Copy `docs/blog/*.md` → `src/content/blog/` (Phase 2)
3. Convert `docs/sidebars.js` → `src/content/docs/sidebar.ts`
4. Convert `docs/docusaurus.config.js` options → `astro.config.mjs` Starlight config
5. Handle custom React components — most can be removed or replaced with Starlight equivalents
6. Move `web` homepage content → `src/pages/index.astro`

### Starlight Config

```js
// astro.config.mjs
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      title: 'Ink',
      logo: { src: './src/assets/logo.svg', replacesPageTitle: false },
      social: { github: '...', discord: '...' },
      sidebar: [
        // migrated from Docusaurus sidebars
      ],
      editLink: { baseUrl: '...' },
      // ... other options from docusaurus.config.js
    }),
  ],
});
```

### Content Migration

- Docusaurus frontmatter (`id`, `title`, `sidebar_label`) → Starlight frontmatter (`title`, `description`, `sidebar_label`)
- Docusaurus admonitions (`:::note`, `:::tip`) → Starlight/admonition syntax (compatible)
- Custom React components in MDX → remove or replace with `<Aside>`, `<Tabs>`, etc.
- Blog posts → Phase 2

### Unified Navigation

**Nav component** (`src/components/Nav.astro`):
- Links: Home, Docs, Packages, Forum (placeholder), Blog (placeholder)
- Highlights active section based on current URL
- Responsive (hamburger on mobile)
- Auth state: shows login/logout

**Footer component** (`src/components/Footer.astro`):
- Links grouped by section
- Social links
- Copyright

### Home Page Redesign

The existing `index.astro` has featured packages + activity feed. The redesign should:

- Serve as the main landing page for inklang.org
- Have a hero section introducing Ink
- Feature a prominent "Get Started" → `/docs/intro`
- Show featured packages (keep existing)
- Unified nav + footer

### Packages Section (Existing)

No structural changes for Phase 1. The existing pages under `src/pages/packages/` and `src/pages/[user]/` continue to work. They will be updated to use the new `Base.astro` layout with unified nav.

### What Stays As-Is

- All API routes in `src/pages/api/`
- Supabase integration and auth flow
- Package publishing flow
- Activity feed
- Giscus comments on packages
- Existing component library (PackageCard, Giscus, etc.)

## Open Questions

1. **Custom domain** — does `inklang.org` point to Vercel now, or is there a separate hosting setup?
2. **Vercel configuration** — will the Astro build handle all routes including Starlight's?
3. **Existing docs links** — are there external links to the old Docusaurus docs URLs that need redirects?
4. **Docs edit links** — does Docusaurus have edit on GitHub links configured? Those need to point to the new location.

## Scope for Phase 1

**In scope:**
- Merge Docusaurus docs into Starlight content collection
- Merge web repo home page into `index.astro`
- Add unified Nav + Footer
- Create `Base.astro` layout used by all pages
- Add placeholder routes for `/forum` and `/blog`
- Update existing package pages to use new layout
- Ensure all build/dev commands work

**Out of scope for Phase 1:**
- Building the actual forum
- Building the actual blog
- Full docs content review/update
- Package registry redesign
- Any auth changes

## File Inventory (Approximate)

| File/Dir | Action |
|---|---|
| `docs/` (Docusaurus repo) | Move content to `src/content/docs/` |
| `web/` repo home content | Move to `src/pages/index.astro` |
| `src/pages/index.astro` | Redesign as unified home |
| `src/pages/docs/` | Starlight auto-generates from content collection |
| `src/content/docs/` | Create, migrate Docusaurus MDX here |
| `src/components/Nav.astro` | Create new unified nav |
| `src/components/Footer.astro` | Create new unified footer |
| `src/layouts/Base.astro` | Create base layout with Nav/Footer |
| `astro.config.mjs` | Add Starlight integration |
| `package.json` | Add Starlight dependencies |
| `src/pages/forum/` | Create placeholder index |
| `src/pages/blog/` | Create placeholder index |
| Existing pages (packages, auth, activity) | Update to use Base.astro |
