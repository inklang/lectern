import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockTrending = [
  { package_name: 'ink.mobs', download_count: 42, latest_version: '1.0.0', description: 'Mob spawning' },
  { package_name: 'ink.fs', download_count: 31, latest_version: '2.1.0', description: 'File system utils' },
]

vi.mock('../../../lib/db.js', () => ({
  getTrendingPackages: vi.fn(),
}))

const { getTrendingPackages } = await import('../../../lib/db.js')

describe('GET /api/packages/trending', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns trending packages with default params', async () => {
    vi.mocked(getTrendingPackages).mockResolvedValue(mockTrending)

    const { GET } = await import('./trending.js')
    const response = await GET({ url: new URL('http://localhost/api/packages/trending') } as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(mockTrending)
    expect(getTrendingPackages).toHaveBeenCalledWith(7, 5)
  })

  it('respects window and limit query params', async () => {
    vi.mocked(getTrendingPackages).mockResolvedValue([mockTrending[0]])

    const { GET } = await import('./trending.js')
    const url = new URL('http://localhost/api/packages/trending?window=30&limit=10')
    const response = await GET({ url } as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(getTrendingPackages).toHaveBeenCalledWith(30, 10)
  })

  it('clamps limit to 50', async () => {
    vi.mocked(getTrendingPackages).mockResolvedValue([])

    const { GET } = await import('./trending.js')
    const url = new URL('http://localhost/api/packages/trending?limit=100')
    const response = await GET({ url } as any)

    expect(response.status).toBe(200)
    expect(getTrendingPackages).toHaveBeenCalledWith(7, 50)
  })

  it('returns 500 on database error', async () => {
    vi.mocked(getTrendingPackages).mockRejectedValue(new Error('db error'))

    const { GET } = await import('./trending.js')
    const response = await GET({ url: new URL('http://localhost/api/packages/trending') } as any)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe('Database error')
  })
})
