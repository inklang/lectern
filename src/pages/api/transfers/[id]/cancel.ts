import type { APIRoute } from 'astro'
import { resolveAuth } from '../../../../lib/tokens.js'
import { getTransferRequest, cancelTransfer } from '../../../../lib/db.js'

// DELETE /api/transfers/[id]
// Auth: Bearer token (initiator only)
export const DELETE: APIRoute = async ({ params, request }) => {
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

  // Check if user is the initiator
  if (transfer.from_owner_id !== userId) {
    return new Response(JSON.stringify({ error: 'Only the initiator can cancel this transfer' }), { status: 403 })
  }

  // Check if transfer is pending
  if (transfer.status !== 'pending') {
    return new Response(JSON.stringify({ error: 'Transfer is not pending' }), { status: 409 })
  }

  // Cancel transfer
  try {
    await cancelTransfer(id)
    return new Response(JSON.stringify({
      id,
      status: 'cancelled',
    }), { status: 200 })
  } catch (err) {
    console.error('Cancel transfer error:', err)
    return new Response(JSON.stringify({ error: 'Database error' }), { status: 500 })
  }
}
