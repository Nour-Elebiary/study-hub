-- Study Hub — M2 Workspace core: content tree, versions, tags, comments, locks
-- (spec sections 5 and 6). Every table: RLS on, policies in this file, tested
-- in supabase/tests/rls/07-09.

-- ---------------------------------------------------------------------------
-- nodes — the content tree that becomes the mind-map (spec section 5)
-- course_id is null for core pages (whole-hub pages outside any course).
-- draft_body_md holds the autosaved draft (every 5 s); node_versions holds
-- the permanent, immutable copies written on Save or after 60 s of changes.
-- ---------------------------------------------------------------------------
create table public.nodes (
  id uuid primary key default gen_random_uuid (),
  course_id uuid references public.courses (id) on delete cascade,
  parent_id uuid references public.nodes (id) on delete cascade,
  area text not null
    check (area in (
      'official_materials', 'student_notes', 'quiz_exam_prep',
      'external_resources', 'glossary', 'open_questions'
    )),
  kind text not null default 'note'
    check (kind in ('core', 'course_home', 'section', 'note')),
  title text not null default '',
  slug text not null default '',
  sort_order integer not null default 0,
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'published')),
  assigned_to uuid references auth.users (id) on delete set null,
  due_date date,
  published_version_id uuid, -- fk added below, after node_versions exists
  draft_body_md text not null default '',
  draft_updated_at timestamptz,
  deleted_at timestamptz, -- soft delete, 30-day retention (spec rule 5)
  created_by uuid references auth.users (id) on delete set null
    default auth.uid (),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector
);

create index nodes_course_id_idx on public.nodes (course_id);
create index nodes_parent_id_idx on public.nodes (parent_id);
create index nodes_assigned_to_idx on public.nodes (assigned_to);
create index nodes_search_idx on public.nodes using gin (search);

-- ---------------------------------------------------------------------------
-- node_versions — one row per save; never updated, only inserted
-- ---------------------------------------------------------------------------
create table public.node_versions (
  id uuid primary key default gen_random_uuid (),
  node_id uuid not null references public.nodes (id) on delete cascade,
  version_no integer not null,
  body_md text not null default '',
  author_id uuid references auth.users (id) on delete set null,
  change_note text not null default '',
  created_at timestamptz not null default now(),
  unique (node_id, version_no)
);

create index node_versions_node_id_idx on public.node_versions (node_id, version_no desc);

alter table public.nodes
  add constraint nodes_published_version_fk
  foreign key (published_version_id) references public.node_versions (id)
  on delete set null;

