-- Tinted — schema.
-- Blind matching: you're paired, you see a glimpse (name, age, town, one line, a heavily blurred photo),
-- and everything else is earned by playing duels together:
--   stage 1  Glimpse   – duel 1. Each heart popped unlocks a fact and sharpens the photo. Prompts only, no free chat.
--   stage 2  Chatting  – both chose "Keep going" after duel 1. Free chat opens. Duel 2.
--   stage 3  Revealed  – both chose "Keep going" after duel 2. Full photos, bio and all facts.
-- Either person choosing "Pass" ends the match quietly.
-- Adults only, everything behind row-level security; rules live in security-definer functions.

create extension if not exists pgcrypto;

-- ───────────────────────── Profiles ─────────────────────────
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 40),
  birthdate     date not null,
  gender        text not null check (gender in ('woman','man','nonbinary')),
  interested_in text[] not null check (interested_in <@ array['woman','man','nonbinary'] and cardinality(interested_in) > 0),
  min_age       smallint not null default 18 check (min_age >= 18),
  max_age       smallint not null default 99 check (max_age >= 18),
  city          text check (char_length(city) <= 60),
  glimpse       text not null check (char_length(glimpse) between 1 and 80),
  bio           text check (char_length(bio) <= 300),
  push_token    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (min_age <= max_age)
);

create or replace function public.enforce_adult() returns trigger language plpgsql as $$
begin
  if new.birthdate > (current_date - interval '18 years') then
    raise exception 'Tinted is for adults 18 and over' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger profiles_adult before insert or update on public.profiles
  for each row execute function public.enforce_adult();

create or replace function public.age_of(d date) returns int language sql stable as $$
  select date_part('year', age(current_date, d))::int;
$$;

create table public.profile_facts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  idx     smallint not null check (idx between 0 and 5),
  label   text not null check (char_length(label) between 1 and 24),
  body    text not null check (char_length(body) between 1 and 140),
  primary key (user_id, idx)
);

-- Each photo is stored four times by the uploader's phone: g1 (heaviest blur), g2, g3, and full.
-- Storage rules decide which version a match may load.
create table public.photos (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  dir        text not null unique,               -- '<user id>/<photo id>'
  position   smallint not null default 0 check (position between 0 and 5),
  status     text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);
create index photos_user_idx on public.photos(user_id);

-- ───────────────────────── Pairing ─────────────────────────
create table public.match_queue (
  user_id   uuid primary key references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now()
);

create table public.matches (
  id           uuid primary key default gen_random_uuid(),
  user_a       uuid not null references public.profiles(id) on delete cascade,
  user_b       uuid not null references public.profiles(id) on delete cascade,
  stage        smallint not null default 1 check (stage between 1 and 3),
  created_at   timestamptz not null default now(),
  ended_at     timestamptz,
  ended_reason text check (ended_reason in ('pass','unmatch','block','expired')),
  check (user_a < user_b),
  unique (user_a, user_b)
);

create table public.blocks (
  blocker    uuid not null references public.profiles(id) on delete cascade,
  blocked    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked)
);

create table public.reports (
  id         uuid primary key default gen_random_uuid(),
  reporter   uuid not null references public.profiles(id) on delete cascade,
  reported   uuid not null references public.profiles(id) on delete cascade,
  match_id   uuid references public.matches(id) on delete set null,
  reason     text not null check (reason in ('fake','harassment','inappropriate_photo','underage','spam','other')),
  details    text check (char_length(details) <= 1000),
  status     text not null default 'open' check (status in ('open','actioned','dismissed')),
  created_at timestamptz not null default now()
);

create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.matches(id) on delete cascade,
  sender     uuid not null references public.profiles(id) on delete cascade,
  kind       text not null default 'chat' check (kind in ('chat','prompt')),
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index messages_match_idx on public.messages(match_id, created_at);

-- ───────────────────────── Duels ─────────────────────────
-- A duel is open until both players have played their 90 seconds. If both play at the same
-- time they see each other's score live; otherwise scores are compared when the second one finishes.
create table public.duels (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.matches(id) on delete cascade,
  round      smallint not null,
  seed       bigint not null default (floor(random() * 4294967295))::bigint,
  status     text not null default 'open' check (status in ('open','done','expired')),
  winner     uuid references public.profiles(id),
  a_keep     boolean,   -- user_a's choice after this duel
  b_keep     boolean,
  created_at timestamptz not null default now(),
  ended_at   timestamptz,
  unique (match_id, round)
);

