-- Lock down database functions: nobody signed out can call any of them, and signed-in users can only
-- call the ones the app uses (plus the helpers the security rules rely on).
revoke execute on all functions in schema public from public, anon, authenticated;

-- Called by the app
grant execute on function public.find_match(), public.leave_queue(), public.in_queue(), public.my_matches(),
  public.match_profile(uuid), public.unmatch(uuid), public.start_duel(uuid), public.reveal_fact(uuid),
  public.decide(uuid, boolean), public.rematch(uuid), public.my_plan() to authenticated;

-- Used inside the row-level security rules, which run as the signed-in user
grant execute on function public.is_blocked(uuid, uuid), public.active_match(uuid), public.photo_level(uuid, uuid),
  public.can_see_photo_file(text) to authenticated;

-- Server functions only
grant execute on all functions in schema public to service_role;

-- New functions start locked too
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
