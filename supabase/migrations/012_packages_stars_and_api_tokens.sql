-- Package stars: user-level starring (per-user, per-package)
-- Users can star packages to signal quality/appreciation

create table package_stars (
  user_id      uuid references auth.users on delete cascade,
  package_name text not null,
  starred_at   timestamptz default now(),
  primary key (user_id, package_name)
);

alter table package_stars enable row level security;

-- Anyone can read stars (public by design)
create policy "public read stars" on package_stars for select using (true);

-- Only the starring user can insert/delete their own stars
create policy "users manage own stars" on package_stars
  for insert with check (auth.uid() = user_id);

create policy "users delete own stars" on package_stars
  for delete using (auth.uid() = user_id);

-- Add star_count column to packages for O(1) lookups and easier sorting
alter table packages add column star_count integer not null default 0;

-- Trigger function to maintain star_count
create or replace function update_package_star_count()
returns trigger as $$
begin
  if TG_OP = 'INSERT' then
    update packages set star_count = star_count + 1 where name = NEW.package_name;
  elsif TG_OP = 'DELETE' then
    update packages set star_count = star_count - 1 where name = OLD.package_name;
  end if;
  return null;
end;
$$ language plpgsql security definer;

create trigger trigger_update_star_count
after insert or delete on package_stars
for each row execute function update_package_star_count();

-- Migration: backfill star_count from existing stars (if any)
update packages set star_count = (
  select count(*) from package_stars where package_stars.package_name = packages.name
);

-- Index for star_count sorting
create index on packages (star_count desc);

-- Returns top N popular packages sorted by composite popularity score.
-- Score = 0.60 * normalized_downloads + 0.30 * normalized_stars + 0.10 * recency_decay
create or replace function get_popular_packages(
  p_limit   int default 20,
  p_offset   int default 0
)
returns table (
  package_name    text,
  popularity_score numeric,
  download_count  bigint,
  star_count      bigint,
  latest_version  text,
  description     text,
  created_at      timestamptz
)
language plpgsql
stable
as $$
declare
  max_dl bigint;
  max_stars bigint;
begin
  -- Find global maxima for normalization (cached via stable volatility)
  select coalesce(max(download_count), 1) into max_dl
  from package_versions;

  select coalesce(max(star_count), 1) into max_stars
  from packages;

  return query
  select
    pv.package_name,
    (
      (0.60 * (log(greatest(1, pv.total_dl)) / log(greatest(2, max_dl))))
      + (0.30 * (greatest(0, p.star_count::numeric) / greatest(1, max_stars)))
      + (0.10 * exp(-0.02 * extract(epoch from (now() - p.created_at)) / 86400))
    )::numeric(10, 6) as popularity_score,
    pv.total_dl,
    p.star_count,
    pv.latest_version,
    pv.description,
    p.created_at
  from (
    select
      package_name,
      sum(download_count)::bigint as total_dl,
      max(version) filter (where (published_at, version) = (
        select published_at, version from package_versions pv2
        where pv2.package_name = pv.package_name
        order by published_at desc limit 1
      )) as latest_version,
      max(description) filter (where (published_at, version) = (
        select published_at, version from package_versions pv2
        where pv2.package_name = pv.package_name
        order by published_at desc limit 1
      )) as description
    from package_versions
    group by package_name
  ) pv
  join packages p on p.name = pv.package_name
  order by popularity_score desc
  limit p_limit
  offset p_offset;
end;
$$;

-- Returns the popularity score for a single package
create or replace function get_package_score(p_package_name text)
returns numeric(10, 6)
language plpgsql
stable
as $$
declare
  max_dl    bigint;
  max_stars bigint;
  dl        bigint;
  stars     bigint;
  created   timestamptz;
begin
  select coalesce(max(download_count), 1), max(created_at)
    into max_dl, created
  from package_versions pv
  join packages p on p.name = pv.package_name
  where pv.package_name = p_package_name
  group by pv.package_name;

  select coalesce(max(star_count), 1) into max_stars from packages;
  select coalesce(sum(download_count), 0) into dl from package_versions where package_name = p_package_name;
  select star_count into stars from packages where name = p_package_name;

  return (
    (0.60 * (log(greatest(1, dl)) / log(greatest(2, max_dl))))
    + (0.30 * (greatest(0, coalesce(stars, 0))::numeric / greatest(1, max_stars)))
    + (0.10 * exp(-0.02 * extract(epoch from (now() - created)) / 86400))
  )::numeric(10, 6);
end;
$$;

-- Star/unstar a package (inserts or deletes from package_stars)
create or replace function set_package_star(p_package_name text, p_starred boolean)
returns void
language plpgsql
security definer
as $$
begin
  if p_starred then
    insert into package_stars (user_id, package_name)
    values (auth.uid(), p_package_name)
    on conflict (user_id, package_name) do nothing;
  else
    delete from package_stars
    where user_id = auth.uid() and package_name = p_package_name;
  end if;
end;
$$;

-- API Tokens table for CI/CD, integrations, and programmatic access
create table api_tokens (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users not null,
  name            text not null,
  token_hash      text unique not null,
  token_prefix    text not null,
  scopes          jsonb not null default '{}',
  token_type      text not null check (token_type in ('read', 'publish', 'org:manage', 'admin')),
  rate_limit      integer,
  rate_limit_burst integer default 10,
  expires_at      timestamptz,
  description     text,
  last_used_at    timestamptz,
  last_used_ip    text,
  created_at      timestamptz default now(),
  org_id          uuid references orgs on delete cascade
);

-- Indexes
create index on api_tokens (user_id);
create index on api_tokens (org_id);
create index on api_tokens (token_hash);
create index on api_tokens (expires_at) where expires_at is not null;

-- RLS
alter table api_tokens enable row level security;

-- Users can CRUD their own tokens
create policy "own api_tokens only"
  on api_tokens for all
  using (auth.uid() = user_id);

-- Org admins can list/revoke org-scoped tokens
create policy "org admins manage org tokens"
  on api_tokens for select, delete
  using (
    org_id is not null and
    exists (
      select 1 from org_members
      where org_id = api_tokens.org_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
    )
  );