create table public.duel_results (
  duel_id      uuid not null references public.duels(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  started_at   timestamptz not null default now(),
  score        integer,
  hearts       integer,
  shots        integer,
  submitted_at timestamptz,
  primary key (duel_id, user_id)
);

create table public.fact_unlocks (
  duel_id    uuid not null references public.duels(id) on delete cascade,
  viewer     uuid not null references public.profiles(id) on delete cascade,
  owner      uuid not null references public.profiles(id) on delete cascade,
  idx        smallint not null,
  created_at timestamptz not null default now(),
  primary key (viewer, owner, idx)
);

-- ───────────────────────── Helpers ─────────────────────────
create or replace function public.is_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocks where (blocker = a and blocked = b) or (blocker = b and blocked = a));
$$;

create or replace function public.active_match(m uuid) returns public.matches
language sql stable security definer set search_path = public as $$
  select * from matches
  where id = m and ended_at is null and auth.uid() in (user_a, user_b) and not is_blocked(user_a, user_b);
$$;

create or replace function public.other_in(m public.matches) returns uuid
language sql stable as $$ select case when m.user_a = auth.uid() then m.user_b else m.user_a end $$;

-- What a viewer may see of an owner's photos: 0 nothing · 1–3 blurred, sharper each step · 4 full.
create or replace function public.photo_level(viewer uuid, owner uuid) returns int
language sql stable security definer set search_path = public as $$
  with m as (
    select stage from matches
    where user_a = least(viewer, owner) and user_b = greatest(viewer, owner) and ended_at is null
      and not is_blocked(viewer, owner)
  ), h as (select count(*) n from fact_unlocks where fact_unlocks.viewer = photo_level.viewer and fact_unlocks.owner = photo_level.owner)
  select case
    when viewer = owner then 4
    when not exists (select 1 from m) then 0
    when (select stage from m) = 3 then 4
    when (select n from h) >= 4 then 3
    when (select n from h) >= 2 then 2
    else 1 end;
$$;

-- ───────────────────────── Subscriptions (Tinted Plus) ─────────────────────────
-- Written only by the revenuecat-webhook function (service role). Google Play takes the payment;
-- RevenueCat tells us who's subscribed. Plus: 3 matches at once instead of 1, and first in the queue.
create table public.subscriptions (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  entitlement  text not null default 'plus',
  status       text not null check (status in ('active','grace','cancelled','expired','refunded')),
  product_id   text,
  store        text,
  expires_at   timestamptz,
  will_renew   boolean,
  updated_at   timestamptz not null default now()
);

-- Active = paid up, in a billing grace period, or cancelled but not yet at the end of the paid period.
create or replace function public.is_plus(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from subscriptions s where s.user_id = u
    and s.status in ('active','grace','cancelled') and (s.expires_at is null or s.expires_at > now()));
$$;

create or replace function public.match_limit(u uuid) returns int
language sql stable as $$ select case when public.is_plus(u) then 3 else 1 end $$;

create or replace function public.my_plan()
returns table (plus boolean, status text, expires_at timestamptz, will_renew boolean, match_limit int, active_matches int)
language sql stable security definer set search_path = public as $$
  select is_plus(auth.uid()), s.status, s.expires_at, s.will_renew, match_limit(auth.uid()),
    (select count(*)::int from matches m where auth.uid() in (m.user_a, m.user_b) and m.ended_at is null)
  from (select 1) one left join subscriptions s on s.user_id = auth.uid();
$$;

