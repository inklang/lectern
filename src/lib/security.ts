import { supabase } from './supabase.js'
import semver from 'semver'

export interface AdvisoryDetail {
  id: string
  advisoryId: string
  cve: string | null
  severity: string
  title: string
  affectedVersions: string
  fixedVersion: string | null
  advisoryUrl: string
}

export interface VulnerabilityHit {
  dep: string
  depRange: string
  advisory: AdvisoryDetail
}

/**
 * Scans a package's dependencies against known advisories.
 * Returns hits where the dep's version range intersects an advisory's affected_versions.
 * Throws on DB error. Skips advisories with unparseable semver ranges.
 */
export async function scanDependencies(
  deps: Record<string, string>
): Promise<VulnerabilityHit[]> {
  const depNames = Object.keys(deps)
  if (depNames.length === 0) return []

  const { data, error } = await supabase
    .from('package_advisories')
    .select('id, package_name, advisory_id, cve, severity, title, affected_versions, fixed_version, advisory_url')
    .in('package_name', depNames)

  if (error) throw new Error(`Advisory query failed: ${error.message}`)

  const hits: VulnerabilityHit[] = []

  for (const advisory of data ?? []) {
    const depRange = deps[advisory.package_name]
    if (!depRange) continue

    try {
      if (semver.intersects(depRange, advisory.affected_versions)) {
        hits.push({
          dep: advisory.package_name,
          depRange,
          advisory: {
            id: advisory.id,
            advisoryId: advisory.advisory_id,
            cve: advisory.cve ?? null,
            severity: advisory.severity,
            title: advisory.title,
            affectedVersions: advisory.affected_versions,
            fixedVersion: advisory.fixed_version ?? null,
            advisoryUrl: advisory.advisory_url,
          },
        })
      }
    } catch {
      // Invalid semver range in advisory — skip without throwing
    }
  }

  return hits
}
