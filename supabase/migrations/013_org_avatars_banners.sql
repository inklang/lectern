-- Organization avatars and banners

-- Add avatar_url and banner_url columns to orgs table
alter table orgs add column avatar_url text;
alter table orgs add column banner_url text;

-- Create org-assets storage bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'org-assets',
  'org-assets',
  true,
  null,
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp']::text[]
);

-- RLS for org-assets bucket
alter storage buckets enable row level security;

-- Public read access to org-assets
create policy "public read org-assets" on storage.objects
  for select using (bucket_id = 'org-assets');

-- Authenticated users who are org admins can upload/update
create policy "org admins upload org-assets" on storage.objects
  for insert with check (
    bucket_id = 'org-assets' and
    exists (
      select 1 from org_members
      where org_id = (storage.objects.metadata->>'orgId')::uuid
        and user_id = auth.uid()
        and role in ('owner', 'admin')
    )
  );

create policy "org admins update org-assets" on storage.objects
  for update using (
    bucket_id = 'org-assets' and
    exists (
      select 1 from org_members
      where org_id = (storage.objects.metadata->>'orgId')::uuid
        and user_id = auth.uid()
        and role in ('owner', 'admin')
    )
  );

create policy "org admins delete org-assets" on storage.objects
  for delete using (
    bucket_id = 'org-assets' and
    exists (
      select 1 from org_members
      where org_id = (storage.objects.metadata->>'orgId')::uuid
        and user_id = auth.uid()
        and role in ('owner', 'admin')
    )
  );
