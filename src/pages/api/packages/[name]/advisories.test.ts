import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../../lib/supabase.js', () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null }),
  },
}))

vi.mock('../../../../lib/db.js', () => ({
  getPackageAdvisories: vi.fn(),
  upsertAdvisory: vi.fn(),
  getPackageOwner: vi.fn(),
}))

vi.mock('../../../../lib/orgs.js', () => ({
  isOrgAdmin: vi.fn(),
}))

vi.mock('../../../../lib/tokens.js', () => ({
  resolveAuth: vi.fn(),
}))

const { getPackageAdvisories, upsertAdvisory, getPackageOwner } = await import('../../../../lib/db.js')
const { isOrgAdmin } = await import('../../../../lib/orgs.js')
const { resolveAuth } = await import('../../../../lib/tokens.js')

describe('GET /api/packages/[name]/advisories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns advisories for a package', async () => {
    const mockAdvisories = [
      {
        id: 'adv-1',
        package_name: 'my-pkg',
        advisory_id: 'GHSA-1234',
        cve: 'CVE-2024-1234',
        severity: 'high',
        title: 'Remote Code Execution',
        affected_versions: '<2.0.0',
        fixed_version: '2.0.0',
        advisory_url: 'https://example.com/adv/1234',
        source: 'manual',
        fetched_at: '2024-01-01T00:00:00Z',
        published_at: '2024-01-01T00:00:00Z',
      },
    ]
    vi.mocked(getPackageAdvisories).mockResolvedValue(mockAdvisories)

    const { GET } = await import('./advisories.js')
    const response = await GET({ params: { name: 'my-pkg' } } as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.package_name).toBe('my-pkg')
    expect(body.advisories).toEqual(mockAdvisories)
    expect(getPackageAdvisories).toHaveBeenCalledWith('my-pkg')
  })

  it('returns 400 when name is missing', async () => {
    const { GET } = await import('./advisories.js')
    const response = await GET({ params: {} } as any)

    expect(response.status).toBe(400)
  })

  it('returns empty array when no advisories', async () => {
    vi.mocked(getPackageAdvisories).mockResolvedValue([])

    const { GET } = await import('./advisories.js')
    const response = await GET({ params: { name: 'secure-pkg' } } as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.advisories).toEqual([])
  })
})

describe('PUT /api/packages/[name]/advisories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveAuth).mockResolvedValue('user-123')
    vi.mocked(getPackageOwner).mockResolvedValue('user-123')
    vi.mocked(upsertAdvisory).mockResolvedValue(undefined)
  })

  it('creates an advisory for user-owned package', async () => {
    vi.mocked(isOrgAdmin).mockResolvedValue(false)

    const { PUT } = await import('./advisories.js')
    const response = await PUT({
      params: { name: 'my-pkg' },
      request: new Request('http://localhost', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'authorization': 'Ink-v1 keyId=test,ts=0,sig=test' },
        body: JSON.stringify({
          advisory_id: 'GHSA-5678',
          cve: 'CVE-2024-5678',
          severity: 'critical',
          title: 'SQL Injection',
          affected_versions: '<1.5.0',
          fixed_version: '1.5.0',
          advisory_url: 'https://example.com/adv/5678',
        }),
      }),
    } as any)

    expect(response.status).toBe(204)
    expect(upsertAdvisory).toHaveBeenCalled()
  })

  it('returns 401 when no auth header', async () => {
    vi.mocked(resolveAuth).mockResolvedValue(null)

    const { PUT } = await import('./advisories.js')
    const response = await PUT({
      params: { name: 'my-pkg' },
      request: new Request('http://localhost', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ advisory_id: 'GHSA-123', severity: 'low', title: 'Test', affected_versions: '*', advisory_url: 'https://test.com' }),
      }),
    } as any)

    expect(response.status).toBe(401)
  })

  it('returns 400 for invalid severity', async () => {
    const { PUT } = await import('./advisories.js')
    const response = await PUT({
      params: { name: 'my-pkg' },
      request: new Request('http://localhost', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'authorization': 'Ink-v1 keyId=test,ts=0,sig=test' },
        body: JSON.stringify({
          advisory_id: 'GHSA-123',
          severity: 'invalid',
          title: 'Test',
          affected_versions: '*',
          advisory_url: 'https://test.com',
        }),
      }),
    } as any)

    expect(response.status).toBe(400)
  })
})
