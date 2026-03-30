-- User follows: asymmetric follow graph between users
create table user_follows (
  id           uuid primary key default gen_random_uuid(),
  follower_id  uuid not null references auth.users on delete cascade,
  following_id uuid not null references auth.users on delete cascade,
  created_at   timestamptz default now(),
  unique (follower_id, following_id)
);

create index on user_follows (follower_id);
create index on user_follows (following_id);

alter table user_follows enable row level security;

create policy "public read follows" on user_follows for select using (true);
create policy "users manage own follows" on user_follows
  for insert with check (auth.uid() = follower_id);
create policy "users delete own follows" on user_follows
  for delete using (auth.uid() = follower_id);

-- Org follows
create table org_follows (
  id          uuid primary key default gen_random_uuid(),
  follower_id uuid not null references auth.users on delete cascade,
  org_id      uuid not null references orgs on delete cascade,
  created_at  timestamptz default now(),
  unique (follower_id, org_id)
);

create index on org_follows (follower_id);
create index on org_follows (org_id);

alter table org_follows enable row level security;

create policy "public read org follows" on org_follows for select using (true);
create policy "users manage own org follows" on org_follows
  for insert with check (auth.uid() = follower_id);
create policy "users delete own org follows" on org_follows
  for delete using (auth.uid() = follower_id);
