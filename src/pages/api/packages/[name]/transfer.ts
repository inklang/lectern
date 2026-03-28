import type { APIRoute } from 'astro'
import { resolveAuth } from '../../../../lib/tokens.js'
import { canManage } from '../../../../lib/authz.js'
import { createTransferRequest, getPendingTransfer } from '../../../../lib/db.js'
import { supabase } from '../../../../lib/supabase.js'
import { emitNotification } from '../../../../lib/notifications.js'

// POST /api/packages/[name]/transfer
// Body: { toOwnerId?: string, toOwnerType?: 'user' | 'org', toUsername?: string, toOrgSlug?: string }
// Auth: Bearer token (canManage on package)
// If toOwnerId is not provided, resolve from toUsername (user) or toOrgSlug (org)
export const POST: APIRoute = async ({ params, request }) => {
  const { name } = params
  if (!name) return new Response(JSON.stringify({ error: 'Bad request' }), { status: 400 })

  // Auth
  const userId = await resolveAuth(request.headers.get('authorization'))
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  // Parse body
  let body: { toOwnerId?: string; toOwnerType?: string; toUsername?: string; toOrgSlug?: string }
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 })
  }

  // Resolve target ID and type
  let toOwnerId = body.toOwnerId
  let toOwnerType = body.toOwnerType

  if (!toOwnerType) {
    return new Response(JSON.stringify({ error: 'toOwnerType is required' }), { status: 400 })
  }

  if (toOwnerType !== 'user' && toOwnerType !== 'org') {
    return new Response(JSON.stringify({ error: 'toOwnerType must be "user" or "org"' }), { status: 400 })
  }

  // Resolve ID if not provided directly
  if (!toOwnerId) {
    if (toOwnerType === 'user' && body.toUsername) {
      const { data: user } = await supabase
        .from('users')
        .select('id')
        .eq('user_name', body.toUsername)
        .single()
      if (!user) {
        return new Response(JSON.stringify({ error: 'User not found' }), { status: 400 })
      }
      toOwnerId = user.id
    } else if (toOwnerType === 'org' && body.toOrgSlug) {
      const { data: org } = await supabase
        .from('orgs')
        .select('id')
        .eq('slug', body.toOrgSlug)
        .single()
      if (!org) {
        return new Response(JSON.stringify({ error: 'Organization not found' }), { status: 400 })
      }
      toOwnerId = org.id
    } else {
      return new Response(JSON.stringify({ error: 'Either toOwnerId or toUsername/toOrgSlug must be provided' }), { status: 400 })
    }
  }

  // Find the package by name (short name)
  const { data: pkg, error: pkgError } = await supabase
    .from('packages')
    .select('slug, owner_id, owner_type, owner_slug')
    .eq('name', name)
    .single()

  if (pkgError || !pkg) {
    return new Response(JSON.stringify({ error: 'Package not found' }), { status: 404 })
  }

  const packageSlug = pkg.slug

  // Permission check: canManage
  if (!(await canManage(userId, packageSlug))) {
    return new Response(JSON.stringify({ error: 'You do not have permission to transfer this package' }), { status: 403 })
  }

  // Check that target is not the current owner
  if (pkg.owner_id === toOwnerId) {
    return new Response(JSON.stringify({ error: 'Cannot transfer to the current owner' }), { status: 400 })
  }

  // Validate target exists
  if (toOwnerType === 'user') {
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('id', toOwnerId)
      .single()
    if (!user) {
      return new Response(JSON.stringify({ error: 'Target user not found' }), { status: 400 })
    }
  } else {
    const { data: org } = await supabase
      .from('orgs')
      .select('id')
      .eq('id', toOwnerId)
      .single()
    if (!org) {
      return new Response(JSON.stringify({ error: 'Target organization not found' }), { status: 400 })
    }
  }

  // Compute new slug
  let newOwnerSlug: string
  if (toOwnerType === 'user') {
    const { data: user } = await supabase
      .from('users')
      .select('user_name')
      .eq('id', toOwnerId)
      .single()
    newOwnerSlug = user?.user_name ?? toOwnerId
  } else {
    const { data: org } = await supabase
      .from('orgs')
      .select('slug')
      .eq('id', toOwnerId)
      .single()
    newOwnerSlug = org?.slug ?? toOwnerId
  }
  const newSlug = `${newOwnerSlug}/${name}`

  // Check that new slug doesn't already exist
  const { data: existingPkg } = await supabase
    .from('packages')
    .select('slug')
    .eq('slug', newSlug)
    .single()
  if (existingPkg) {
    return new Response(JSON.stringify({ error: 'A package with this name already exists for the target owner' }), { status: 400 })
  }

  // Check no pending transfer already exists for this package
  const pending = await getPendingTransfer(name)
  if (pending) {
    return new Response(JSON.stringify({ error: 'A pending transfer already exists for this package' }), { status: 409 })
  }

  // Create transfer request
  try {
    const transfer = await createTransferRequest(
      name,
      pkg.owner_id,
      pkg.owner_type as 'user' | 'org',
      toOwnerId,
      toOwnerType as 'user' | 'org',
      newSlug
    )

    // Get initiator username for notification
    let fromUsername = 'Someone'
    if (pkg.owner_type === 'user') {
      const { data: fromUser } = await supabase
        .from('users')
        .select('user_name')
        .eq('id', pkg.owner_id)
        .single()
      fromUsername = fromUser?.user_name ?? 'Someone'
    } else {
      const { data: fromOrg } = await supabase
        .from('orgs')
        .select('name')
        .eq('id', pkg.owner_id)
        .single()
      fromUsername = fromOrg?.name ?? 'Someone'
    }

    // Create notification for recipient
    await emitNotification(toOwnerId, 'transfer_requested', {
      transfer_id: transfer.id,
      package: newSlug,
      package_name: name,
      from_username: fromUsername,
      new_slug: newSlug,
    })

    return new Response(JSON.stringify({
      id: transfer.id,
      packageName: transfer.package_name,
      fromOwnerId: transfer.from_owner_id,
      toOwnerId: transfer.to_owner_id,
      newSlug: transfer.new_slug,
      status: transfer.status,
      expiresAt: transfer.expires_at,
    }), { status: 201 })
  } catch (err) {
    console.error('Transfer error:', err)
    return new Response(JSON.stringify({ error: 'Database error' }), { status: 500 })
  }
}
