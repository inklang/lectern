import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from './health'

describe('GET /api/packages/[name]/health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns health data for a package with health record', async () => {
    const mockHealth = {
      package_name: 'ink-json',
      health_score: 85,
      health_status: 'excellent',
      maintenance_score: 90,
      maintenance_status: 'excellent',
      popularity_score: 80,
      popularity_status: 'excellent',
      quality_score: 85,
      quality_status: 'excellent',
      compliance_score: 80,
      compliance_status: 'excellent',
    }

    vi.doMock('../../../../lib/db.js', () => ({
      getPackageHealth: vi.fn().mockResolvedValue(mockHealth),
    }))

    const response = await GET({ params: { name: 'ink-json' } } as any)
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.package_name).toBe('ink-json')
    expect(json.health_score).toBe(85)
  })

  it('returns 404 for package with no health record', async () => {
    vi.doMock('../../../../lib/db.js', () => ({
      getPackageHealth: vi.fn().mockResolvedValue(null),
    }))

    const response = await GET({ params: { name: 'unknown-pkg' } } as any)
    expect(response.status).toBe(404)
  })

  it('returns 400 if no package name', async () => {
    const response = await GET({ params: {} } as any)
    expect(response.status).toBe(400)
  })

  it('returns 500 on database error', async () => {
    vi.doMock('../../../../lib/db.js', () => ({
      getPackageHealth: vi.fn().mockRejectedValue(new Error('DB error')),
    }))

    const response = await GET({ params: { name: 'ink-json' } } as any)
    expect(response.status).toBe(500)
  })
})
