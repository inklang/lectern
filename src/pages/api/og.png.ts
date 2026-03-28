import type { APIRoute } from 'astro'
import { getPackageVersions, getPackageOwner } from '../../lib/db.js'
import satori from 'satori'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

// Load bundled font from src directory (gets bundled with serverless function)
function loadFont(): ArrayBuffer | undefined {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const fontPaths = [
    path.join(__dirname, '../../fonts/DejaVuSans.ttf'),
    path.join(process.cwd(), 'src/fonts/DejaVuSans.ttf'),
  ]

  for (const fontPath of fontPaths) {
    try {
      const buffer = readFileSync(fontPath)
      // Return a copy of the buffer as ArrayBuffer
      return new Uint8Array(buffer).buffer.slice(0)
    } catch (e) {
      // Font not found, try next
      console.error('Failed to load font:', fontPath, e)
    }
  }
  return undefined
}

export const GET: APIRoute = async ({ url }) => {
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

  const title = packageSlug
  const description = latest.description?.slice(0, 150) || `${packageSlug} — an Ink package`
  const version = latest.version
  const author = owner?.name || owner?.username || 'Unknown'

  const fontData = loadFont()

  const fonts: Array<{ name: string; data: ArrayBuffer; weight: number; style: string }> = []
  if (fontData) {
    fonts.push({
      name: 'DejaVu Sans',
      data: fontData,
      weight: 400,
      style: 'normal',
    })
  }

  const element = {
    type: 'div',
    props: {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#09090b',
        padding: '40px',
      },
      children: {
        type: 'div',
        props: {
          style: {
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#18181b',
            borderRadius: '16px',
            border: '2px solid #3f3f46',
            flex: 1,
            padding: '40px',
          },
          children: [
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  marginBottom: '30px',
                },
                children: [
                  {
                    type: 'div',
                    props: {
                      style: {
                        width: '80px',
                        height: '80px',
                        backgroundColor: '#8b5cf6',
                        borderRadius: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '40px',
                        marginRight: '20px',
                      },
                      children: '⬡',
                    },
                  },
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        flexDirection: 'column',
                      },
                      children: [
                        {
                          type: 'div',
                          props: {
                            style: {
                              fontSize: '48px',
                              fontWeight: 600,
                              color: '#fafafa',
                            },
                            children: title,
                          },
                        },
                        {
                          type: 'div',
                          props: {
                            style: {
                              display: 'flex',
                              backgroundColor: '#27272a',
                              color: '#a1a1aa',
                              fontSize: '18px',
                              padding: '4px 12px',
                              borderRadius: '6px',
                              marginTop: '8px',
                            },
                            children: `v${version}`,
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
            {
              type: 'div',
              props: {
                style: {
                  fontSize: '28px',
                  color: '#a1a1aa',
                  marginBottom: '20px',
                },
                children: description,
              },
            },
            {
              type: 'div',
              props: {
                style: {
                  fontSize: '24px',
                  color: '#71717a',
                },
                children: `by ${author}`,
              },
            },
            {
              type: 'div',
              props: {
                style: {
                  fontSize: '20px',
                  color: '#52525b',
                  marginTop: 'auto',
                },
                children: 'lectern.inklang.org',
              },
            },
          ],
        },
      },
    },
  }

  let svg: string
  try {
    svg = await satori(element, {
      width: 1200,
      height: 630,
      fonts: fonts.length > 0 ? fonts : undefined,
    })
  } catch (e) {
    // Fallback if satori fails - try without fonts
    console.error('Satori error:', e)
    try {
      svg = await satori(element, {
        width: 1200,
        height: 630,
      })
    } catch (e2) {
      console.error('Satori fallback error:', e2)
      return new Response(`Image generation failed: ${e instanceof Error ? e.message : String(e)}`, { status: 500 })
    }
  }

  // Convert SVG to PNG using sharp
  const sharpModule = await import('sharp')
  const sharpInstance = sharpModule.default
  const pngBuffer = await sharpInstance(Buffer.from(svg)).png().toBuffer()

  return new Response(pngBuffer, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