-- ───────────────────────── Pairing RPCs ─────────────────────────
-- Pairs you with the longest-waiting compatible person, or puts you in the queue.
create or replace function public.find_match() returns public.matches
language plpgsql security definer set search_path = public as $$
declare me profiles; cand uuid; m matches;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null then raise exception 'Finish your profile first'; end if;
  if not exists (select 1 from photos where user_id = me.id) then raise exception 'Add a photo first'; end if;
  if (select count(*) from matches where me.id in (user_a, user_b) and ended_at is null) >= match_limit(me.id) then
    if is_plus(me.id) then
      raise exception 'You have 3 matches on the go. Finish or pass on one to get a new match.' using hint = 'limit';
    end if;
    raise exception 'You have a match on the go. Finish or pass on it, or get Plus to play 3 at once.' using hint = 'upgrade';
  end if;

  select q.user_id into cand
  from match_queue q join profiles p on p.id = q.user_id
  where q.user_id <> me.id
    and p.gender = any(me.interested_in) and me.gender = any(p.interested_in)
    and age_of(p.birthdate) between me.min_age and me.max_age
    and age_of(me.birthdate) between p.min_age and p.max_age
    and not is_blocked(me.id, p.id)
    and not exists (select 1 from matches x where x.user_a = least(me.id, p.id) and x.user_b = greatest(me.id, p.id))
    and exists (select 1 from photos ph where ph.user_id = p.id and ph.status = 'approved')
  order by is_plus(q.user_id) desc, q.joined_at   -- Plus members are paired first
  limit 1
  for update of q skip locked;

  if cand is null then
    insert into match_queue(user_id) values (me.id) on conflict (user_id) do update set joined_at = match_queue.joined_at;
    return null;
  end if;

  delete from match_queue where user_id in (me.id, cand);
  insert into matches(user_a, user_b) values (least(me.id, cand), greatest(me.id, cand)) returning * into m;
  insert into duels(match_id, round) values (m.id, 1);
  return m;
end $$;

create or replace function public.leave_queue() returns void
language sql security definer set search_path = public as $$
  delete from match_queue where user_id = auth.uid();
$$;

create or replace function public.in_queue() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from match_queue where user_id = auth.uid());
$$;

