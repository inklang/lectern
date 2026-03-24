-- Enable pgvector
create extension if not exists vector;

-- Packages table: one row per package name, holds ownership
create table packages (
  name       text primary key,
  owner_id   uuid references auth.users not null,
  created_at timestamptz default now()
);

-- Package versions table
create table package_versions (
  package_name  text references packages(name) not null,
  version       text not null,
  description   text,
  readme        text,
  dependencies  jsonb default '{}',
  tarball_url   text not null,
  published_at  timestamptz default now(),
  embedding     vector(1024),
  primary key (package_name, version)
);

-- Full-text search generated column
alter table package_versions
  add column fts tsvector
  generated always as (
    to_tsvector('english', coalesce(package_name, '') || ' ' || coalesce(description, ''))
  ) stored;

create index on package_versions using gin(fts);
create index on package_versions using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- CLI tokens table
create table cli_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users not null,
  token_hash  text unique not null,
  created_at  timestamptz default now(),
  last_used   timestamptz
);

-- RLS
alter table packages enable row level security;
alter table package_versions enable row level security;
alter table cli_tokens enable row level security;

-- packages: public read, owner write
create policy "public read packages"
  on packages for select using (true);
create policy "owner insert packages"
  on packages for insert with check (auth.uid() = owner_id);

-- package_versions: public read, owner write
create policy "public read versions"
  on package_versions for select using (true);
create policy "owner insert versions"
  on package_versions for insert
  with check (
    exists (
      select 1 from packages
      where name = package_name and owner_id = auth.uid()
    )
  );

-- cli_tokens: user can only see/delete their own
create policy "own tokens only"
  on cli_tokens for all using (auth.uid() = user_id);
