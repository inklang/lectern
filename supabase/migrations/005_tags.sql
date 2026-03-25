-- Tags table: global tag registry
create table tags (
  name        text primary key,
  created_at  timestamptz default now()
);

-- Junction table: package <-> tag relationship
create table package_tags (
  package_name text references packages(name) on delete cascade not null,
  tag          text references tags(name) on delete cascade not null,
  added_at     timestamptz default now(),
  primary key (package_name, tag)
);

-- Indexes for efficient lookups
create index package_tags_tag_idx on package_tags(tag);
create index package_tags_package_name_idx on package_tags(package_name);

-- RLS
alter table tags enable row level security;
alter table package_tags enable row level security;

-- Tags: public read; anyone authenticated can create tags
create policy "public read tags"
  on tags for select using (true);
create policy "authenticated create tags"
  on tags for insert with check (auth.uid() is not null);

-- Package tags: public read; owners can manage (add/remove)
create policy "public read package_tags"
  on package_tags for select using (true);
-- Owner can insert tags for their packages (checked via packages owner_id)
create policy "owner insert package_tags"
  on package_tags for insert with check (
    exists (
      select 1 from packages
      where name = package_tags.package_name
        and owner_id = auth.uid()
    )
  );
-- Owner can delete tags from their packages
create policy "owner delete package_tags"
  on package_tags for delete using (
    exists (
      select 1 from packages
      where name = package_tags.package_name
        and owner_id = auth.uid()
    )
  );

-- RPC: list all tags with package counts, ordered by popularity
create or replace function list_tags()
returns table (
  name         text,
  package_count bigint
)
language sql
stable
as $$
  select
    t.name,
    count(pt.package_name)::bigint as package_count
  from tags t
  left join package_tags pt on pt.tag = t.name
  group by t.name
  order by package_count desc, t.name asc;
$$;

-- RPC: get tags for a specific package
create or replace function get_package_tags(pkg_name text)
returns table (tag text)
language sql
stable
as $$
  select tag from package_tags where package_name = pkg_name order by tag asc;
$$;

-- RPC: get packages by tag (paginated)
create or replace function get_packages_by_tag(p_tag text, p_limit int default 20, p_offset int default 0)
returns table (
  package_name text,
  version text,
  description text,
  published_at timestamptz
)
language sql
stable
as $$
  select
    pv.package_name,
    pv.version,
    pv.description,
    pv.published_at
  from package_tags pt
  join package_versions pv
    on pv.package_name = pt.package_name
    and pv.version = (
      select version from package_versions pv2
      where pv2.package_name = pv.package_name
      order by pv2.published_at desc
      limit 1
    )
  where pt.tag = p_tag
  order by pv.published_at desc
  limit p_limit
  offset p_offset;
$$;
