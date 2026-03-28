import type { APIRoute } from 'astro'
import { getPackageVersions, getPackageOwner } from '../../lib/db.js'
import sharp from 'sharp'

export const GET: APIRoute = async ({ url }) => {
  try {
    const pkg = url.searchParams.get('pkg')
    if (!pkg) {
      return new Response('Missing pkg parameter', { status: 400 })
    }

    const packageSlug = pkg

    const versions = await getPackageVersions(packageSlug)
    if (versions.length === 0) {
      return new Response('Package not found', { status: 404 })
    }

    const latest = versions[0]
    const owner = await getPackageOwner(packageSlug)

    const version = latest.version
    const author = owner?.name || owner?.username || 'Unknown'

    // Create a simple PNG using sharp - purple accent bar at bottom
    const width = 1200
    const height = 630

    // Create SVG with basic shapes (no font required for the icon)
    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect fill="#18181b" width="${width}" height="${height}"/>
        <rect fill="#18181b" x="40" y="40" width="1120" height="550" rx="16"/>
        <rect fill="#8b5cf6" x="0" y="620" width="1200" height="10"/>
        <rect fill="#8b5cf6" x="40" y="20" width="80" height="80" rx="12"/>
        <text x="140" y="85" font-family="Arial, sans-serif" font-size="48" font-weight="bold" fill="#fafafa">${escapeXml(packageSlug)}</text>
        <rect fill="#27272a" x="145" y="100" width="120" height="30" rx="6"/>
        <text x="155" y="122" font-family="Arial, sans-serif" font-size="16" fill="#a1a1aa">v${escapeXml(version)}</text>
      </svg>
    `

    // Convert SVG to PNG
    const png = await sharp(Buffer.from(svg)).png().toBuffer()

    return new Response(png, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (error) {
    console.error('OG image error:', error)
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}