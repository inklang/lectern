import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./supabase.js', () => ({
  supabase: {
    from: vi.fn(),
  },
}))

import { supabase } from './supabase.js'
import { scanDependencies } from './security.js'

const mockFrom = vi.mocked(supabase.from)

function makeFromChain(data: unknown[], error = null) {
  return {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ data, error }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('scanDependencies', () => {
  it('returns empty array when deps is empty', async () => {
    const result = await scanDependencies({})
    expect(result).toEqual([])
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('returns empty array when no advisories match', async () => {
    mockFrom.mockReturnValue(makeFromChain([]) as any)
    const result = await scanDependencies({ 'safe/pkg': '>=1.0.0' })
    expect(result).toEqual([])
  })

  it('returns a hit when dep range intersects advisory affected_versions', async () => {
    mockFrom.mockReturnValue(makeFromChain([
      {
        id: 'uuid-1',
        package_name: 'vuln/pkg',
        advisory_id: 'GHSA-1111',
        cve: 'CVE-2025-1234',
        severity: 'high',
        title: 'Remote code execution',
        affected_versions: '<2.0.0',
        fixed_version: '2.0.0',
        advisory_url: 'https://example.com/advisory',
      },
    ]) as any)

    // dep range ">=1.0.0 <3.0.0" intersects advisory "<2.0.0"
    const result = await scanDependencies({ 'vuln/pkg': '>=1.0.0 <3.0.0' })

    expect(result).toHaveLength(1)
    expect(result[0].dep).toBe('vuln/pkg')
    expect(result[0].depRange).toBe('>=1.0.0 <3.0.0')
    expect(result[0].advisory.severity).toBe('high')
    expect(result[0].advisory.cve).toBe('CVE-2025-1234')
  })

  it('does NOT return a hit when dep range is entirely above affected_versions', async () => {
    mockFrom.mockReturnValue(makeFromChain([
      {
        id: 'uuid-2',
        package_name: 'vuln/pkg',
        advisory_id: 'GHSA-2222',
        cve: null,
        severity: 'critical',
        title: 'Buffer overflow',
        affected_versions: '<1.0.0',
        fixed_version: '1.0.0',
        advisory_url: 'https://example.com/advisory2',
      },
    ]) as any)

    // dep range ">=1.0.0" does NOT intersect "<1.0.0"
    const result = await scanDependencies({ 'vuln/pkg': '>=1.0.0' })
    expect(result).toEqual([])
  })

  it('throws when supabase returns an error', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
    } as any)

    await expect(scanDependencies({ 'some/pkg': '1.0.0' })).rejects.toThrow()
  })

  it('skips advisories with invalid semver ranges without throwing', async () => {
    mockFrom.mockReturnValue(makeFromChain([
      {
        id: 'uuid-3',
        package_name: 'bad/pkg',
        advisory_id: 'GHSA-3333',
        cve: null,
        severity: 'low',
        title: 'Bad range advisory',
        affected_versions: 'not-a-valid-semver-range',
        fixed_version: null,
        advisory_url: 'https://example.com/advisory3',
      },
    ]) as any)

    // Should not throw — invalid ranges are skipped
    const result = await scanDependencies({ 'bad/pkg': '>=1.0.0' })
    expect(result).toEqual([])
  })
})
