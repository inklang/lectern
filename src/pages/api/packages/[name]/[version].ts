import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../../lib/tokens.js'
import { canUserPublish } from '../../../../lib/authz.js'
import { getPackageOwner, createPackage, insertVersion, versionExists } from '../../../../lib/db.js'
import { uploadTarball } from '../../../../lib/storage.js'
import { extractDependencies } from '../../../../tar.js'

export const GET: APIRoute = async ({ params }) => {
  const { name, version } = params
  if (!name || !version) return new Response('Bad request', { status: 400 })

  // Redirect to Supabase Storage public URL via storage helper
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

  // Permission check: if version already exists, verify publisher has access
  if (await versionExists(name, version)) {
    if (!(await canUserPublish(userId, name))) {
      return new Response(JSON.stringify({ error: `You do not have permission to publish to ${name}` }), { status: 403 })
    }
    return new Response(JSON.stringify({ error: `${name}@${version} already exists` }), { status: 409 })
  }

  // Parse body — multipart or legacy raw gzip. Do NOT read arrayBuffer() here;
  // it can only be consumed once and is read inside each branch below.
  const contentType = request.headers.get('content-type') ?? ''
  let tarballData: Buffer
  let description: string | null = null
  let readme: string | null = null
  let dependencies: Record<string, string> = {}

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    const tarballFile = formData.get('tarball') as File | null
    if (!tarballFile) return new Response(JSON.stringify({ error: 'Missing tarball' }), { status: 400 })
    tarballData = Buffer.from(await tarballFile.arrayBuffer())
    description = (formData.get('description') as string | null) ?? null
    readme = (formData.get('readme') as string | null) ?? null
    try { dependencies = await extractDependencies(tarballData) } catch {}
  } else {
    // Legacy: raw gzip body (backwards compat — remove after one release cycle)
    tarballData = Buffer.from(await request.arrayBuffer())
    if (!tarballData.length) return new Response(JSON.stringify({ error: 'Empty body' }), { status: 400 })
    try { dependencies = await extractDependencies(tarballData) } catch {}
  }

  // Upload to Supabase Storage
  const tarballUrl = await uploadTarball(name, version, tarballData)

  // Check if this should be an org-owned package
  const url = new URL(request.url)
  const ownerOrgId = url.searchParams.get('owner_org_id')

  let ownerType: 'user' | 'org' = 'user'
  let actualOwnerId = userId

  if (ownerOrgId) {
    // Verify user is admin of this org
    const { isOrgAdmin } = await import('../../../../lib/orgs.js')
    if (!(await isOrgAdmin(ownerOrgId, userId))) {
      return new Response(JSON.stringify({ error: 'Not an admin of this org' }), { status: 403 })
    }
    ownerType = 'org'
    actualOwnerId = ownerOrgId
  }

  // Create package record on first publish
  const owner = await getPackageOwner(name)
  if (!owner) await createPackage(name, actualOwnerId, ownerType)

  // Insert version row (embedding added async after response)
  await insertVersion({
    package_name: name,
    version,
    description,
    readme,
    dependencies,
    tarball_url: tarballUrl,
    embedding: null,
  })

  // Trigger embedding generation non-blocking — implemented in Task 16
  generateAndStoreEmbedding(name, version, description, readme).catch(() => {})

  const baseUrl = process.env['BASE_URL'] ?? 'http://localhost:4321'
  return new Response(JSON.stringify({ name, version, url: `${baseUrl}/api/packages/${name}/${version}` }), { status: 201 })
}

import { embedText } from '../../../../lib/embed.js'

async function generateAndStoreEmbedding(
  name: string, version: string,
  description: string | null, readme: string | null
): Promise<void> {
  const { supabase } = await import('../../../../lib/supabase.js')

  // Strip markdown to plain text for embedding (rough strip)
  const plaintext = [name, description ?? '', readme?.replace(/[#*`\[\]]/g, '') ?? '']
    .filter(Boolean).join(' ').slice(0, 8000)

  const embedding = await embedText(plaintext, 'passage')
  if (!embedding) return

  await supabase
    .from('package_versions')
    .update({ embedding })
    .eq('package_name', name)
    .eq('version', version)
}
