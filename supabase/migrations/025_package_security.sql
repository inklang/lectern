-- Add tarball integrity hash to published versions
alter table package_versions add column tarball_hash text;

-- Add tarball integrity hash to gated releases (copied to package_versions on promotion)
-- Note: releases table does not exist in this schema (gated publish not enabled)
-- alter table releases add column tarball_hash text;

-- Cache of vulnerability scan results per package version
-- Rows are cascade-deleted when an advisory is removed
create table package_vulnerability_cache (
  package_name    text not null,
  version         text not null,
  advisory_id     uuid not null references package_advisories(id) on delete cascade,
  severity        text not null,
  dep_name        text not null,
  dep_range       text not null,
  cached_at       timestamptz default now(),
  primary key (package_name, version, advisory_id)
);

create index on package_vulnerability_cache (package_name, version);
