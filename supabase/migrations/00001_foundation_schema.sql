-- Study Hub — M0 Foundation: core tables (spec section 5)
-- Every table: RLS on (policies in 00002), uuid ids, timestamptz, created_at.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles — one row per leader or admin
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  global_role text not null default 'leader'
    check (global_role in ('admin', 'leader')),
  is_active boolean not null default true,
  must_change_password boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per leader or admin. Created by the on_auth_user_created trigger. '
  'is_active=false blocks sign-in (enforced in M1 login flow).';

-- ---------------------------------------------------------------------------
-- courses — the study hub's first organizing unit
-- ---------------------------------------------------------------------------
create table public.courses (
  id uuid primary key default gen_random_uuid (),
  code text not null unique,
  title text not null,
  semester text not null default '',
  archived boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- course_members — the permission source (spec section 4)
-- role: owner | editor | contributor | reviewer
-- areas: which of course content areas the leader may work in
-- ---------------------------------------------------------------------------
create table public.course_members (
  course_id uuid not null references public.courses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null
    check (role in ('owner', 'editor', 'contributor', 'reviewer')),
  areas text[] not null default '{}',
  valid_from date,
  valid_until date,
  created_at timestamptz not null default now(),
  primary key (course_id, user_id)
);

create index course_members_user_id_idx on public.course_members (user_id);
create index course_members_course_id_idx on public.course_members (course_id);

-- ---------------------------------------------------------------------------
-- settings — limits and feature flags live in data, never in code
-- (spec section 12 rule 8)
-- ---------------------------------------------------------------------------
create table public.settings (
  key text primary key,
  value jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- audit_log — who did what, written by the server only (spec section 9)
-- No client-side policies: only admins SELECT, only service_role INSERTs.
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id uuid primary key default gen_random_uuid (),
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity text not null,
  entity_id uuid,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_actor_id_idx on public.audit_log (actor_id);
create index audit_log_created_at_idx on public.audit_log (created_at desc);
