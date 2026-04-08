create table if not exists public.app_state_store (
  id text primary key,
  payload jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.app_blob_store (
  id text primary key,
  value text,
  updated_at timestamptz not null default timezone('utc', now())
);

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.app_state_store to anon, authenticated;
grant select, insert, update on public.app_blob_store to anon, authenticated;

alter table public.app_state_store enable row level security;
alter table public.app_blob_store enable row level security;

drop policy if exists "app_state_store_select" on public.app_state_store;
drop policy if exists "app_state_store_insert" on public.app_state_store;
drop policy if exists "app_state_store_update" on public.app_state_store;
drop policy if exists "app_blob_store_select" on public.app_blob_store;
drop policy if exists "app_blob_store_insert" on public.app_blob_store;
drop policy if exists "app_blob_store_update" on public.app_blob_store;

create policy "app_state_store_select"
on public.app_state_store
for select
to anon, authenticated
using (true);

create policy "app_state_store_insert"
on public.app_state_store
for insert
to anon, authenticated
with check (true);

create policy "app_state_store_update"
on public.app_state_store
for update
to anon, authenticated
using (true)
with check (true);

create policy "app_blob_store_select"
on public.app_blob_store
for select
to anon, authenticated
using (true);

create policy "app_blob_store_insert"
on public.app_blob_store
for insert
to anon, authenticated
with check (true);

create policy "app_blob_store_update"
on public.app_blob_store
for update
to anon, authenticated
using (true)
with check (true);
