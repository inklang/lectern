import type { APIRoute } from 'astro'
import sharp from 'sharp'

export const GET: APIRoute = async ({ url }) => {
  try {
    const pkg = url.searchParams.get('pkg')
    if (!pkg) {
      return new Response('Missing pkg parameter', { status: 400 })
    }

    // Create a simple purple rectangle PNG
    const png = await sharp({
      create: {
        width: 1200,
        height: 630,
        channels: 4,
        background: { r: 24, g: 24, b: 27, alpha: 1 }
      }
    })
    .png()
    .toBuffer()

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