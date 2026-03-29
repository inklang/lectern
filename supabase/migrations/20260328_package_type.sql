-- Add package_type to distinguish script vs library packages
alter table package_versions add column package_type text not null default 'script';
alter table package_versions add constraint valid_package_type
  check (package_type in ('script', 'library'));
