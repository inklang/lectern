# Organization Avatars & Banners Design Spec

**Date:** 2026-03-25
**Feature:** Organization avatars and banners for Lectern
**Status:** Draft

---

## Overview

Add visual identity support for organizations: avatar (profile picture) and banner image displayed on org profile pages. This mirrors GitHub organization profiles and allows orgs to establish brand presence on their Lectern page.

---

## Data Model

### Option A: Store URLs directly in `orgs` table (Recommended)

Add two nullable columns to the `orgs` table:

```sql
ALTER TABLE orgs ADD COLUMN avatar_url TEXT;
ALTER TABLE orgs ADD COLUMN banner_url TEXT;
```

**Rationale:**
- Simpler queries (no joins needed when fetching org profile data)
- The `getOrgBySlug` and `getOrgById` functions already return all org fields, so no changes needed to those interfaces
- Direct public storage URLs; no need to resolve bucket paths at query time
- Aligned with how the existing `tarballs` bucket returns public URLs

### Option B: Storage bucket with path references

Store files in a new `org-assets` bucket with paths like `avatars/{orgId}/avatar.png` and `banners/{orgId}/banner.png`, then store only the path or rely on `supabase.storage.from('org-assets').getPublicUrl()` at runtime.

**Rationale:**
- Allows server-side transformations via Supabase Image Transformations API
- More complex querying; requires URL construction on every page load

**Decision:** Option A is recommended for simplicity. Supabase public URLs are fast and cached by CDNs. Server-side resize/optimization can be handled at upload time (see Image Processing section).

---

## Storage Structure

### Bucket

**Bucket name:** `org-assets`
**Public:** Yes (required for direct image serving)

### Path Conventions

```
org-assets/
  {orgId}/
    avatar.png      # 400x400 recommended, max 1024x1024
    banner.png       # 1500x500 recommended, max 2560x512
```

**File naming:** Use literal filenames `avatar` and `banner` for simplicity. If multiple formats are stored (e.g., after conversion), use suffixes: `avatar.webp`, `banner.jpg`.

**Accepted formats (input):**
- Images: PNG, JPEG, GIF, WebP
- SVG is NOT accepted (security: XSS vector)

**Storage limits:**
- Avatar: 5 MB max
- Banner: 10 MB max

---

## Image Processing

### Upload Time Processing

On upload, process images before storing:

1. **Validate format** — reject SVG, executables, etc.
2. **Validate size** — reject files exceeding limits
3. **Convert format** — convert to WebP for storage (better compression, wide browser support)
4. **Resize** — constrain dimensions:
   - Avatar: max 400x400, preserve aspect ratio, center-crop to square
   - Banner: max 1500x500, preserve aspect ratio
5. **Strip metadata** — remove EXIF, ICC profiles to reduce size

**Implementation:** Use the browser's Canvas API for client-side processing before upload, OR use Supabase Edge Functions with sharp for server-side processing.

### Client-Side Processing (Preferred for this stack)

```typescript
async function processImage(file: File, type: 'avatar' | 'banner'): Promise<Blob> {
  const img = await createImageBitmap(file)
  const { width, height } = img

  const maxWidth = type === 'avatar' ? 400 : 1500
  const maxHeight = type === 'avatar' ? 400 : 500

  // Calculate resize dimensions
  let targetWidth = width
  let targetHeight = height
  if (width > maxWidth || height > maxHeight) {
    const ratio = Math.min(maxWidth / width, maxHeight / height)
    targetWidth = Math.round(width * ratio)
    targetHeight = Math.round(height * ratio)
  }

  // For avatar, crop to square from center
  if (type === 'avatar') {
    const size = Math.min(targetWidth, targetHeight)
    const canvas = new OffscreenCanvas(size, size)
    const ctx = canvas.getContext('2d')!
    const sx = (width - size) / 2
    const sy = (height - size) / 2
    ctx.drawImage(img, sx, sy, size, size, 0, 0, size, size)
  } else {
    const canvas = new OffscreenCanvas(targetWidth, targetHeight)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight)
  }

  return canvas.convertToBlob({ type: 'image/webp', quality: 0.85 })
}
```

