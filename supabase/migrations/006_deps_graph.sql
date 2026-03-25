-- GIN index on package_versions.dependencies for efficient reverse lookups
-- Allows fast query: SELECT * FROM package_versions WHERE dependencies @> '{"pkgName": "any"}'::jsonb
create index if not exists idx_package_versions_dependencies on package_versions using gin (dependencies);
