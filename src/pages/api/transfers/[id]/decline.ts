import type { APIRoute } from 'astro'
import { resolveAuth } from '../../../../lib/tokens.js'
import { getTransferRequest, declineTransfer } from '../../../../lib/db.js'
import { isOrgAdmin } from '../../../../lib/orgs.js'
import { emitNotification } from '../../../../lib/notifications.js'
import { supabase } from '../../../../lib/supabase.js'

// POST /api/transfers/[id]/decline
// Auth: Bearer token (recipient only, or org admin if recipient is org)
export const POST: APIRoute = async ({ params, request }) => {
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

  // Check if user is the recipient
  if (transfer.to_owner_id !== userId) {
    // If recipient is an org, check if user is an org admin
    if (transfer.to_owner_type === 'org') {
      const admin = await isOrgAdmin(transfer.to_owner_id, userId)
      if (!admin) {
        return new Response(JSON.stringify({ error: 'Only the recipient or org admin can decline this transfer' }), { status: 403 })
      }
    } else {
      return new Response(JSON.stringify({ error: 'Only the recipient can decline this transfer' }), { status: 403 })
    }
  }

  // Check if transfer is pending
  if (transfer.status !== 'pending') {
    return new Response(JSON.stringify({ error: 'Transfer is not pending' }), { status: 409 })
  }

  // Decline transfer
  try {
    await declineTransfer(id)

    // Get recipient username for notification
    let recipientUsername = 'Someone'
    if (transfer.to_owner_type === 'user') {
      const { data: user } = await supabase
        .from('users')
        .select('user_name')
        .eq('id', transfer.to_owner_id)
        .single()
      recipientUsername = user?.user_name ?? 'Someone'
    } else {
      const { data: org } = await supabase
        .from('orgs')
        .select('name')
        .eq('id', transfer.to_owner_id)
        .single()
      recipientUsername = org?.name ?? 'Someone'
    }

    // Notify initiator
    await emitNotification(transfer.from_owner_id, 'transfer_declined', {
      transfer_id: id,
      package: transfer.new_slug,
      package_name: transfer.package_name,
      from_username: recipientUsername,
      new_slug: transfer.new_slug,
    })

    return new Response(JSON.stringify({
      id,
      status: 'declined',
    }), { status: 200 })
  } catch (err) {
    console.error('Decline transfer error:', err)
    return new Response(JSON.stringify({ error: 'Database error' }), { status: 500 })
  }
}
