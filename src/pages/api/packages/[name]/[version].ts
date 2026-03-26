import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../../lib/tokens.js'
import { canUserPublish } from '../../../../lib/authz.js'
import { getPackageOwner, createPackage, insertVersion, versionExists } from '../../../../lib/db.js'
import { uploadTarball } from '../../../../lib/storage.js'
import { extractDependencies } from '../../../../tar.js'
import { deliverWebhook } from '../../../../lib/webhooks.js'
import { checkRateLimit, rateLimitHeaders, rateLimitResponse } from '../../../../lib/ratelimit.js'
import { logAuditEvent } from '../../../../lib/audit.js'

export const GET: APIRoute = async ({ params, request }) => {
  const { name, version } = params
  if (!name || !version) return new Response('Bad request', { status: 400 })

  // Log download and increment counter (fire and forget, don't block redirect)
  const { logDownload } = await import('../../../../lib/db.js')
  logDownload(name, version, request.headers.get('authorization') ?? null).catch(() => {})

  // Redirect to Supabase Storage public URL via storage helper
  // For slug-based URLs, name IS the slug (owner/package format)
  const { supabase } = await import('../../../../lib/supabase.js')
  const { data: urlData } = supabase.storage
    .from('tarballs')
    .getPublicUrl(`${name}/${version}.tar.gz`)
  return Response.redirect(urlData.publicUrl, 302)
}

export const PUT: APIRoute = async ({ params, request }) => {
  const { name, version } = params
  if (!name || !version) return new Response('Bad request', { status: 400 })

  // Auth
  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header. Run `quill login` first.' }), { status: 401 })
  }

  const userId = await resolveToken(raw)
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Invalid or expired token. Run `quill login`.' }), { status: 401 })
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
    // Get user's slug (username)
    const { supabase } = await import('../../../../lib/supabase.js')
    const { data: userData } = await supabase.from('auth.users').select('raw_user_meta_data').eq('id', userId).single()
    ownerSlug = userData?.raw_user_meta_data?.preferred_username ?? 'unknown'
  }

  // Full slug is ownerSlug/packageName
  const slug = `${ownerSlug}/${name}`

  // Upload to Supabase Storage (use slug for path)
  const tarballUrl = await uploadTarball(slug, version, tarballData)

  // Create package record on first publish
  const owner = await getPackageOwner(slug)
  if (!owner) await createPackage(slug, name, ownerSlug, actualOwnerId, ownerType)

  // Insert version row (embedding added async after response)
  await insertVersion({
    package_slug: slug,
    version,
    description,
    readme,
    author,
    license,
    dependencies,
    tarball_url: tarballUrl,
    embedding: null,
    targets,
  })

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
  deliverWebhook(ownerType === 'org' ? actualOwnerId : null, 'package.published', {
    package: name,
    version,
    description,
    published_by: userId,
    owner_type: ownerType,
    owner_id: actualOwnerId,
  }).catch(() => {})

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
