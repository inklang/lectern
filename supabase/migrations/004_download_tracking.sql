-- Add download_count to package_versions
alter table package_versions
  add column download_count bigint not null default 0;

-- Download logs for per-download tracking
create table download_logs (
  id             uuid primary key default gen_random_uuid(),
  package_name   text not null,
  version        text not null,
  user_id        uuid,  -- nullable: anonymous downloads
  downloaded_at   timestamptz not null default now()
);

-- Index for package+version lookups and time-based trending queries
create index download_logs_package_version_idx on download_logs(package_name, version);
create index download_logs_downloaded_at_desc_idx on download_logs(downloaded_at desc);

-- RLS
alter table download_logs enable row level security;

-- Public read (stats are public)
create policy "public read download_logs"
  on download_logs for select using (true);

-- Service role / authenticated users can insert (tracking downloads)
-- We use a trigger-based approach so the API service key can insert
-- without passing user_id explicitly; but for RLS we allow anyone to insert
create policy "anyone insert download_logs"
  on download_logs for insert with check (true);

-- Atomic increment helper function
create or replace function increment_download_count(pkg_name text, ver text)
returns void
language plpgsql
as $$
begin
  update package_versions
  set download_count = download_count + 1
  where package_name = pkg_name and version = ver;
end;
$$;

-- RPC function to get package stats
create or replace function get_package_stats(pkg_name text)
returns jsonb
language plpgsql
stable
as $$
declare
  total_count   bigint;
  last7d_count   bigint;
  last30d_count  bigint;
begin
  -- Total downloads (all time)
  select coalesce(sum(download_count), 0)
  into total_count
  from package_versions
  where package_name = pkg_name;

  -- Last 7 days from logs
  select count(*)
  into last7d_count
  from download_logs
  where package_name = pkg_name
    and downloaded_at >= now() - interval '7 days';

  -- Last 30 days from logs
  select count(*)
  into last30d_count
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

-- Returns the top N trending packages based on download count within a time window.
-- Each row: package_name, download_count (within window), latest_version, description
create or replace function get_trending_packages(window_days int, limit_count int)
returns table (
  package_name    text,
  download_count  bigint,
  latest_version  text,
  description     text
)
language sql
stable
as $$
  select
    dl.package_name,
    count(dl.*)::bigint as download_count,
    pv.version as latest_version,
    pv.description
  from download_logs dl
  join (
    select distinct on (package_name) package_name, version, description
    from package_versions
    order by package_name, published_at desc
  ) pv on pv.package_name = dl.package_name
  where dl.downloaded_at >= now() - (window_days || ' days')::interval
  group by dl.package_name, pv.version, pv.description
  order by download_count desc
  limit limit_count;
$$;
