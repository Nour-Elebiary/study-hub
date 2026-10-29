-- Study Hub — M7 AI assistant: key pool, limits, usage, conversations
-- (spec sections 5 and 8).
--
-- Compliance shape (spec section 8 "Compliance first"): one key per Google
-- Cloud project (project_label is unique), the ciphertext is never readable
-- by any client role (column grants), and every client-facing write goes
-- through the server with the service-role key. The router, not the client,
-- decides whose key is used — a leader's own key for their own requests.

-- ---------------------------------------------------------------------------
-- ai_keys: each leader's own API key, encrypted at rest (AES-256-GCM,
-- stored as base64 text so the JSON round-trip is unambiguous).
-- provider: 'gemini' for now; other providers arrive with Tier 2 and extend
-- the check. status 'cooling' means the router skips the key until
-- cooldown_until (set on a 429 whose retry delay points past the minute).
-- ---------------------------------------------------------------------------
create table public.ai_keys (
  id uuid primary key default gen_random_uuid (),
  owner_id uuid not null references auth.users (id) on delete cascade,
  label text not null check (char_length (label) between 1 and 60),
  provider text not null default 'gemini' check (provider in ('gemini')),
  key_ciphertext text not null,
  key_last4 text not null check (char_length (key_last4) = 4),
  -- One key per Google Cloud project (spec section 8): a second key for the
  -- same project is refused by the app, because Google counts quota per
  -- project and two keys on one project would double-count nothing.
  project_label text not null unique check (char_length (project_label) between 1 and 120),
  status text not null default 'active'
    check (status in ('active', 'cooling', 'disabled')),
  cooldown_until timestamptz,
  created_at timestamptz not null default now ()
);

create index ai_keys_owner_idx on public.ai_keys (owner_id, status);

alter table public.ai_keys enable row level security;
alter table public.ai_keys force row level security;

-- Owners and admins may read the metadata (the Add-key screen, the admin
-- usage bars) — but never the ciphertext: the column grant below omits
-- key_ciphertext, so no client role can select it even with a policy pass.
create policy select_own_or_admin_keys on public.ai_keys
  as permissive for select to authenticated
  using (owner_id = auth.uid () or public.is_admin ());

-- No insert/update/delete policies at all: keys are created, cooled down,
-- and deleted only by the server (service role), so a client can never
-- write a key it does not own or flip someone's status.

revoke all on public.ai_keys from anon, authenticated;
grant select (
  id, owner_id, label, provider, key_last4, project_label, status,
  cooldown_until, created_at
) on public.ai_keys to authenticated;

-- ---------------------------------------------------------------------------
-- ai_limits: the per-model quota numbers the router compares against
-- (spec section 8 "Limit sensing"). Edited by the admin when Google changes
-- the free-tier limits — never hardcoded (spec rule 8).
-- ---------------------------------------------------------------------------
create table public.ai_limits (
  id uuid primary key default gen_random_uuid (),
  provider text not null,
  model text not null,
  rpm integer not null check (rpm > 0),
  tpm integer not null check (tpm > 0),
  rpd integer not null check (rpd > 0),
  soft_pct integer not null default 80 check (soft_pct between 1 and 100),
  created_at timestamptz not null default now (),
  unique (provider, model)
);

alter table public.ai_limits enable row level security;
alter table public.ai_limits force row level security;

create policy admin_full_limits on public.ai_limits
  as permissive for all to authenticated
  using (public.is_admin ())
  with check (public.is_admin ());

revoke all on public.ai_limits from anon, authenticated;
grant select, insert, update, delete on public.ai_limits to authenticated;

-- ---------------------------------------------------------------------------
-- ai_usage: rolling request/token counters per key, model and bucket
-- (minute or day). Advisory only — a real 429 is the final truth. Written
-- by the router (service role); admins read it for the usage screen.
-- ---------------------------------------------------------------------------
create table public.ai_usage (
  key_id uuid not null references public.ai_keys (id) on delete cascade,
  model text not null,
  bucket_start timestamptz not null,
  bucket_kind text not null check (bucket_kind in ('minute', 'day')),
  requests integer not null default 0,
  tokens_est integer not null default 0,
  primary key (key_id, model, bucket_start, bucket_kind)
);

