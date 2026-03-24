import { createGunzip } from 'zlib'
import { extract } from 'tar-stream'
import { Readable } from 'stream'

export async function extractDependencies(tarball: Buffer): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    const deps: Record<string, string> = {}
    const gunzip = createGunzip()
    const extractor = extract()

    extractor.on('entry', (header, stream, next) => {
      if (header.name.endsWith('ink-manifest.json')) {
        const chunks: Buffer[] = []
        stream.on('data', (chunk: Buffer) => chunks.push(chunk))
        stream.on('end', () => {
          try {
            const manifest = JSON.parse(Buffer.concat(chunks).toString())
            Object.assign(deps, manifest.dependencies ?? {})
          } catch {}
          next()
        })
      } else {
        stream.resume()
        stream.on('end', next)
      }
    })

    extractor.on('finish', () => resolve(deps))
    extractor.on('error', () => resolve(deps))

    Readable.from(tarball).pipe(gunzip).pipe(extractor)
  })
}
