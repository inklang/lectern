import type { APIRoute } from 'astro'
import { extractBearer, resolveToken } from '../../../../lib/tokens.js'
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

  // Ownership check
  const owner = await getPackageOwner(name)
  if (owner && owner !== userId) {
    return new Response(JSON.stringify({ error: `Package ${name} is owned by a different account` }), { status: 403 })
  }

  // Duplicate check
  if (await versionExists(name, version)) {
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

  // Create package record on first publish
  if (!owner) await createPackage(name, userId)

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

// Placeholder — wired up in Task 16
async function generateAndStoreEmbedding(
  _name: string, _version: string,
  _description: string | null, _readme: string | null
): Promise<void> {}
