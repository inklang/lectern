import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../../lib/tokens.js', () => ({
  resolveAuth: vi.fn(),
}))

vi.mock('../../../../lib/authz.js', () => ({
  canUserDeprecate: vi.fn(),
}))

vi.mock('../../../../lib/db.js', () => ({
  setPackageDeprecation: vi.fn(),
}))

const { resolveAuth } = await import('../../../../lib/tokens.js')
const { canUserDeprecate } = await import('../../../../lib/authz.js')
const { setPackageDeprecation } = await import('../../../../lib/db.js')

describe('PUT /api/packages/[name]/deprecate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveAuth).mockResolvedValue('user-123')
    vi.mocked(canUserDeprecate).mockResolvedValue(true)
    vi.mocked(setPackageDeprecation).mockResolvedValue(undefined)
  })

  it('deprecates a package successfully', async () => {
    const { PUT } = await import('./deprecate.js')
    const response = await PUT({
      params: { name: 'my-pkg' },
      request: new Request('http://localhost', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'authorization': 'Ink-v1 keyId=test,ts=0,sig=test' },
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
        headers: { 'content-type': 'application/json', 'authorization': 'Ink-v1 keyId=test,ts=0,sig=test' },
        body: JSON.stringify({ deprecated: false }),
      }),
    } as any)

    expect(response.status).toBe(204)
    expect(setPackageDeprecation).toHaveBeenCalledWith('my-pkg', false, null, 'user-123')
  })

  it('returns 401 when no auth header', async () => {
    vi.mocked(resolveAuth).mockResolvedValue(null)

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
        headers: { 'content-type': 'application/json', 'authorization': 'Ink-v1 keyId=test,ts=0,sig=test' },
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
        headers: { 'content-type': 'application/json', 'authorization': 'Ink-v1 keyId=test,ts=0,sig=test' },
        body: JSON.stringify({ message: 'test' }),
      }),
    } as any)

    expect(response.status).toBe(400)
  })
})
