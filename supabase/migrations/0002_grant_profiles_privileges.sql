-- Fixes "My Addresses" showing empty on the dashboard for every user.
--
-- 0001 created public.profiles with RLS policies but never granted base
-- table privileges to the `authenticated` role. Postgres checks GRANTs
-- before evaluating RLS, so every dashboard request against `profiles`
-- was failing with "permission denied for table profiles" (42501),
-- regardless of the RLS policies being correct. The client swallowed the
-- error and just rendered an empty address list.
--
-- Run this once in the Supabase SQL Editor for the project
-- (https://mhcupdxtgvhmxnddshhd.supabase.co). Safe to run even though 0001
-- has already been applied — it only adds the missing GRANT.

grant select, insert, update, delete on public.profiles to authenticated;
