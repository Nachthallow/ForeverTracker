-- pg_net cannot be relocated, so drop and recreate it outside public.
-- Its functions stay in the net schema either way; the cron job is unaffected.
drop extension if exists pg_net;
create extension pg_net with schema extensions;
