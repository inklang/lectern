-- Package Ownership Transfer
-- Create transfer requests table
create table package_transfer_requests (
  id              uuid primary key default gen_random_uuid(),
  package_name    text not null,         -- short name, e.g. "my-pkg"
  from_owner_id   uuid not null,         -- user or org that currently owns
  from_owner_type text not null,         -- 'user' or 'org'
  to_owner_id     uuid not null,         -- user or org receiving ownership
  to_owner_type   text not null,         -- 'user' or 'org'
  new_slug        text not null,         -- full slug after transfer, e.g. "bob/my-pkg"
  status          text not null default 'pending',
                                         -- 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired'
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,   -- default: now() + 7 days
  accepted_at     timestamptz,
  declined_at     timestamptz,
  cancelled_at    timestamptz
);

-- Indexes
create index on package_transfer_requests (package_name);
create index on package_transfer_requests (to_owner_id, status);
create index on package_transfer_requests (from_owner_id, status);

-- Create redirect table for preserving old URLs
create table package_redirects (
  old_slug        text primary key,      -- e.g. "alice/my-pkg"
  new_slug        text not null,         -- e.g. "bob/my-pkg"
  created_at      timestamptz not null default now()
);

-- Create transfer history table for audit trail
create table package_transfer_history (
  id              uuid primary key default gen_random_uuid(),
  package_name    text not null,
  from_owner_id   uuid not null,
  to_owner_id     uuid not null,
  new_slug        text not null,
  transferred_at   timestamptz not null default now()
);

-- RLS policies for package_transfer_requests
alter table package_transfer_requests enable row level security;

-- Allow authenticated users to create transfer requests
create policy "Users can create transfer requests"
  on package_transfer_requests for insert
  with check (auth.role() = 'authenticated');

-- Allow initiator and recipient to read their transfer requests
create policy "Initiator and recipient can read transfer requests"
  on package_transfer_requests for select
  using (
    auth.role() = 'authenticated' and (
      from_owner_id = auth.uid() or
      to_owner_id = auth.uid()
    )
  );

-- Only recipient can update (accept/decline) transfer requests
create policy "Recipient can update transfer requests"
  on package_transfer_requests for update
  using (
    auth.role() = 'authenticated' and
    to_owner_id = auth.uid()
  );

-- RLS policies for package_redirects (public read)
alter table package_redirects enable row level security;

-- Allow anyone to read redirects (needed for redirect resolution)
create policy "Anyone can read package redirects"
  on package_redirects for select
  using (true);

-- Only new owner can delete redirects (optional, for cleanup)
create policy "New owner can delete redirects"
  on package_redirects for delete
  using (auth.role() = 'authenticated');

-- RLS policies for package_transfer_history
alter table package_transfer_history enable row level security;

-- Allow public read of transfer history
create policy "Anyone can read transfer history"
  on package_transfer_history for select
  using (true);

-- Allow authenticated inserts only (system managed)
create policy "System can insert transfer history"
  on package_transfer_history for insert
  with check (auth.role() = 'authenticated');

-- Function for atomic package transfer
create or replace function accept_package_transfer(
  p_id uuid,
  p_old_slug text,
  p_new_slug text,
  p_new_owner_id uuid,
  p_new_owner_type text,
  p_new_owner_slug text,
  p_package_name text
)
returns void
language plpgsql
security definer
as $$
declare
  old_short_name text;
  new_short_name text;
begin
  old_short_name := split_part(p_old_slug, '/', 2);
  new_short_name := split_part(p_new_slug, '/', 2);

  -- Update packages
  update packages
  set slug = p_new_slug,
      owner_slug = p_new_owner_slug,
      owner_id = p_new_owner_id,
      owner_type = p_new_owner_type
  where name = p_package_name and slug = p_old_slug;

  -- Update package_versions
  update package_versions
  set package_slug = p_new_slug
  where package_slug = p_old_slug;

  -- Update package_stars (stores full slug)
  update package_stars
  set package_name = p_new_slug
  where package_name = p_old_slug;

  -- Update package_reviews (stores full slug)
  update package_reviews
  set package_name = p_new_slug
  where package_name = p_old_slug;

  -- Update download_logs (stores full slug)
  update download_logs
  set package_name = p_new_slug
  where package_name = p_old_slug;

  -- Update package_tags (stores short name)
  update package_tags
  set package_name = new_short_name
  where package_name = old_short_name;

  -- Insert redirect
  insert into package_redirects (old_slug, new_slug)
  values (p_old_slug, p_new_slug)
  on conflict (old_slug) do update set new_slug = p_new_slug;

  -- Insert transfer history
  insert into package_transfer_history (package_name, from_owner_id, to_owner_id, new_slug)
  values (
    p_package_name,
    (select from_owner_id from package_transfer_requests where id = p_id),
    p_new_owner_id,
    p_new_slug
  );

  -- Cancel other pending transfers for this package
  update package_transfer_requests
  set status = 'cancelled', cancelled_at = now()
  where package_name = p_package_name and status = 'pending' and id != p_id;

  -- Update transfer request status
  update package_transfer_requests
  set status = 'accepted', accepted_at = now()
  where id = p_id;
end;
$$;
