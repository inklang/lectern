import type { APIRoute } from 'astro'
import { getPackageStats, versionExists } from '../../../../lib/db.js'

function shieldSvg(left: string, right: string, rightColor = '#10b981', style = 'flat'): string {
  const w1 = Math.max(left.length * 6.5 + 16, left.length * 8 + 20)
  const w2 = Math.max(right.length * 6.5 + 16, right.length * 8 + 20)
  const totalW = w1 + w2
  const radius = style === 'flat' ? 0 : 6
  const h = 20

  const pill = (x: number, y: number, w: number, fill: string) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}"/>`
  const text = (x: number, y: number, s: string, fill: string, anchor: 'start' | 'middle' = 'start') =>
    `<text x="${x}" y="${y}" fill="${fill}" font-family="monospace" font-size="11" font-weight="600" dominant-baseline="central" text-anchor="${anchor}">${s}</text>`

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${h}" role="img" aria-label="${left} ${right}">
  ${pill(0, '#4f46e5')}
  ${pill(w1, rightColor)}
  ${text(8, h / 2, left, '#ffffff')}
  ${text(w1 + 8, h / 2, right, '#ffffff')}
</svg>`
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export const GET: APIRoute = async ({ params, url }) => {
  const { name } = params
  if (!name) return new Response('Bad request', { status: 400 })

  const window = url.searchParams.get('window') ?? 'total'
  const color = url.searchParams.get('color') ?? '#10b981'

  let count: number
  try {
    const stats = await getPackageStats(name)
    if (window === '7d') count = stats.last7d
    else if (window === '30d') count = stats.last30d
    else count = stats.total
  } catch {
    count = 0
  }

  const label = window === 'total' ? 'downloads' : window === '7d' ? 'downloads/7d' : 'downloads/30d'
  const svg = shieldSvg(name, `${formatCount(count)} ${label.replace('/7d', '/wk').replace('/30d', '/mo')}`, color)

  return new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
