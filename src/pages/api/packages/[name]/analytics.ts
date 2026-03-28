import type { APIRoute } from 'astro'
import { resolveAuth } from '../../../../lib/tokens.js'
import { canUserPublish } from '../../../../lib/authz.js'
import {
  getPackageStats,
  getDownloadTimeline,
  getDownloadAnalytics,
  getPackageDependentsFast,
  getPackageVersions,
  getStarCount,
} from '../../../../lib/db.js'
import { supabase } from '../../../../lib/supabase.js'

// GET /api/packages/[name]/analytics
// Auth: Bearer token (package owner only)
// Query params:
//   dimension?: 'timeline' | 'versions' | 'referrers' | 'geo' (default: 'timeline')
//   days?: '7' | '30' | '90' | 'all' (default: '30')
export const GET: APIRoute = async ({ params, request }) => {
  const { name } = params
  if (!name) return new Response('Bad request', { status: 400 })

  // Parse query params
  const url = new URL(request.url)
  const dimension = (url.searchParams.get('dimension') ?? 'timeline') as 'timeline' | 'versions' | 'referrers' | 'geo'
  const daysParam = url.searchParams.get('days') ?? '30'
  const days: number | 'all' = daysParam === 'all' ? 'all' : parseInt(daysParam, 10) || 30

  // Auth
  const userId = await resolveAuth(request.headers.get('authorization'))
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header.' }), { status: 401 })
  }

  // Permission check — only package owner can see analytics
  if (!(await canUserPublish(userId, name))) {
    return new Response(JSON.stringify({ error: 'You do not have permission to view analytics for this package.' }), { status: 403 })
  }

  // Fetch package info to get the short name
  const { data: pkgRow } = await supabase
    .from('packages')
    .select('name, slug')
    .eq('slug', name)
    .single()

  if (!pkgRow) {
    return new Response(JSON.stringify({ error: 'Package not found' }), { status: 404 })
  }

  const packageName = pkgRow.name // short name (bare package name)

  // When dimension/days are specified, return enhanced analytics
  if (dimension !== 'timeline' || days !== 30) {
    // Fetch analytics for the requested dimension and days
    const analyticsData = await getDownloadAnalytics(packageName, dimension, days).catch(() => null)

    // Also fetch stats for the summary footer
    const [stats] = await Promise.all([
      getPackageStats(name).catch(() => ({ total: 0, last7d: 0, last30d: 0 })),
    ])

    return new Response(JSON.stringify({
      dimension,
      days: daysParam,
      packageName,
      ...(analyticsData ?? {}),
      summary: {
        total: stats.total,
        periodDownloads: dimension === 'timeline' && analyticsData
          ? (analyticsData as { periodDownloads?: number }).periodDownloads ?? 0
          : dimension !== 'timeline' && analyticsData
          ? ('versions' in analyticsData ? (analyticsData as { versions: { count: number }[] }).versions.reduce((s, v) => s + v.count, 0)
            : 'referrers' in analyticsData ? (analyticsData as { referrers: { count: number }[] }).referrers.reduce((s, r) => s + r.count, 0)
            : 'geo' in analyticsData ? (analyticsData as { geo: { count: number }[] }).geo.reduce((s, g) => s + g.count, 0)
            : 0)
          : 0,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Run all data fetches in parallel (backward compatible response)
  const [stats, timeline30d, timeline7d, versions, starCount] = await Promise.all([
    getPackageStats(name).catch(() => ({ total: 0, last7d: 0, last30d: 0 })),
    getDownloadTimeline(packageName, 30).catch(() => []),
    getDownloadTimeline(packageName, 7).catch(() => []),
    getPackageVersions(name).catch(() => []),
    getStarCount(name).catch(() => 0),
  ])

  // Top 5 versions by download count
  const topVersions = [...versions]
    .sort((a, b) => (b.download_count ?? 0) - (a.download_count ?? 0))
    .slice(0, 5)
    .map(v => ({ version: v.version, downloads: v.download_count ?? 0, publishedAt: v.published_at }))

  // Top dependents
  const dependents = await getPackageDependentsFast(packageName).catch(() => [])
  // Group by package_slug and count versions
  const depMap = new Map<string, { package_slug: string; versionCount: number }>()
  for (const d of dependents) {
    const existing = depMap.get(d.package_slug)
    if (existing) {
      existing.versionCount++
    } else {
      depMap.set(d.package_slug, { package_slug: d.package_slug, versionCount: 1 })
    }
  }
  const topDependents = [...depMap.values()]
    .sort((a, b) => b.versionCount - a.versionCount)
    .slice(0, 5)
    .map(d => {
      // Extract short name for display
      const shortName = d.package_slug.includes('/') ? d.package_slug.split('/').pop()! : d.package_slug
      return { packageSlug: d.package_slug, packageName: shortName, versionCount: d.versionCount }
    })

  // Star timeline — group stars by week
  const { data: starRows } = await supabase
    .from('package_stars')
    .select('starred_at')
    .eq('package_name', name)
    .order('starred_at', { ascending: true })

  const starTimeline: { week: string; count: number }[] = []
  if (starRows && starRows.length > 0) {
    // Group by week (YYYY-WW format)
    const weekCounts: Record<string, number> = {}
    for (const row of starRows) {
      const date = new Date(row.starred_at)
      const year = date.getFullYear()
      const startOfYear = new Date(year, 0, 1)
      const weekNum = Math.ceil(((date.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7)
      const weekKey = `${year}-W${String(weekNum).padStart(2, '0')}`
      weekCounts[weekKey] = (weekCounts[weekKey] ?? 0) + 1
    }
    // Cumulative
    let cumulative = 0
    const sortedWeeks = Object.keys(weekCounts).sort()
    for (const week of sortedWeeks) {
      cumulative += weekCounts[week]
      starTimeline.push({ week, count: cumulative })
    }
  }

  // Version release timeline
  const releaseTimeline = versions.map(v => ({
    version: v.version,
    publishedAt: v.published_at,
  }))

  return new Response(JSON.stringify({
    downloads: {
      total: stats.total,
      last7d: stats.last7d,
      last30d: stats.last30d,
      timeline30d,
      timeline7d,
    },
    stars: {
      total: starCount,
      timeline: starTimeline,
    },
    topVersions,
    topDependents,
    releaseTimeline,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