### Server-Side Validation (Edge Function)

Regardless of client-side processing, server-side validation must:
1. Verify the authenticated user is an org admin
2. Verify the file is actually an image (magic bytes, not just extension)
3. Enforce size limits
4. Reject SVG files

---

## Upload UI

### Location

Add avatar/banner upload section to the org settings page. Since org settings appear to be managed via `src/pages/api/orgs/[slug]/index.ts` (PATCH endpoint), a new settings page or inline editing can be added.

**Option 1: Dedicated org settings page**
- Path: `/orgs/[slug]/settings` or `/[slug]/settings`
- Sections: General (name, description), **Images (avatar, banner)**

**Option 2: Inline editing on org profile page**
- Edit button visible only to org admins
- Avatar and banner become clickable upload targets
- Simpler but less discoverable for full settings

**Decision:** Option 1 (dedicated settings page) for clarity. This aligns with the existing pattern of API endpoints under `src/pages/api/orgs/[slug]/`.

### Upload Form

```
Org Images

Avatar
[Current avatar or fallback] [Upload new] [Remove]
Accepted: PNG, JPEG, GIF, WebP. Max 5 MB. Recommended: 400x400.

Banner
[Current banner or fallback] [Upload new] [Remove]
Accepted: PNG, JPEG, GIF, WebP. Max 10 MB. Recommended: 1500x500.
```

**Interactions:**
- Click "Upload new" opens file picker (accepts image types)
- Preview appears before confirming upload
- "Remove" resets to default fallback
- Each image has independent upload/remove actions

### API Endpoint

**PATCH** `/api/orgs/[slug]/images`

```typescript
// Request (multipart/form-data)
{
  type: 'avatar' | 'banner',
  file: File
}

// Response
{
  avatar_url?: string,  // present if avatar was updated
  banner_url?: string,  // present if banner was updated
}

// Error responses
400 - Invalid file type, file too large, or processing failed
401 - Not authenticated
403 - Not an org admin
404 - Org not found
```

**DELETE** `/api/orgs/[slug]/images`

```typescript
// Request (JSON)
{
  type: 'avatar' | 'banner'
}

// Response
{
  success: true
}
```

---

## Display in Org Profile Page

### Layout

In `src/pages/[slug]/index.astro`, the org header section currently displays:

```
@{org.slug}
{org.name}
{org.description}
[stats: members, packages, teams]
```

With avatars/banners, the layout becomes:

```
+--------------------------------------------------+
|  [Banner image - 1500x200px, full width]         |
|                                                   |
|        [Avatar - 80x80 circle, overlapping]       |
|                                                   |
|  @{org.slug}                                      |
|  {org.name}                                       |
|  {org.description}                                |
|  [stats: members, packages, teams]                |
+--------------------------------------------------+
```

**CSS approach:**

```css
.org-header {
  position: relative;
  margin-bottom: 2.5rem;
}

.banner {
  width: 100%;
  height: 200px;
  object-fit: cover;
  border-radius: 10px;
  background: var(--surface);
}

.avatar-wrapper {
  position: absolute;
  top: 140px;  /* overlaps banner bottom by 40px */
  left: 1.5rem;
}

.avatar {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  border: 3px solid var(--bg);
  object-fit: cover;
  background: var(--surface);
}

.org-slug {
  margin-top: 50px;  /* clear avatar overlap */
}
```

### Responsive Behavior

- Banner height reduces on mobile: 120px
- Avatar size reduces on mobile: 60x60
- On very narrow screens (<400px), avatar moves above banner text

---

## Display in Settings

### Avatar Preview

- Display at actual display size (80x80 in form context)
- Show current image or fallback (initials on colored background)

### Banner Preview

