---
title: Migration Notes
description: Internal migration documentation
---

# Ink Docs Migration Notes

## Doc pages found (17 total)

`intro`, `getting-started`, `running-code`, `variables`, `data-types`, `operators`, `control-flow`, `functions`, `parameters`, `classes`, `inheritance`, `arrays`, `maps`, `examples`, `language-reference`, `stdlib`, `first-program`

## Content loading mechanism

Content is loaded from **separate MDX files** in `~/dev/web/src/content/docs/{slug}.mdx`:
- Uses `gray-matter` for frontmatter parsing
- Uses `react-markdown` + `rehype-highlight` for rendering
- A shared `DocRenderer` component (`src/components/doc-renderer.tsx`) handles all markdown rendering

## Shared patterns/components

- **Layout:** `src/app/docs/layout.tsx` — sidebar navigation with hardcoded links
- **Renderer:** `src/components/doc-renderer.tsx` — styled markdown with copy-code button
- **UI:** shadcn/ui components + lucide-react icons
- **Styling:** Tailwind CSS with `prose prose-invert prose-zinc`

## Migration considerations

- MDX files can be copied directly (but React components need removal/replacement)
- The `DocRenderer` component adds copy-code functionality — Starlight has this built-in via expressive-code
- React-markdown and gray-matter dependencies can be removed after migration
- Navigation inconsistency: sidebar shows 14 items but 17 MDX files exist — sidebar config needs to be updated to match all actual pages
- Frontmatter should be converted to Starlight format (title, description)
