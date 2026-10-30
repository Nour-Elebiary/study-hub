# Study Hub — Canvas, Design System & Study Tools (M9–M13)

**Build specification for opencode** · Version 1.0 · 30 October 2026 · Builds on M0–M8 (migrations 00001–00017)

## 0. How to use this document

This is the single source of truth for the next five milestones of Study Hub. It is written for a coding agent (opencode) and for Nour, who reviews each milestone.

- **Order.** Build M9 → M13 in order. One milestone = one branch = one pull request. Do not start a milestone until the previous one is green in CI and its acceptance list is ticked.
- **Kickoff prompts.** Copy the prompt for each milestone from §15 into opencode.
- **Words.** MUST / MUST NOT are hard rules. SHOULD is the default unless a reason is written in `docs/QUESTIONS.md`. **Decision** means already decided; do not reopen it. **Open** means: build the simplest safe option and add a row to `docs/QUESTIONS.md` (spec rule 2).
- **If the repository and this document disagree:** for existing behaviour (names, signatures, column names) the repository wins; for new behaviour this document wins. Record every difference in `docs/QUESTIONS.md`.
- **Do not invent facts about the repo.** Anything marked **\[RECON\]** must be read from the code first (§4).

## 1. Goals and non-goals

| # | Goal | Milestone |
| --- | --- | --- |
| 1 | A persisted, editable infinite canvas where leaders connect, create, edit, delete and organise notes and files while keeping the mind-map | M9, M10 |
| 2 | Colour, theme, UI and UX overhaul for phone, tablet, desktop and the installed PWA | M11 |
| 3 | Obsidian-style knowledge links: wikilinks, backlinks, graph, JSON Canvas import/export, Obsidian vault export, better Arabic search | M12 |
| 4 | Live co-working for leaders and free study tools for students | M13 |

**Non-goals (v1):** no paid service of any kind; no student accounts; no offline editing or CRDT; no AI writing into published content without leader review; no remote images, link unfurling or third-party analytics; no native apps.

## 2. Ground rules inherited from the project (MUST)

