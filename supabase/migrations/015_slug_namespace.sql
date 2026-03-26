-- Add slug and display_name for GitHub-style namespacing
-- slug format: "owner_slug/package_name" (e.g., "minty/test-package")

-- Add columns to packages table
ALTER TABLE packages ADD COLUMN slug TEXT;
ALTER TABLE packages ADD COLUMN display_name TEXT;
ALTER TABLE packages ADD COLUMN owner_slug TEXT NOT NULL DEFAULT '';

-- Generate slug from owner_slug + name, and display_name from name
UPDATE packages p SET
  owner_slug = COALESCE(
    (SELECT raw_user_meta_data->>'preferred_username' FROM auth.users WHERE id = p.owner_id),
    (SELECT slug FROM orgs WHERE id = p.owner_id),
    'unknown'
  ),
  display_name = p.name,
  slug = COALESCE(
    (SELECT raw_user_meta_data->>'preferred_username' FROM auth.users WHERE id = p.owner_id),
    (SELECT slug FROM orgs WHERE id = p.owner_id),
    'unknown'
  ) || '/' || p.name;

-- Add unique constraint on slug
ALTER TABLE packages ADD CONSTRAINT packages_slug_unique UNIQUE (slug);

-- Add package_slug to package_versions (keep package_name for backwards compat)
ALTER TABLE package_versions ADD COLUMN package_slug TEXT;

UPDATE package_versions pv SET package_slug = (
  SELECT slug FROM packages WHERE name = pv.package_name
);

-- Add foreign key reference
ALTER TABLE package_versions ADD CONSTRAINT package_versions_package_slug_fkey
  FOREIGN KEY (package_slug) REFERENCES packages(slug) ON DELETE SET NULL;
