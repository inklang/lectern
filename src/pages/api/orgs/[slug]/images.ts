import type { APIRoute } from 'astro'
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { getOrgBySlug, isOrgAdmin } from '../../../../lib/orgs.js'
import { uploadOrgAsset, deleteOrgAsset } from '../../../../lib/storage.js'
import { logAuditEvent } from '../../../../lib/audit.js'

const MAX_AVATAR_SIZE = 5 * 1024 * 1024 // 5 MB
const MAX_BANNER_SIZE = 10 * 1024 * 1024 // 10 MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

function getOrgSlugFromParams(request: Request, url: URL): string | null {
  const pathParts = url.pathname.match(/\/api\/orgs\/([^/]+)\/images/)
  return pathParts ? decodeURIComponent(pathParts[1]) : null
}

export const PATCH: APIRoute = async ({ params, request }) => {
  const url = new URL(request.url)
  const slug = getOrgSlugFromParams(request, url)
  if (!slug) return new Response('Not found', { status: 404 })

  const supabaseUrl = import.meta.env.SUPABASE_URL ?? ''
  const supabaseKey = import.meta.env.SUPABASE_SECRET_KEY ?? ''

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() { return parseCookieHeader(request.headers.get('Cookie') ?? '') },
      setAll() {},
    },
  })

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })
  const userId = user.id

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })
  if (!(await isOrgAdmin(org.id, userId))) return new Response('Forbidden', { status: 403 })

  // Parse multipart form data
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid form data' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const type = formData.get('type') as 'avatar' | 'banner'
  const file = formData.get('file') as File | null

  if (!type || (type !== 'avatar' && type !== 'banner')) {
    return new Response(JSON.stringify({ error: 'type must be "avatar" or "banner"' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  if (!file) {
    return new Response(JSON.stringify({ error: 'file is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  // Validate file type
  if (!ALLOWED_TYPES.includes(file.type)) {
    return new Response(JSON.stringify({ error: 'invalid file type. accepted: PNG, JPEG, GIF, WebP' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  // Validate SVG (security)
  if (file.type === 'image/svg+xml' || file.name.endsWith('.svg')) {
    return new Response(JSON.stringify({ error: 'SVG files are not allowed' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  // Validate size
  const maxSize = type === 'avatar' ? MAX_AVATAR_SIZE : MAX_BANNER_SIZE
  if (file.size > maxSize) {
    return new Response(JSON.stringify({ error: `file too large. max size: ${maxSize / 1024 / 1024}MB` }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  try {
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const publicUrl = await uploadOrgAsset(org.id, type, buffer, file.type)

    // Update org record with the new URL
    const { supabase: adminDb } = await import('../../../../lib/supabase.js')
    const updateData = type === 'avatar'
      ? { avatar_url: publicUrl }
      : { banner_url: publicUrl }

    const { error: updateError } = await adminDb
      .from('orgs')
      .update(updateData)
      .eq('id', org.id)

    if (updateError) {
      return new Response(JSON.stringify({ error: 'failed to update org' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }

    // Log audit event
    logAuditEvent({
      orgId: org.id,
      userId,
      action: 'org.update',
      resourceType: 'org',
      resourceId: org.id,
      details: { type, url: publicUrl },
      ipAddress: request.headers.get('x-forwarded-for') ?? null,
      userAgent: request.headers.get('user-agent') ?? null,
    }).catch(() => {})

    return new Response(JSON.stringify({ [type === 'avatar' ? 'avatar_url' : 'banner_url']: publicUrl }), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: 'upload failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

export const DELETE: APIRoute = async ({ params, request }) => {
  const url = new URL(request.url)
  const slug = getOrgSlugFromParams(request, url)
  if (!slug) return new Response('Not found', { status: 404 })

  const supabaseUrl = import.meta.env.SUPABASE_URL ?? ''
  const supabaseKey = import.meta.env.SUPABASE_SECRET_KEY ?? ''

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() { return parseCookieHeader(request.headers.get('Cookie') ?? '') },
      setAll() {},
    },
  })

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })
  const userId = user.id

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })
  if (!(await isOrgAdmin(org.id, userId))) return new Response('Forbidden', { status: 403 })

  let body: { type?: string }
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const type = body.type as 'avatar' | 'banner'
  if (!type || (type !== 'avatar' && type !== 'banner')) {
    return new Response(JSON.stringify({ error: 'type must be "avatar" or "banner"' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  try {
    // Delete from storage
    await deleteOrgAsset(org.id, type)

    // Update org record to null
    const { supabase: adminDb } = await import('../../../../lib/supabase.js')
    const updateData = type === 'avatar'
      ? { avatar_url: null }
      : { banner_url: null }

    const { error: updateError } = await adminDb
      .from('orgs')
      .update(updateData)
      .eq('id', org.id)

    if (updateError) {
      return new Response(JSON.stringify({ error: 'failed to update org' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }

    // Log audit event
    logAuditEvent({
      orgId: org.id,
      userId,
      action: 'org.update',
      resourceType: 'org',
      resourceId: org.id,
      details: { type, action: 'removed' },
      ipAddress: request.headers.get('x-forwarded-for') ?? null,
      userAgent: request.headers.get('user-agent') ?? null,
    }).catch(() => {})

    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: 'delete failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
