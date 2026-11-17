-- Re-sync every character every 6 hours (00, 06, 12, 18 UTC).
--
-- The sync function only runs "all" when the x-cron-secret header matches its
-- CRON_SECRET. The same value is kept in Vault under the name 'cron_secret'.
-- Both are set by hand in the dashboard; neither is in the repo.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'sync-all-characters',
  '0 */6 * * *',
  $$
  select net.http_post(
    url := 'https://mwvppjxhtylnrfjdcrmt.supabase.co/functions/v1/sync',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{"action": "all"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
