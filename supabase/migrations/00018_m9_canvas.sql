-- Study Hub — M9 Canvas foundation (CANVAS-SPEC section 5):
-- canvases, cards, edges and versions. Every table: RLS ENABLED and FORCED,
-- column-level grants, no grants to anon, guard triggers for cross-course
-- integrity and caps, tested in supabase/tests/rls/16_canvas.sql.
--
-- Canvas = a persisted, editable map. Cards REFERENCE notes/files (D1):
-- a card never copies content, so a publishing note updates the map too.
-- Adaptations from the spec sketch, verified against the repository first
-- (docs/M9-recon.md): profiles.global_role (R1), helpers is_admin() and
-- can_access_course() exist (R2), the touch function is touch_updated_at()
-- (R5), and — confirmed decision QUESTIONS #31 — EVERY course member may
-- edit (owner, editor, contributor and reviewer; students and strangers
-- cannot), so can_edit_canvas is "admin OR any valid course_members row".

-- ---------------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------------

-- May the caller edit canvases in this course?
-- D7 (QUESTIONS #31): admin, owner, editor, contributor AND reviewer.
-- A membership outside its validity window counts as absent (same rule as
-- src/lib/course-access.ts getMembership — "enforced twice").
create or replace function public.can_edit_canvas(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin ()
    or exists (
      select 1
      from public.course_members m
      where m.course_id = p_course_id
        and m.user_id = auth.uid ()
        and (m.valid_from is null or m.valid_from <= current_date)
        and (m.valid_until is null or m.valid_until >= current_date)
    );
$$;

-- "Course staff" for read visibility: the same set as can_edit_canvas now
-- that every member level edits (QUESTIONS #31). Draft canvases are visible
-- to course members only; everyone else (students, strangers) sees published
-- canvases of courses they can access.
create or replace function public.is_course_staff(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_edit_canvas (p_course_id);
$$;

revoke all on function public.can_edit_canvas (uuid), public.is_course_staff (uuid)
  from public, anon;
grant execute on function public.can_edit_canvas (uuid), public.is_course_staff (uuid)
  to authenticated;

-- Small int settings reader for the guard triggers (R5: there is no
-- RPC-side settings reader). The settings table is `value jsonb`; seeded
-- values include both numbers (10) and JSON strings ("10"), so both forms
-- must work, and a missing row must fall back to the default. Any surprise
-- value raises — the exception returns the default rather than failing a
-- student save because of a typing mistake in the settings screen.
create or replace function public.canvas_setting_int(p_key text, p_default int)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text;
begin
  select value::text into v from public.settings where key = p_key;
  if v is null or v = '' then
    return p_default;
  end if;
  v := trim(both '"' from v);
  if v !~ '^-?[0-9]+$' then
    return p_default;
  end if;
  return v::int;
exception when others then
  return p_default;
end $$;

revoke all on function public.canvas_setting_int (text, int) from public, anon;
grant execute on function public.canvas_setting_int (text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

-- canvases — one editable map for one course.
create table public.canvases (
  id           uuid primary key default gen_random_uuid (),
  course_id    uuid not null references public.courses (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 120),
  kind         text not null default 'free' check (kind in ('course', 'subject', 'free')),
  root_node_id uuid references public.nodes (id) on delete set null,
  is_default   boolean not null default false,
  published    boolean not null default false,
  legend       jsonb not null default '{}'::jsonb
               check (jsonb_typeof(legend) = 'object' and octet_length(legend::text) < 4096),
  viewport     jsonb not null default jsonb_build_object('x', 0, 'y', 0, 'zoom', 1)
               check (jsonb_typeof(viewport) = 'object'),
  rev          bigint not null default 0,
  created_by   uuid not null default auth.uid () references public.profiles (id),
  created_at   timestamptz not null default now (),
  updated_at   timestamptz not null default now (),
  deleted_at   timestamptz
);

comment on table public.canvases is
  'A persisted, editable map. published=true makes it visible to students; '
  'deletion is a soft delete through a server action (audit row written).';

-- One default map per course; used by /s/map/[courseId] (spec 5.7).
create unique index canvases_one_default on public.canvases (course_id)
  where is_default and deleted_at is null;
create index canvases_course_idx on public.canvases (course_id)
  where deleted_at is null;

-- canvas_nodes — one card on one canvas.
create table public.canvas_nodes (
  id         uuid primary key default gen_random_uuid (),
  canvas_id  uuid not null references public.canvases (id) on delete cascade,
  course_id  uuid not null references public.courses (id) on delete cascade, -- set by the guard trigger
  kind       text not null check (kind in ('note', 'file', 'text', 'link', 'group')),
  node_id    uuid references public.nodes (id) on delete cascade,             -- kind = note
  asset_id   uuid references public.assets (id) on delete cascade,            -- kind = file
  url        text check (url is null or (char_length(url) <= 2048 and url ~* '^https?://')),
  x          double precision not null check (x between -100000 and 100000),
  y          double precision not null check (y between -100000 and 100000),
  width      double precision not null check (width between 40 and 4000),
  height     double precision not null check (height between 30 and 4000),
  z          integer not null default 0 check (z between -1000 and 1000),
  color      text check (color is null or color ~ '^[1-6]$'),
  body       text check (body is null or char_length(body) <= 20000),          -- text cards (Markdown)
  label      text check (label is null or char_length(label) <= 200),          -- group / link title
  student_visible boolean not null default true,                               -- text/link/group cards too
  created_by uuid not null default auth.uid () references public.profiles (id),
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  constraint canvas_nodes_ref_by_kind check (
    (kind = 'note' and node_id is not null and asset_id is null and url is null) or
    (kind = 'file' and asset_id is not null and node_id is null and url is null) or
    (kind = 'link' and url is not null and node_id is null and asset_id is null) or
    (kind = 'text' and body is not null and node_id is null and asset_id is null and url is null) or
    (kind = 'group' and node_id is null and asset_id is null and url is null))
);

comment on table public.canvas_nodes is
  'One card on one canvas. Cards reference notes and files in their own '
  'course (D1); the guard trigger enforces the course match and the card '
  'cap. Groups are pure geometry (D4): no hierarchy, no parentId.';

create index canvas_nodes_canvas_idx on public.canvas_nodes (canvas_id);
create index canvas_nodes_node_idx on public.canvas_nodes (node_id)
  where node_id is not null;
create index canvas_nodes_asset_idx on public.canvas_nodes (asset_id)
  where asset_id is not null;

-- canvas_edges — arrows between two cards of the same canvas.
create table public.canvas_edges (
  id         uuid primary key default gen_random_uuid (),
  canvas_id  uuid not null references public.canvases (id) on delete cascade,
  course_id  uuid not null references public.courses (id) on delete cascade, -- set by the guard trigger
  from_node  uuid not null references public.canvas_nodes (id) on delete cascade,
  to_node    uuid not null references public.canvas_nodes (id) on delete cascade,
  from_side  text not null default 'right' check (from_side in ('top', 'right', 'bottom', 'left')),
  to_side    text not null default 'left' check (to_side in ('top', 'right', 'bottom', 'left')),
  from_end   text not null default 'none' check (from_end in ('none', 'arrow')),
  to_end     text not null default 'arrow' check (to_end in ('none', 'arrow')),
  label      text check (label is null or char_length(label) <= 200),
  color      text check (color is null or color ~ '^[1-6]$'),
  created_by uuid not null default auth.uid () references public.profiles (id),
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  constraint canvas_edges_no_self_loop check (from_node <> to_node),
  constraint canvas_edges_unique unique (canvas_id, from_node, to_node, from_side, to_side)
);

create index canvas_edges_canvas_idx on public.canvas_edges (canvas_id);

-- canvas_versions — snapshots of a canvas (immutable rows, like
-- node_versions in 00013/00014). snapshot is the JSON of cards + edges +
-- legend; version_no is assigned by the guard trigger.
create table public.canvas_versions (
  id         uuid primary key default gen_random_uuid (),
  canvas_id  uuid not null references public.canvases (id) on delete cascade,
  course_id  uuid not null references public.courses (id) on delete cascade, -- set by the guard trigger
  version_no integer not null,                                                -- set by the guard trigger
  label      text check (label is null or char_length(label) <= 120),
  auto       boolean not null default false,
  snapshot   jsonb not null check (octet_length(snapshot::text) <= 2000000),
  created_by uuid not null default auth.uid () references public.profiles (id),
  created_at timestamptz not null default now (),
  unique (canvas_id, version_no)
);

create index canvas_versions_canvas_idx on public.canvas_versions (canvas_id);

-- ---------------------------------------------------------------------------
-- 2. Guard triggers: same-course integrity, card cap, derived columns.
-- All security definer with a pinned search_path (project convention 00016).
-- ---------------------------------------------------------------------------

create or replace function public.canvas_nodes_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course uuid;
  v_ref uuid;
  v_cap int;
begin
  select course_id into v_course from public.canvases
    where id = new.canvas_id and deleted_at is null;
  if v_course is null then
    raise exception 'canvas not found';
  end if;
  new.course_id := v_course;

  -- A card may only reference a note or file of its own course (D1).
  if new.kind = 'note' then
    select course_id into v_ref from public.nodes where id = new.node_id;
    if v_ref is distinct from v_course then
      raise exception 'note belongs to another course';
    end if;
  elsif new.kind = 'file' then
    select course_id into v_ref from public.assets where id = new.asset_id;
    if v_ref is distinct from v_course then
      raise exception 'file belongs to another course';
    end if;
  end if;

  -- Card cap: kept in `settings`, never in code (constitution rule 8).
  if tg_op = 'INSERT' then
    v_cap := least(public.canvas_setting_int('max_canvas_cards', 300), 1000);
    if (select count(*) from public.canvas_nodes where canvas_id = new.canvas_id) >= v_cap then
      raise exception 'canvas card limit reached';
    end if;
  end if;
  return new;
end $$;

create trigger canvas_nodes_guard_trg
  before insert or update of canvas_id, node_id, asset_id on public.canvas_nodes
  for each row execute function public.canvas_nodes_guard ();

create trigger canvas_nodes_touch_updated_at
  before update on public.canvas_nodes
  for each row execute function public.touch_updated_at ();

create or replace function public.canvas_edges_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course uuid;
begin
  select course_id into v_course from public.canvases
    where id = new.canvas_id and deleted_at is null;
  if v_course is null then
    raise exception 'canvas not found';
  end if;
  new.course_id := v_course;

  -- Both endpoints must be cards of the same canvas.
  if (select count(*) from public.canvas_nodes
      where id in (new.from_node, new.to_node) and canvas_id = new.canvas_id) <> 2 then
    raise exception 'edge endpoints must be cards of the same canvas';
  end if;
  return new;
end $$;

create trigger canvas_edges_guard_trg
  before insert or update of canvas_id, from_node, to_node on public.canvas_edges
  for each row execute function public.canvas_edges_guard ();

create trigger canvas_edges_touch_updated_at
  before update on public.canvas_edges
  for each row execute function public.touch_updated_at ();

create or replace function public.canvas_versions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course uuid;
begin
  select course_id into v_course from public.canvases
    where id = new.canvas_id and deleted_at is null;
  if v_course is null then
    raise exception 'canvas not found';
  end if;
  new.course_id := v_course;

  -- Version numbers increase per canvas; the caller never sets them.
  select coalesce(max(version_no), 0) + 1 into new.version_no
    from public.canvas_versions where canvas_id = new.canvas_id;
  return new;
end $$;

create trigger canvas_versions_guard_trg
  before insert on public.canvas_versions
  for each row execute function public.canvas_versions_guard ();

create trigger canvases_touch_updated_at
  before update on public.canvases
  for each row execute function public.touch_updated_at ();

-- ---------------------------------------------------------------------------
-- 3. RLS (enabled AND forced, spec section 11 item 1)
-- ---------------------------------------------------------------------------

alter table public.canvases enable row level security;
alter table public.canvases force row level security;
alter table public.canvas_nodes enable row level security;
alter table public.canvas_nodes force row level security;
alter table public.canvas_edges enable row level security;
alter table public.canvas_edges force row level security;
alter table public.canvas_versions enable row level security;
alter table public.canvas_versions force row level security;

-- Canvases: course members see everything of their course (they edit),
-- everyone else only published, undeleted ones of courses they can access.
create policy canvases_select on public.canvases
  as permissive for select to authenticated
  using (
    deleted_at is null
    and public.can_access_course (course_id)
    and (published or public.is_course_staff (course_id))
  );

create policy canvases_insert on public.canvases
  as permissive for insert to authenticated
  with check (public.can_edit_canvas (course_id) and created_by = auth.uid ());

create policy canvases_update on public.canvases
  as permissive for update to authenticated
  using (public.can_edit_canvas (course_id) and deleted_at is null)
  with check (public.can_edit_canvas (course_id) and deleted_at is null);

-- No delete policy: deletion is a soft delete through a server action
-- (admin client + audit row).

-- Cards: course members see every card; students (RLS "non-members" here —
-- account-less students are served by the app with the service-role client
-- filtered by the cookie scope, R8) and other-course strangers only cards
-- whose target they may see (D8): text/link/group cards that are
-- student_visible, note cards whose note is published, and file cards whose
-- asset is student_visible.
create policy canvas_nodes_select on public.canvas_nodes
  as permissive for select to authenticated
  using (
    exists (
      select 1 from public.canvases c
      where c.id = canvas_nodes.canvas_id
        and c.deleted_at is null
    )
    and (
      public.is_course_staff (course_id)
      or (student_visible and (
            kind in ('text', 'link', 'group')
         or (kind = 'note' and exists (
              select 1 from public.nodes n
              where n.id = canvas_nodes.node_id
                and n.published_version_id is not null
                and n.deleted_at is null))
         or (kind = 'file' and exists (
              select 1 from public.assets a
              where a.id = canvas_nodes.asset_id and a.student_visible))
      ))
    ));

create policy canvas_nodes_insert on public.canvas_nodes
  as permissive for insert to authenticated
  with check (public.can_edit_canvas (course_id) and created_by = auth.uid ());

create policy canvas_nodes_update on public.canvas_nodes
  as permissive for update to authenticated
  using (public.can_edit_canvas (course_id))
  with check (public.can_edit_canvas (course_id));

create policy canvas_nodes_delete on public.canvas_nodes
  as permissive for delete to authenticated
  using (public.can_edit_canvas (course_id));

-- Edges: visible only if BOTH end cards are visible to the caller (the
-- canvas_nodes select policy applies inside these exists() checks).
create policy canvas_edges_select on public.canvas_edges
  as permissive for select to authenticated
  using (
    exists (select 1 from public.canvas_nodes f where f.id = canvas_edges.from_node)
    and exists (select 1 from public.canvas_nodes t where t.id = canvas_edges.to_node)
  );

create policy canvas_edges_insert on public.canvas_edges
  as permissive for insert to authenticated
  with check (public.can_edit_canvas (course_id) and created_by = auth.uid ());

create policy canvas_edges_update on public.canvas_edges
  as permissive for update to authenticated
  using (public.can_edit_canvas (course_id))
  with check (public.can_edit_canvas (course_id));

create policy canvas_edges_delete on public.canvas_edges
  as permissive for delete to authenticated
  using (public.can_edit_canvas (course_id));

-- Versions: course members only. No update or delete grant (immutable rows,
-- like node_versions in 00013). Pruning happens with the admin client.
create policy canvas_versions_select on public.canvas_versions
  as permissive for select to authenticated
  using (public.is_course_staff (course_id));

create policy canvas_versions_insert on public.canvas_versions
  as permissive for insert to authenticated
  with check (public.can_edit_canvas (course_id) and created_by = auth.uid ());

-- ---------------------------------------------------------------------------
-- 4. Grants: column-level, nothing for anon. `rev` is granted only so the
--   canvas_apply_ops RPC can bump it (QUESTIONS #43); the regular REST API
--   should not write it. Protected columns are NOT grantable.
-- ---------------------------------------------------------------------------

revoke all on public.canvases, public.canvas_nodes, public.canvas_edges, public.canvas_versions
  from anon, authenticated;
grant select on public.canvases, public.canvas_nodes, public.canvas_edges, public.canvas_versions
  to authenticated;

grant insert (id, course_id, title, kind, root_node_id, legend, viewport)
  on public.canvases to authenticated;
grant update (title, root_node_id, legend, viewport, published, is_default, rev)
  on public.canvases to authenticated;

grant insert (id, canvas_id, kind, node_id, asset_id, url, x, y, width, height, z, color, body, label, student_visible)
  on public.canvas_nodes to authenticated;
grant update (x, y, width, height, z, color, body, label, url, student_visible)
  on public.canvas_nodes to authenticated;
grant delete on public.canvas_nodes to authenticated;

grant insert (id, canvas_id, from_node, to_node, from_side, to_side, from_end, to_end, label, color)
  on public.canvas_edges to authenticated;
grant update (from_side, to_side, from_end, to_end, label, color)
  on public.canvas_edges to authenticated;
grant delete on public.canvas_edges to authenticated;

grant insert (id, canvas_id, label, auto, snapshot)
  on public.canvas_versions to authenticated;