-- Everything the Matches list and match page need, for every match you're in (ended ones included,
-- so a "they passed" state can be shown once).
create or replace function public.my_matches()
returns table (match_id uuid, other_id uuid, display_name text, age int, city text, glimpse text, stage smallint,
               ended_reason text, photo_dir text, photo_level int, unlocked int, duel_id uuid, duel_round smallint,
               duel_status text, i_played boolean, they_played boolean, my_keep boolean, their_keep boolean,
               last_message text, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.id, o.id, o.display_name, age_of(o.birthdate), o.city, o.glimpse, m.stage, m.ended_reason,
    (select ph.dir from photos ph where ph.user_id = o.id and ph.status = 'approved' order by ph.position limit 1),
    photo_level(auth.uid(), o.id),
    (select count(*)::int from fact_unlocks u where u.viewer = auth.uid() and u.owner = o.id),
    d.id, d.round, d.status,
    exists (select 1 from duel_results r where r.duel_id = d.id and r.user_id = auth.uid() and r.submitted_at is not null),
    exists (select 1 from duel_results r where r.duel_id = d.id and r.user_id = o.id and r.submitted_at is not null),
    case when m.user_a = auth.uid() then d.a_keep else d.b_keep end,
    case when m.user_a = auth.uid() then d.b_keep else d.a_keep end,
    (select body from messages where match_id = m.id order by created_at desc limit 1),
    greatest(m.created_at, coalesce((select max(created_at) from messages where match_id = m.id), m.created_at),
             coalesce(d.ended_at, m.created_at))
  from matches m
  join profiles o on o.id = case when m.user_a = auth.uid() then m.user_b else m.user_a end
  left join lateral (select * from duels where match_id = m.id order by round desc limit 1) d on true
  where auth.uid() in (m.user_a, m.user_b) and not is_blocked(m.user_a, m.user_b)
    and (m.ended_at is null or m.ended_at > now() - interval '3 days')
  order by (m.ended_at is null) desc, 20 desc;
$$;

-- The other person's profile, cut to what this stage allows.
create or replace function public.match_profile(m uuid)
returns table (id uuid, display_name text, age int, city text, glimpse text, bio text, stage smallint,
               photo_dirs text[], photo_level int)
language sql stable security definer set search_path = public as $$
  with x as (select * from active_match(m)), o as (select p.* from profiles p, x where p.id = other_in(x))
  select o.id, o.display_name, age_of(o.birthdate), o.city, o.glimpse,
         case when (select stage from x) = 3 then o.bio end,
         (select stage from x),
         array(select ph.dir from photos ph where ph.user_id = o.id and ph.status = 'approved' order by ph.position
               limit case when (select stage from x) = 3 then 6 else 1 end),
         photo_level(auth.uid(), o.id)
  from o;
$$;

create or replace function public.unmatch(m uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update matches set ended_at = now(), ended_reason = 'unmatch'
  where id = m and ended_at is null and auth.uid() in (user_a, user_b);
  if not found then raise exception 'Not your match'; end if;
end $$;

-- ───────────────────────── Duel RPCs ─────────────────────────
-- Called when you tap Play. Records your start time (the server checks your 90 seconds against it)
-- and returns the board seed. Calling it again resumes the same round.
create or replace function public.start_duel(d uuid)
returns table (seed bigint, round smallint, started_at timestamptz, submitted boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare du duels; mm matches;
begin
  select * into du from duels where id = d;
  select * into mm from active_match(du.match_id);
  if du.id is null or mm.id is null or du.status <> 'open' then raise exception 'This duel is not open'; end if;
  insert into duel_results(duel_id, user_id) values (d, auth.uid()) on conflict do nothing;
  return query select du.seed, du.round, r.started_at, r.submitted_at is not null
    from duel_results r where r.duel_id = d and r.user_id = auth.uid();
end $$;

-- A heart popped unlocks the opponent's next fact (only while your round is running).
create or replace function public.reveal_fact(d uuid)
returns table (idx smallint, label text, body text, photo_level int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare du duels; mm matches; opp uuid; nxt smallint;
begin
  select * into du from duels where id = d;
  select * into mm from active_match(du.match_id);
  if mm.id is null or du.status <> 'open' or not exists (
    select 1 from duel_results r where r.duel_id = d and r.user_id = auth.uid() and r.submitted_at is null
      and r.started_at > now() - interval '3 minutes') then
    raise exception 'Your round is not running';
  end if;
  opp := other_in(mm);
  select min(f.idx) into nxt from profile_facts f
  where f.user_id = opp and not exists (select 1 from fact_unlocks u where u.viewer = auth.uid() and u.owner = opp and u.idx = f.idx);
  if nxt is null then return; end if;
  insert into fact_unlocks(duel_id, viewer, owner, idx) values (d, auth.uid(), opp, nxt) on conflict do nothing;
  return query select f.idx, f.label, f.body, photo_level(auth.uid(), opp) from profile_facts f where f.user_id = opp and f.idx = nxt;
end $$;

-- After a finished duel: keep going or pass. Both keep → next stage (and the next duel, if any).
create or replace function public.decide(d uuid, keep boolean) returns public.matches
language plpgsql security definer set search_path = public as $$
declare du duels; mm matches;
begin
  select * into du from duels where id = d;
  select * into mm from active_match(du.match_id);
  if mm.id is null or du.status <> 'done' then raise exception 'There is nothing to decide here'; end if;
  if mm.user_a = auth.uid() then update duels set a_keep = keep where id = d returning * into du;
  else update duels set b_keep = keep where id = d returning * into du; end if;

  if not keep then
    update matches set ended_at = now(), ended_reason = 'pass' where id = mm.id returning * into mm;
  elsif du.a_keep and du.b_keep and mm.stage = du.round and mm.stage < 3 then
    update matches set stage = stage + 1 where id = mm.id returning * into mm;
    if mm.stage = 2 then insert into duels(match_id, round) values (mm.id, 2) on conflict do nothing; end if;
  end if;
  return mm;
end $$;

-- Once fully revealed, play again whenever you like.
create or replace function public.rematch(m uuid) returns public.duels
language plpgsql security definer set search_path = public as $$
declare mm matches; du duels;
begin
  select * into mm from active_match(m);
  if mm.id is null or mm.stage < 3 then raise exception 'Rematches open once you are both revealed'; end if;
  if exists (select 1 from duels where match_id = m and status = 'open') then raise exception 'A duel is already open'; end if;
  insert into duels(match_id, round) values (m, (select max(round) + 1 from duels where match_id = m)) returning * into du;
  return du;
end $$;

-- Schedule hourly with pg_cron: select public.expire_stale();
create or replace function public.expire_stale() returns void
language sql security definer set search_path = public as $$
  update duels set status = 'expired', ended_at = now() where status = 'open' and created_at < now() - interval '48 hours';
  update matches set ended_at = now(), ended_reason = 'expired'
  where ended_at is null and exists (select 1 from duels d where d.match_id = matches.id and d.status = 'expired'
                                     and not exists (select 1 from duels d2 where d2.match_id = matches.id and d2.round > d.round));
  delete from match_queue where joined_at < now() - interval '7 days';
$$;

-- Blocking ends any match between the two and takes the blocker out of nobody's queue.
create or replace function public.block_ends_match() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update matches set ended_at = now(), ended_reason = 'block'
  where user_a = least(new.blocker, new.blocked) and user_b = greatest(new.blocker, new.blocked) and ended_at is null;
  return new;
end $$;
create trigger blocks_end_match after insert on public.blocks for each row execute function public.block_ends_match();

-- ───────────────────────── Row-level security ─────────────────────────
alter table public.profiles      enable row level security;
alter table public.profile_facts enable row level security;
alter table public.photos        enable row level security;
alter table public.match_queue   enable row level security;
alter table public.matches       enable row level security;
alter table public.blocks        enable row level security;
alter table public.reports       enable row level security;
alter table public.messages      enable row level security;
alter table public.duels         enable row level security;
alter table public.duel_results  enable row level security;
alter table public.fact_unlocks  enable row level security;
alter table public.subscriptions enable row level security;

create policy "own profile" on public.profiles for select using (id = auth.uid());
create policy "create own profile" on public.profiles for insert with check (id = auth.uid());
create policy "edit own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy "own facts" on public.profile_facts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "earned facts" on public.profile_facts for select using (
  not is_blocked(auth.uid(), user_id) and (
    exists (select 1 from fact_unlocks u where u.viewer = auth.uid() and u.owner = user_id and u.idx = profile_facts.idx)
    or photo_level(auth.uid(), user_id) = 4)
);

create policy "own photos" on public.photos for select using (user_id = auth.uid());
create policy "add own photo" on public.photos for insert with check (user_id = auth.uid() and status = 'pending' and dir like auth.uid()::text || '/%');
create policy "remove own photo" on public.photos for delete using (user_id = auth.uid());

create policy "own queue spot" on public.match_queue for select using (user_id = auth.uid());

create policy "my matches" on public.matches for select using (auth.uid() in (user_a, user_b) and not is_blocked(user_a, user_b));

create policy "own blocks" on public.blocks for select using (blocker = auth.uid());
create policy "block" on public.blocks for insert with check (blocker = auth.uid());

create policy "report" on public.reports for insert with check (reporter = auth.uid());

create policy "read chat" on public.messages for select using ((active_match(match_id)).id is not null);
create policy "send chat" on public.messages for insert with check (
  sender = auth.uid() and (active_match(match_id)).id is not null
  and (kind = 'prompt' or (active_match(match_id)).stage >= 2)
);

create policy "my duels" on public.duels for select using (
  exists (select 1 from matches m where m.id = match_id and auth.uid() in (m.user_a, m.user_b))
);
create policy "my duel results" on public.duel_results for select using (
  exists (select 1 from duels d join matches m on m.id = d.match_id where d.id = duel_id and auth.uid() in (m.user_a, m.user_b))
);
create policy "own subscription" on public.subscriptions for select using (user_id = auth.uid());
create policy "my unlocks" on public.fact_unlocks for select using (viewer = auth.uid() or owner = auth.uid());

revoke update on public.profiles from authenticated;
grant update (display_name, birthdate, gender, interested_in, min_age, max_age, city, glimpse, bio, push_token) on public.profiles to authenticated;
revoke update, insert, delete on public.matches, public.duels, public.duel_results, public.fact_unlocks, public.match_queue, public.subscriptions from authenticated;

-- ───────────────────────── Storage ─────────────────────────
-- Paths: photos/<user id>/<photo id>/{g1,g2,g3,full}.jpg
insert into storage.buckets (id, name, public) values ('photos', 'photos', false) on conflict do nothing;

create policy "upload own photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "delete own photos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
-- Runs as the database owner so it can look at the other person's photo row.
create or replace function public.can_see_photo_file(path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from photos p
    where p.dir = split_part(path, '/', 1) || '/' || split_part(path, '/', 2)
      and (p.user_id = auth.uid() or (p.status = 'approved'
        and photo_level(auth.uid(), p.user_id) >= case split_part(path, '/', 3)
          when 'g1.jpg' then 1 when 'g2.jpg' then 2 when 'g3.jpg' then 3 when 'full.jpg' then 4 else 99 end))
  );
$$;

create policy "see the version you've earned" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.can_see_photo_file(name)));

-- ───────────────────────── Realtime ─────────────────────────
alter publication supabase_realtime add table public.messages, public.duels, public.matches, public.duel_results;
