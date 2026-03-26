-- Fix RPC functions to use package_slug instead of package_name in package_versions

-- Atomic download count increment: now uses package_slug
create or replace function increment_download_count(pkg_name text, ver text)
returns void
language plpgsql
security definer
as $$
begin
  update package_versions
  set download_count = download_count + 1
  where package_slug = pkg_name and version = ver;
end;
$$;

-- Aggregated download stats: now uses package_slug for version lookup
create or replace function get_package_stats(pkg_name text)
returns jsonb
language plpgsql
security definer
as $$
declare
  total_count  bigint;
  last7d_count bigint;
  last30d_count bigint;
begin
  select coalesce(sum(download_count), 0) into total_count
  from package_versions where package_slug = pkg_name;

  -- download_logs still uses package_name (stores slug) for historical tracking
  select count(*) into last7d_count
  from download_logs
  where package_name = pkg_name
    and downloaded_at >= now() - interval '7 days';

  select count(*) into last30d_count
  from download_logs
  where package_name = pkg_name
    and downloaded_at >= now() - interval '30 days';

  return jsonb_build_object(
    'total',   total_count,
    'last7d',  last7d_count,
    'last30d', last30d_count
  );
end;
$$;
