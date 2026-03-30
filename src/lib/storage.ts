import { supabase } from './supabase.js'

const BUCKET = 'tarballs'
const ORG_ASSETS_BUCKET = 'org-assets'

// New path structure: [ownerSlug]/[packageName]/[target]/[version]/package.tar.gz
// ownerSlug: the user or org slug (e.g., "justi" or "myorg")
// packageName: just the package name without owner prefix (e.g., "my-package")
// target: the build target (e.g., "default", "windows", "linux")
// version: semantic version (e.g., "1.0.0")

export async function uploadTarball(
  ownerSlug: string,
  packageName: string,
  target: string,
  version: string,
  data: Buffer
): Promise<string> {
  const objectPath = `${ownerSlug}/${packageName}/${target}/${version}/package.tar.gz`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(objectPath, data, {
      contentType: 'application/gzip',
      upsert: true,
    })
  if (error) throw error

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(objectPath)
  return urlData.publicUrl
}

// Downloads a tarball as a Buffer, or returns null if not found
export async function downloadTarball(
  ownerSlug: string,
  packageName: string,
  target: string,
  version: string
): Promise<Buffer | null> {
  const objectPath = `${ownerSlug}/${packageName}/${target}/${version}/package.tar.gz`
  const { data, error } = await supabase.storage.from(BUCKET).download(objectPath)
  if (error || !data) return null
  return Buffer.from(await data.arrayBuffer())
}

// Uploads an org avatar or banner and returns the public URL
export async function uploadOrgAsset(orgId: string, type: 'avatar' | 'banner', data: Buffer, contentType: string): Promise<string> {
  const objectPath = `${orgId}/${type}`
  const { error } = await supabase.storage
    .from(ORG_ASSETS_BUCKET)
    .upload(objectPath, data, {
      contentType,
      upsert: true,
    })
  if (error) throw error

  const { data: urlData } = supabase.storage.from(ORG_ASSETS_BUCKET).getPublicUrl(objectPath)
  return urlData.publicUrl
}

// Deletes an org avatar or banner
export async function deleteOrgAsset(orgId: string, type: 'avatar' | 'banner'): Promise<void> {
  const objectPath = `${orgId}/${type}`
  const { error } = await supabase.storage.from(ORG_ASSETS_BUCKET).remove([objectPath])
  if (error) throw error
}
