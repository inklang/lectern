import type { APIRoute } from 'astro'
import { resolveAuth } from '../../../lib/tokens.js'
import { getTransferRequest } from '../../../lib/db.js'

// GET /api/transfers/[id]
// Auth: Bearer token (initiator or recipient only)
export const GET: APIRoute = async ({ params, request }) => {
  const { id } = params
  if (!id) return new Response(JSON.stringify({ error: 'Bad request' }), { status: 400 })

  // Auth
  const userId = await resolveAuth(request.headers.get('authorization'))
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  // Get transfer
  const transfer = await getTransferRequest(id)
  if (!transfer) {
    return new Response(JSON.stringify({ error: 'Transfer not found' }), { status: 404 })
  }

  // Check if user is initiator or recipient
  if (transfer.from_owner_id !== userId && transfer.to_owner_id !== userId) {
    return new Response(JSON.stringify({ error: 'You do not have access to this transfer' }), { status: 403 })
  }

  return new Response(JSON.stringify({
    id: transfer.id,
    packageName: transfer.package_name,
    fromOwner: {
      id: transfer.from_owner_id,
      username: transfer.from_owner_username,
      avatarUrl: transfer.from_owner_avatar,
    },
    toOwner: {
      id: transfer.to_owner_id,
      username: transfer.to_owner_username,
      avatarUrl: transfer.to_owner_avatar,
    },
    newSlug: transfer.new_slug,
    oldSlug: transfer.old_slug,
    status: transfer.status,
    createdAt: transfer.created_at,
    expiresAt: transfer.expires_at,
  }), { status: 200 })
}
