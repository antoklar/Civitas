-- Civitas: saved addresses table.
--
-- Named "profiles" per product spec, but note it stores one row per saved
-- address (label + address), not one row per user — a user can have many.
-- First name lives on the Supabase Auth user itself (user_metadata.first_name),
-- set at signup; it is not duplicated here.
--
-- Run this once in the Supabase SQL Editor for the project
-- (https://mhcupdxtgvhmxnddshhd.supabase.co) before the new dashboard code
-- goes live.

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'Home',
  address text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists profiles_user_id_idx on public.profiles(user_id);

-- Only one primary address per user.
create unique index if not exists profiles_one_primary_per_user
  on public.profiles(user_id) where is_primary;

alter table public.profiles enable row level security;

drop policy if exists "Users can view their own addresses" on public.profiles;
create policy "Users can view their own addresses"
  on public.profiles for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own addresses" on public.profiles;
create policy "Users can insert their own addresses"
  on public.profiles for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own addresses" on public.profiles;
create policy "Users can update their own addresses"
  on public.profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own addresses" on public.profiles;
create policy "Users can delete their own addresses"
  on public.profiles for delete
  using (auth.uid() = user_id);