- Display at 300x100 preview size, clickable for full preview
- Show current image or fallback (patterned background)

### Fallbacks

**Avatar fallback:** Generated initials avatar
- First letter of org name, uppercase
- Background color derived from org slug (deterministic, consistent)
- CSS-only implementation:

```css
.avatar-fallback {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: hsl(hashOfSlug % 360, 50%, 40%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-mono);
  font-size: 1.5rem;
  font-weight: 600;
}
```

**Banner fallback:** Solid or subtle patterned background
- Color derived from org slug (same hashing as avatar)
- Or subtle repeating grid pattern using CSS

---

## Deletion / Replacement Flow

### Replacement

1. User selects new file
2. Client-side preview shown
3. User confirms
4. API uploads new file to same path (overwrite)
5. `avatar_url` or `banner_url` in database updated
6. Cache invalidation: new URL includes cache-busting query param or new filename

**Note:** Overwriting in-place is simpler than generating new filenames. Supabase Storage overwrites are atomic.

### Deletion

1. User clicks "Remove"
2. Confirmation: "Remove avatar? This cannot be undone."
3. API deletes file from storage
4. API sets `avatar_url` or `banner_url` to `null` in database
5. UI immediately shows fallback

### Deletion on Org Deletion

When an org is deleted (handled by `deleteOrg` in `src/pages/api/orgs/[slug]/delete.ts`):
1. Delete all org files from `org-assets/{orgId}/` prefix
2. Then delete the org record (existing behavior)

---

## Storage SDK Usage

Follow the existing pattern in `src/lib/storage.ts`:

```typescript
const ASSET_BUCKET = 'org-assets'

export async function uploadOrgAsset(orgId: string, type: 'avatar' | 'banner', data: Buffer, contentType: string): Promise<string> {
  const objectPath = `${orgId}/${type}`
  const { error } = await supabase.storage
    .from(ASSET_BUCKET)
    .upload(objectPath, data, {
      contentType,
      upsert: true,  // overwrite existing
    })
  if (error) throw error

  const { data: urlData } = supabase.storage.from(ASSET_BUCKET).getPublicUrl(objectPath)
  return urlData.publicUrl
}

export async function deleteOrgAsset(orgId: string, type: 'avatar' | 'banner'): Promise<void> {
  const objectPath = `${orgId}/${type}`
  const { error } = await supabase.storage.from(ASSET_BUCKET).remove([objectPath])
  if (error) throw error
}
```

---

## Security Considerations

1. **Only org admins can upload** — verify via `isOrgAdmin()` before processing
2. **File type validation** — check magic bytes, not just extensions
3. **Size limits enforced server-side** — reject oversized uploads
4. **SVG blocked** — no `image/svg+xml` content type
5. **Public bucket** — bucket is public read (needed for image display), but write requires auth
6. **RLS policies** — storage bucket should have RLS:
   - SELECT: public
   - INSERT/UPDATE/DELETE: authenticated user who is org admin

---

## Implementation Phases

### Phase 1: Core Infrastructure
- [ ] Add `avatar_url` and `banner_url` columns to `orgs` table
- [ ] Create `org-assets` bucket with RLS policies
- [ ] Add `uploadOrgAsset` and `deleteOrgAsset` functions to `src/lib/storage.ts`
- [ ] Create `PATCH /api/orgs/[slug]/images` endpoint
- [ ] Create `DELETE /api/orgs/[slug]/images` endpoint

### Phase 2: Frontend Upload UI
- [ ] Add image upload section to org settings page
- [ ] Client-side image processing (resize, format convert)
- [ ] Preview before upload
- [ ] Fallback display for missing images

### Phase 3: Profile Display
- [ ] Update `src/pages/[slug]/index.astro` to display avatar and banner
- [ ] Responsive CSS for mobile
- [ ] Fallback rendering when images not set

### Phase 4: Cleanup
- [ ] Delete assets when org is deleted
- [ ] Error handling for failed uploads
- [ ] Loading states during upload
