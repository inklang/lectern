import type { APIRoute } from 'astro'
import { versionExists } from '../../../../lib/db.js'
import { supabase } from '../../../../lib/supabase.js'

function shieldSvg(left: string, right: string, color = '#4f46e5', style = 'flat'): string {
  const widths = [left, right].map(s => Math.max(s.length * 6.5 + 16, s.length * 8 + 20))
  const w1 = widths[0], w2 = widths[1]
  const totalW = w1 + w2
  const radius = style === 'flat' ? 0 : 6
  const h = 20

  // pill shape
  const pill = (x: number, y: number, w: number, h: number, r: number, fill: string) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`
  const text = (x: number, y: number, s: string, fill: string, anchor: 'start' | 'middle' = 'start') =>
    `<text x="${x}" y="${y}" fill="${fill}" font-family="monospace" font-size="11" font-weight="600" dominant-baseline="central" text-anchor="${anchor}">${s}</text>`

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${h}" role="img" aria-label="${left} ${right}">
  ${pill(0, 0, w1 + w2, h, radius, '#4f46e5')}
  ${pill(0, 0, w1, h, radius, '#4f46e5')}
  ${pill(w1, 0, w2, h, radius, '#10b981')}
  ${text(8, h / 2, left, '#ffffff')}
  ${text(w1 + 8, h / 2, right, '#ffffff')}
</svg>`
}

// Resolve name (short or slug) to slug, returning null if not found
async function resolveSlug(name: string): Promise<{ slug: string; displayName: string } | null> {
  if (name.includes('/')) {
    // Already a slug
    const { data: pkg } = await supabase.from('packages').select('slug, display_name').eq('slug', name).single()
    return pkg ? { slug: pkg.slug, displayName: pkg.display_name ?? name.split('/').pop()! } : null
  }
  // Short name - look up slug
  const { data: pkg } = await supabase.from('packages').select('slug, display_name').eq('name', name).single()
  if (!pkg) return null
  return { slug: pkg.slug, displayName: pkg.display_name ?? name }
}

export const GET: APIRoute = async ({ params }) => {
  const { name, version } = params
  if (!name || !version) return new Response('Bad request', { status: 400 })

  // Decode version (URL-encoded)
  const decodedVersion = decodeURIComponent(version)

  // Resolve name to slug
  const resolved = await resolveSlug(name)
  if (!resolved) {
    return new Response('Not found', { status: 404 })
  }

  // Validate the version exists
  const exists = await versionExists(resolved.slug, decodedVersion)
  if (!exists) {
    return new Response('Not found', { status: 404 })
  }

  const svg = shieldSvg(resolved.displayName, `v${decodedVersion}`, '#4f46e5')

  return new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
