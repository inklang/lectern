import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/db.js', () => ({
  getAllAdvisories: vi.fn(),
}))

vi.mock('../../lib/api-tokens.js', () => ({
  verifyApiToken: vi.fn(),
}))

vi.mock('../../lib/supabase.js', () => ({
  supabase: {
    from: vi.fn(),
  },
}))

vi.mock('../../lib/security.js', () => ({
  scanDependencies: vi.fn().mockResolvedValue([]),
}))

const { getAllAdvisories } = await import('../../lib/db.js')

describe('GET /api/advisories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns paginated advisories', async () => {
    const mockAdvisories = [
      {
        id: 'adv-1',
        package_name: 'pkg-a',
        advisory_id: 'GHSA-1111',
        severity: 'critical',
        title: 'Critical bug',
        affected_versions: '<1.0.0',
        advisory_url: 'https://example.com/1',
        source: 'manual',
        fetched_at: '2024-01-01T00:00:00Z',
        published_at: null,
        cve: null,
        fixed_version: null,
      },
      {
        id: 'adv-2',
        package_name: 'pkg-b',
        advisory_id: 'GHSA-2222',
        severity: 'low',
        title: 'Minor issue',
        affected_versions: '<2.0.0',
        advisory_url: 'https://example.com/2',
        source: 'manual',
        fetched_at: '2024-01-02T00:00:00Z',
        published_at: null,
        cve: null,
        fixed_version: null,
      },
    ]
    vi.mocked(getAllAdvisories).mockResolvedValue({ advisories: mockAdvisories, total: 2 })

    const { GET } = await import('./advisories.js')
    const response = await GET({ url: new URL('http://localhost/api/advisories') } as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.advisories).toEqual(mockAdvisories)
    expect(body.pagination.total).toBe(2)
    expect(body.pagination.has_more).toBe(false)
  })

  it('respects limit and offset params', async () => {
    vi.mocked(getAllAdvisories).mockResolvedValue({ advisories: [], total: 100 })

    const { GET } = await import('./advisories.js')
    const url = new URL('http://localhost/api/advisories?limit=10&offset=20')
    const response = await GET({ url } as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(getAllAdvisories).toHaveBeenCalledWith(10, 20)
    expect(body.pagination.limit).toBe(10)
    expect(body.pagination.offset).toBe(20)
  })

  it('caps limit at 100', async () => {
    vi.mocked(getAllAdvisories).mockResolvedValue({ advisories: [], total: 0 })

    const { GET } = await import('./advisories.js')
    const url = new URL('http://localhost/api/advisories?limit=500')
    const response = await GET({ url } as any)

    expect(response.status).toBe(200)
    expect(getAllAdvisories).toHaveBeenCalledWith(100, 0)
  })
})

describe('POST /api/advisories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 403 when token is not admin type', async () => {
    const { verifyApiToken } = await import('../../lib/api-tokens.js')
    vi.mocked(verifyApiToken).mockResolvedValue({ tokenType: 'publish', userId: 'u1' } as any)

    const { POST } = await import('./advisories.js')
    const req = new Request('http://localhost/api/advisories', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ package_name: 'x', advisory_id: 'G-1', severity: 'high',
        affected_versions: '>=1.0.0', title: 'T', advisory_url: 'https://x.com' }),
    })
    const res = await POST({ request: req } as any)
    expect(res.status).toBe(403)
  })

  it('returns 400 when required fields are missing', async () => {
    const { verifyApiToken } = await import('../../lib/api-tokens.js')
    vi.mocked(verifyApiToken).mockResolvedValue({ tokenType: 'admin', userId: 'u1' } as any)

    const { POST } = await import('./advisories.js')
    const req = new Request('http://localhost/api/advisories', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ package_name: 'x' }), // missing required fields
    })
    const res = await POST({ request: req } as any)
    expect(res.status).toBe(400)
  })

  it('inserts advisory and returns 201 for valid admin request', async () => {
    const { verifyApiToken } = await import('../../lib/api-tokens.js')
    vi.mocked(verifyApiToken).mockResolvedValue({ tokenType: 'admin', userId: 'u1' } as any)

    const { supabase } = await import('../../lib/supabase.js')
    const mockInsertChain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'adv-uuid', package_name: 'vuln/pkg', advisory_id: 'GHSA-1111',
          severity: 'high', affected_versions: '<2.0.0', title: 'T', advisory_url: 'https://x.com' },
        error: null,
      }),
    }
    vi.mocked(supabase.from).mockReturnValue(mockInsertChain as any)

    const { POST } = await import('./advisories.js')
    const req = new Request('http://localhost/api/advisories', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        package_name: 'vuln/pkg', advisory_id: 'GHSA-1111', severity: 'high',
        affected_versions: '<2.0.0', title: 'T', advisory_url: 'https://x.com',
      }),
    })
    const res = await POST({ request: req } as any)
    expect(res.status).toBe(201)
  })
})
