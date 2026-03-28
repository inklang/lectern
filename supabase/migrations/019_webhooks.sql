-- Webhook subscriptions for package-level event notifications
create table webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  package_name text not null,  -- short name (bare package name, e.g., "my-package")
  url text not null,
  secret text not null,  -- HMAC signing secret
  events text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Index for looking up webhooks by package
create index webhook_subscriptions_package_name_idx on webhook_subscriptions(package_name);

-- Index for looking up webhooks by user
create index webhook_subscriptions_user_id_idx on webhook_subscriptions(user_id);

-- RLS
alter table webhook_subscriptions enable row level security;

-- Users can manage their own webhook subscriptions
create policy "users manage own webhooks" on webhook_subscriptions
  for all using (auth.uid()::text = user_id);

-- Webhook delivery log
create table webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references webhook_subscriptions(id) on delete cascade,
  event text not null,
  payload jsonb not null,
  response_status int,
  response_body text,
  error text,
  attempted_at timestamptz not null default now(),
  next_retry_at timestamptz
);

-- Index for looking up deliveries by subscription
create index webhook_deliveries_subscription_id_idx on webhook_deliveries(subscription_id);

-- Index for pending retries
create index webhook_deliveries_next_retry_at_idx on webhook_deliveries(next_retry_at) where next_retry_at is not null;

-- RLS
alter table webhook_deliveries enable row level security;

-- Users can read their own delivery history
create policy "users read own deliveries" on webhook_deliveries
  for select using (
    exists (
      select 1 from webhook_subscriptions ws
      where ws.id = webhook_deliveries.subscription_id
      and ws.user_id = auth.uid()::text
    )
  );
