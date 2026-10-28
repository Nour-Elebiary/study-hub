-- Study Hub — M4 Student site: join codes, anonymous suggestions and the
-- shared rate limiter (spec sections 10 and 11 rule 5).
-- join_codes and suggestions: RLS on, tested in supabase/tests/rls/11.
-- rate_limits lives in the `private` schema: PostgREST only exposes `public`,
-- so the table is unreachable through the API no matter what.

-- ---------------------------------------------------------------------------
-- join_codes — hashed class join codes (spec section 10 rule 1).
-- The plaintext code is shown once when created; only its HMAC-SHA256 hash is
-- stored. course_id null means the code unlocks every non-archived course.
-- expires_at null means no expiry; max_uses null means unlimited uses.
-- Students never touch this table: the join server action validates the code
-- with the service-role client, so no client role gets any grant here.
-- Privacy (section 11): the stored data is the hash and the use count only.
-- ---------------------------------------------------------------------------
create table public.join_codes (
  id uuid primary key default gen_random_uuid (),
  course_id uuid references public.courses (id) on delete cascade,
  code_hash text not null unique,
  label text not null default '',
  expires_at timestamptz,
  max_uses integer check (max_uses > 0),
  uses integer not null default 0,
  created_by uuid references auth.users (id) on delete set null
    default auth.uid (),
  created_at timestamptz not null default now()
);

-- No policies at all: RLS denies every client role everything.
alter table public.join_codes enable row level security;

revoke all on public.join_codes from anon, authenticated;

-- ---------------------------------------------------------------------------
-- suggestions — anonymous "suggest a correction" notes (spec section 10
-- rule 4). No personal data: no user, no IP (the rate limiter stores only a
-- salted hash, never a raw address). Inserts happen through the server action
-- after the rate-limit check, so anon gets no INSERT grant or policy.
-- Leaders see these in the course's open_questions area; marking one resolved
-- is a server action (audited), so clients only ever read.
-- ---------------------------------------------------------------------------
create table public.suggestions (
  id uuid primary key default gen_random_uuid (),
  note_id uuid not null references public.nodes (id) on delete cascade,
  text text not null check (char_length (text) between 1 and 2000),
  resolved boolean not null default false,
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index suggestions_note_id_idx on public.suggestions (note_id);

alter table public.suggestions enable row level security;

revoke all on public.suggestions from anon, authenticated;
grant select on public.suggestions to authenticated;

-- Same visibility as the notes themselves (00005): course members see their
-- course's suggestions; core-page suggestions are visible to every leader.
create policy select_course_suggestions on public.suggestions
  as permissive for select to authenticated
  using (
    exists (
      select 1
      from public.nodes n
      where n.id = note_id
        and (n.course_id is null or public.can_access_course (n.course_id))
    )
  );

-- ---------------------------------------------------------------------------
-- Rate limiting (spec section 11 rule 5): one small Postgres table and
-- function for login, join code, suggestions and AI calls — no extra service.
-- The key is a salted hash (e.g. "join:<hmac(ip)>" or "login:<hmac(ip)>"),
-- never a raw IP address (section 11 privacy: no personal data).
-- ---------------------------------------------------------------------------
create schema if not exists private;

create table private.rate_limits (
  key text primary key,
  window_started_at timestamptz not null default now(),
  count integer not null default 0
);

-- Rows are tiny; a scheduled cleanup can come with the retention milestone.
-- Atomic fixed-window counter: the upsert takes the row lock, so concurrent
-- requests serialize and the count is exact. Returns true while the caller is
-- still inside the limit, false once the window is full.
create or replace function public.consume_rate_limit(
  rate_key text,
  max_events integer,
  window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_ts timestamptz := now ();
  current_count integer;
begin
  insert into private.rate_limits as rl (key, window_started_at, count)
    values (rate_key, now_ts, 1)
    on conflict (key) do update
      set
        window_started_at = case
          when rl.window_started_at
               + make_interval (secs => window_seconds) <= now_ts
          then now_ts
          else rl.window_started_at
        end,
        count = case
          when rl.window_started_at
               + make_interval (secs => window_seconds) <= now_ts
          then 1
          else rl.count + 1
        end
    returning count into current_count;

  return current_count <= max_events;
end;
$$;

-- Only the server may call the limiter: no client role through the API.
revoke execute on function public.consume_rate_limit (text, integer, integer)
  from public;
grant execute on function public.consume_rate_limit (text, integer, integer)
  to service_role;
