import fs from 'fs'
import path from 'path'

export interface PackageVersion {
  version: string
  url: string
  dependencies: Record<string, string>
  publishedAt: string
}

export interface Index {
  packages: Record<string, Record<string, PackageVersion>>
  owners: Record<string, string>       // package name → key fingerprint
  keys: Record<string, string>         // fingerprint → base64 SPKI public key
}

export class PackageStore {
  private indexPath: string
  private storageDir: string

  constructor(storageDir: string) {
    this.storageDir = storageDir
    this.indexPath = path.join(storageDir, 'index.json')
    fs.mkdirSync(storageDir, { recursive: true })
    if (!fs.existsSync(this.indexPath)) {
      this.writeIndex({ packages: {}, owners: {}, keys: {} })
    }
  }

  readIndex(): Index {
    const raw = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'))
    // migrate older index files that lack owners/keys
    if (!raw.owners) raw.owners = {}
    if (!raw.keys) raw.keys = {}
    return raw
  }

  private writeIndex(index: Index): void {
    fs.writeFileSync(this.indexPath, JSON.stringify(index, null, 2))
  }

  // --- keys ---

  hasKey(fp: string): boolean {
    return !!this.readIndex().keys[fp]
  }

  registerKey(fp: string, publicKey: string): void {
    const index = this.readIndex()
    index.keys[fp] = publicKey
    this.writeIndex(index)
  }

  getPublicKey(fp: string): string | null {
    return this.readIndex().keys[fp] ?? null
  }

  // --- ownership ---

  getOwner(pkgName: string): string | null {
    return this.readIndex().owners[pkgName] ?? null
  }

  setOwner(pkgName: string, fp: string): void {
    const index = this.readIndex()
    index.owners[pkgName] = fp
    this.writeIndex(index)
  }

  // --- packages ---

  hasVersion(name: string, version: string): boolean {
    return !!this.readIndex().packages[name]?.[version]
  }

  saveTarball(name: string, version: string, data: Buffer): void {
    const pkgDir = path.join(this.storageDir, 'tarballs', name.replace('/', '-'))
    fs.mkdirSync(pkgDir, { recursive: true })
    const filename = `${name.replace('/', '-')}-${version}.tar.gz`
    fs.writeFileSync(path.join(pkgDir, filename), data)
  }

  registerVersion(name: string, version: string, tarballUrl: string, dependencies: Record<string, string>): void {
    const index = this.readIndex()
    if (!index.packages[name]) index.packages[name] = {}
    index.packages[name][version] = {
      version,
      url: tarballUrl,
      dependencies,
      publishedAt: new Date().toISOString(),
    }
    this.writeIndex(index)
  }

  getTarballPath(name: string, version: string): string | null {
    const filename = `${name.replace('/', '-')}-${version}.tar.gz`
    const filepath = path.join(this.storageDir, 'tarballs', name.replace('/', '-'), filename)
    return fs.existsSync(filepath) ? filepath : null
  }
}
