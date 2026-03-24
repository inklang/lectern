import { supabase } from './supabase.js'

const BUCKET = 'tarballs'

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
