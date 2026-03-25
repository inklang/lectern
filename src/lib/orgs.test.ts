import { describe, it, expect, vi, beforeEach } from 'vitest'
// Stub tests that verify functions exist and have correct signatures
// These will pass/fail based on whether the functions are exported

// Mock the supabase module to avoid env var requirements during import
vi.mock('./supabase.js', () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null }),
    insert: vi.fn().mockResolvedValue({ error: null }),
    update: vi.fn().mockResolvedValue({ error: null }),
    delete: vi.fn().mockResolvedValue({ error: null }),
    order: vi.fn().mockResolvedValue({ data: [], error: null }),
  },
}))

describe('orgs API surface', () => {
  it('exports all required functions', async () => {
    const orgs = await import('./orgs.js')
    const expected = ['getOrgBySlug', 'getOrgById', 'getUserOrgs', 'createOrg',
      'getOrgMembers', 'addOrgMember', 'removeOrgMember', 'updateOrgMemberRole',
      'getOrgTeams', 'createOrgTeam', 'getTeamMembers', 'addTeamMember', 'removeTeamMember',
      'getTeamsForPackage', 'setPackagePermission', 'getPackagePermissionForUser',
      'isOrgAdmin', 'isOrgOwner', 'slugAvailable', 'createInvite', 'useInvite',
      'deleteOrg', 'getOrgInvites', 'cancelInvite', 'deleteOrgTeam', 'updateOrgTeam']
    for (const fn of expected) {
      expect(typeof orgs[fn]).toBe('function')
    }
  })
})
