-- Fixes "permission denied for table profiles" (42501) when writing to
-- public.profiles with the service_role key (e.g. scripts/create-demo-user.js,
-- or any future server-side admin task).
--
-- 0001/0002 granted table privileges to `authenticated` but never to
-- `service_role`. Postgres checks GRANTs before RLS, and RLS policies don't
-- apply to service_role anyway (it bypasses RLS) — but the base table GRANT
-- is still required for PostgREST requests made with the service_role key.
--
-- Already applied directly in the Supabase SQL Editor for the project
-- (https://mhcupdxtgvhmxnddshhd.supabase.co) on 2026-09-18. Recorded here
-- for the repo's migration history; re-running it is a no-op.

grant select, insert, update, delete on public.profiles to service_role;
