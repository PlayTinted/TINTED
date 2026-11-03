-- Database → edge function calls (notifications and photo checks), plus the hourly clean-up job.
-- The shared secret is generated here and kept in Supabase Vault, so nobody has to copy it around.
create extension if not exists pg_net;
create extension if not exists pg_cron;

select vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'webhook_secret', 'Signs calls from the database to edge functions')
where not exists (select 1 from vault.secrets where name = 'webhook_secret');
select vault.create_secret('https://bdycrgfnxafpczhpxveh.supabase.co', 'project_url', 'Base URL for edge function calls')
where not exists (select 1 from vault.secrets where name = 'project_url');

-- Edge functions call this to check a request really came from the database.
create or replace function public.check_webhook_secret(s text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'webhook_secret' and decrypted_secret = s);
$$;

create or replace function public.call_edge() returns trigger
language plpgsql security definer set search_path = public as $$
declare base text; secret text;
begin
  select decrypted_secret into base from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'webhook_secret';
  perform net.http_post(
    url := base || '/functions/v1/' || TG_ARGV[0],
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', secret),
    body := jsonb_build_object('type', TG_OP, 'table', TG_TABLE_NAME, 'record', to_jsonb(NEW),
                               'old_record', case when TG_OP = 'UPDATE' then to_jsonb(OLD) end),
    timeout_milliseconds := 5000);
  return NEW;
end $$;

create trigger photos_moderate after insert on public.photos for each row execute function public.call_edge('moderate-photo');
create trigger messages_notify after insert on public.messages for each row execute function public.call_edge('notify');
create trigger matches_notify after insert or update on public.matches for each row execute function public.call_edge('notify');
create trigger duels_notify after update on public.duels for each row when (new.status = 'done' and old.status <> 'done') execute function public.call_edge('notify');
create trigger results_notify after update on public.duel_results for each row when (new.submitted_at is not null and old.submitted_at is null) execute function public.call_edge('notify');

select cron.schedule('expire-stale', '0 * * * *', 'select public.expire_stale()');
