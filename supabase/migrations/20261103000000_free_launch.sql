-- Free launch: everyone gets 3 matches at once (Plus is switched off in the app via SUBSCRIPTIONS_ON).
-- To bring Plus back: return case when public.is_plus(u) then 3 else 1 end.
create or replace function public.match_limit(u uuid) returns int
language sql stable set search_path = public as $$ select 3 $$;
