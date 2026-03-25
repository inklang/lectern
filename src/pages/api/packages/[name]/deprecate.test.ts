import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../../lib/tokens.js', () => ({
  extractBearer: vi.fn(),
  resolveToken: vi.fn(),
}))

vi.mock('../../../../lib/authz.js', () => ({
  canUserDeprecate: vi.fn(),
}))

vi.mock('../../../../lib/db.js', () => ({
  setPackageDeprecation: vi.fn(),
}))

const { extractBearer, resolveToken } = await import('../../../../lib/tokens.js')
const { canUserDeprecate } = await import('../../../../lib/authz.js')
const { setPackageDeprecation } = await import('../../../../lib/db.js')

describe('PUT /api/packages/[name]/deprecate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(extractBearer).mockReturnValue('mock-token')
    vi.mocked(resolveToken).mockResolvedValue('user-123')
    vi.mocked(canUserDeprecate).mockResolvedValue(true)
    vi.mocked(setPackageDeprecation).mockResolvedValue(undefined)
  })

  it('deprecates a package successfully', async () => {
    const { PUT } = await import('./deprecate.js')
    const response = await PUT({
      params: { name: 'my-pkg' },
      request: new Request('http://localhost', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'authorization': 'Bearer mock-token' },
        body: JSON.stringify({ deprecated: true, message: 'Use successor-pkg instead' }),
      }),
    } as any)

    expect(response.status).toBe(204)
    expect(setPackageDeprecation).toHaveBeenCalledWith('my-pkg', true, 'Use successor-pkg instead', 'user-123')
  })

  it('un-deprecates a package', async () => {
    const { PUT } = await import('./deprecate.js')
    const response = await PUT({
      params: { name: 'my-pkg' },
      request: new Request('http://localhost', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'authorization': 'Bearer mock-token' },
        body: JSON.stringify({ deprecated: false }),
      }),
    } as any)

    expect(response.status).toBe(204)
    expect(setPackageDeprecation).toHaveBeenCalledWith('my-pkg', false, null, 'user-123')
  })

  it('returns 401 when no auth header', async () => {
    vi.mocked(extractBearer).mockReturnValue(null)

    const { PUT } = await import('./deprecate.js')
    const response = await PUT({
      params: { name: 'my-pkg' },
      request: new Request('http://localhost', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deprecated: true }),
      }),
    } as any)

    expect(response.status).toBe(401)
  })

  it('returns 403 when user lacks permission', async () => {
    vi.mocked(canUserDeprecate).mockResolvedValue(false)

    const { PUT } = await import('./deprecate.js')
    const response = await PUT({
      params: { name: 'my-pkg' },
      request: new Request('http://localhost', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'authorization': 'Bearer mock-token' },
        body: JSON.stringify({ deprecated: true }),
      }),
    } as any)

    expect(response.status).toBe(403)
  })

  it('returns 400 when deprecated field is missing', async () => {
    const { PUT } = await import('./deprecate.js')
    const response = await PUT({
      params: { name: 'my-pkg' },
      request: new Request('http://localhost', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'authorization': 'Bearer mock-token' },
        body: JSON.stringify({ message: 'test' }),
      }),
    } as any)

    expect(response.status).toBe(400)
  })
})
