import { supabase } from './supabase.js'

const BUCKET = 'tarballs'
const ORG_ASSETS_BUCKET = 'org-assets'

// Uploads a tarball buffer and returns the public URL
export async function uploadTarball(packageName: string, version: string, data: Buffer): Promise<string> {
  const objectPath = `${packageName}/${version}.tar.gz`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(objectPath, data, {
      contentType: 'application/gzip',
      upsert: false,
    })
  if (error) throw error

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(objectPath)
  return urlData.publicUrl
}

// Downloads a tarball as a Buffer, or returns null if not found
export async function downloadTarball(packageName: string, version: string): Promise<Buffer | null> {
  const objectPath = `${packageName}/${version}.tar.gz`
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
