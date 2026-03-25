-- Rate limiting table for API write operations
create table rate_limits (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid,                                      -- null for anonymous
  token_id          text,                                      -- null for session-based
  endpoint_pattern  text not null,                             -- e.g. 'PUT /api/packages/*'
  window_start      timestamptz not null default now(),
  request_count     integer not null default 1
);

-- Index for fast lookups
create index rate_limits_lookup_idx
  on rate_limits(user_id, token_id, endpoint_pattern, window_start);

-- Cleanup old entries periodically (production: use a cron job)
-- For now, we rely on the sliding window logic in code to ignore stale entries.

alter table rate_limits enable row level security;

-- Service role can manage (bypass RLS for cleanup jobs)
create policy "service manage rate_limits" on rate_limits
  for all using (auth.jwt() ->> 'role' = 'service_role');
