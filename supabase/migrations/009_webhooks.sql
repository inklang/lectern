-- Webhook configurations for org-level and system-wide event notifications
create table webhook_configs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references orgs on delete cascade,  -- null for system-wide webhooks
  url         text not null,
  events      text[] not null,                        -- e.g. ['package.published', 'package.unpublished']
  secret      text not null,                          -- HMAC secret for signature
  active      boolean not null default true,
  created_at  timestamptz default now()
);

-- Index for looking up webhooks by org
create index webhook_configs_org_id_idx on webhook_configs(org_id) where org_id is not null;

-- RLS
alter table webhook_configs enable row level security;

-- Public read for active webhooks (needed for delivery verification)
create policy "active webhooks are public" on webhook_configs
  for select using (active = true);

-- Org admins manage their org's webhooks
create policy "org admins manage webhooks" on webhook_configs
  for all using (
    org_id is null or
    exists (select 1 from org_members where org_id = webhook_configs.org_id and user_id = auth.uid() and role in ('owner', 'admin'))
  );

-- System webhooks (org_id = null) require superuser (service key bypasses RLS anyway)
