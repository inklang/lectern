import type { APIRoute } from 'astro'
import { createHash } from 'crypto'
import { resolveAuth } from '../../../../lib/tokens.js'
import { canUserPublish } from '../../../../lib/authz.js'
import { getPackageOwner, createPackage, insertVersion, versionExists } from '../../../../lib/db.js'
import { uploadTarball } from '../../../../lib/storage.js'
import { extractDependencies } from '../../../../tar.js'
import { deliverOrgWebhook, emitWebhooks } from '../../../../lib/webhooks.js'
import { checkRateLimit, rateLimitHeaders, rateLimitResponse } from '../../../../lib/ratelimit.js'
import { logAuditEvent } from '../../../../lib/audit.js'
import { emitNotificationBatch } from '../../../../lib/notifications.js'
import { getUserFollowers, getOrgFollowers } from '../../../../lib/follows.js'

export const GET: APIRoute = async ({ params, request }) => {
  const { name, version } = params
  if (!name || !version) return new Response('Bad request', { status: 400 })

  // Extract Cloudflare country header and referrer
  const country = request.headers.get('CF-IPCountry') ?? undefined
  const referrer = request.headers.get('Referer') ?? undefined

  // Log download and increment counter (fire and forget, don't block redirect)
  const { logDownload } = await import('../../../../lib/db.js')
  logDownload(name, version, request.headers.get('authorization') ?? null, country, referrer).catch(() => {})

  // Parse slug to get ownerSlug and packageName
  const slashIdx = name.indexOf('/')
  const ownerSlug = slashIdx > 0 ? name.slice(0, slashIdx) : name
  const packageName = slashIdx > 0 ? name.slice(slashIdx + 1) : name

  // Target from query param, default to 'default'
  const url = new URL(request.url)
  const target = url.searchParams.get('target') ?? 'default'

  // Redirect to Supabase Storage public URL via storage helper
  // New path structure: [ownerSlug]/[packageName]/[target]/[version]/package.tar.gz
  const { supabase } = await import('../../../../lib/supabase.js')
  const { data: urlData } = supabase.storage
    .from('tarballs')
    .getPublicUrl(`${ownerSlug}/${packageName}/${target}/${version}/package.tar.gz`)
  return Response.redirect(urlData.publicUrl, 302)
}

