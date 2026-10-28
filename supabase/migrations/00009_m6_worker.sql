-- Study Hub — M6 Home Worker: claim machinery (spec section 7 rule 5).
-- The worker is a Python program on a leader's own PC. It holds NO Supabase
-- keys: it talks only to the Next.js API routes (/api/worker/claim and
-- /api/worker/complete) with a WORKER_TOKEN, and the server hands it signed
-- URLs for the input download and the result upload.

-- ---------------------------------------------------------------------------
-- worker_heartbeats: the app shows "Home Worker online/offline" from
-- last_seen_at. The claim call doubles as the heartbeat (every 10 seconds).
-- Writes happen only through the server (service role), so there are no
-- insert/update policies at all — clients can never fake a heartbeat.
-- ---------------------------------------------------------------------------
create table public.worker_heartbeats (
  id text primary key,
  last_seen_at timestamptz not null default now (),
  current_job_id uuid,
  created_at timestamptz not null default now ()
);

alter table public.worker_heartbeats enable row level security;
alter table public.worker_heartbeats force row level security;

-- Admins watch worker health; other leaders see nothing (no policy).
create policy select_worker_heartbeats on public.worker_heartbeats
  as permissive for select to authenticated
  using (public.is_admin ());

-- ---------------------------------------------------------------------------
-- jobs.claimed_by: which runner instance took the job (the worker's name).
-- No new client grant: the column rides the existing update policy, and the
-- claim function writes it as the service role.
-- ---------------------------------------------------------------------------
alter table public.jobs add column claimed_by text;

-- ---------------------------------------------------------------------------
-- claim_worker_job: the atomic claim (spec section 7 rule 5). SELECT ... FOR
-- UPDATE SKIP LOCKED inside the function means two workers polling at the
-- same moment can never take the same job — the second one sees the row
-- already locked and moves on. Only jobs meant for the worker (runner =
-- 'worker') are handed out; browser jobs stay for the leader's browser.
-- Returns no rows when there is nothing to do.
-- ---------------------------------------------------------------------------
create or replace function public.claim_worker_job(worker_name text)
returns table (
  job_id uuid,
  course_id uuid,
  job_type text,
  params jsonb,
  input_asset_id uuid,
  input_path text,
  input_mime text,
  attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed record;
begin
  -- One atomic statement claims the oldest due job or finds none.
  select j.id, j.course_id, j.type, j.params, j.input_asset_id,
         a.path_or_url, a.mime, j.attempts
    into claimed
  from public.jobs j
  join public.assets a on a.id = j.input_asset_id
  where j.status = 'queued'
    and j.runner = 'worker'
    and j.run_after <= now ()
    and a.storage = 'supabase' -- Drive links have no signed URL to give
  order by j.created_at
  for update of j skip locked
  limit 1;

  if not found then
    -- Still a heartbeat: the worker is alive even with an empty queue.
    insert into public.worker_heartbeats (id, last_seen_at, current_job_id)
      values (worker_name, now (), null)
      on conflict (id) do update
        set last_seen_at = now (), current_job_id = null;
    return;
  end if;

  update public.jobs
    set status = 'running', claimed_by = worker_name, updated_at = now ()
  where id = claimed.id;

  insert into public.worker_heartbeats (id, last_seen_at, current_job_id)
    values (worker_name, now (), claimed.id)
    on conflict (id) do update
      set last_seen_at = now (), current_job_id = claimed.id;

  return query
    select claimed.id, claimed.course_id, claimed.type, claimed.params,
           claimed.input_asset_id, claimed.path_or_url, claimed.mime,
           claimed.attempts;
end $$;

-- Only the server may call this: the API route runs as the service role.
revoke execute on function public.claim_worker_job (text) from public;
revoke execute on function public.claim_worker_job (text) from anon;
revoke execute on function public.claim_worker_job (text) from authenticated;
grant execute on function public.claim_worker_job (text) to service_role;