alter table public.ai_usage enable row level security;
alter table public.ai_usage force row level security;

create policy admin_read_usage on public.ai_usage
  as permissive for select to authenticated
  using (public.is_admin ());

revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;

-- ---------------------------------------------------------------------------
-- ai_conversations: the AI is stateless, so the thread lives here. One
-- conversation per (user, node) context; running_summary is the handoff
-- packet's memory, refreshed every 6 turns or ~6000 tokens.
-- ---------------------------------------------------------------------------
create table public.ai_conversations (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references auth.users (id) on delete cascade,
  node_id uuid references public.nodes (id) on delete set null,
  title text not null default 'New chat',
  running_summary text not null default '',
  summary_upto_msg integer not null default 0,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now ()
);

create index ai_conversations_user_idx on public.ai_conversations (user_id);

alter table public.ai_conversations enable row level security;
alter table public.ai_conversations force row level security;

create policy full_own_conversations on public.ai_conversations
  as permissive for all to authenticated
  using (user_id = auth.uid ())
  with check (user_id = auth.uid ());

revoke all on public.ai_conversations from anon, authenticated;
grant select, insert, update, delete on public.ai_conversations to authenticated;

-- ---------------------------------------------------------------------------
-- ai_messages: the turns. key_id/model record which key actually served an
-- assistant reply (for the usage screen and audits) — the column is set by
-- the server; clients never choose it. Messages are kept 90 days
-- (settings.retention_ai_days) and their author can delete them.
-- ---------------------------------------------------------------------------
create table public.ai_messages (
  id uuid primary key default gen_random_uuid (),
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  key_id uuid references public.ai_keys (id) on delete set null,
  model text,
  tokens_est integer not null default 0,
  created_at timestamptz not null default now ()
);

create index ai_messages_conversation_idx on public.ai_messages (conversation_id, created_at);

alter table public.ai_messages enable row level security;
alter table public.ai_messages force row level security;

-- Read and delete your own conversation's turns. Inserts and updates are
-- server-only (the endpoint writes both sides with the service role), so a
-- client cannot forge an assistant turn or attach someone else's key to one.
create policy read_own_messages on public.ai_messages
  as permissive for select to authenticated
  using (
    exists (
      select 1 from public.ai_conversations c
      where c.id = conversation_id and c.user_id = auth.uid ()
    )
  );

create policy delete_own_messages on public.ai_messages
  as permissive for delete to authenticated
  using (
    exists (
      select 1 from public.ai_conversations c
      where c.id = conversation_id and c.user_id = auth.uid ()
    )
  );

revoke all on public.ai_messages from anon, authenticated;
grant select, delete on public.ai_messages to authenticated;

-- ---------------------------------------------------------------------------
-- ai_handoffs: one row per key or provider switch, with the packet that
-- carried the context over (spec section 8 "Handoff packet").
-- ---------------------------------------------------------------------------
create table public.ai_handoffs (
  id uuid primary key default gen_random_uuid (),
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  from_key_id uuid references public.ai_keys (id) on delete set null,
  to_key_id uuid references public.ai_keys (id) on delete set null,
  reason text not null check (char_length (reason) between 1 and 200),
  packet jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now ()
);

alter table public.ai_handoffs enable row level security;
alter table public.ai_handoffs force row level security;

create policy read_own_handoffs on public.ai_handoffs
  as permissive for select to authenticated
  using (
    exists (
      select 1 from public.ai_conversations c
      where c.id = conversation_id and c.user_id = auth.uid ()
    )
  );

revoke all on public.ai_handoffs from anon, authenticated;
grant select on public.ai_handoffs to authenticated;