export const PUT: APIRoute = async ({ params, request }) => {
  const { name, version } = params
  if (!name || !version) return new Response('Bad request', { status: 400 })

  // Validate package name: allow scoped (owner/pkg) but no dots in any segment
  const nameSegments = name.split('/')
  const disallowed = /[^a-zA-Z0-9_-]/
  for (const segment of nameSegments) {
    if (!segment || disallowed.test(segment)) {
      return new Response(JSON.stringify({ error: `Invalid package name "${name}". Only letters, numbers, hyphens, and underscores are allowed.` }), { status: 400 })
    }
  }

  // Auth
  const userId = await resolveAuth(request.headers.get('authorization'))
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header. Run `quill login` first.' }), { status: 401 })
  }

  // Rate limit check: 30/min for authenticated publish
  const endpoint = `PUT /api/packages/${name}/*`
  const rateLimit = await checkRateLimit(userId, null, endpoint, 30, 60)
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit)
  }

  // Permission check: if version already exists, verify publisher has access
  if (await versionExists(name, version)) {
    if (!(await canUserPublish(userId, name))) {
      return new Response(JSON.stringify({ error: `You do not have permission to publish to ${name}` }), { status: 403 })
    }
    return new Response(JSON.stringify({ error: `${name}@${version} already exists` }), { status: 409 })
  }

  // Parse body — ink-publish+gzip (metadata in headers), multipart, or legacy raw gzip.
  // Do NOT read arrayBuffer() here; it can only be consumed once and is read inside each branch below.
  const contentType = request.headers.get('content-type') ?? ''
  let tarballData: Buffer
  let description: string | null = null
  let readme: string | null = null
  let author: string | null = null
  let license: string | null = null
  let dependencies: Record<string, string> = {}
  let tags: string[] = []
  let targets: string[] = []
  let packageType: string = 'script'

  if (contentType.includes('application/vnd.ink-publish+gzip')) {
    // New format: tarball as raw gzip body, metadata in HTTP headers
    tarballData = Buffer.from(await request.arrayBuffer())
    if (!tarballData.length) return new Response(JSON.stringify({ error: 'Empty body' }), { status: 400 })
    description = request.headers.get('X-Package-Description') ?? null
    readme = request.headers.get('X-Package-Readme') ?? null
    try { dependencies = await extractDependencies(tarballData) } catch {}

    // Parse targets from X-Package-Targets header
    const targetsHeader = request.headers.get('X-Package-Targets')
    if (targetsHeader) {
      try { targets = JSON.parse(targetsHeader) } catch { targets = [] }
    }

    // Parse package type from X-Package-Type header
    packageType = request.headers.get('X-Package-Type') ?? 'script'
    if (packageType !== 'script' && packageType !== 'library') {
      return new Response(JSON.stringify({ error: 'Invalid X-Package-Type. Must be "script" or "library".' }), { status: 400 })
    }
  } else if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    const tarballFile = formData.get('tarball') as File | null
    if (!tarballFile) return new Response(JSON.stringify({ error: 'Missing tarball' }), { status: 400 })
    tarballData = Buffer.from(await tarballFile.arrayBuffer())
    description = (formData.get('description') as string | null) ?? null
    readme = (formData.get('readme') as string | null) ?? null
    author = (formData.get('author') as string | null) ?? null
    license = (formData.get('license') as string | null) ?? null
    try { dependencies = await extractDependencies(tarballData) } catch {}

    // Parse tags: can be JSON array string or repeated form fields
    const tagsVal = formData.get('tags')
    if (tagsVal) {
      if (typeof tagsVal === 'string') {
        try { tags = JSON.parse(tagsVal) } catch { tags = [] }
      } else {
        // File — ignore
      }
    }
    // Also support repeated form fields: tags=a&tags=b
    const tagsAll = formData.getAll('tags')
    if (tagsAll.length > 1) {
      tags = tagsAll.map(t => String(t).trim().toLowerCase()).filter(Boolean)
    }

    // Parse targets: sent as JSON array string
    const targetsVal = formData.get('targets')
    if (targetsVal) {
      if (typeof targetsVal === 'string') {
        try { targets = JSON.parse(targetsVal) } catch { targets = [] }
      }
    }
  } else {
    // Legacy: raw gzip body (backwards compat — remove after one release cycle)
    tarballData = Buffer.from(await request.arrayBuffer())
    if (!tarballData.length) return new Response(JSON.stringify({ error: 'Empty body' }), { status: 400 })
    try { dependencies = await extractDependencies(tarballData) } catch {}
  }

  // Compute SHA-256 integrity hash before any storage upload
  let tarballHash: string
  try {
    tarballHash = 'sha256:' + createHash('sha256').update(tarballData).digest('hex')
  } catch (e) {
    console.error('hash computation failed:', e)
    return new Response(JSON.stringify({ error: 'Failed to compute tarball hash' }), { status: 500 })
  }

  // Check if this should be an org-owned package
  const url = new URL(request.url)
  const ownerOrgId = url.searchParams.get('owner_org_id')

  let ownerType: 'user' | 'org' = 'user'
  let actualOwnerId = userId
  let ownerSlug = ''

  if (ownerOrgId) {
    // Verify user is admin of this org
    const { isOrgAdmin, getOrgById } = await import('../../../../lib/orgs.js')
    if (!(await isOrgAdmin(ownerOrgId, userId))) {
      return new Response(JSON.stringify({ error: 'Not an admin of this org' }), { status: 403 })
    }
    ownerType = 'org'
    actualOwnerId = ownerOrgId
    // Get org slug
    const org = await getOrgById(ownerOrgId)
    ownerSlug = org?.slug ?? 'unknown'
  } else {
    // Get user's slug (username) via Auth Admin API
    const { supabase } = await import('../../../../lib/supabase.js')
    const { data: { user: authUser } } = await supabase.auth.admin.getUserById(userId)
    ownerSlug = authUser?.user_metadata?.preferred_username ?? authUser?.user_metadata?.user_name ?? 'unknown'
  }

  // For scoped names (e.g., "mintychochip/ink.paper"), name is already the full slug
  const slashIdx = name.indexOf('/')
  const packageName = slashIdx > 0 ? name.slice(slashIdx + 1) : name
  const slug = slashIdx > 0 ? name : `${ownerSlug}/${name}`

  // Determine target: use first target if provided, otherwise default to 'default'
  const uploadTarget = targets.length > 0 ? targets[0] : 'default'

  // Upload to Supabase Storage (new path: [ownerSlug]/[packageName]/[target]/[version]/package.tar.gz)
  const tarballUrl = await uploadTarball(ownerSlug, packageName, uploadTarget, version, tarballData)

  // Create package record on first publish
  const owner = await getPackageOwner(slug)
  if (!owner) await createPackage(slug, name, ownerSlug, actualOwnerId, ownerType)

  // Insert version row (embedding added async after response)
  await insertVersion({
    package_name: name,
    package_slug: slug,
    version,
    description,
    readme,
    dependencies,
    tarball_url: tarballUrl,
    tarball_hash: tarballHash,
    embedding: null,
    targets,
    package_type: packageType,
  })

  // Notify followers of new version (fire and forget)
  ;(async () => {
    try {
      if (ownerType === 'user') {
        const followers = await getUserFollowers(actualOwnerId, 100, 0)
        const notifications = followers
          .filter(f => f.follower_id !== userId)
          .map(f => ({
            userId: f.follower_id,
            type: 'new_version' as const,
            payload: { actor: userId, package: slug, version },
          }))
        if (notifications.length > 0) {
          await emitNotificationBatch(notifications)
        }
      } else {
        const followers = await getOrgFollowers(actualOwnerId, 100, 0)
        const notifications = followers
          .filter(f => f.follower_id !== userId)
          .map(f => ({
            userId: f.follower_id,
            type: 'new_version' as const,
            payload: { actor: userId, package: slug, version, org_id: actualOwnerId },
          }))
        if (notifications.length > 0) {
          await emitNotificationBatch(notifications)
        }
      }
    } catch {}
  })()

  // Add tags if provided (fire and forget)
  if (tags.length > 0) {
    const { addPackageTag } = await import('../../../../lib/db.js')
    for (const tag of tags.slice(0, 20)) {
      if (tag.length <= 50) addPackageTag(slug, tag).catch(() => {})
    }
  }

  // Trigger embedding generation non-blocking
  generateAndStoreEmbedding(slug, version, description, readme).catch(() => {})

  // Fire webhook for package.published event (fire and forget)
  deliverOrgWebhook(ownerType === 'org' ? actualOwnerId : null, 'package.published', {
    package: name,
    version,
    description,
    published_by: userId,
    owner_type: ownerType,
    owner_id: actualOwnerId,
  }).catch(() => {})

  // Fire package-level webhooks (fire and forget)
  emitWebhooks(name, 'package.published', {
    package: name,
    version,
    description,
    published_by: userId,
    owner_type: ownerType,
    owner_id: actualOwnerId,
    timestamp: new Date().toISOString(),
  })

  // Log audit event (fire and forget)
  logAuditEvent({
    orgId: ownerType === 'org' ? actualOwnerId : null,
    userId,
    action: 'package.publish',
    resourceType: 'package',
    resourceId: `${name}@${version}`,
    details: { name, version, owner_type: ownerType },
    ipAddress: request.headers.get('x-forwarded-for') ?? null,
    userAgent: request.headers.get('user-agent') ?? null,
  }).catch(() => {})

  const baseUrl = process.env['BASE_URL'] ?? 'http://localhost:4321'
  const resp = new Response(JSON.stringify({ name, version, url: `${baseUrl}/api/packages/${name}/${version}` }), { status: 201 })
  // Add rate limit headers to successful response
  for (const [k, v] of Object.entries(rateLimitHeaders(rateLimit))) {
    resp.headers.set(k, v)
  }
  return resp
}

import { embedText } from '../../../../lib/embed.js'

async function generateAndStoreEmbedding(
  slug: string, version: string,
  description: string | null, readme: string | null
): Promise<void> {
  const { supabase } = await import('../../../../lib/supabase.js')

  // Strip markdown to plain text for embedding (rough strip)
  const plaintext = [slug, description ?? '', readme?.replace(/[#*`\[\]]/g, '') ?? '']
    .filter(Boolean).join(' ').slice(0, 8000)

  const embedding = await embedText(plaintext, 'passage')
  if (!embedding) return

  await supabase
    .from('package_versions')
    .update({ embedding })
    .eq('package_slug', slug)
    .eq('version', version)
}
