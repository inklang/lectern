-- Audit log for tracking all write operations
create table audit_log (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid references orgs on delete cascade,  -- null for system-wide events
  user_id        uuid,                                    -- the user who performed the action
  token_id       text,                                    -- CLI token ID if token-based
  action         text not null,                           -- e.g. 'package.publish', 'org.create'
  resource_type  text not null,                          -- e.g. 'package', 'org', 'member'
  resource_id    text,                                    -- id or name of the resource
  details        jsonb,                                   -- extra context
  ip_address     text,
  user_agent     text,
  created_at     timestamptz default now()
);

-- Indexes for common queries
create index audit_log_org_created_idx on audit_log(org_id, created_at desc);
create index audit_log_user_created_idx on audit_log(user_id, created_at desc);
create index audit_log_action_idx on audit_log(action);

-- RLS: org admins can read their org logs; users can read their own
alter table audit_log enable row level security;

-- Org admins can read their org's audit logs
create policy "org admins read audit" on audit_log
  for select using (
    org_id is null or
    exists (select 1 from org_members where org_id = audit_log.org_id and user_id = auth.uid() and role in ('owner', 'admin'))
  );

-- Service role can insert (bypass RLS for server-side logging)
create policy "service insert audit" on audit_log
  for insert with check (auth.jwt() ->> 'role' = 'service_role');
