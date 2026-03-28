-- User profile columns
alter table users add column bio text;
alter table users add column website text;
alter table users add column twitter text;
alter table users add column github text;
alter table users add column avatar_url text;

-- Pinned packages
create table user_pinned_packages (
  user_id       uuid references auth.users on delete cascade,
  package_name  text not null,
  pinned_at     timestamptz default now(),
  position      integer not null default 0,
  primary key (user_id, package_name)
);

alter table user_pinned_packages enable row level security;

create policy "public read pinned packages" on user_pinned_packages for select using (true);
create policy "users manage own pins" on user_pinned_packages
  for insert with check (auth.uid() = user_id);
create policy "users delete own pins" on user_pinned_packages
  for delete using (auth.uid() = user_id);
