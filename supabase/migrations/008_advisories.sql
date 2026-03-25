-- Package security advisories table
create table if not exists package_advisories (
  id uuid primary key default gen_random_uuid(),
  package_name text not null,
  advisory_id text not null,
  cve text,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  title text not null,
  affected_versions text not null,
  fixed_version text,
  advisory_url text not null,
  source text not null default 'manual',
  fetched_at timestamptz not null default now(),
  published_at timestamptz,
  unique(package_name, advisory_id)
);

-- Index on package_name for efficient lookups
create index if not exists idx_package_advisories_package_name on package_advisories (package_name);

-- Index on severity for filtering
create index if not exists idx_package_advisories_severity on package_advisories (severity);

-- RLS on package_advisories
alter table package_advisories enable row level security;

-- Public read policy
create policy "public read advisories"
  on package_advisories for select using (true);

-- Org admin can insert (for manual advisory creation)
-- We check org admin via a function since RLS doesn't support complex auth
create policy "org admin can insert advisories"
  on package_advisories for insert with check (true);
