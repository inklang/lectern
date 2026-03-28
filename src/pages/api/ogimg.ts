import type { APIRoute } from 'astro'
import { getPackageVersions, getPackageOwner } from '../../lib/db.js'
import satori from 'satori'
import sharp from 'sharp'

// Use Inter from jsDelivr as TTF
const fontUrl = 'https://cdn.jsdelivr.net/npm/inter@3.19.0/packages/inter/ttf/Inter-Regular.ttf'
const fontBoldUrl = 'https://cdn.jsdelivr.net/npm/inter@3.19.0/packages/inter/ttf/Inter-Bold.ttf'

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

    const title = packageSlug
    const description = latest.description?.slice(0, 150) || `${packageSlug} — an Ink package`
    const version = latest.version
    const author = owner?.name || owner?.username || 'Unknown'

    // Fetch fonts
    const [fontRegular, fontBold] = await Promise.all([
      fetch(fontUrl).then(r => r.arrayBuffer()),
      fetch(fontBoldUrl).then(r => r.arrayBuffer()),
    ])

    const svg = await satori(
      {
        type: 'div',
        props: {
          style: {
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#18181b',
            padding: '40px',
          },
          children: [
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  backgroundColor: '#18181b',
                  borderRadius: '16px',
                  flex: '1',
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
                                type: 'span',
                                props: {
                                  style: {
                                    fontSize: '42px',
                                    fontWeight: 700,
                                    color: '#fafafa',
                                  },
                                  children: title,
                                },
                              },
                              {
                                type: 'span',
                                props: {
                                  style: {
                                    display: 'inline-flex',
                                    backgroundColor: '#27272a',
                                    color: '#a1a1aa',
                                    fontSize: '16px',
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
                    type: 'span',
                    props: {
                      style: {
                        fontSize: '26px',
                        color: '#a1a1aa',
                        marginBottom: '20px',
                      },
                      children: description,
                    },
                  },
                  {
                    type: 'span',
                    props: {
                      style: {
                        fontSize: '22px',
                        color: '#71717a',
                      },
                      children: `by ${author}`,
                    },
                  },
                  {
                    type: 'span',
                    props: {
                      style: {
                        fontSize: '18px',
                        color: '#52525b',
                        marginTop: 'auto',
                      },
                      children: 'lectern.inklang.org',
                    },
                  },
                ],
              },
            },
            {
              type: 'div',
              props: {
                style: {
                  width: '100%',
                  height: '10px',
                  backgroundColor: '#8b5cf6',
                },
              },
            },
          ],
        },
      },
      {
        width: 1200,
        height: 630,
        fonts: [
          {
            name: 'Inter',
            data: fontRegular,
            weight: 400,
            style: 'normal',
          },
          {
            name: 'Inter',
            data: fontBold,
            weight: 700,
            style: 'normal',
          },
        ],
      }
    )

    // Convert SVG to PNG for Discord compatibility
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