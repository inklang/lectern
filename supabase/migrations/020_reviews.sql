-- Package reviews table
create table package_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  package_name text not null,
  rating int not null check (rating between 1 and 5),
  body text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, package_name)  -- one review per user per package
);

-- Average rating per package (denormalized for performance)
alter table packages add column avg_rating numeric(3,2) default 0;
alter table packages add column review_count int default 0;

-- RLS
alter table package_reviews enable row level security;
create policy "users can read all reviews" on package_reviews for select using (true);
create policy "users can insert own reviews" on package_reviews for insert with check (auth.uid()::text = user_id);
create policy "users can update own reviews" on package_reviews for update using (auth.uid()::text = user_id);
create policy "users can delete own reviews" on package_reviews for delete using (auth.uid()::text = user_id);

-- Function to update package rating stats after review changes
create or replace function update_package_review_stats(pkg_name text)
returns void as $$
declare
  avg_val numeric(3,2);
  cnt_val int;
begin
  select coalesce(avg(rating), 0), count(*)
  into avg_val, cnt_val
  from package_reviews
  where package_name = pkg_name;

  update packages
  set avg_rating = avg_val, review_count = cnt_val
  where slug = pkg_name;
end;
$$ language plpgsql security definer;

-- Trigger to auto-update package stats on insert
create or replace function review_insert_trigger()
returns trigger as $$
begin
  perform update_package_review_stats(new.package_name);
  return new;
end;
$$ language plpgsql security definer;

create trigger review_after_insert
  after insert on package_reviews
  for each row execute function review_insert_trigger();

-- Trigger to auto-update package stats on update
create or replace function review_update_trigger()
returns trigger as $$
begin
  perform update_package_review_stats(new.package_name);
  return new;
end;
$$ language plpgsql security definer;

create trigger review_after_update
  after update on package_reviews
  for each row execute function review_update_trigger();

-- Trigger to auto-update package stats on delete
create or replace function review_delete_trigger()
returns trigger as $$
begin
  perform update_package_review_stats(old.package_name);
  return old;
end;
$$ language plpgsql security definer;

create trigger review_after_delete
  after delete on package_reviews
  for each row execute function review_delete_trigger();

-- Updated at trigger
create or replace function review_updated_at_trigger()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql security definer;

create trigger review_updated_at
  before update on package_reviews
  for each row execute function review_updated_at_trigger();