1. TypeScript strict, no `any` (constitution rule 3). Validate every input with zod at the boundary (server actions, API routes, imports).
2. RLS enabled **and forced** on every new table; every new table gets RLS tests in `scripts/test-rls.mjs`. Never disable RLS or a test to make something pass.
3. Secrets only in env files, never in code, tests, logs or commits (rule 4).
4. Mobile-first at 360 px, plain-language labels, 44 px touch targets, visible focus rings, axe-clean (rule 6).
5. Every new service or dependency gets a row in `docs/FREE_TIER.md` (date, licence, official source) **before** the code that uses it is merged (spec section 12 rule 7).
6. Heavy files never run on Vercel (spec section 2). Browser-side jobs re-validate on the server (spec section 7 rule 2).
7. AI keys stay per leader; AI never reads a file that is not marked allowed (rule 9). Nothing in this document changes that.
8. Students have no accounts and no personal data is stored about them. Anything a student creates (bookmarks, flashcard progress) lives **on their device**.
9. Limits live in the `settings` table, not in code. Rate limits use `consume_rate_limit`.
10. Before every commit: `npm run lint && npm run typecheck && npm test` (rule 10). CI (quality, rls, e2e) MUST be green before merge.
11. Next 16 with `cacheComponents`: follow existing page patterns; do not add `force-dynamic` (QUESTIONS #27).
12. Student-facing strings go through `src/messages/en.json`; leader/admin strings may stay hard-coded English (QUESTIONS #24).

If `AGENTS.md` numbers these rules differently, follow `AGENTS.md`.

## 3. Product decisions (already made)

| ID | Decision | Why |
| --- | --- | --- |
| D1 | **Cards are views, not copies.** A card references a note or a file. “Remove from canvas” deletes only the card; “Delete note/file” is a separate action with the existing soft-delete rules. | Non-technical leaders must never lose content by tidying a map. |
| D2 | Canvas data is **normalised rows** (`canvas_nodes`, `canvas_edges`), not one JSON blob. A JSON snapshot is stored only in `canvas_versions`. | RLS per card, per-card realtime, small writes. |
| D3 | Fields mirror the open **JSON Canvas** format (text/file/link/group nodes; edges with sides and ends; colours 1–6). | Free Obsidian interoperability in M12. |
| D4 | **Groups are plain rectangles.** Membership is by geometry. “Move group with its contents” is client behaviour at drag start. | Matches JSON Canvas; no parent column. |
| D5 | **All structural writes go through one RPC**, `canvas_apply_ops` (atomic, at most 200 ops). | One choke point for caps, validation and `rev`. |
| D6 | Concurrent edits are **last-write-wins per card**. No CRDT in v1. | Leaders are few; simple and predictable. |
| D7 | Who edits canvases: **admin, course owner, course editor.** Contributors and reviewers read. | A map is shared structure. (Open: confirm with Nour; QUESTIONS.) |
| D8 | Student view is read-only. Cards whose note is unpublished or whose file is not student-visible, and edges touching them, are **invisible at the RLS level**. | “Students cannot even find out those pages exist.” |
| D9 | The **outline (tree) view stays** and is the accessible alternative. On screens under 768 px the outline is the default; the canvas is one tap away. | An infinite canvas on a 360 px phone is a poor default. |
| D10 | The existing `/courses/[courseId]/map` stays until M10 is accepted, then redirects to the default canvas. | No regression while building. |
| D11 | No remote images, favicons or link previews in cards. Markdown images only from the app’s own signed storage URLs. | CSP and privacy (QUESTIONS #23). |
| D12 | Wikilinks are **plain text** `[[Title]]` in the Markdown body, resolved at render time. | Zero TipTap serialisation risk; Obsidian-compatible. |
| D13 | Themes use `data-theme` on `<html>` plus CSS variables. A course accent comes from a **preset list only**. | Contrast can be guaranteed by a script. |
| D14 | Realtime is for **leaders only**. Students refresh on focus. | Protects the free Realtime connection budget. |
| D15 | Leader theme and student theme are stored on the device (`localStorage`). | No schema change, works for students. |

## 4. Step 0 — Reconnaissance **\[RECON\]** (before writing any SQL or code)

Read the files below and write the findings into a new file `docs/M9-recon.md` (a table: *question → answer → file and line*). If an answer contradicts an assumption in this document, stop, write it in `docs/QUESTIONS.md`, and adapt using the simplest safe option.

| ID | Find out | Look in |
| --- | --- | --- |
| R1 | Exact names and signatures of the course-access helpers (`can_access_course(...)` and any write/staff helper) and how `nodes` INSERT/UPDATE policies use them | `00001`, `00005`, `00006` |
| R2 | Column names of `course_members` (user column, role column and role values) and `profiles.role` | `00001`, `00002` |
| R3 | Columns of `nodes` (kind/area enums, `deleted_at`, `published_version_id`, `slug`, `created_by` type) and of `assets` (`student_visible`, `student_downloadable`, `ai_allowed`, storage path) | `00005`, `00006` |
| R4 | The `set_updated_at` trigger function and how other tables attach it | `00016` |
| R5 | Shape of the `settings` table and its reader RPC; how `src/lib/settings.ts` registers a key | `00002`, `src/lib/settings.ts` |
| R6 | How students are evaluated in SQL and in the DAL (cookie → memberships → `can_access_course`); the function that lists a student’s nodes | `src/lib/student-access.ts`, `src/lib/dal.ts`, `00007` |
| R7 | The storage helper that creates signed download URLs and the upload helper (magic-byte check, size limit, allow-list) | `src/lib/storage.ts`, `src/lib/file-allowlist.ts` |
| R8 | The public API of `src/lib/mind-map.ts` and the page `/courses/[courseId]/map` | `src/lib/mind-map.ts`, `src/app/(leader)/courses/[courseId]/map` |
| R9 | How `scripts/test-rls.mjs` builds fixtures, numbers tests (the last test number) and which seed users exist | `scripts/test-rls.mjs`, seed files |
| R10 | How Playwright tests sign in as leader/admin and join as student; fixture helpers; axe helper | `e2e/` or `tests/` |
| R11 | The inline script in the root layout (text-size) and the `<html>` attributes it sets | `src/app/layout.tsx` |
| R12 | How `rate-limit.ts` registers a purpose; how `audit.ts` is called | `src/lib/rate-limit.ts`, `src/lib/audit.ts` |

**Placeholders in this document:** where SQL or code uses a name from R1–R12 that may differ in the repo, it is written in the form `/* R1 */`. Replace it with the real name.

## 5. M9 — Canvas foundation (data, RPCs, view, edit basics)

### 5.1 Deliverables

1. Migrations `00018_m9_canvas.sql` and `00019_m9_canvas_ops.sql` (below).
2. Shared pure modules in `src/lib/canvas/` with unit tests (§5.4, §5.6).
3. DAL functions and server actions (§5.5).
4. Pages: leader canvas list, leader canvas editor (basic), student canvas viewer (§5.7).
5. **Generate from course** (§5.8) so nobody starts with a blank page.
6. RLS tests, unit tests, e2e tests (§5.9).
7. Docs updated: `PROJECT-GUIDE.md` (§6, §7, §14), `leader-guide.md` (new Canvas section; draft text in Appendix B), `FREE_TIER.md` (new rows), `QUESTIONS.md` (new rows).

### 5.2 Migration `00018_m9_canvas.sql`

```sql
-- Canvas = a persisted, editable map. Cards REFERENCE notes/files (D1).

-- 0. Helpers. Skip any that already exist under another name (R1, R2).
create or replace function public.can_edit_canvas(p_course_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
      or exists (select 1 from public.course_members m
                 where m.course_id = p_course_id and m.user_id = auth.uid()   /* R2 */
                   and m.role in ('owner','editor'));                          /* R2 */
$$;

create or replace function public.is_course_staff(p_course_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
      or exists (select 1 from public.course_members m
                 where m.course_id = p_course_id and m.user_id = auth.uid());  /* R2 */
$$;

revoke all on function public.can_edit_canvas(uuid), public.is_course_staff(uuid) from public, anon;
grant execute on function public.can_edit_canvas(uuid), public.is_course_staff(uuid) to authenticated;

-- Settings reader used by the guard trigger. ADAPT to the settings table shape (R5).
create or replace function public.canvas_setting_int(p_key text, p_default int)
returns int language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  select value::text into v from public.settings where key = p_key;            /* R5 */
  return coalesce(nullif(trim(both '"' from v), '')::int, p_default);
exception when others then return p_default;
end $$;
revoke all on function public.canvas_setting_int(text, int) from public, anon;
grant execute on function public.canvas_setting_int(text, int) to authenticated;

-- 1. Tables
create table public.canvases (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 120),
  kind        text not null default 'free' check (kind in ('course','subject','free')),
  root_node_id uuid references public.nodes(id) on delete set null,
  is_default  boolean not null default false,
  published   boolean not null default false,
  legend      jsonb not null default '{}'::jsonb
              check (jsonb_typeof(legend) = 'object' and octet_length(legend::text) < 4096),
  viewport    jsonb not null default jsonb_build_object('x', 0, 'y', 0, 'zoom', 1)
              check (jsonb_typeof(viewport) = 'object'),
  rev         bigint not null default 0,
  created_by  uuid not null default auth.uid() references public.profiles(id),  /* R3 */
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index canvases_one_default on public.canvases (course_id) where is_default and deleted_at is null;
create index canvases_course_idx on public.canvases (course_id) where deleted_at is null;

create table public.canvas_nodes (
  id         uuid primary key default gen_random_uuid(),
  canvas_id  uuid not null references public.canvases(id) on delete cascade,
  course_id  uuid not null references public.courses(id) on delete cascade,   -- set by guard trigger
  kind       text not null check (kind in ('note','file','text','link','group')),
  node_id    uuid references public.nodes(id)  on delete cascade,             -- kind = note
  asset_id   uuid references public.assets(id) on delete cascade,             -- kind = file
  url        text check (url is null or (char_length(url) <= 2048 and url ~* '^https?://')),
  x          double precision not null check (x between -100000 and 100000),
  y          double precision not null check (y between -100000 and 100000),
  width      double precision not null check (width  between 40 and 4000),
  height     double precision not null check (height between 30 and 4000),
  z          integer not null default 0 check (z between -1000 and 1000),
  color      text check (color is null or color ~ '^[1-6]$'),
  body       text check (body is null or char_length(body) <= 20000),         -- text cards (Markdown)
  label      text check (label is null or char_length(label) <= 200),         -- group / link title
  student_visible boolean not null default true,                              -- text/link/group cards
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canvas_nodes_ref_by_kind check (
    (kind = 'note'  and node_id is not null and asset_id is null and url is null) or
    (kind = 'file'  and asset_id is not null and node_id is null and url is null) or
    (kind = 'link'  and url is not null and node_id is null and asset_id is null) or
    (kind = 'text'  and body is not null and node_id is null and asset_id is null and url is null) or
    (kind = 'group' and node_id is null and asset_id is null and url is null))
);
create index canvas_nodes_canvas_idx on public.canvas_nodes (canvas_id);
create index canvas_nodes_node_idx   on public.canvas_nodes (node_id)  where node_id  is not null;
create index canvas_nodes_asset_idx  on public.canvas_nodes (asset_id) where asset_id is not null;

create table public.canvas_edges (
  id         uuid primary key default gen_random_uuid(),
  canvas_id  uuid not null references public.canvases(id) on delete cascade,
  course_id  uuid not null references public.courses(id) on delete cascade,   -- set by guard trigger
  from_node  uuid not null references public.canvas_nodes(id) on delete cascade,
  to_node    uuid not null references public.canvas_nodes(id) on delete cascade,
  from_side  text not null default 'right'  check (from_side in ('top','right','bottom','left')),
  to_side    text not null default 'left'   check (to_side   in ('top','right','bottom','left')),
  from_end   text not null default 'none'   check (from_end  in ('none','arrow')),
  to_end     text not null default 'arrow'  check (to_end    in ('none','arrow')),
  label      text check (label is null or char_length(label) <= 200),
  color      text check (color is null or color ~ '^[1-6]$'),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canvas_edges_no_self_loop check (from_node <> to_node),
  constraint canvas_edges_unique unique (canvas_id, from_node, to_node, from_side, to_side)
);
create index canvas_edges_canvas_idx on public.canvas_edges (canvas_id);

create table public.canvas_versions (
  id         uuid primary key default gen_random_uuid(),
  canvas_id  uuid not null references public.canvases(id) on delete cascade,
  course_id  uuid not null references public.courses(id) on delete cascade,   -- set by guard trigger
  version_no integer not null,                                                -- set by guard trigger
  label      text check (label is null or char_length(label) <= 120),
  auto       boolean not null default false,
  snapshot   jsonb not null check (octet_length(snapshot::text) <= 2000000),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (canvas_id, version_no)
);

-- 2. Guard triggers: same-course integrity, caps, derived columns.
create or replace function public.canvas_nodes_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_course uuid; v_ref uuid; v_cap int;
begin
  select course_id into v_course from public.canvases where id = new.canvas_id and deleted_at is null;
  if v_course is null then raise exception 'canvas not found'; end if;
  new.course_id := v_course;
  if new.kind = 'note' then
    select course_id into v_ref from public.nodes where id = new.node_id;
    if v_ref is distinct from v_course then raise exception 'note belongs to another course'; end if;
  elsif new.kind = 'file' then
    select course_id into v_ref from public.assets where id = new.asset_id;
    if v_ref is distinct from v_course then raise exception 'file belongs to another course'; end if;
  end if;
  if tg_op = 'INSERT' then
    v_cap := least(public.canvas_setting_int('max_canvas_cards', 300), 1000);
    if (select count(*) from public.canvas_nodes where canvas_id = new.canvas_id) >= v_cap then
      raise exception 'canvas card limit reached';
    end if;
  end if;
  return new;
end $$;
create trigger canvas_nodes_guard_trg before insert or update of canvas_id, node_id, asset_id
  on public.canvas_nodes for each row execute function public.canvas_nodes_guard();

create or replace function public.canvas_edges_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_course uuid;
begin
  select course_id into v_course from public.canvases where id = new.canvas_id and deleted_at is null;
  if v_course is null then raise exception 'canvas not found'; end if;
  new.course_id := v_course;
  if (select count(*) from public.canvas_nodes
       where id in (new.from_node, new.to_node) and canvas_id = new.canvas_id) <> 2 then
    raise exception 'edge endpoints must be cards of the same canvas';
  end if;
  return new;
end $$;
create trigger canvas_edges_guard_trg before insert or update of canvas_id, from_node, to_node
  on public.canvas_edges for each row execute function public.canvas_edges_guard();

create or replace function public.canvas_versions_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_course uuid;
begin
  select course_id into v_course from public.canvases where id = new.canvas_id and deleted_at is null;
  if v_course is null then raise exception 'canvas not found'; end if;
  new.course_id := v_course;
  select coalesce(max(version_no), 0) + 1 into new.version_no
    from public.canvas_versions where canvas_id = new.canvas_id;
  return new;
end $$;
create trigger canvas_versions_guard_trg before insert
  on public.canvas_versions for each row execute function public.canvas_versions_guard();

create trigger canvases_touch before update on public.canvases
  for each row execute function public.set_updated_at();          /* R4 */
create trigger canvas_nodes_touch before update on public.canvas_nodes
  for each row execute function public.set_updated_at();
create trigger canvas_edges_touch before update on public.canvas_edges
  for each row execute function public.set_updated_at();

-- 3. RLS (enabled AND forced)
alter table public.canvases        enable row level security;
alter table public.canvases        force  row level security;
alter table public.canvas_nodes    enable row level security;
alter table public.canvas_nodes    force  row level security;
alter table public.canvas_edges    enable row level security;
alter table public.canvas_edges    force  row level security;
alter table public.canvas_versions enable row level security;
alter table public.canvas_versions force  row level security;

-- Canvases: staff see all of their course; everyone else only published, undeleted ones.
create policy canvases_select on public.canvases for select to authenticated
  using (deleted_at is null and public.can_access_course(course_id)      /* R1 */
         and (published or public.is_course_staff(course_id)));
create policy canvases_insert on public.canvases for insert to authenticated
  with check (public.can_edit_canvas(course_id) and created_by = auth.uid());
create policy canvases_update on public.canvases for update to authenticated
  using (public.can_edit_canvas(course_id)) with check (public.can_edit_canvas(course_id));
-- No delete policy: deletion is a soft delete through a server action (admin client + audit row).

-- Cards: staff see everything; students only cards whose target they may see (D8).
create policy canvas_nodes_select on public.canvas_nodes for select to authenticated
  using (
    exists (select 1 from public.canvases c where c.id = canvas_nodes.canvas_id)
    and (
      public.is_course_staff(course_id)
      or (student_visible and (
            kind in ('text','link','group')
         or (kind = 'note' and exists (select 1 from public.nodes n
               where n.id = canvas_nodes.node_id and n.published_version_id is not null
                 and n.deleted_at is null))                                   /* R3 */
         or (kind = 'file' and exists (select 1 from public.assets a
               where a.id = canvas_nodes.asset_id and a.student_visible))      /* R3 */
      ))
    ));
create policy canvas_nodes_insert on public.canvas_nodes for insert to authenticated
  with check (public.can_edit_canvas(course_id) and created_by = auth.uid());
create policy canvas_nodes_update on public.canvas_nodes for update to authenticated
  using (public.can_edit_canvas(course_id)) with check (public.can_edit_canvas(course_id));
create policy canvas_nodes_delete on public.canvas_nodes for delete to authenticated
  using (public.can_edit_canvas(course_id));

-- Edges: visible only if BOTH end cards are visible to the caller (RLS on canvas_nodes applies inside exists).
create policy canvas_edges_select on public.canvas_edges for select to authenticated
  using (
    exists (select 1 from public.canvas_nodes f where f.id = canvas_edges.from_node)
    and exists (select 1 from public.canvas_nodes t where t.id = canvas_edges.to_node));
create policy canvas_edges_insert on public.canvas_edges for insert to authenticated
  with check (public.can_edit_canvas(course_id) and created_by = auth.uid());
create policy canvas_edges_update on public.canvas_edges for update to authenticated
  using (public.can_edit_canvas(course_id)) with check (public.can_edit_canvas(course_id));
create policy canvas_edges_delete on public.canvas_edges for delete to authenticated
  using (public.can_edit_canvas(course_id));

-- Versions: staff only. No update/delete grant (immutable, like node_versions, 00013). Pruning = server action with admin client.
create policy canvas_versions_select on public.canvas_versions for select to authenticated
  using (public.is_course_staff(course_id));
create policy canvas_versions_insert on public.canvas_versions for insert to authenticated
  with check (public.can_edit_canvas(course_id) and created_by = auth.uid());

-- 4. Grants: column-level, nothing for anon. Protected columns are NOT grantable.
revoke all on public.canvases, public.canvas_nodes, public.canvas_edges, public.canvas_versions
  from anon, authenticated;
grant select on public.canvases, public.canvas_nodes, public.canvas_edges, public.canvas_versions to authenticated;

grant insert (id, course_id, title, kind, root_node_id, legend, viewport) on public.canvases to authenticated;
grant update (title, root_node_id, legend, viewport, published, is_default) on public.canvases to authenticated;

grant insert (id, canvas_id, kind, node_id, asset_id, url, x, y, width, height, z, color, body, label, student_visible)
  on public.canvas_nodes to authenticated;
grant update (x, y, width, height, z, color, body, label, url, student_visible) on public.canvas_nodes to authenticated;
grant delete on public.canvas_nodes to authenticated;

grant insert (id, canvas_id, from_node, to_node, from_side, to_side, from_end, to_end, label, color)
  on public.canvas_edges to authenticated;
grant update (from_side, to_side, from_end, to_end, label, color) on public.canvas_edges to authenticated;
grant delete on public.canvas_edges to authenticated;

grant insert (id, canvas_id, label, auto, snapshot) on public.canvas_versions to authenticated;
```

### 5.3 Migration `00019_m9_canvas_ops.sql` (RPCs)

All RPCs are `security invoker`, so RLS and column grants still apply. Execute is revoked from `public` and `anon` and granted to `authenticated`.

```sql
create or replace function public.canvas_snapshot_json(p_canvas_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'nodes', coalesce((select jsonb_agg(to_jsonb(n) - 'course_id' - 'canvas_id' - 'created_by' - 'created_at' - 'updated_at')
                         from public.canvas_nodes n where n.canvas_id = p_canvas_id), '[]'::jsonb),
    'edges', coalesce((select jsonb_agg(to_jsonb(e) - 'course_id' - 'canvas_id' - 'created_by' - 'created_at' - 'updated_at')
                         from public.canvas_edges e where e.canvas_id = p_canvas_id), '[]'::jsonb),
    'legend', (select legend from public.canvases where id = p_canvas_id));
$$;

create or replace function public.canvas_apply_ops(p_canvas_id uuid, p_ops jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_op jsonb; v_name text; v_rows int; v_applied int := 0; v_skipped int := 0; v_rev bigint;
begin
  if jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) > 200 then
    raise exception 'ops must be an array of at most 200 items';
  end if;
  perform 1 from public.canvases where id = p_canvas_id and deleted_at is null for update;
  if not found then raise exception 'canvas not found'; end if;

  for v_op in select value from jsonb_array_elements(p_ops) loop
    v_name := v_op->>'op';
    if v_name = 'node.add' then
      insert into public.canvas_nodes (id, canvas_id, kind, node_id, asset_id, url, x, y, width, height, z, color, body, label, student_visible)
      values ((v_op->>'id')::uuid, p_canvas_id, v_op->>'kind', (v_op->>'node_id')::uuid, (v_op->>'asset_id')::uuid, v_op->>'url',
              (v_op->>'x')::float8, (v_op->>'y')::float8, (v_op->>'width')::float8, (v_op->>'height')::float8,
              coalesce((v_op->>'z')::int, 0), v_op->>'color', v_op->>'body', v_op->>'label',
              coalesce((v_op->>'student_visible')::boolean, true));
      v_rows := 1;
    elsif v_name = 'node.update' then
      update public.canvas_nodes set
        x      = case when v_op ? 'x'      then (v_op->>'x')::float8      else x end,
        y      = case when v_op ? 'y'      then (v_op->>'y')::float8      else y end,
        width  = case when v_op ? 'width'  then (v_op->>'width')::float8  else width end,
        height = case when v_op ? 'height' then (v_op->>'height')::float8 else height end,
        z      = case when v_op ? 'z'      then (v_op->>'z')::int         else z end,
        color  = case when v_op ? 'color'  then v_op->>'color'            else color end,
        body   = case when v_op ? 'body'   then v_op->>'body'             else body end,
        label  = case when v_op ? 'label'  then v_op->>'label'            else label end,
        url    = case when v_op ? 'url'    then v_op->>'url'              else url end,
        student_visible = case when v_op ? 'student_visible' then (v_op->>'student_visible')::boolean else student_visible end
      where id = (v_op->>'id')::uuid and canvas_id = p_canvas_id;
      get diagnostics v_rows = row_count;
    elsif v_name = 'node.delete' then
      delete from public.canvas_nodes where id = (v_op->>'id')::uuid and canvas_id = p_canvas_id;
      get diagnostics v_rows = row_count;
    elsif v_name = 'edge.add' then
      insert into public.canvas_edges (id, canvas_id, from_node, to_node, from_side, to_side, from_end, to_end, label, color)
      values ((v_op->>'id')::uuid, p_canvas_id, (v_op->>'from_node')::uuid, (v_op->>'to_node')::uuid,
              coalesce(v_op->>'from_side', 'right'), coalesce(v_op->>'to_side', 'left'),
              coalesce(v_op->>'from_end', 'none'), coalesce(v_op->>'to_end', 'arrow'), v_op->>'label', v_op->>'color');
      v_rows := 1;
    elsif v_name = 'edge.update' then
      update public.canvas_edges set
        from_side = case when v_op ? 'from_side' then v_op->>'from_side' else from_side end,
        to_side   = case when v_op ? 'to_side'   then v_op->>'to_side'   else to_side end,
        from_end  = case when v_op ? 'from_end'  then v_op->>'from_end'  else from_end end,
        to_end    = case when v_op ? 'to_end'    then v_op->>'to_end'    else to_end end,
        label     = case when v_op ? 'label'     then v_op->>'label'     else label end,
        color     = case when v_op ? 'color'     then v_op->>'color'     else color end
      where id = (v_op->>'id')::uuid and canvas_id = p_canvas_id;
      get diagnostics v_rows = row_count;
    elsif v_name = 'edge.delete' then
      delete from public.canvas_edges where id = (v_op->>'id')::uuid and canvas_id = p_canvas_id;
      get diagnostics v_rows = row_count;
    else
      raise exception 'unknown op: %', v_name;
    end if;
    if v_rows > 0 then v_applied := v_applied + 1; else v_skipped := v_skipped + 1; end if;
  end loop;

  update public.canvases set rev = rev + 1 where id = p_canvas_id returning rev into v_rev;
  return jsonb_build_object('rev', v_rev, 'applied', v_applied, 'skipped', v_skipped);
end $$;

create or replace function public.canvas_restore_version(p_version_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v public.canvas_versions; n_total int; n_nodes int; n_edges_total int; n_edges int;
begin
  select * into v from public.canvas_versions where id = p_version_id;
  if not found then raise exception 'version not found'; end if;
  perform 1 from public.canvases where id = v.canvas_id and deleted_at is null for update;
  if not found then raise exception 'canvas not found'; end if;

  insert into public.canvas_versions (id, canvas_id, label, auto, snapshot)
  values (gen_random_uuid(), v.canvas_id, 'Before restore', true, public.canvas_snapshot_json(v.canvas_id));

  delete from public.canvas_nodes where canvas_id = v.canvas_id;          -- edges cascade
  n_total := jsonb_array_length(v.snapshot->'nodes');
  insert into public.canvas_nodes (id, canvas_id, kind, node_id, asset_id, url, x, y, width, height, z, color, body, label, student_visible)
  select (j->>'id')::uuid, v.canvas_id, j->>'kind', nullif(j->>'node_id','')::uuid, nullif(j->>'asset_id','')::uuid,
         j->>'url', (j->>'x')::float8, (j->>'y')::float8, (j->>'width')::float8, (j->>'height')::float8,
         coalesce((j->>'z')::int, 0), j->>'color', j->>'body', j->>'label', coalesce((j->>'student_visible')::boolean, true)
    from jsonb_array_elements(v.snapshot->'nodes') j
   where j->>'kind' not in ('note','file')
      or (j->>'kind' = 'note' and exists (select 1 from public.nodes x where x.id = (j->>'node_id')::uuid and x.deleted_at is null))  /* R3 */
      or (j->>'kind' = 'file' and exists (select 1 from public.assets a where a.id = (j->>'asset_id')::uuid));
  get diagnostics n_nodes = row_count;

  n_edges_total := jsonb_array_length(v.snapshot->'edges');
  insert into public.canvas_edges (id, canvas_id, from_node, to_node, from_side, to_side, from_end, to_end, label, color)
  select (e->>'id')::uuid, v.canvas_id, (e->>'from_node')::uuid, (e->>'to_node')::uuid, e->>'from_side', e->>'to_side',
         e->>'from_end', e->>'to_end', e->>'label', e->>'color'
    from jsonb_array_elements(v.snapshot->'edges') e
   where exists (select 1 from public.canvas_nodes c where c.id = (e->>'from_node')::uuid and c.canvas_id = v.canvas_id)
     and exists (select 1 from public.canvas_nodes c where c.id = (e->>'to_node')::uuid   and c.canvas_id = v.canvas_id);
  get diagnostics n_edges = row_count;

  update public.canvases set legend = coalesce(v.snapshot->'legend', '{}'::jsonb), rev = rev + 1 where id = v.canvas_id;
  return jsonb_build_object('nodes_restored', n_nodes, 'nodes_dropped', n_total - n_nodes,
                            'edges_restored', n_edges, 'edges_dropped', n_edges_total - n_edges);
end $$;

revoke all on function public.canvas_snapshot_json(uuid), public.canvas_apply_ops(uuid, jsonb), public.canvas_restore_version(uuid)
  from public, anon;
grant execute on function public.canvas_snapshot_json(uuid), public.canvas_apply_ops(uuid, jsonb), public.canvas_restore_version(uuid)
  to authenticated;
```

**Agent notes for 00018/00019:**

- Run both against the local Supabase (`npm run db:reset`) and fix syntax before moving on. These scripts are a complete first draft, not tested code. Pay special attention to the `case when v_op ? 'color'` null handling (an explicit JSON null MUST clear the colour) and to `for update` under RLS.
- `canvas_restore_version` re-inserts card rows with their old ids after deleting them in the same transaction. Verify that this works with the primary key and the edge cascade.
- A restore silently drops cards whose note or file no longer exists. The UI MUST show the returned `nodes_dropped` / `edges_dropped` counts.
- Seed ids are not RFC-conformant UUIDs (QUESTIONS #19). Postgres accepts them, but zod's strict `z.uuid()` rejects them. Every id that may be a seed id (`node_id`, `asset_id`, `canvas_id`, `course_id`) MUST be validated with the relaxed hex pattern in §5.4.

### 5.4 Shared types and zod schemas (`src/lib/canvas/`)

Create these pure modules (no React, no Supabase, no `server-only`) so server and browser share them: `types.ts`, `schemas.ts`, `defaults.ts`, `ops.ts`, `geometry.ts`, `layout.ts`, `generate.ts`. Each has a `*.test.ts` next to it.

```ts
// src/lib/canvas/schemas.ts
import { z } from 'zod';

export const CARD_KINDS = ['note', 'file', 'text', 'link', 'group'] as const;
export const SIDES = ['top', 'right', 'bottom', 'left'] as const;
export const CANVAS_COLORS = ['1', '2', '3', '4', '5', '6'] as const;

// Relaxed on purpose: seed ids are not RFC UUIDs (QUESTIONS #19).
export const uuidLike = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const cardKind = z.enum(CARD_KINDS);
export const side = z.enum(SIDES);
export const canvasColor = z.enum(CANVAS_COLORS);
const coord = z.number().finite().min(-100000).max(100000);
const cardWidth = z.number().finite().min(40).max(4000);
const cardHeight = z.number().finite().min(30).max(4000);
const httpUrl = z.string().max(2048).regex(/^https?:\/\//i); // plus new URL() parse in a refine
const edgeEnd = z.enum(['none', 'arrow']);

const nodeAdd = z.object({
  op: z.literal('node.add'),
  id: uuidLike,
  kind: cardKind,
  node_id: uuidLike.optional(),
  asset_id: uuidLike.optional(),
  url: httpUrl.optional(),
  x: coord, y: coord, width: cardWidth, height: cardHeight,
  z: z.number().int().min(-1000).max(1000).optional(),
  color: canvasColor.nullable().optional(),
  body: z.string().max(20000).optional(),
  label: z.string().max(200).optional(),
  student_visible: z.boolean().optional(),
}).superRefine((v, ctx) => {
  // exactly the reference the kind needs (mirrors the SQL check constraint)
  const ok =
    (v.kind === 'note' && !!v.node_id && !v.asset_id && !v.url) ||
    (v.kind === 'file' && !!v.asset_id && !v.node_id && !v.url) ||
    (v.kind === 'link' && !!v.url && !v.node_id && !v.asset_id) ||
    (v.kind === 'text' && v.body !== undefined && !v.node_id && !v.asset_id && !v.url) ||
    (v.kind === 'group' && !v.node_id && !v.asset_id && !v.url);
  if (!ok) ctx.addIssue({ code: 'custom', message: 'card reference does not match its kind' });
});

const nodeUpdate = z.object({
  op: z.literal('node.update'),
  id: uuidLike,
  x: coord.optional(), y: coord.optional(),
  width: cardWidth.optional(), height: cardHeight.optional(),
  z: z.number().int().min(-1000).max(1000).optional(),
  color: canvasColor.nullable().optional(),
  body: z.string().max(20000).optional(),
  label: z.string().max(200).nullable().optional(),
  url: httpUrl.optional(),
  student_visible: z.boolean().optional(),
}).refine((v) => Object.keys(v).length > 2, { message: 'node.update needs at least one field' });

const nodeDelete = z.object({ op: z.literal('node.delete'), id: uuidLike });

const edgeAdd = z.object({
  op: z.literal('edge.add'),
  id: uuidLike, from_node: uuidLike, to_node: uuidLike,
  from_side: side.optional(), to_side: side.optional(),
  from_end: edgeEnd.optional(), to_end: edgeEnd.optional(),
  label: z.string().max(200).optional(),
  color: canvasColor.nullable().optional(),
}).refine((v) => v.from_node !== v.to_node, { message: 'an edge cannot connect a card to itself' });

const edgeUpdate = z.object({
  op: z.literal('edge.update'),
  id: uuidLike,
  from_side: side.optional(), to_side: side.optional(),
  from_end: edgeEnd.optional(), to_end: edgeEnd.optional(),
  label: z.string().max(200).nullable().optional(),
  color: canvasColor.nullable().optional(),
}).refine((v) => Object.keys(v).length > 2, { message: 'edge.update needs at least one field' });

const edgeDelete = z.object({ op: z.literal('edge.delete'), id: uuidLike });

export const canvasOp = z.discriminatedUnion('op', [
  nodeAdd, nodeUpdate, nodeDelete, edgeAdd, edgeUpdate, edgeDelete,
]);
export const canvasOps = z.array(canvasOp).min(1).max(200);
export type CanvasOp = z.infer<typeof canvasOp>;
```

If zod 4 rejects refined objects inside `discriminatedUnion`, wrap the refinement outside the union instead and record the change in `docs/QUESTIONS.md`. Add a second check on `httpUrl` with `new URL()` inside a `refine` and reject anything whose `protocol` is not `http:` or `https:`.

```ts
// src/lib/canvas/types.ts (client + server state shape)
import type { CardKind, Side, CanvasColor } from './schemas';
export type CanvasCard = {
  id: string; kind: CardKind;
  nodeId: string | null; assetId: string | null; url: string | null;
  x: number; y: number; width: number; height: number; z: number;
  color: CanvasColor | null; body: string | null; label: string | null;
  studentVisible: boolean;
};
export type CanvasEdge = {
  id: string; from: string; to: string; fromSide: Side; toSide: Side;
  fromEnd: 'none' | 'arrow'; toEnd: 'none' | 'arrow';
  label: string | null; color: CanvasColor | null;
};
export type CanvasState = {
  cards: Record<string, CanvasCard>;
  edges: Record<string, CanvasEdge>;
  rev: number;
};
```

**`defaults.ts`** holds the default card sizes (width × height): text 260×140, note 320×200, file 280×200, link 260×90, group 600×400. Grid size 20. Zoom range 0.1–2.

**`ops.ts`** exports two pure functions: `applyOps(state, ops): CanvasState` and `invertOps(before: CanvasState, ops: CanvasOp[]): CanvasOp[]`. Rules for the inverse: `node.add` ↔ `node.delete`; `node.update` ↔ `node.update` with the previous values (including `null` colours); **`node.delete` inverts to a `node.add` plus one `edge.add` for every edge that the delete cascaded**; the inverse list is returned in reverse order. Unit tests: apply-then-invert returns the original state for random op sequences (property test with a seeded generator), and `applyOps` rejects unknown ids by skipping, never by throwing.

**`geometry.ts`** exports: `cardsInsideGroup(group, cards)` (a card belongs to the group when its centre is inside the group rectangle), `snap(value, grid)`, `rectOf(card)`, `unionRect(cards)`, `nearestSide(card, point)`, `alignCards(cards, mode)`, `distributeCards(cards, axis)`.

### 5.5 DAL and server actions

Put canvas data access in `src/lib/dal-canvas.ts` (`server-only`) and re-export it from `dal.ts`, so `dal.ts` stays the single choke point (R6).

| Function | Notes |
| --- | --- |
| `listCanvases(courseId)` | Staff: all undeleted. Others: published only. |
| `getCanvas(canvasId)` | Returns canvas, cards, edges **and resolved targets** (note title, slug, area, published flag, deleted flag; file name, kind, bytes, downloadable flag) in at most 4 queries (no N+1). |
| `getStudentCanvas(canvasId)` | Student path (R6). Same shape; relies on the RLS in §5.2; additionally strips `body` of unpublished notes. |
| `createCanvas(input)` | Server action only; enforces `max_canvases_per_course`. |
| `applyCanvasOps(canvasId, ops)` | zod → RPC `canvas_apply_ops`. Before the first write after 30 minutes of inactivity, takes an automatic snapshot. Maps database errors to plain language (e.g. `canvas card limit reached` → “This map is full (limit N cards). Remove cards or start a second map.”). |
| `saveVersion` / `listVersions` / `restoreVersion` | Manual snapshots are kept forever; automatic ones: newest `canvas_version_keep_auto` (default 30); pruning uses the admin client. |
| `softDeleteCanvas` | Admin client; sets `deleted_at`; audit row; restore window = `retention_deleted_note_days`. |
| `setPublished`, `setDefault`, `updateLegend`, `saveViewport` | `saveViewport` is debounced on the client (at most 2 per minute). |

Server actions live in `src/app/(leader)/courses/[courseId]/canvas/actions.ts`. Every action: zod-validate → resolve session and course role with `course-access.ts` → `can_edit_canvas` equivalent check in TypeScript (defence in depth; RLS is the real gate) → DAL → audit for create, delete, restore, publish and import → revalidate. Rate limits (new purposes in `rate-limit.ts`, R12): `canvas_ops` 240 per minute, `canvas_create` 20 per hour. Add both to the table in `PROJECT-GUIDE.md` §12.

### 5.6 Pages and components (M9 scope)

```
src/app/(leader)/courses/[courseId]/canvas/page.tsx              list of maps, New map, Generate from course
src/app/(leader)/courses/[courseId]/canvas/[canvasId]/page.tsx  loads data (server) → <CanvasEditor/>
src/app/(leader)/courses/[courseId]/canvas/actions.ts
src/app/s/canvas/[canvasId]/page.tsx                            student viewer
src/components/canvas/CanvasEditor.tsx    'use client', loaded with next/dynamic (ssr: false)
src/components/canvas/CanvasViewer.tsx    read-only variant sharing the same renderer
src/components/canvas/cards/{NoteCard,FileCard,TextCard,LinkCard,GroupCard}.tsx
src/components/canvas/CanvasEdge.tsx, Toolbar.tsx, SaveStatus.tsx, LegendEditor.tsx, VersionsSheet.tsx
```

**Rendering rules (React Flow, `@xyflow/react`):**

- Define `nodeTypes` and `edgeTypes` at module level, never inside a component.
- Map one `CanvasCard` to one React Flow node: `id`, `type` = kind, `position` = (x, y), `width`/`height`, `zIndex` = z (groups default to −10 so cards sit above them), `data` = card plus resolved target. Groups have **no** `parentId` (D4).
- Use `onlyRenderVisibleElements`, `minZoom` 0.1, `maxZoom` 2, `connectionMode` loose. Leave the default React Flow attribution in place.
- Level of detail: below zoom 0.4 cards render only icon and title; no Markdown, no thumbnails.
- `NoteCard`: title, area badge, first \~300 characters of the published body through `react-markdown` (no raw HTML, images only from the app’s signed URLs). Leaders also see a **Draft** badge for unpublished notes, and a ghost “Deleted note — Restore / Remove card” state for soft-deleted ones.
- `FileCard`: icon by kind, name, size. Image thumbnails via a lazily requested signed URL; PDF first-page thumbnails arrive in M10.
- `LinkCard`: shows the domain and the label only; opens with `target="_blank" rel="noopener noreferrer"`.
- Card colours come from CSS variables `--canvas-1` … `--canvas-6` (defined in M11; until then add a temporary block in `globals.css`). Never use colour alone: the legend (`canvases.legend`) maps each colour to a plain-language name the leader writes, for example “red = important for the exam”.
- Plain-language action names everywhere: **Remove from map** (not Delete), **Delete note** (separate, in the note’s own menu).

**M9 editor scope (basic):** pan and zoom; add a text card; add a note or file card from a picker list; move; resize; **Remove from map** with an “Undo” toast; connect with handles; edit edge label, colour and arrows; colours; create and resize an empty group; save status chip (Saved / Saving… / Could not save — retrying); publish switch; legend editor; versions sheet (save, list, restore). Drag-and-drop, command palette, side pane, full undo/redo and touch connect mode belong to M10.

### 5.7 Student viewer (`/s/canvas/[canvasId]`)

- Access: the signed cookie → `getStudentCanvas`. A missing, unpublished or other-course canvas calls `notFound()` (the root not-found screen; QUESTIONS #27). The page MUST NOT reveal whether the canvas exists.
- React Flow flags: `nodesDraggable={false}`, `nodesConnectable={false}`, `elementsSelectable`, pan and pinch zoom on. No handles, no toolbar except Fit and Zoom ± (44 px buttons) and **List of cards** (a bottom sheet with every visible card, for keyboard and screen-reader users).
- Tap a note card → `/s/notes/[nodeId]`. File card → the existing file sheet; **Download appears only if the file is downloadable**. Link card → new tab.
- Under 768 px the student sees the course outline first with an **Open map** button (D9). `/s/map/[courseId]` redirects to the default published canvas if one exists, otherwise keeps the current tree map.
- Student strings go into `en.json` under `student.canvas.*`: `title`, `openMap`, `listOfCards`, `fit`, `zoomIn`, `zoomOut`, `empty`, `download`, `openNote`.
- The canvas bundle MUST be loaded by `next/dynamic` so other student pages do not grow. Check with the Lighthouse script and the bundle output.

### 5.8 Generate from course (algorithm)

Input: course id, optional section id. Output: a list of ops (and a new canvas). Dependency: `@dagrejs/dagre` (MIT) → add a `FREE_TIER.md` row first.

1. Load the tree: course home, its sections, and every note under each section (flatten recursively, keep stored order). Leaders see drafts too; the RLS in §5.2 hides them from students automatically.
2. If notes + sections + 1 exceeds `max_canvas_cards`, create **one canvas per section** (`kind = 'subject'`) and one core canvas holding the core card and one note card per section. Otherwise create a single `course` canvas.
3. **Core card:** a `note` card for the course home (or a `text` card with the course name if none), at (0, 0), 360×200, colour `6`.
4. **Section groups:** for each section, a `group` card labelled with the section title. Its notes are `note` cards, 320×200 each, in a grid: columns = clamp(ceil(sqrt(n)), 1, 4), gap 40, padding 40, header 56. The group size is computed from the grid.
5. **Placement:** run dagre on the graph (core → each group) with `rankdir: 'LR'`, `nodesep: 80`, `ranksep: 160`, node sizes = real sizes. Convert dagre centres to top-left coordinates. Core ends on the left, groups stacked on the right.
6. **Edges:** core → each group (from `right` to `left`). Group colour comes from the area (Official 4, Student notes 5, Quiz & exam prep 2, External resources 3, Glossary 6, Open questions 1).
7. **Order of ops:** groups, then cards, then edges; chunks of at most 200 ops through `applyCanvasOps`. On any failure, soft-delete the half-built canvas and show the plain-language error.
8. **Determinism:** the function takes an injected id generator and a sorted tree; the same input MUST give the same output (unit test with a stored snapshot).
9. The first canvas of a course becomes `is_default`.

### 5.9 Tests for M9

**RLS tests** (append to `scripts/test-rls.mjs`, continue the numbering found in R9):

1. A student/anon cannot read a draft (unpublished) canvas; can read a published one.
2. A student cannot see a card whose note has no published version, nor a card whose file is not student-visible, nor a card with `student_visible = false`.
3. A student cannot see an edge if either end card is hidden.
4. A leader of course A cannot read, insert into, update or delete canvases, cards, edges or versions of course B.
5. A card cannot reference a note or file of another course (guard trigger raises).
6. An edge cannot connect cards of two different canvases.
7. Contributor and reviewer can read but not write; owner, editor and admin can write.
8. `canvas_apply_ops` with 201 ops fails; with an unknown op fails; a failing op rolls back all earlier ops.
9. The card cap (`max_canvas_cards`) blocks the next insert.
10. Column grants: updating `canvas_id`, `kind`, `node_id`, `asset_id` or `course_id` of a card is refused.
11. `canvas_versions` cannot be updated or deleted by `authenticated`; version numbers increase per canvas.
12. `canvas_restore_version` restores cards, drops cards whose note was deleted, reports the counts, and writes a “Before restore” snapshot.
13. Deleting a note hard (cleanup) removes its cards (cascade); soft-deleted notes keep the card for leaders and hide it from students.
14. `anon` has no privileges on any of the four tables or three functions.

**Unit tests:** schema accept/reject (including seed ids and a `javascript:` URL), `applyOps`/`invertOps` round trip, geometry helpers, `generate.ts` determinism and chunking, error-message mapping.

**Playwright e2e (axe on every page, 360 px and 1280 px):** (a) leader generates a map from the seeded course, moves a card, adds a text card, connects two cards, reloads and sees the same map; (b) leader publishes the map; student joins with `SEED-2026` and sees only published cards; taps a note card and lands on the note; (c) student cannot open a draft canvas id (not-found screen, no protected content); (d) card cap message appears in plain language.

### 5.10 M9 acceptance checklist

- [ ] `docs/M9-recon.md` exists and every `/* R# */` placeholder was resolved.
- [ ] Migrations 00018 and 00019 apply on a fresh local database and on the hosted project; `db:reset` works.
- [ ] All 14 RLS tests and all unit and e2e tests pass; CI is green (quality, rls, e2e).
- [ ] A leader can generate, edit, publish and restore a map; a student can view it read-only.
- [ ] No `any`; lint, typecheck, Prettier and tests pass locally before each commit.
- [ ] `FREE_TIER.md`, `PROJECT-GUIDE.md`, `leader-guide.md` and `QUESTIONS.md` updated.
- [ ] Student JS for other pages did not grow (canvas code is dynamically imported).

## 6. M10 — Interactions, side pane, history, mobile

### 6.1 Deliverables

1. Full editing interactions (§6.2), keyboard shortcuts (§6.3), undo/redo and the save queue (§6.4).
2. Drag-and-drop and file upload onto the canvas (§6.5).
3. Side pane / split view for notes and files (§6.6) and the command palette (§6.7).
4. Touch mode and mobile layout (§6.8); canvas accessibility (§6.9); performance budget (§6.10).
5. After acceptance: `/courses/[courseId]/map` redirects to the default canvas (D10); the old tree view remains reachable as **Outline**.

### 6.2 Interaction specification

Every change is expressed as ops (§5.4), applied optimistically in the browser and queued for the server (§6.4). Drags emit **one** `node.update` per card **on drag end**, never during the drag.

| Action | Mouse and keyboard | Touch | Ops emitted |
| --- | --- | --- | --- |
| Pan | Drag empty space, or Space + drag, or middle mouse | One finger on empty space | none (viewport saved) |
| Zoom | Ctrl/Cmd + wheel, `+` / `-`, `0` = fit | Pinch, Fit button | none |
| Select many | Shift + drag a box, Shift/Ctrl + click, Ctrl+A | Toolbar **Select many** toggle, then tap | none |
| New text card | Double-click empty space, or `N` | Double-tap empty space, or **Add → Text** | `node.add` |
| Add a note or file from the course | Drag from the left drawer, or **Add → Note/File** picker | **Add** sheet; card lands in the view centre | `node.add` |
| Add a file from the computer | Drop onto the canvas (§6.5) | **Add → Upload** | `node.add` after upload |
| Paste | Ctrl/Cmd+V: text → text card; `http(s)` URL → link card; image → upload then file card; Study Hub cards → copies with the same references | Paste in the **More** menu | `node.add` |
| Connect | Drag from a side handle to another card. Dropping on empty space opens a quick menu (new text, note or file card) at that point | **Connect** mode: tap the source card, then the target | `edge.add` (+ `node.add`) |
| Edit an edge | Click it → floating toolbar: label, colour, arrow ends, flip, remove | Tap it → same toolbar as a bottom sheet | `edge.update` / `edge.delete` |
| Move, resize | Drag, drag corner handles; snap to the 20 px grid unless Alt is held | Drag; handles have a 24 px touch area | `node.update` |
| Group | Select cards, press `G`: a group frame (padding 40) wraps them. Moving a group moves the cards whose centres were inside it **at drag start** (one batch) | **More → Group** | `node.add` (group) |
| Align, distribute, tidy | Toolbar menu; **Tidy up** runs dagre on the selection with the §5.8 settings | **More → Tidy up** | batch of `node.update` |
| Layer | Bring to front / send to back (`]` / `[`); groups stay in −1000…−1 | **More** | `node.update` (z) |
| Colour | Palette popover: colours 1–6 and none; names come from the legend | Same, as a sheet | `node.update` / `edge.update` |
| Hide from students | Eye toggle on text, link and group cards | Same | `node.update` (student\_visible) |
| Remove from map | `Delete` / `Backspace`; toast with **Undo** | **More → Remove** | `node.delete` (+ cascaded edges) |

**Safety rules:** removing a card never deletes its note or file (D1). The card menu offers **Open**, **Copy**, **Duplicate**, **Remove from map**; deleting a note or file is only available in the note’s or file’s own menu, with the existing confirmation.

### 6.3 Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl/Cmd+K` | Command palette |
| `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` or `Ctrl+Y` | Undo, redo |
| `Ctrl/Cmd+C`, `V`, `D` | Copy, paste, duplicate |
| `Ctrl/Cmd+S` | Save a named version (prevent the browser dialog) |
| `N` | New text card at the view centre |
| `G` | Group the selection |
| `Ctrl/Cmd+Shift+L` | Tidy up |
| `Delete`, `Backspace` | Remove selected from map |
| `Arrow keys` | Nudge the selected cards by 20 px (grid) |
| `Alt+Arrow` | Move focus to the nearest **connected** card in that direction (follows edges) |
| `Tab`, `Shift+Tab` | Next, previous card in reading order |
| `Enter` | Open the focused card in the side pane |
| `Esc` | Close menu, pane or selection (in that order) |
| `?` | Show this list |

Shortcuts MUST NOT fire while a text field, the TipTap editor or a palette input has focus. Put them in `src/lib/canvas/shortcuts.ts` as data (key, action, label) so the `?` sheet and the leader guide are generated from the same list.

### 6.4 History and the save queue

**`history.ts`** (pure, tested): a stack of `{ forward: CanvasOp[], inverse: CanvasOp[], at: number }`, at most 100 entries, **own actions only**. A drag, a resize or a group move is one entry; typing in a card body is one entry per 1.5 s pause. A new action clears the redo stack. Undo sends the `inverse` ops through the normal save queue. If another leader already removed a card the undo touches, the op is skipped and a toast says “Some changes could not be undone because someone else changed this map.”

**`save-queue.ts`** (pure, tested with fake timers): local state is optimistic.

- Flush after 800 ms of quiet, and immediately on `Ctrl+S`, window blur and `visibilitychange` to hidden. Batches of at most 200 ops.
- Coalesce consecutive `node.update` ops for the same card into one (merge fields; the last value wins).
- Retry with back-off 2 s, 6 s, 18 s (three times). Then show **Could not save — Retry**. Ops are **never dropped silently**.
- Offline: pause and show “You are offline. Your changes are kept on this page until you are back.” While the queue is not empty, register a `beforeunload` warning.
- The server returns `rev`. On window focus call a cheap `getCanvasRev`; if it differs from the last known value and the queue is empty, refetch the canvas (M13 replaces this with live updates).
- Status chip states: **Saved**, **Saving…**, **Offline**, **Could not save**.

### 6.5 Drag-and-drop and upload

Reuse the existing upload pipeline (R7); do not write a second one.

1. On drop (up to 10 files at once): check extension and type against `file-allowlist.ts`, size against `max_file_mb`, and the browser-side magic-byte check.
2. Upload straight to Storage under `{course_id}/…` with the existing helper, then create the `assets` row through the existing post-upload server action.
3. Only after success, add a `file` card at the drop point (offset each further file by 24 px).
4. Show a progress chip per file; show a plain-language error on failure and create **no** card.
5. Dropping a `.canvas` file is handled in M12 (import).

### 6.6 Side pane (split view)

- Clicking a card, or `Enter` on a focused card, opens it in a pane on the right: ≥1280 px docked (320–720 px, resizable), 768–1279 px overlay drawer, <768 px full-screen sheet.
- **Note card:** the existing TipTap editor component for writers, with the same `locks` row as the full editor page (never two editors on one note). Read-only rendering for everyone else. Link: **Open full page**.
- **File card:** image, PDF (existing `pdfjs-dist` viewer), audio and video (HTML5 players on signed URLs), everything else a download card. Respect `student_downloadable` for students.
- Closing the pane returns focus to the card. On desktop up to 5 open notes appear as tabs in the pane.

### 6.7 Command palette

Use `cmdk` (MIT; add the `FREE_TIER.md` row first). Opens with `Ctrl/Cmd+K` and a visible search button (for touch). Groups: **Cards on this map** (fuzzy by title), **Notes in this course** (not on the map → “Add to map”), **Actions** (new text card, new group, tidy up, fit, save version, toggle snap, switch between map and outline), **Maps** (switch). Fully keyboard operable, labelled, with a visible empty state. Matching lowercases text and, once M12 exists, uses the Arabic normaliser.

### 6.8 Touch and mobile

- Under 768 px a bottom toolbar (44 px targets): **Add (+)**, **Connect**, **Undo**, **Redo**, **Fit**, **More**. **Add** opens a bottom sheet: Text, Note, File, Upload, Link, Group.
- Long-press = context menu. No hover-only UI anywhere.
- On coarse pointers (`@media (pointer: coarse)`) handles and resize corners get a 24 px hit area.
- The pane has `touch-action: none` so the page does not scroll or zoom while panning the canvas; the rest of the page keeps normal gestures. Use `dvh`, not `vh`. Respect safe-area insets for the toolbar.
- Phones open the **outline** first (D9); the **Map** tab is one tap away and remembers the choice on that device.

### 6.9 Canvas accessibility

- The canvas is a labelled region (`aria-label` = “Map: \<title>”). Cards use a roving `tabindex` in reading order (top to bottom, then left to right; mirrored in RTL) and carry an `aria-label`: kind, title, number of connections.
- A live region (`aria-live=polite`) announces: card added, removed, moved, connected, saved.
- A permanent **Outline** button switches to the tree view, which offers the same actions; edge labels appear there as text.
- Focus ring: 2 px `--focus`, offset 2 px, never removed. Colour is never the only signal (legend names, icons, labels).
- `prefers-reduced-motion`: no animated pan or zoom (`fitView` duration 0).

### 6.10 Performance budget

- A 300-card canvas renders its first frame in under 1.5 s on the CI desktop runner; no long task over 50 ms during a scripted pan and zoom (Playwright trace).
- Wrap cards in `React.memo`; keep selection in the React Flow store; render Markdown previews once per card version and memoise them.
- Request thumbnails only for cards in view and at zoom ≥ 0.4, at most 6 signed-URL requests in flight.
- At most one save request per 800 ms of activity.

### 6.11 Tests and acceptance for M10

**Unit:** `history` coalescing and skip rules, `save-queue` (coalesce, retry, offline), `geometry` align and distribute, shortcut table has no duplicate keys.

**Playwright (axe on each, 360 px and 1280 px):** keyboard-only flow (create, connect, move, delete, undo); drag a file from the drawer; drop a file from the computer; edit a note in the side pane while a second browser context sees the lock; palette search and action; touch viewport: Connect mode between two cards; offline banner and recovery.

- [ ] Every interaction in §6.2 works with mouse, keyboard and touch where listed.
- [ ] No action can delete a note or file from the canvas menu.
- [ ] Undo/redo works across drag, group, delete, colour and connect.
- [ ] Performance budget met; CI green; docs and `QUESTIONS.md` updated; `/map` redirects to the default canvas.

## 7. M11 — Design system, themes and layouts

### 7.1 Deliverables

1. Design tokens and four themes (§7.2–7.4), course accents (§7.5), fonts (§7.6), RTL-safe layout (§7.7).
2. A small component library on Radix primitives (§7.8) and per-device layouts (§7.9).
3. Motion, polish and UX fixes (§7.10, §7.11).
4. `scripts/check-contrast.mjs` wired into CI, and theme screenshots (§7.12).

### 7.2 Tokens (`src/app/tokens.css`, imported by `globals.css`)

The values below are starting points. **The contrast script (§7.12) is the authority:** if a pair fails, adjust the value, not the script.

```css
:root, [data-theme='light'] {
  color-scheme: light;
  --bg: #fafaf9;  --surface: #ffffff;  --surface-2: #f3f3f1;  --card: #ffffff;
  --border: #dcdce0;  --border-strong: #b8b8c0;
  --text: #1b1b1f;  --text-muted: #5b5b66;
  --accent: #5b4bd6;  --accent-contrast: #ffffff;  --accent-soft: #ecebfb;
  --focus: #1a73e8;
  --danger: #c4272d;  --success: #1f7a3d;  --warning: #8a5a00;
  --canvas-bg: #f4f4f2;  --canvas-dot: #c9c9cf;
  --canvas-1: #e5484d;  --canvas-2: #d9560a;  --canvas-3: #a87c00;
  --canvas-4: #2f9e44;  --canvas-5: #0b9fb5;  --canvas-6: #7c5cff;
  --shadow-1: 0 1px 2px rgb(0 0 0 / .06), 0 1px 3px rgb(0 0 0 / .08);
  --shadow-2: 0 4px 14px rgb(0 0 0 / .12);
  --radius-s: 6px;  --radius-m: 10px;  --radius-l: 16px;
  --dur-1: 120ms;  --dur-2: 200ms;  --dur-3: 320ms;
  --ease: cubic-bezier(.2, .7, .2, 1);
}
[data-theme='dark'] {
  color-scheme: dark;
  --bg: #131317;  --surface: #1b1b21;  --surface-2: #23232b;  --card: #25252d;
  --border: #34343f;  --border-strong: #4a4a58;
  --text: #ececf1;  --text-muted: #a8a8b6;
  --accent: #9b8cff;  --accent-contrast: #0f0f14;  --accent-soft: #2a2745;
  --focus: #7db4ff;
  --danger: #ff7b80;  --success: #4cc38a;  --warning: #f0b429;
  --canvas-bg: #101014;  --canvas-dot: #2c2c36;
  --canvas-1: #ff6369;  --canvas-2: #ff8b3e;  --canvas-3: #f5c518;
  --canvas-4: #4cc38a;  --canvas-5: #3dd6f5;  --canvas-6: #a78bfa;
  --shadow-1: 0 1px 2px rgb(0 0 0 / .4);
  --shadow-2: 0 6px 18px rgb(0 0 0 / .5);
}
[data-theme='paper'] {
  color-scheme: light;
  --bg: #f4ecd8;  --surface: #fbf5e6;  --surface-2: #ece2c8;  --card: #fbf5e6;
  --border: #d6c9a8;  --border-strong: #b3a37c;
  --text: #2b2318;  --text-muted: #6b5f4a;
  --accent: #9a3412;  --accent-contrast: #fffaf0;  --accent-soft: #f0d9c0;
  --focus: #1d4ed8;
  --danger: #a61b1b;  --success: #20632f;  --warning: #7a4a00;
  --canvas-bg: #efe5cc;  --canvas-dot: #cdbf9c;
  --canvas-1: #d23b40;  --canvas-2: #c24d08;  --canvas-3: #8f6a00;
  --canvas-4: #2a8a3d;  --canvas-5: #0a8aa0;  --canvas-6: #6b4de0;
}
[data-theme='contrast'] {
  color-scheme: dark;
  --bg: #000000;  --surface: #0a0a0a;  --surface-2: #141414;  --card: #000000;
  --border: #ffffff;  --border-strong: #ffffff;
  --text: #ffffff;  --text-muted: #e0e0e0;
  --accent: #ffd60a;  --accent-contrast: #000000;  --accent-soft: #2b2500;
  --focus: #00e5ff;
  --danger: #ff6b6b;  --success: #5dff8f;  --warning: #ffd60a;
  --canvas-bg: #000000;  --canvas-dot: #5a5a5a;
  --canvas-1: #ff6b6b;  --canvas-2: #ff9f43;  --canvas-3: #ffd60a;
  --canvas-4: #5dff8f;  --canvas-5: #00e5ff;  --canvas-6: #c4a7ff;
}
/* No-JS fallback only; the inline script always sets data-theme before paint. */
@media (prefers-color-scheme: dark) { :root:not([data-theme]) { /* copy the dark values */ } }
@media (prefers-reduced-motion: reduce) { :root { --dur-1: 1ms; --dur-2: 1ms; --dur-3: 1ms; } }
```

**Tailwind 4 wiring** (in `globals.css`): `@theme inline { --color-bg: var(--bg); --color-surface: var(--surface); --color-card: var(--card); --color-border: var(--border); --color-text: var(--text); --color-muted: var(--text-muted); --color-accent: var(--accent); --color-accent-contrast: var(--accent-contrast); --color-accent-soft: var(--accent-soft); --color-danger: var(--danger); --color-success: var(--success); --color-warning: var(--warning); }` so utilities such as `bg-surface`, `text-muted`, `border-border` exist. Add a unit test that fails if any file under `src/` (except `tokens.css` and `tokens-accent.css`) contains a raw hex colour or a Tailwind palette class such as `bg-slate-*`, `text-gray-*`, `bg-white`, `text-black`.

### 7.3 Visual language (rules for every screen)

- Surfaces: page `--bg`, panels `--surface`, cards `--card` with a 1 px `--border` and `--shadow-1`; popovers `--shadow-2`. Radius: controls `--radius-s`, cards `--radius-m`, sheets `--radius-l`.
- The canvas background is `--canvas-bg` with a dot grid (`--canvas-dot`, 20 px spacing, React Flow `Background` variant dots).
- Canvas card tint: 12% of the card colour over `--card`, 2 px solid border in the colour, text stays `--text`. The six colours are **labels, not meaning**: meaning comes from the legend.
- Buttons: primary = `--accent` with `--accent-contrast` text; secondary = `--surface-2`; ghost; danger. Disabled states keep 4.5:1 text where the text carries information.
- Icons: `lucide-react` (ISC), imported one by one; 20 px in toolbars, 16 px inline. Every icon-only button has an `aria-label` **and** a visible tooltip.
- Focus: 2 px `--focus` ring with 2 px offset on every interactive element; `outline: none` is allowed only together with an equal replacement.

### 7.4 Theme mechanism

- Preference values: `system`, `light`, `dark`, `paper`, `contrast`, stored on the device under `studyhub.theme` (D15). Labels in plain language: “Match my device”, “Light”, “Dark”, “Paper (easy on the eyes)”, “High contrast”.
- Extend the existing blocking inline script in the root layout (R11): read the preference, resolve `system` with `matchMedia`, set `document.documentElement.dataset.theme`, and update `<meta name="theme-color">` from a fixed map (light #fafaf9, dark #131317, paper #f4ecd8, contrast #000000). When the preference is `system`, listen for the media-query change. Add `suppressHydrationWarning` to `<html>`. No flash of the wrong theme.
- A `ThemeSwitcher` radio group appears in the leader account menu, the admin menu and the student top bar, next to the A− / A+ text-size buttons (which keep working through a `--text-scale` variable).

### 7.5 Course accent

- Migration `00020_m11_course_accent.sql`: `alter table public.courses add column accent text not null default 'indigo' check (accent in ('indigo','teal','rose','amber','emerald','sky','violet','slate'));`. Changing it is a server action (owner or admin) using the admin client plus an audit row, so no new grants are needed.
- `src/lib/accent.ts` maps each key to `--accent`, `--accent-contrast` and `--accent-soft` for light, dark and paper. The contrast theme ignores accents. Apply with `data-accent` on the course layout wrapper and the student course wrapper, through selectors in `tokens-accent.css` such as `[data-theme='dark'] [data-accent='teal'] { … }`.
- The agent picks the values; the contrast script MUST pass for every accent in every theme (accent on `--bg` ≥ 4.5:1, `--accent-contrast` on `--accent` ≥ 4.5:1, `--text` on `--accent-soft` ≥ 4.5:1).

### 7.6 Typography

- Fonts: **Inter** (variable, Latin UI) and **IBM Plex Sans Arabic** (400, 500, 700), both SIL OFL (add `FREE_TIER.md` rows). Prefer `next/font/local` with the font files committed under `src/fonts/` together with their licence files, so builds and CI need no network. Use `font-display: swap`.
- Stack: `--font-ui: var(--font-inter), var(--font-arabic), system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;` and for `:lang(ar), [dir='rtl']` put the Arabic font first. Monospace stays the system stack.
- Scale 12 / 14 / 16 / 18 / 20 / 24 / 30 / 36. Body line-height 1.5, Arabic note text 1.7. Reading width 68ch for notes.

### 7.7 RTL readiness

The interface stays English (QUESTIONS #24) but every new and touched component MUST use logical utilities (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`) and flip direction-implying icons with the `rtl:` variant. Note and card text keeps `dir="auto"`. Canvas coordinates stay left-to-right. Add one Playwright check that sets `dir=rtl` on `<html>` and verifies the app shell has no horizontal overflow and no axe violations.

### 7.8 Components (`src/components/ui/`)

Build on Radix primitives (MIT): `@radix-ui/react-dialog`, `-dropdown-menu`, `-popover`, `-tooltip`, `-tabs`, `-toggle-group`, `-switch` (add `FREE_TIER.md` rows). Components: `Button`, `IconButton` (the TypeScript type makes `aria-label` required), `Input`, `Textarea`, `Select`, `Badge`, `Card`, `Sheet` (bottom sheet under 768 px, side drawer above), `Toast` (`aria-live=polite`, 6 s, optional **Undo**), `Skeleton`, `EmptyState` (icon, one plain sentence, one primary action), `Kbd`, `Spinner`, `ThemeSwitcher`. Minimum target size 44 px on coarse pointers, 32 px on fine pointers. Migrate existing screens to these components screen by screen; do not leave a screen half-migrated.

### 7.9 Layouts per device

| Width | Shell |
| --- | --- |
| under 768 (phone) | Top bar (course name, menu), content, **bottom nav** (Home, Courses, Search, Jobs or Map) with safe-area padding; secondary UI in bottom sheets; canvas full-bleed with the bottom toolbar |
| 768–1279 (tablet) | Collapsible left rail (icons, optional labels); side pane as an overlay drawer; in landscape the canvas and the pane may split 60/40 |
| 1280 and up (desktop) | Three panes: left outline or file tree with search (240–360 px, resizable), centre tabs (Map, Notes), right inspector and AI panel (320–420 px, docked, collapsible). Pane widths are remembered per device |
| 1920 and up | Lists capped at 1600 px; the canvas uses the full width |
| Student shell | Simple: top bar plus bottom nav on phones, no side panes except the note outline (and backlinks in M12). Reading width 68ch |

**PWA:** manifest gains `id`, `categories: ['education']`, `screenshots` (phone and desktop), `shortcuts` (My courses, Search). iOS: `apple-mobile-web-app-status-bar-style` set to `black-translucent` with safe-area padding. The theme-color meta follows the theme (§7.4). Check that `public/sw.js` already caches the last 20 visited pages including canvases; add a Playwright offline test that opens a visited canvas offline (production build, as for the existing offline test).

### 7.10 Motion and feedback

Use the duration and easing tokens only. Skeletons for lists and note bodies; optimistic updates for toggles; every error has a plain sentence and a **Try again** button. Under `prefers-reduced-motion` all transitions are effectively instant and React Flow `fitView` uses duration 0.

### 7.11 UX polish list (do all)

1. **Leader home:** “Continue where you left off” (your most recently edited notes and maps), pinned courses, three quick actions (New note, New map, Upload).
2. **Course hub:** accent bar, tabs **Outline · Map · Files · People · Access** (Graph arrives in M12); a useful empty state for every tab.
3. **Onboarding tour:** extend to five steps including the map; do not reset anyone’s `tour_done`. Add **Take the tour** to the account menu.
4. **Plain error pages:** friendly not-found and error screens with one clear way back.
5. **Forms:** inline validation text under the field, never colour alone; keep the user’s input on error.
6. **Loading:** no layout jumps; reserve image and card space.
7. **Search:** show tag and area filters as chips; keep the query in the URL.

### 7.12 Contrast and visual checks

`scripts/check-contrast.mjs` (no dependencies) parses `tokens.css` and `tokens-accent.css`, computes WCAG contrast, and exits non-zero on failure. Required pairs for every theme: `--text`, `--text-muted`, `--danger`, `--success`, `--warning` on `--bg`, `--surface` and `--card` ≥ 4.5; `--accent-contrast` on `--accent` ≥ 4.5; `--accent` on `--bg` ≥ 4.5; `--canvas-1…6` against `--card` and `--canvas-bg` ≥ 3; `--focus` against `--bg` and `--surface` ≥ 3; `--border-strong` against `--bg` ≥ 3. The **contrast** theme additionally needs every text pair ≥ 7. Run it in the `quality` job of `ci.yml`.

Playwright `toHaveScreenshot` for five screens (login, course hub, note, canvas, student home) × three widths × the four themes, stored in the repository. **Open:** if screenshot diffs prove flaky in CI, reduce to light and dark and record it in `QUESTIONS.md`.

### 7.13 M11 acceptance

- [ ] Four themes plus System work on every screen; no flash on load; the theme survives reload on the same device.
- [ ] Contrast script, token-usage test, axe and RTL check pass; CI green.
- [ ] Phone, tablet and desktop shells match §7.9 on measured widths 360 / 768 / 1024 / 1280.
- [ ] Course accent changes the course and the student course pages without breaking contrast.
- [ ] Arabic notes render with the Arabic font and correct direction; the A− / A+ buttons still work.
- [ ] Docs updated (`PROJECT-GUIDE.md` §4–§7, `leader-guide.md`, `STUDENTS-AND-JOIN-CODES.md`, `FREE_TIER.md`, `QUESTIONS.md`).

## 8. M12 — Obsidian interoperability, wikilinks, graph, Arabic search

### 8.1 Deliverables

1. JSON Canvas export and import; Obsidian vault export (§8.2).
2. Wikilinks, backlinks and broken-link reporting (§8.3).
3. Graph view for leaders and students (§8.4).
4. Search upgrade with Arabic normalisation (§8.6).
5. Backup export and restore extended for canvases (§8.2).

### 8.2 JSON Canvas mapping, import, vault export

**Mapping (export):**

| Study Hub | JSON Canvas |
| --- | --- |
| `text` card | `{ id, type: 'text', text: body, x, y, width, height, color }` |
| `note` card | `{ type: 'file', file: '<course-slug>/<section-slug>/<note-slug>.md' }` (same path the Markdown export already uses) |
| `file` card | `{ type: 'file', file: '<course-slug>/_files/<unique-safe-filename>' }` |
| `link` card | `{ type: 'link', url }` |
| `group` card | `{ type: 'group', label }` |
| edge | `{ id, fromNode, toNode, fromSide, toSide, fromEnd, toEnd, color, label }` |
| colour | the same strings `'1'`…`'6'` |

Exported ids are the UUID without dashes. Import always generates fresh ids.

**Import rules** (`src/lib/canvas/json-canvas.ts`, pure, with fixtures):

- Leader uploads a `.canvas` file. Parse in the browser; reject files over `canvas_import_max_kb` (default 1024) and more nodes than `max_canvas_cards`.
- Validate with zod; ignore unknown fields; clamp numbers to the database ranges. Hex colours map to the nearest preset by RGB distance.
- `file` nodes: a path ending in `.md` is matched to a note of **this course** by slug (last path segment without `.md`), then by normalised title; any other path is matched to an asset by file name (case-insensitive). No match → a `text` card reading “Missing file: \<path>” with `student_visible = false`.
- `link` nodes: only `http`/`https`; anything else becomes a placeholder text card. `text` bodies are stored as Markdown; HTML is never interpreted (react-markdown escapes it).
- Edges whose end cards are missing are dropped. The new canvas is **unpublished**. Write an audit row. Show a summary: “12 cards imported, 3 placeholders, 2 links dropped.”
- Import runs as chunked `canvas_apply_ops` calls through a server action; the server re-validates everything (spec section 7 rule 2).

**Vault export (“Download for Obsidian”):** a leader button on the course page. Build the ZIP **in the leader’s browser** with `jszip` (heavy work never runs on Vercel): published notes as Markdown with their `[[wikilinks]]` intact, one `.canvas` per map, a `_files/` folder with the files the leader may see (fetched with signed URLs), and a short `README.md`. Respect `vault_export_max_mb` (default 200): if the total would exceed it, offer “without files”. Never include AI keys, join codes, audit data or anything students cannot see unless the leader is staff.

**Backup and restore:** extend `/api/admin/export` with `canvases.json` (canvases, cards, edges; not versions) and one `.canvas` per map; extend `scripts/restore.mjs` to restore them after notes and assets; update the manifest counts and `docs/restore.md`.

### 8.3 Wikilinks and backlinks

- **Syntax:** `[[Title]]`, `[[Title|alias]]`, `[[Title#Heading]]` (the heading part is kept in the text but ignored in v1).
- **Resolution** (`src/lib/wikilinks.ts`, pure): within the same course; key = normalised title or slug; if several notes match, prefer by area order (Official, Student notes, Quiz & exam prep, External, Glossary, Open questions), then oldest. Unresolved links render as a muted “missing link” span; leaders also get **Create note**.
- **Rendering:** a small remark plugin in the `react-markdown` pipeline turns resolved links into internal links (`/courses/[courseId]/nodes/[id]` for leaders, `/s/notes/[id]` for students). Students only resolve to **published** notes; a link to anything else renders as plain text (no leak). The server passes one resolver map (title → id, published) together with the note, in a single query.
- **Editor (D12):** links stay plain text. Add a ProseMirror decoration that highlights `[[…]]`, and an autocomplete popup with `@tiptap/suggestion` (MIT) triggered by `[[`, listing the course’s notes and inserting `[[Title]]` as text. No custom node, no serialisation change.
- **Hover preview** (desktop only): the first \~200 characters of the target note.

**Migration `00021_m12_note_links.sql`:**

```sql
create table public.note_links (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses(id) on delete cascade,
  from_node   uuid not null references public.nodes(id) on delete cascade,
  to_node     uuid references public.nodes(id) on delete cascade,   -- null = unresolved
  target_text text not null check (char_length(target_text) between 1 and 200),
  created_at  timestamptz not null default now()
);
create unique index note_links_unique on public.note_links (from_node, target_text);
create index note_links_to_idx on public.note_links (to_node) where to_node is not null;

alter table public.note_links enable row level security;
alter table public.note_links force row level security;

-- Staff see everything. Others see a link only if both notes are visible to them (nodes RLS applies inside exists).
create policy note_links_select on public.note_links for select to authenticated
  using (
    public.can_access_course(course_id)                                          /* R1 */
    and exists (select 1 from public.nodes n where n.id = note_links.from_node)
    and (
      (to_node is null and public.is_course_staff(course_id))
      or exists (select 1 from public.nodes t where t.id = note_links.to_node)));

revoke all on public.note_links from anon, authenticated;
grant select on public.note_links to authenticated;   -- no client writes; rows are derived data
```

The rows are derived from the **published version** of each note. The publish server action rebuilds the rows of that note with the admin client. After a create, rename or publish, run `rebuildCourseLinks(courseId)` (recompute from published bodies; fine up to a few thousand notes). A leader button **Rebuild links** on the Health screen calls the same function.

**UI:** a **Linked from** panel on each note and in the side pane (title and area); leaders also see **Unresolved links**; the Health screen lists broken links. Students see backlinks from published notes only.

### 8.4 Graph view

- Routes: `/courses/[courseId]/graph` and `/s/graph/[courseId]` (read-only). Add the leader tab **Graph** to the course hub.
- Data: published notes as nodes, `note_links` as edges. Toggles: **Show sections**, **Show map connections** (edges between note cards of the default canvas).
- Layout: `d3-force` (ISC) for 300 ticks; above 200 nodes run it in a web worker; above 500 nodes ask the user to filter first. Cache positions in memory per course keyed by the newest `updated_at`. Render with React Flow (consistent pan and zoom). Add the `FREE_TIER.md` row first.
- Filters: tag, area, search box, **Local graph** (the selected note and its neighbours, depth 1 or 2). Node size by link count (three sizes); colour by area with a legend (never colour only: area shown in the tooltip and list). Labels appear above zoom 0.6, or on hover or selection.
- Accessibility: an outline fallback lists each note with “Links to” and “Linked from”; nodes are keyboard-focusable.
- Deep links: `#card-<id>` on a canvas URL focuses and zooms to that card (plain hash only). Add **Copy link to this card**.

### 8.5 Search upgrade — migration `00022_m12_search_normalize.sql`

```sql
create extension if not exists pg_trgm with schema extensions;   -- adapt to the project's extension convention

-- Search-only normaliser: strips Arabic diacritics and tatweel, unifies alef forms, alef maqsura and ta marbuta (lossy on purpose), maps Arabic-Indic digits.
create or replace function public.normalize_search(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select lower(translate(
    regexp_replace(coalesce(t, ''), '[\u064B-\u065F\u0670\u0640]', '', 'g'),
    'أإآٱىة٠١٢٣٤٥٦٧٨٩',
    'ااااية0123456789'));
$$;

alter table public.nodes add column search_norm text;      -- title + published body; written by the server only (no grant)
create index nodes_search_norm_trgm on public.nodes using gin (search_norm extensions.gin_trgm_ops);
```

- `src/lib/search-normalize.ts` implements the same function in TypeScript. A **golden-file test** (a list of tricky Arabic and English strings) runs in both the unit suite and the RLS runner (`select public.normalize_search(...)`), so SQL and TypeScript can never drift.
- The publish action writes `search_norm` (normalised title + published body). `scripts/backfill-search-norm.mjs` fills existing rows; a **Rebuild search index** button on the Health screen calls the same function. OCR and transcript text already lands in note bodies, so it is indexed automatically.
- Query: keep the existing full-text path for ranking; add a fallback or union on `search_norm % query` (trigram similarity) and `ilike`. Order: exact title, title contains, full-text rank, trigram similarity. Highlight snippets in TypeScript. RLS is unchanged, so students still only find what they can read.

### 8.6 Tests and acceptance for M12

- **Unit:** wikilink parse and resolve (Arabic, aliases, ambiguity, unresolved); JSON Canvas export→import round trip; import of a hand-written fixture containing every node type, hex colours, a missing file and a bad URL; colour mapping; search normaliser golden file.
- **RLS:** `note_links` visible to staff, filtered for students (unpublished source or target hidden), no client writes; `normalize_search` parity.
- **Playwright:** import a `.canvas`; type `[[` and pick a note; click a wikilink; see backlinks; graph filter and local graph; Arabic search with and without diacritics; vault ZIP file list.
- **Manual (Nour):** open the exported vault in desktop Obsidian and confirm notes, links and the canvas open correctly.

* [ ] All of the above pass; CI green; backup export and restore drill updated and run once on a throwaway project.
* [ ] Docs updated (`PROJECT-GUIDE.md`, `leader-guide.md`, `STUDENTS-AND-JOIN-CODES.md`, `restore.md`, `FREE_TIER.md`, `QUESTIONS.md`).

## 9. M13 — Live co-working and study tools

### 9.1 Deliverables

A. Realtime co-working on canvases (§9.2). B. Student study tools on the device (§9.3). C. Events and timetable with `.ics` download (§9.4). D. Aggregate read counts (§9.5). E. Optional AI “organise map” helper (§9.6).

### 9.2 Realtime co-working (leaders only, D14)

**Migration `00024_m13_realtime.sql`:**

```sql
alter publication supabase_realtime add table public.canvases, public.canvas_nodes, public.canvas_edges;

-- Private presence/cursor channels named canvas:<canvas uuid>. VERIFY against the current Supabase Realtime docs first.
create policy canvas_realtime_read on realtime.messages for select to authenticated
  using (realtime.topic() like 'canvas:%' and exists (
    select 1 from public.canvases c
     where c.id::text = substring(realtime.topic() from 8) and public.is_course_staff(c.course_id)));
create policy canvas_realtime_write on realtime.messages for insert to authenticated
  with check (realtime.topic() like 'canvas:%' and exists (
    select 1 from public.canvases c
     where c.id::text = substring(realtime.topic() from 8) and public.is_course_staff(c.course_id)));
```

If the private-channel API differs from this sketch, record it in `QUESTIONS.md` and fall back to Postgres Changes only, with a simple “edited a moment ago by \<name>” indicator instead of cursors.

- **Client hook** `useCanvasLive(canvasId)`: subscribe to changes of the three tables filtered by `canvas_id`. Map each row change to an op and apply it with `applyOps`. Ignore echoes of your own writes (remember your op ids for 10 s). Last-write-wins: a remote change to a field you edited in the last 2 s is ignored.
- **Presence:** name and a colour derived from a hash of the user id (use the six canvas colours plus pattern or initials, never colour alone). Cursor positions go through Broadcast at 10 per second at most and are never stored. A **Who is here** avatar stack shows initials and plain names.
- **Soft lock:** a card another leader is dragging shows a thin coloured outline and “\<Name> is moving this”; local dragging of that card is ignored until 3 s after the last remote update.
- **Budget:** settings `realtime_enabled` (default 1) and `max_live_editors_per_canvas` (default 5; extra leaders join as **viewing**). Unsubscribe when the tab has been hidden for 60 s; reconnect with back-off and refetch the canvas on reconnect. Note editing keeps the existing `locks`.
- **Free tier:** before shipping, read the current Realtime limits on the official Supabase pricing page and add a dated row to `FREE_TIER.md` (rule 7).
- Students are not live: they refresh on focus, and a **Refresh** button is shown.

### 9.3 Student study tools (on the device only)

All data lives in IndexedDB through `idb-keyval` (MIT), key prefix `studyhub:<courseId>:`. Nothing is sent to the server. **Export my study data** and **Import** use a versioned JSON file (zod-validated, at most 2 MB) so a student can move to a new phone.

| Tool | Behaviour |
| --- | --- |
| Bookmarks | Star a note or a canvas card; **Saved** list on the student home |
| Highlights and personal notes | Select text → highlight (yellow, green, pink, each with a pattern or label) plus an optional comment. Anchor = `{ noteId, versionId, quote ≤200, prefix ≤40, suffix ≤40 }`. On a new version re-anchor by searching the quote; if not found mark it **outdated** |
| Progress | **Mark as read** per note, course progress bar, **Continue where I left off** (last note and scroll position) |
| Flashcards (Leitner) | Leaders write cards anywhere in the Quiz & exam prep area as `Front :: Back` lines (`src/lib/flashcards.ts`, pure; ignores code blocks; at most 200 per note). A TipTap toolbar button **Add flashcard** inserts such a line. Students practise at `/s/practice/[courseId]`: boxes 1–5 with intervals 1, 2, 4, 8, 16 days; right → next box, wrong → box 1; at most 20 due cards per session. Progress is keyed by a hash of the normalised front text plus the note id. Keyboard: Space flips, `1` wrong, `2` right; large buttons on touch; `dir=auto` text |
| Read aloud | Button on notes using `speechSynthesis`, feature-detected. Language guessed from the first 200 characters (Arabic script → `ar`, else `en`). Chunk text to at most 200 characters per utterance. If the device has no voice for the language, say so in plain words |
| Export map as image | PNG of the visible cards through `html-to-image` (MIT), longest side at most 4096 px, for leaders and students |
| Present mode | **Present** on a canvas steps through cards in reading order, or by following edges from the core card; Space/→ next, ← back, Esc exits; camera moves with `fitBounds` (duration 0 under reduced motion); “3 / 24” indicator. No schema change |

### 9.4 Events and timetable — migration `00023_m13_events_views.sql` (part 1)

```sql
create table public.course_events (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses(id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 160),
  kind       text not null default 'other' check (kind in ('exam','quiz','deadline','lecture','other')),
  starts_at  timestamptz not null,
  ends_at    timestamptz,
  all_day    boolean not null default false,
  note_id    uuid references public.nodes(id) on delete set null,
  published  boolean not null default false,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create index course_events_course_idx on public.course_events (course_id, starts_at);
-- RLS enabled and forced. select: can_access_course and (published or is_course_staff).
-- insert/update/delete: can_edit_canvas (owner, editor, admin). Guard trigger: note_id must belong to the same course.
-- Grants: select; insert (id, course_id, title, kind, starts_at, ends_at, all_day, note_id, published);
--         update (title, kind, starts_at, ends_at, all_day, note_id, published); delete. Touch trigger for updated_at.
```

Write the policies and triggers out in full in the migration, in the same style as §5.2.

- **UI:** leader `/courses/[courseId]/calendar` (list and simple month grid; add, edit, delete); student `/s/calendar` (all joined courses, upcoming events grouped by week, countdown chips such as “in 12 days”, today highlighted). Store UTC, **display in the device time zone and show the zone name** (daylight-saving rules can change). Setting `max_events_per_course` (default 200).
- **`.ics` download:** route `GET /api/calendar/[courseId]` (leader session or student cookie; published events only for students) returning `text/calendar; charset=utf-8`, `Cache-Control: private, no-store`. Pure `buildIcs(events)`: `PRODID:-//Study Hub//EN`, `UID:<id>@studyhub`, `DTSTAMP` and `DTSTART` in UTC (`...Z`; all-day uses `VALUE=DATE`), RFC 5545 text escaping (backslash, comma, semicolon, newline), CRLF line ends, folding at 75 **octets** (not characters, so Arabic titles stay valid). No subscription URL in v1 (it would need a new secret). **Open:** subscription URL later.

### 9.5 Aggregate read counts — migration `00023` (part 2)

```sql
create table public.note_view_counts (
  node_id   uuid not null references public.nodes(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  day       date not null,
  views     integer not null default 0 check (views >= 0),
  primary key (node_id, day)
);
-- RLS enabled and forced; select: is_course_staff(course_id); no client writes.
create or replace function public.bump_note_view(p_node uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.note_view_counts (node_id, course_id, day, views)
  select n.id, n.course_id, (now() at time zone 'utc')::date, 1
    from public.nodes n where n.id = p_node and n.published_version_id is not null and n.deleted_at is null
  on conflict (node_id, day) do update set views = public.note_view_counts.views + 1;
$$;
revoke all on function public.bump_note_view(uuid) from public, anon, authenticated;
grant execute on function public.bump_note_view(uuid) to service_role;
```

- The student note page calls `bump_note_view` through a server action **after** the access check, at most once per note per device per 30 minutes (client dedupe in `sessionStorage`), and behind a new rate-limit purpose `view` (60 per minute per hashed IP).
- Retention: setting `retention_view_counts_days` (default 365); delete older rows lazily when an admin opens Health (same pattern as QUESTIONS #20).
- UI: Health tab **Most read notes (last 30 days)** and “Read N times this month” on a note for leaders. No student identifiers or IPs are stored. Add one sentence to the students guide: “The site counts how many times each note is opened, never who opened it.”

### 9.6 Optional AI helper: “Suggest how to organise this map”

- Lives in the existing AI side panel; uses the leader’s own key and the existing router (`ai_task`, new task kind `organise_map`); counts against the daily allowance; at most 1 per minute per leader.
- Input to the model: only titles of notes, cards and groups, plus names of `ai_allowed` files. **Note text is included only if the leader ticks “include note text” and the note’s files are `ai_allowed`.** Never student data. The existing free-tier privacy warning is shown first.
- Output: strict JSON, `{ groups: [{ label, cardIds[] }], links: [{ from, to, label }], notes: string }`, validated with zod on the server; unknown ids are dropped.
- The leader sees a **preview** (“Add 3 groups and 5 links”) with **Apply** and **Discard**. Apply sends ordinary ops through the save queue (so undo works). Nothing is ever applied automatically and nothing is published.

### 9.7 Tests and acceptance for M13

- **Unit:** `buildIcs` (escaping, folding by octets, UTC, all-day), flashcard parser, Leitner scheduler (injected clock), highlight anchoring and outdated detection, present-mode ordering, study-data export/import schema, row→op mapping, echo filter.
- **RLS:** `course_events` visibility (students see published only; no cross-course); `note_view_counts` has no client writes and is staff-readable only; `bump_note_view` is not executable by `authenticated`; realtime policy checked if testable.
- **Playwright:** two leader contexts see each other’s card moves within 2 s and see presence; student flashcard session by keyboard; highlights survive reload; study-data export/import round trip; calendar → `.ics` download parsed; read-aloud button hidden when unsupported; present mode steps.

* [ ] All of the above pass; CI green; `FREE_TIER.md` has the dated Realtime row; docs updated.

## 10. Settings, limits and migrations (all milestones)

Register every key in `src/lib/settings.ts` with a plain-language label, default, minimum and maximum, so `/admin/settings` renders it (QUESTIONS #21 said eight keys; this adds nine).

| Key | Default | Min | Max | Label shown to admins |
| --- | --- | --- | --- | --- |
| `max_canvas_cards` | 300 | 20 | 1000 | Most cards on one map |
| `max_canvases_per_course` | 20 | 1 | 100 | Most maps per course |
| `canvas_version_keep_auto` | 30 | 5 | 100 | Automatic map backups to keep |
| `canvas_import_max_kb` | 1024 | 64 | 4096 | Largest map file you can import (KB) |
| `vault_export_max_mb` | 200 | 10 | 500 | Largest Obsidian download (MB) |
| `realtime_enabled` | 1 | 0 | 1 | Live editing together (1 = on) |
| `max_live_editors_per_canvas` | 5 | 1 | 10 | Leaders who can edit one map live |
| `max_events_per_course` | 200 | 10 | 1000 | Most calendar entries per course |
| `retention_view_counts_days` | 365 | 30 | 1095 | Days to keep note read counts |

**New rate-limit purposes** (add to `rate-limit.ts` and the table in `PROJECT-GUIDE.md` §12; all fail closed): `canvas_ops` 240 per minute, `canvas_create` 20 per hour, `canvas_import` 10 per hour, `view` 60 per minute, `ai_organise` 1 per minute.

**Migrations added by this plan:**

| File | Milestone | Content |
| --- | --- | --- |
| `00018_m9_canvas.sql` | M9 | canvases, cards, edges, versions, guards, RLS, grants |
| `00019_m9_canvas_ops.sql` | M9 | snapshot, apply-ops and restore RPCs |
| `00020_m11_course_accent.sql` | M11 | `courses.accent` preset |
| `00021_m12_note_links.sql` | M12 | wikilink table and policies |
| `00022_m12_search_normalize.sql` | M12 | `pg_trgm`, `normalize_search`, `nodes.search_norm` |
| `00023_m13_events_views.sql` | M13 | `course_events`, `note_view_counts`, `bump_note_view` |
| `00024_m13_realtime.sql` | M13 | realtime publication and channel policies |

After each migration: apply it locally (`db:reset`), run the RLS suite, then apply it to the hosted project and note it in `PROJECT-GUIDE.md` §6 (table count and migration table).

## 11. Security and privacy checklist (verify at every milestone)

1. Every new table has RLS **enabled and forced**, column-level grants, and no grant to `anon`.
2. A card can never reference another course’s note or file; an edge can never join two canvases (guard triggers + RLS tests).
3. Students cannot learn that a hidden note, file, card or canvas exists: not-found screens only, no protected content in responses.
4. Card URLs: `http`/`https` only; links use `rel="noopener noreferrer"`; never `javascript:` or `data:`.
5. Markdown: no raw HTML; images only from the app’s own signed storage URLs; external images are stripped and shown as plain text.
6. The CSP gets **no new external origin**. Fonts are self-hosted; no CDN scripts; no remote previews or favicons.
7. File upload reuses the existing pipeline (allow-list, magic-byte check, size limit, private bucket). There is no second upload path.
8. Imports (`.canvas`, study data) are parsed in a `try` block, size-capped, zod-validated, never evaluated, and re-validated on the server where they reach the database.
9. Realtime channels are private and staff-only. Students never subscribe.
10. Student study data stays on the device. No endpoint receives it. Export and import are local file operations.
11. Read counts are aggregate only; no student id, no IP is stored (the limiter key is already a hash).
12. `.ics` responses contain no personal data, are `no-store`, and list published events only for students.
13. The service-role client is used only on the server; `bump_note_view` is executable by `service_role` only.
14. AI follows rule 9: per-leader keys, `ai_allowed` files only, no student data, output validated and never applied automatically.
15. Audit rows are written for: canvas create, delete, publish, restore, import; accent change; link rebuild; search-index rebuild.
16. Before merging a milestone, `npm audit` shows no high or critical findings for new dependencies, and every dependency is pinned to an exact version.

## 12. Testing, CI and performance

| Suite | What changes |
| --- | --- |
| Vitest | New pure modules: `canvas/*`, `wikilinks`, `search-normalize`, `flashcards`, `ics`, `study-data`, `accent`; shortcut table check; token-usage check |
| RLS (`scripts/test-rls.mjs`) | §5.9, §8.6 and §9.7 cases; continue the existing numbering |
| Playwright | Specs listed per milestone; axe on every new page; 360 px and 1280 px; one RTL check; offline canvas check on the production build |
| CI `quality` job | Add `node scripts/check-contrast.mjs` |
| CI `e2e` job | Keep total e2e time under 15 minutes; if exceeded, split desktop and mobile projects with `--shard` |

**Baseline first:** before starting M9, run the existing Lighthouse script on the student home and a student note page and write the scores in `docs/M9-recon.md`. After each milestone the performance score on those pages MUST NOT drop by more than 3 points. Extend `scripts/load-test.mjs` with a read of a 300-card canvas.

## 13. `FREE_TIER.md` rows to add (before the code that uses each item)

The licences below are what is expected. **Confirm each on its official page on the day you add the row** and write that date; do not rely on this table.

| Dependency or service | Expected licence | Used for | Milestone |
| --- | --- | --- | --- |
| `@dagrejs/dagre` | MIT | Auto-layout (generate, tidy up) | M9 |
| `cmdk` | MIT | Command palette | M10 |
| `lucide-react` | ISC | Icons | M11 |
| `@radix-ui/react-*` primitives (dialog, dropdown-menu, popover, tooltip, tabs, toggle-group, switch) | MIT | Accessible components | M11 |
| Inter, IBM Plex Sans Arabic (font files) | SIL OFL 1.1 | Self-hosted fonts | M11 |
| `@tiptap/suggestion` | MIT | `[[` autocomplete | M12 |
| `d3-force` | ISC | Graph layout | M12 |
| `pg_trgm` (Postgres extension, included with Supabase) | PostgreSQL licence | Typo-tolerant search | M12 |
| `idb-keyval` | Apache-2.0 | Student data on the device | M13 |
| `html-to-image` | MIT | Export map as PNG | M13 |
| Supabase Realtime (free plan limits) | n/a | Live co-working | M13: copy the current limits and the date from the official pricing page |

## 14. Rows to add to `docs/QUESTIONS.md` (start at #31)

| # | Date | Question | Simplest safe option chosen for now |
| --- | --- | --- | --- |
| 31 | 2026-10-30 | Who may edit canvases? | Admin, course owner and course editor. Contributors and reviewers read (D7). Revisit if contributors need to add their own notes to maps. |
| 32 | 2026-10-30 | A published map is live: edits show to students immediately. Should maps have a separate draft and publish step? | No. Show a banner on published maps, “This map is published — changes are visible to students immediately”, and offer **Unpublish to edit privately**. **MUST be built in M9.** |
| 33 | 2026-10-30 | Student study data lives only on the device and is lost if the browser data is cleared. | Provide **Export my study data** and **Import** (§9.3). No server copy, to keep students account-free and private. |
| 34 | 2026-10-30 | Should a leader’s theme follow them across devices? | No: device-only in v1 (D15). A `profiles.theme` column can come later. |
| 35 | 2026-10-30 | Will theme screenshots be stable in CI? | Try five screens × three widths × four themes; if flaky, keep light and dark only. |
| 36 | 2026-10-30 | The Supabase Realtime private-channel API may differ from the sketch in §9.2. | Fall back to Postgres Changes only with an “edited a moment ago by \<name>” indicator. |
| 37 | 2026-10-30 | Should students get a calendar subscription URL? | No. `.ics` download only; a subscription URL needs a new secret. |
| 38 | 2026-10-30 | The Arabic search normaliser is lossy on purpose (ta marbuta → ha, alef maqsura → ya). Acceptable? | Yes, for search only; displayed text is never changed. |
| 39 | 2026-10-30 | Vault export size. | Built in the browser, capped at `vault_export_max_mb` (200); offer “without files” above that. |
| 40 | 2026-10-30 | After `/map` redirects to the canvas, keep the old tree map? | Keep it reachable as **Outline**; it is also the accessible alternative. |
| 41 | 2026-10-30 | Can reviewers comment on canvas cards? | Not in v1. Comments stay on notes. |
| 42 | 2026-10-30 | Do seed ids (`cccccccc-…`) need real UUIDs for canvas ops? | Use the relaxed hex pattern for any id that may be a seed id (same as #19); new ids come from `crypto.randomUUID()`. |

## 15. Kickoff prompts for opencode

First, export this document as Markdown and commit it as `docs/CANVAS-SPEC.md`. Then give opencode one prompt at a time, in order. Start a fresh session for each milestone.

**M9**

```text
You are working in the Study Hub repository (Next.js 16, React 19, Tailwind 4, Supabase, strict TypeScript). Read AGENTS.md, docs/PROJECT-GUIDE.md, docs/QUESTIONS.md and docs/FREE_TIER.md first. Then read docs/CANVAS-SPEC.md and implement ONLY milestone M9 (its sections 0-5, plus sections 10-14 where they apply).

Order of work: (1) Step 0 reconnaissance, written to docs/M9-recon.md, including the Lighthouse baseline; (2) migrations 00018 and 00019 with RLS tests; (3) src/lib/canvas modules with unit tests; (4) DAL, server actions, pages and components; (5) generate-from-course; (6) e2e tests; (7) docs.

Rules: never disable RLS or a test; no any; add a FREE_TIER.md row before using any new dependency; when something is unclear choose the simplest safe option and add a row to docs/QUESTIONS.md; run lint, typecheck and tests before every commit; commit in small steps on branch m9-canvas. Published maps must show the banner from QUESTIONS #32.

Stop when the M9 acceptance checklist (5.10) is fully ticked and CI is green. Then report: what was built, any deviation from the spec, and open questions. Do not start M10.
```

**M10**

```text
Continue in the Study Hub repository. M9 is merged. Read docs/CANVAS-SPEC.md and implement ONLY milestone M10 (section 6): all interactions, keyboard shortcuts, history and save queue, drag-and-drop upload (reuse the existing upload pipeline, do not write a new one), side pane, command palette, touch mode, canvas accessibility, performance budget. Redirect /courses/[courseId]/map to the default canvas only after every M10 test passes.
Same rules as M9: RLS and tests are never disabled, no any, FREE_TIER.md rows before new dependencies (cmdk), unclear points go to docs/QUESTIONS.md, lint + typecheck + tests before every commit, branch m10-interactions. Stop at the M10 checklist (6.11) and report.
```

**M11**

```text
Continue in the Study Hub repository. M10 is merged. Read docs/CANVAS-SPEC.md and implement ONLY milestone M11 (section 7): design tokens and four themes, course accent, self-hosted fonts, RTL-safe components, Radix-based component library, per-device layouts, motion, UX polish list, scripts/check-contrast.mjs in CI. Migrate screens one at a time and never leave a screen half-migrated. The contrast script is the authority on colours: change values, not the script. Same rules as before; branch m11-design. Stop at the M11 checklist (7.13) and report.
```

**M12**

```text
Continue in the Study Hub repository. M11 is merged. Read docs/CANVAS-SPEC.md and implement ONLY milestone M12 (section 8): JSON Canvas export and import, Obsidian vault export built in the browser, wikilinks with plain-text storage, note_links and backlinks, graph view, search normalisation for Arabic, and the backup/restore extension. Keep SQL and TypeScript normalisers in sync with the golden-file test. Same rules as before; branch m12-links. Stop at the M12 checklist (8.6) and report.
```

**M13**

```text
Continue in the Study Hub repository. M12 is merged. Read docs/CANVAS-SPEC.md and implement ONLY milestone M13 (section 9): realtime co-working for leaders, student study tools stored only on the device, events and .ics download, aggregate read counts, and the optional AI organise-map helper. First verify the Supabase Realtime private-channel API against the current official docs and record the result in docs/QUESTIONS.md. Same rules as before; branch m13-live. Stop at the M13 checklist (9.7) and report.
```

## Appendix A — Repository additions and routes

```
src/lib/canvas/{types,schemas,defaults,ops,geometry,history,save-queue,shortcuts,layout,generate,json-canvas}.ts (+ tests)
src/lib/{dal-canvas,wikilinks,search-normalize,flashcards,ics,study-data,accent}.ts (+ tests)
src/components/canvas/…      src/components/ui/…      src/fonts/…
src/app/tokens.css          src/app/tokens-accent.css
src/app/(leader)/courses/[courseId]/{canvas,graph,calendar}/…
src/app/s/{canvas,graph,calendar,practice}/…
src/app/api/calendar/[courseId]/route.ts
scripts/{check-contrast,backfill-search-norm}.mjs
docs/{CANVAS-SPEC,M9-recon}.md
```

| Route | Who | Milestone |
| --- | --- | --- |
| `/courses/[courseId]/canvas`, `/canvas/[canvasId]` | Leaders | M9 |
| `/s/canvas/[canvasId]` | Students | M9 |
| `/courses/[courseId]/graph`, `/s/graph/[courseId]` | Leaders, students | M12 |
| `/courses/[courseId]/calendar`, `/s/calendar` | Leaders, students | M13 |
| `/s/practice/[courseId]` | Students | M13 |
| `GET /api/calendar/[courseId]` (`.ics`) | Leaders, students | M13 |

Update `PROJECT-GUIDE.md`: §4 (stack rows), §5 (dependencies), §6 (tables and migrations), §7 (screens), §12 (rate limits), §13 (settings), §14 (routes), §19 (repository map), §20 (this spec in the documentation set).

## Appendix B — Draft text for `leader-guide.md` (plain language)

**Maps (the canvas)**

A map is a big, open board where you place your notes and files and draw lines between them, so students see how everything fits together. Open a course and tap **Map**.

- **Start fast:** press **Generate from course**. Study Hub builds a first map from your sections and notes. You can move anything afterwards.
- **Add things:** double-click empty space for a text card. Drag a note or file from the list on the left. Drag a file from your computer onto the map to upload it and add it in one step.
- **Connect:** drag from the dot on the side of a card to another card. On a phone, tap **Connect**, then tap two cards.
- **Group:** select several cards and press **G** to put a coloured frame around them.
- **Colours:** pick a colour for a card or line and write what it means in the **Legend**, for example “red = important for the exam”.
- **Remove from map** only takes the card off the map. Your note or file stays safe in the course. To delete a note or file, use its own menu.
- **Undo** is always one tap or **Ctrl+Z** away. **Save version** keeps a copy you can go back to.
- **Publish** when the map is ready. A published map is live: changes you make show to students straight away. Tap **Unpublish** if you want to work privately.
- **Obsidian:** **Download for Obsidian** gives you your notes, links and maps to open in the free Obsidian app on a computer.

Students see the map read-only. They can open notes, and download files only where you allowed it.

## Appendix C — Definition of done (every milestone)

1. Acceptance checklist of the milestone fully ticked.
2. CI green: quality, rls, e2e. No test or rule disabled.
3. Security checklist (§11) re-checked for everything new.
4. `FREE_TIER.md`, `QUESTIONS.md`, `PROJECT-GUIDE.md` and the leader and student guides updated.
5. A short report from the agent: built, deviations, open questions.
6. Nour reviews on a real phone (360 px) and a laptop, signs in as a leader, joins as a student with a join code, and walks through the milestone’s main flow before the next milestone starts.
