-- Package stats: download counts and metadata
alter table package_versions
  add column download_count bigint not null default 0;

alter table package_versions
  add column author text,
  add column license text;

-- Index for efficient download count sorting
create index on package_versions (download_count desc);

-- Download logs table for historical tracking
create table download_logs (
  id           uuid primary key default gen_random_uuid(),
  package_name text not null,
  version      text not null,
  user_id      uuid references auth.users,
  downloaded_at timestamptz default now()
);

create index on download_logs (package_name, version);
create index on download_logs (downloaded_at desc);

-- RLS for download_logs
alter table download_logs enable row level security;
create policy "public read download_logs"
  on download_logs for select using (true);
create policy "insert download_logs anon"
  on download_logs for insert with check (true);

-- Atomic download count increment via RPC
-- Parameters must match what logDownload() calls: { pkg_name, ver }
create or replace function increment_download_count(pkg_name text, ver text)
returns void
language plpgsql
security definer
as $$
begin
  update package_versions
  set download_count = download_count + 1
  where package_name = pkg_name and version = ver;
end;
$$;

-- Aggregated download stats RPC
-- Returns total, last7d, last30d for a package
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
  from package_versions where package_name = pkg_name;

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