-- ---------------------------------------------------------------------------
-- tags and node_tags — quizzes and exams are tags, not folders
-- ---------------------------------------------------------------------------
create table public.tags (
  id uuid primary key default gen_random_uuid (),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table public.node_tags (
  node_id uuid not null references public.nodes (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (node_id, tag_id)
);

create index node_tags_tag_id_idx on public.node_tags (tag_id);

-- ---------------------------------------------------------------------------
-- comments — review feedback and questions (threaded)
-- ---------------------------------------------------------------------------
create table public.comments (
  id uuid primary key default gen_random_uuid (),
  node_id uuid not null references public.nodes (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  parent_id uuid references public.comments (id) on delete cascade,
  body text not null default '',
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create index comments_node_id_idx on public.comments (node_id);

-- ---------------------------------------------------------------------------
-- locks — soft edit locks: one person edits a note at a time (spec rule 3).
-- The lock renews every 30 s in the editor and expires after 2 minutes.
-- ---------------------------------------------------------------------------
create table public.locks (
  node_id uuid primary key references public.nodes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helper: the caller's role in a course, honouring optional validity dates
-- (a membership outside its valid_from/valid_until window counts as absent).
-- ---------------------------------------------------------------------------
create or replace function public.course_role(course uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.course_members m
  where m.course_id = course
    and m.user_id = auth.uid ()
    and (m.valid_from is null or m.valid_from <= current_date)
    and (m.valid_until is null or m.valid_until >= current_date);
$$;

-- Helper: may the caller write content in this area of this course?
-- Owner: all areas. Editor and contributor: only their assigned areas
-- (spec section 4). Contributor is further limited to own drafts at the
-- row level (policies below).
create or replace function public.can_write_area(course uuid, area text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin ()
    or public.course_role (course) = 'owner'
    or (
      public.course_role (course) in ('editor', 'contributor')
      and area in (
        select unnest (m.areas)
        from public.course_members m
        where m.course_id = course
          and m.user_id = auth.uid ()
          and (m.valid_from is null or m.valid_from <= current_date)
          and (m.valid_until is null or m.valid_until >= current_date)
      )
    );
$$;

-- Helper: does the caller share at least one course with this user?
-- Lets leaders see the display names of the people they work with
-- (comment authors, assignees) without exposing anything else.
create or replace function public.shares_course_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.course_members me
    join public.course_members them on them.course_id = me.course_id
    where me.user_id = auth.uid ()
      and them.user_id = other
  );
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
-- 1. touch updated_at on every node update
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now ();
  return new;
end;
$$;

create trigger nodes_touch_updated_at
before update on public.nodes
for each row execute function public.touch_updated_at ();

-- 2. version numbers are sequential per node and assigned by the database
--    (the unique (node_id, version_no) constraint is the race guard)
create or replace function public.assign_version_no()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select coalesce (max (version_no), 0) + 1 into new.version_no
  from public.node_versions
  where node_id = new.node_id;
  return new;
end;
$$;

create trigger node_versions_assign_no
before insert on public.node_versions
for each row execute function public.assign_version_no ();

-- 3. keep nodes.search current: title (weight A) plus the newest version
--    body, falling back to the autosaved draft (weight B). The `simple`
--    configuration indexes English and Arabic without stemming (rule 4).
create or replace function public.refresh_node_search(node uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.nodes n
  set search =
    setweight (to_tsvector ('simple', coalesce (n.title, '')), 'A')
    || setweight (
      to_tsvector (
        'simple',
        coalesce (
          (
            select v.body_md
            from public.node_versions v
            where v.node_id = n.id
            order by v.version_no desc
            limit 1
          ),
          n.draft_body_md,
          ''
        )
      ),
      'B'
    )
  where n.id = node;
$$;

create or replace function public.refresh_search_on_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_node_search (new.node_id);
  return null;
end;
$$;

create trigger node_versions_refresh_search
after insert on public.node_versions
for each row execute function public.refresh_search_on_version ();

create or replace function public.refresh_search_on_title()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_node_search (new.id);
  return null;
end;
$$;

create trigger nodes_refresh_search_title
after update of title on public.nodes
for each row execute function public.refresh_search_on_title ();

-- 4. maximum tree depth of 6 (spec section 5, nodes row)
create or replace function public.enforce_node_depth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_id uuid := new.parent_id;
  depth integer := 0;
begin
  while current_id is not null loop
    depth := depth + 1;
    if current_id = new.id then
      raise exception 'A note cannot be inside itself.';
    end if;
    if depth >= 6 then
      raise exception 'Content can be nested at most 6 levels deep.';
    end if;
    select parent_id into current_id from public.nodes where id = current_id;
  end loop;
  return new;
end;
$$;

create trigger nodes_enforce_depth
before insert or update of parent_id on public.nodes
for each row execute function public.enforce_node_depth ();

-- ---------------------------------------------------------------------------
-- profiles: leaders may also read the display name of anyone they share a
-- course with (comment authors, assignees). Nothing else is exposed.
-- ---------------------------------------------------------------------------
create policy select_course_peer_profiles on public.profiles
  as permissive for select to authenticated
  using (
    id = auth.uid ()
    or public.is_admin ()
    or public.shares_course_with (id)
  );

-- ---------------------------------------------------------------------------
-- Enable and force RLS on every new table
-- ---------------------------------------------------------------------------
alter table public.nodes enable row level security;
alter table public.node_versions enable row level security;
alter table public.tags enable row level security;
alter table public.node_tags enable row level security;
alter table public.comments enable row level security;
alter table public.locks enable row level security;
alter table public.nodes force row level security;
alter table public.node_versions force row level security;
alter table public.tags force row level security;
alter table public.node_tags force row level security;
alter table public.comments force row level security;
alter table public.locks force row level security;

-- ---------------------------------------------------------------------------
-- nodes
-- Read: every member of the course (drafts included — leaders inside a
-- course collaborate on drafts); core pages (course_id null) every leader.
-- Insert: admin, owner, or editor/contributor in an assigned area.
-- Update (content columns only): admin, owner, editor in area, or a
-- contributor on their own draft. Status transitions and soft deletes go
-- through the server (audited service-role actions), so `status` and
-- `deleted_at` have no client grant at all.
-- ---------------------------------------------------------------------------
create policy select_course_nodes on public.nodes
  as permissive for select to authenticated
  using (
    course_id is null
    or public.can_access_course (course_id)
  );

create policy insert_writable_nodes on public.nodes
  as permissive for insert to authenticated
  with check (
    course_id is not null
    and public.can_write_area (course_id, area)
  );

create policy update_writable_nodes on public.nodes
  as permissive for update to authenticated
  using (
    public.is_admin ()
    or public.is_course_owner (course_id)
    or (
      public.can_write_area (course_id, area)
      and (
        public.course_role (course_id) <> 'contributor'
        or created_by = auth.uid ()
      )
    )
  )
  with check (
    public.is_admin ()
    or public.is_course_owner (course_id)
    or (
      public.can_write_area (course_id, area)
      and (
        public.course_role (course_id) <> 'contributor'
        or created_by = auth.uid ()
      )
    )
  );

-- No delete policy: deleting is a soft delete written by the server.

revoke insert, update, delete on public.nodes from authenticated;
-- `id` is grantable: clients may generate their own UUIDs (standard Supabase
-- practice); the PK still rejects collisions. The protected columns are
-- status/deleted_at (server-only transitions) and created_by (defaults to
-- auth.uid(), never client-settable).
grant insert (
  id, course_id, parent_id, area, kind, title, slug, sort_order,
  assigned_to, due_date, draft_body_md
) on public.nodes to authenticated;
grant update (
  title, slug, sort_order, assigned_to, due_date,
  draft_body_md, draft_updated_at
) on public.nodes to authenticated;

-- ---------------------------------------------------------------------------
-- node_versions — immutable history. Read by course members; written by
-- the same roles that may edit the node (a reviewer never writes versions).
-- ---------------------------------------------------------------------------
create policy select_course_node_versions on public.node_versions
  as permissive for select to authenticated
  using (
    exists (
      select 1 from public.nodes n
      where n.id = node_id
        and (n.course_id is null or public.can_access_course (n.course_id))
    )
  );

create policy insert_writable_node_versions on public.node_versions
  as permissive for insert to authenticated
  with check (
    exists (
      select 1 from public.nodes n
      where n.id = node_id
        and n.course_id is not null
        and (
          public.is_admin ()
          or public.is_course_owner (n.course_id)
          or (
            public.can_write_area (n.course_id, n.area)
            and (
              public.course_role (n.course_id) <> 'contributor'
              or n.created_by = auth.uid ()
            )
          )
        )
    )
  );

-- No update/delete policies: versions are immutable (spec section 5).

-- ---------------------------------------------------------------------------
-- tags — global labels; every leader may read and create them
-- ---------------------------------------------------------------------------
create policy select_tags_authenticated on public.tags
  as permissive for select to authenticated
  using (true);

create policy insert_tags_authenticated on public.tags
  as permissive for insert to authenticated
  with check (true);

-- No update/delete: tags are immutable labels (renames would silently
-- rewrite every course that uses them — an admin task via the server later).

-- ---------------------------------------------------------------------------
-- node_tags — follow the write rights of the node they attach to
-- ---------------------------------------------------------------------------
create policy select_course_node_tags on public.node_tags
  as permissive for select to authenticated
  using (
    exists (
      select 1 from public.nodes n
      where n.id = node_id
        and (n.course_id is null or public.can_access_course (n.course_id))
    )
  );

create policy write_writable_node_tags on public.node_tags
  as permissive for all to authenticated
  using (
    exists (
      select 1 from public.nodes n
      where n.id = node_id
        and n.course_id is not null
        and (
          public.is_admin ()
          or public.is_course_owner (n.course_id)
          or (
            public.can_write_area (n.course_id, n.area)
            and (
              public.course_role (n.course_id) <> 'contributor'
              or n.created_by = auth.uid ()
            )
          )
        )
    )
  )
  with check (
    exists (
      select 1 from public.nodes n
      where n.id = node_id
        and n.course_id is not null
        and (
          public.is_admin ()
          or public.is_course_owner (n.course_id)
          or (
            public.can_write_area (n.course_id, n.area)
            and (
              public.course_role (n.course_id) <> 'contributor'
              or n.created_by = auth.uid ()
            )
          )
        )
    )
  );

-- ---------------------------------------------------------------------------
-- comments — every course member reads and writes (reviewers included);
-- only the author, an owner or an admin can mark a thread resolved.
-- ---------------------------------------------------------------------------
create policy select_course_comments on public.comments
  as permissive for select to authenticated
  using (
    exists (
      select 1 from public.nodes n
      where n.id = node_id
        and (n.course_id is null or public.can_access_course (n.course_id))
    )
  );

create policy insert_course_comments on public.comments
  as permissive for insert to authenticated
  with check (
    author_id = auth.uid ()
    and exists (
      select 1 from public.nodes n
      where n.id = node_id
        and n.course_id is not null
        and public.can_access_course (n.course_id)
    )
  );

create policy update_own_or_owner_comments on public.comments
  as permissive for update to authenticated
  using (
    author_id = auth.uid ()
    or public.is_admin ()
    or exists (
      select 1 from public.nodes n
      where n.id = node_id
        and public.is_course_owner (n.course_id)
    )
  )
  with check (true);

-- No delete policy: review feedback is part of the record.

-- ---------------------------------------------------------------------------
-- locks — course members see them; a member holds at most their own lock;
-- an owner or admin may break someone else's lock (spec rule 3).
-- ---------------------------------------------------------------------------
create policy select_course_locks on public.locks
  as permissive for select to authenticated
  using (
    exists (
      select 1 from public.nodes n
      where n.id = node_id
        and n.course_id is not null
        and public.can_access_course (n.course_id)
    )
  );

create policy insert_own_locks on public.locks
  as permissive for insert to authenticated
  with check (
    user_id = auth.uid ()
    and exists (
      select 1 from public.nodes n
      where n.id = node_id
        and n.course_id is not null
        and public.can_access_course (n.course_id)
    )
  );

create policy update_own_locks on public.locks
  as permissive for update to authenticated
  using (user_id = auth.uid ())
  with check (user_id = auth.uid ());

create policy delete_own_or_owner_locks on public.locks
  as permissive for delete to authenticated
  using (
    user_id = auth.uid ()
    or public.is_admin ()
    or exists (
      select 1 from public.nodes n
      where n.id = node_id
        and public.is_course_owner (n.course_id)
    )
  );
