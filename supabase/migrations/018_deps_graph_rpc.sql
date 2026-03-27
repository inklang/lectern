-- GIN-index-based RPC for efficient dependency reverse lookup
-- Uses: WHERE dependencies @> jsonb_build_object($1, '')
-- This leverages the GIN index on package_versions.dependencies

create or replace function get_package_dependents(pkg_name text)
returns jsonb
language plpgsql
security definer
as $$
begin
  return (
    select jsonb_agg(jsonb_build_object(
      'package_slug', pv.package_slug,
      'version', pv.version,
      'dep_version', pv.dependencies->>pkg_name
    ))
    from package_versions pv
    where pv.dependencies is not null
      and pv.dependencies @> jsonb_build_object(pkg_name, '')
  );
end;
$$;
