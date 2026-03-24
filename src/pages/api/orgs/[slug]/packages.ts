import type { APIRoute } from 'astro'
import { getOrgBySlug } from '../../../../lib/orgs.js'

export const GET: APIRoute = async ({ params }) => {
  const { slug } = params
  if (!slug) return new Response('Not found', { status: 404 })

  const org = await getOrgBySlug(slug)
  if (!org) return new Response('Not found', { status: 404 })

  const { supabase } = await import('../../../../lib/supabase.js')
  const { data, error } = await supabase
    .from('packages')
    .select('*, package_versions(*)')
    .eq('owner_id', org.id)
    .eq('owner_type', 'org')

  if (error) return new Response(JSON.stringify({ error: 'failed to fetch packages' }), { status: 500, headers: { 'Content-Type': 'application/json' } })

  return new Response(JSON.stringify(data ?? []), { headers: { 'Content-Type': 'application/json' } })
}
