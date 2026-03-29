-- supabase/migrations/002_search_fn.sql
create or replace function match_package_versions(
  query_embedding vector(1024),
  match_count int
)
returns table (
  package_name text,
  version text,
  description text,
  package_type text,
  similarity float
)
language sql stable
as $$
  select
    pv.package_name,
    pv.version,
    pv.description,
    pv.package_type,
    1 - (pv.embedding <=> query_embedding) as similarity
  from package_versions pv
  inner join (
    select distinct on (package_name) package_name, version
    from package_versions
    order by package_name, published_at desc
  ) latest on pv.package_name = latest.package_name and pv.version = latest.version
  where pv.embedding is not null
  order by similarity desc
  limit match_count;
$$;
