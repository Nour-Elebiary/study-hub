-- Study Hub RLS test 16 — canvas foundation (CANVAS-SPEC section 5.9, M9).
--
-- Decision D7 (QUESTIONS #31, confirmed by the owner): EVERY course member
-- level may edit canvases — admin, owner, editor, contributor and reviewer.
-- Only account-less students (who have no database identity at all) and
-- non-members cannot.
--
-- What the database can and cannot enforce, and where the rest is enforced:
--   * Students never appear here (no accounts): the app reads canvases with
--     the service-role client filtered by the join-cookie scope
--     (src/lib/student-access.ts), which re-checks "published only" and the
--     card-level visibility rules (published notes, student-visible files,
--     student_visible cards) in code. The card RLS policy keeps the same
--     rules for any future authenticated caller who is not course staff.
--   * A stranger (an authenticated leader with no membership) sees NOTHING —
--     not even published canvases: privacy beats discoverability at the
--     database layer.
--   * Notes have no hard DELETE policy (soft delete only), so the restore
--     path "drops cards whose note no longer exists" is exercised with a
--     hand-written snapshot that includes a node_id not present any more.
--
-- Conventions for the negative cases below: an RLS UPDATE/DELETE that the
-- caller may not see silently matches zero rows (verified by reading back
-- as a permitted role), while an INSERT whose WITH CHECK fails raises
-- 42501 and must be caught in a do-block. Where the expected failure AND
-- the assertion failure are both P0001 raises, the handler re-raises
-- anything starting with "ASSERT FAILED" so a wrongly-permitted action
-- still fails the file instead of passing silently.
--
-- Fixtures reused from earlier files (they commit their state):
--   Leader A (dddd…01): editor in COURSE-A (test 07)
--   Leader B (dddd…02): contributor in COURSE-B, reviewer in COURSE-A (07)
--   the seed admin (aaaa…): owns both sample courses
-- plus a fresh membership-less leader created below.

begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', 'dddddddd-dddd-dddd-dddd-dddddddddd81',
  'authenticated', 'authenticated', 'leaderH@studyhub.local',
  crypt ('LeaderH-Temp-01', gen_salt ('bf')), now (),
  '{"provider":"email","providers":["email"]}',
  '{"display_name":"Leader H"}', now (), now ()
);

-- ---------------------------------------------------------------------------
-- Case 14: anon has no privileges on the four tables or the three functions
-- (column-level grants were revoked from anon; the RPCs are authenticated-only)
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '';

do $$
begin
  select count(*) > 0 from public.canvases;
  raise exception 'ASSERT FAILED: anon selected canvases';
exception when insufficient_privilege then null; -- expected
end $$;

do $$
begin
  select count(*) > 0 from public.canvas_nodes;
  raise exception 'ASSERT FAILED: anon selected canvas_nodes';
exception when insufficient_privilege then null; -- expected
end $$;

do $$
begin
  select count(*) > 0 from public.canvas_edges;
  raise exception 'ASSERT FAILED: anon selected canvas_edges';
exception when insufficient_privilege then null; -- expected
end $$;

do $$
begin
  select count(*) > 0 from public.canvas_versions;
  raise exception 'ASSERT FAILED: anon selected canvas_versions';
exception when insufficient_privilege then null; -- expected
end $$;

do $$
begin
  perform public.canvas_apply_ops (
    '00000000-0000-0000-0000-000000000001', '[]'::jsonb);
  raise exception 'ASSERT FAILED: anon executed canvas_apply_ops';
exception when insufficient_privilege then null; -- expected
end $$;

do $$
begin
  perform public.canvas_restore_version ('00000000-0000-0000-0000-000000000001');
  raise exception 'ASSERT FAILED: anon executed canvas_restore_version';
exception when insufficient_privilege then null; -- expected
end $$;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- Fixtures (as the seed admin, who owns both sample courses): one published
-- and one draft canvas in COURSE-A, three cards (note / text / hidden file),
-- one edge, a draft COURSE-A note, a draft COURSE-B note (for the
-- cross-course guard), and the canvas's first version.
-- ---------------------------------------------------------------------------
insert into public.nodes (id, course_id, area, kind, title, slug, status, created_by)
values
  ('f0f0f0f0-0c19-0000-9000-000000000001', 'cccccccc-0000-cccc-0000-000000000001',
   'quiz_exam_prep', 'note', 'Canvas guardian note', 'canvas-guardian-note', 'draft',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('f0f0f0f0-0c19-0000-9000-000000000002', 'cccccccc-0000-cccc-0000-000000000002',
   'quiz_exam_prep', 'note', 'Course B guardian', 'course-b-guardian', 'draft',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

insert into public.assets (
  id, course_id, node_id, kind, storage, path_or_url, title, mime, size_bytes,
  student_visible, created_by
) values (
  'f0f0f0f0-0c19-0000-a000-000000000001', 'cccccccc-0000-cccc-0000-000000000001',
  'eeeeeeee-0000-eeee-0000-000000000003', 'document', 'drive',
  'https://drive.google.com/file/d/1EXAMPLE-hidden/view',
  'Hidden from students', 'application/pdf', 1024,
  false, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

insert into public.canvases (id, course_id, title, published)
values
  ('f0f0f0f0-0c19-0000-8000-000000000001', 'cccccccc-0000-cccc-0000-000000000001',
   'Canvas A (published)', true),
  ('f0f0f0f0-0c19-0000-8000-000000000002', 'cccccccc-0000-cccc-0000-000000000001',
   'Canvas A2 (draft)', false);

-- Every card kind satisfies canvas_nodes_ref_by_kind at insert time: the
-- note card carries node_id, the text card carries body, the file card
-- carries asset_id (a student-invisible file — staff must still see it).
insert into public.canvas_nodes
  (id, canvas_id, kind, node_id, asset_id, body, x, y, width, height)
values
  ('f0f0f0f0-0c19-0000-1000-000000000001',
   'f0f0f0f0-0c19-0000-8000-000000000001', 'note',
   'eeeeeeee-0000-eeee-0000-000000000003', null, null, 0, 0, 320, 200),
  ('f0f0f0f0-0c19-0000-1000-000000000002',
   'f0f0f0f0-0c19-0000-8000-000000000001', 'text',
   null, null, 'A quick text card', 400, 0, 260, 140),
  ('f0f0f0f0-0c19-0000-1000-000000000003',
   'f0f0f0f0-0c19-0000-8000-000000000001', 'file',
   null, 'f0f0f0f0-0c19-0000-a000-000000000001', null, 300, 300, 280, 200);

-- A card on the draft canvas A2, pointing at the COURSE-A draft note
-- ("Lecture 1 (draft)" from seed.sql — cards may reference drafts; they
-- are just hidden from non-staff viewers).
insert into public.canvas_nodes
  (id, canvas_id, kind, node_id, x, y, width, height)
values
  ('f0f0f0f0-0c19-0000-1000-000000000009',
   'f0f0f0f0-0c19-0000-8000-000000000002', 'note',
   'eeeeeeee-0000-eeee-0000-000000000002', 0, 0, 320, 200);

insert into public.canvas_edges (id, canvas_id, from_node, to_node, label)
values
  ('f0f0f0f0-0c19-0000-2000-000000000001',
   'f0f0f0f0-0c19-0000-8000-000000000001',
   'f0f0f0f0-0c19-0000-1000-000000000001', 'f0f0f0f0-0c19-0000-1000-000000000002',
   'leads to');

insert into public.canvas_versions (id, canvas_id, label, auto, snapshot)
values
  ('f0f0f0f0-0c19-0000-3000-000000000001',
   'f0f0f0f0-0c19-0000-8000-000000000001', 'Initial', false,
   public.canvas_snapshot_json ('f0f0f0f0-0c19-0000-8000-000000000001'));

select tests.assert_true (
  (select version_no from public.canvas_versions
    where id = 'f0f0f0f0-0c19-0000-3000-000000000001') = 1,
  'the first version of a canvas is numbered 1 (guard trigger)');

select tests.assert_true (
  (select count (*) from public.canvases) = 2,
  'the admin (owner of both courses) reads both COURSE-A canvases');

-- ---------------------------------------------------------------------------
-- Leader H: an authenticated leader with NO membership — nothing readable,
-- nothing writable, not even published canvases (privacy first; the student
-- site's published-only filtering lives in the app, not here).
-- ---------------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd81","role":"authenticated"}';

select tests.assert_true (
  (select count (*) from public.canvases) = 0,
  'a leader without membership reads no canvases — not even published ones');
select tests.assert_true (
  (select count (*) from public.canvas_nodes
     where canvas_id = 'f0f0f0f0-0c19-0000-8000-000000000001') = 0,
  'a stranger reads no cards of canvases they cannot access');
select tests.assert_true (
  (select count (*) from public.canvas_edges
     where canvas_id = 'f0f0f0f0-0c19-0000-8000-000000000001') = 0,
  'a stranger reads no edges of canvases they cannot access');
select tests.assert_true (
  (select count (*) from public.canvas_versions) = 0,
  'a stranger reads no canvas versions');

-- UPDATE/DELETE match zero rows silently under RLS…
update public.canvases set title = 'hax'
  where id = 'f0f0f0f0-0c19-0000-8000-000000000001';
delete from public.canvas_nodes
  where canvas_id = 'f0f0f0f0-0c19-0000-8000-000000000001';

-- …while INSERT refuses outright (42501), caught here rather than
-- aborting the whole file.
do $$
begin
  insert into public.canvases (id, course_id, title)
  values ('f0f0f0f0-0c19-0000-8000-000000000009',
          'cccccccc-0000-cccc-0000-000000000001', 'hax');
exception when insufficient_privilege then
  null; -- expected: the insert policy refuses non-members
end $$;

-- ---------------------------------------------------------------------------
-- Leader A (editor in COURSE-A) — D7: full edit rights, and the proof that
-- the stranger really changed nothing: read back as the editor.
-- ---------------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd01","role":"authenticated"}';

select tests.assert_true (
  (select count (*) from public.canvases) = 2,
  'the editor reads drafts and published canvases of their own course');

select tests.assert_true (
  (select title from public.canvases
    where id = 'f0f0f0f0-0c19-0000-8000-000000000001') = 'Canvas A (published)',
  'the stranger update matched zero rows (title unchanged)');

select tests.assert_true (
  exists (select 1 from public.canvas_nodes
    where id = 'f0f0f0f0-0c19-0000-1000-000000000001'),
  'the stranger delete matched zero rows (cards untouched)');

select tests.assert_true (
  (select count (*) from public.canvas_nodes
     where canvas_id = 'f0f0f0f0-0c19-0000-8000-000000000001') = 3,
  'staff see ALL cards of their course, including the hidden file card');

select tests.assert_true (
  (select count (*) from public.nodes
     where course_id = 'cccccccc-0000-cccc-0000-000000000002') = 0,
  'course isolation still holds for a member of a different course');

-- The editor creates a canvas.
insert into public.canvases (id, course_id, title)
values
  ('f0f0f0f0-0c19-0000-8000-000000000003',
   'cccccccc-0000-cccc-0000-000000000001', 'Canvas A3 created by editor');

select tests.assert_true (
  (select created_by from public.canvases
    where id = 'f0f0f0f0-0c19-0000-8000-000000000003')
    = 'dddddddd-dddd-dddd-dddd-dddddddddd01'::uuid,
  'created_by defaults to the calling editor');

-- One atomic batch: add a text card, move another and clear its colour
-- (explicit JSON null sets NULL), touch an unknown card (skipped), and add
-- an edge between the new card and the note card.
do $$
declare
  r jsonb;
begin
  select public.canvas_apply_ops (
    'f0f0f0f0-0c19-0000-8000-000000000001',
    $ops$[
     {"op":"node.add","id":"f0f0f0f0-0c19-0000-1000-00000000000f","kind":"text",
      "body":"added by the editor","x":0,"y":900,"width":260,"height":140,"color":"4"},
     {"op":"node.update","id":"f0f0f0f0-0c19-0000-1000-000000000002","x":410,"color":null},
     {"op":"node.update","id":"dddddddd-ffff-0000-8000-0000000000ff","x":1},
     {"op":"edge.add","id":"f0f0f0f0-0c19-0000-2000-00000000000e",
      "from_node":"f0f0f0f0-0c19-0000-1000-00000000000f",
      "to_node":"f0f0f0f0-0c19-0000-1000-000000000001"}
    ]$ops$::jsonb)
  into r;
  if r->>'applied' <> '4' then
    raise exception 'ASSERT FAILED: apply_ops applied % ops, expected 4 (%s)',
      r->>'applied', r::text;
  end if;
end $$;

select tests.assert_true (
  (select color from public.canvas_nodes
    where id = 'f0f0f0f0-0c19-0000-1000-000000000002') is null,
  'an explicit JSON null in node.update cleared the card colour');

select tests.assert_true (
  exists (select 1 from public.canvas_edges
    where id = 'f0f0f0f0-0c19-0000-2000-00000000000e'),
  'the edge added inside the ops batch exists');

-- Case 8: atomicity — a failing op rolls back the WHOLE batch. The batch
-- moves a card, then fails on a self-loop edge (guard refuses it). If the
-- batch had been applied, the two assertions below fail instead.
do $$
begin
  perform public.canvas_apply_ops (
    'f0f0f0f0-0c19-0000-8000-000000000001',
    $ops$[
      {"op":"node.update","id":"f0f0f0f0-0c19-0000-1000-00000000000f","x":1234,"y":1234},
      {"op":"edge.add","id":"f0f0f0f0-0c19-0000-2000-0000000000f0",
       "from_node":"f0f0f0f0-0c19-0000-1000-00000000000f",
       "to_node":"f0f0f0f0-0c19-0000-1000-00000000000f"}
    ]$ops$::jsonb);
exception when others then
  null; -- expected (the guard raises P0001 / the check constraint 23514)
  -- a wrongly-applied batch is not caught here; the assertions below catch it
end $$;

select tests.assert_true (
  (select x from public.canvas_nodes
    where id = 'f0f0f0f0-0c19-0000-1000-00000000000f') = 0,
  'the failing op rolled back the whole batch (atomic apply)');

select tests.assert_true (
  not exists (select 1 from public.canvas_edges
    where id = 'f0f0f0f0-0c19-0000-2000-0000000000f0'),
  'the self-loop edge of the failed batch does not exist');

-- Case 8: a batch of 201 ops is refused outright.
do $$
declare
  big jsonb := '[]'::jsonb;
begin
  for i in 1..201 loop
    big := big || jsonb_build_object(
      'op', 'node.delete', 'id', 'dddddddd-dddd-dddd-dddd-dddddddddd00');
  end loop;
  perform public.canvas_apply_ops (
    'f0f0f0f0-0c19-0000-8000-000000000001', big);
  raise exception 'ASSERT FAILED: 201 ops were accepted';
exception
  when raise_exception then
    if sqlerrm like 'ASSERT FAILED%' then raise; end if;
    -- anything else is the RPC's refusal of the oversized batch (expected)
end $$;

-- An unknown op name is refused in the same batch-atomic way.
do $$
begin
  perform public.canvas_apply_ops (
    'f0f0f0f0-0c19-0000-8000-000000000001',
    '[{"op":"canvas.nuke"}]'::jsonb);
  raise exception 'ASSERT FAILED: an unknown op was accepted';
exception
  when raise_exception then
    if sqlerrm like 'ASSERT FAILED%' then raise; end if;
end $$;

-- Removing a card cascades to its edges (FK on delete cascade).
delete from public.canvas_nodes
  where id = 'f0f0f0f0-0c19-0000-1000-00000000000f';

select tests.assert_true (
  not exists (
    select 1 from public.canvas_edges
    where from_node = 'f0f0f0f0-0c19-0000-1000-00000000000f'
       or to_node   = 'f0f0f0f0-0c19-0000-1000-00000000000f'),
  'removing a card removed its edges (fk cascade)');

-- ---------------------------------------------------------------------------
-- Guard triggers: a card may NOT reference the other course's note, and an
-- edge may not join cards of two different canvases.
-- ---------------------------------------------------------------------------
do $$
begin
  insert into public.canvas_nodes
    (id, canvas_id, kind, node_id, x, y, width, height)
  values
    ('f0f0f0f0-0c19-0000-1000-0000000000b1',
     'f0f0f0f0-0c19-0000-8000-000000000001', 'note',
     'f0f0f0f0-0c19-0000-9000-000000000002', 0, 0, 320, 200);
  raise exception 'ASSERT FAILED: card referenced another course note';
exception
  when raise_exception then
    if sqlerrm like 'ASSERT FAILED%' then raise; end if;
end $$;

do $$
begin
  insert into public.canvas_edges (id, canvas_id, from_node, to_node)
  values
    ('f0f0f0f0-0c19-0000-2000-0000000000b2',
     'f0f0f0f0-0c19-0000-8000-000000000001',
     'f0f0f0f0-0c19-0000-1000-000000000001', -- a Canvas A1 card
     'f0f0f0f0-0c19-0000-1000-000000000009'); -- a Canvas A2 card
  raise exception 'ASSERT FAILED: edge joined two canvases';
exception
  when raise_exception then
    if sqlerrm like 'ASSERT FAILED%' then raise; end if;
end $$;

-- Case 9: column grants — protected columns are not updatable over the API.
do $$
begin
  update public.canvas_nodes
    set node_id = 'eeeeeeee-0000-eeee-0000-000000000003'
    where id = 'f0f0f0f0-0c19-0000-1000-000000000009';
  raise exception 'ASSERT FAILED: changed node_id without a grant';
exception when insufficient_privilege then
  null; -- node_id has no UPDATE grant
end $$;

do $$
begin
  update public.canvas_nodes
    set kind = 'file'
    where id = 'f0f0f0f0-0c19-0000-1000-000000000009';
  raise exception 'ASSERT FAILED: changed kind without a grant';
exception when insufficient_privilege then
  null; -- kind has no UPDATE grant
end $$;

-- ---------------------------------------------------------------------------
-- Case 7 continued: a reviewer CAN write per D7 (the old draft said they
-- could not). Leader B is a reviewer in COURSE-A and a contributor in
-- COURSE-B.
-- ---------------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd02","role":"authenticated"}';

insert into public.canvas_nodes
  (id, canvas_id, kind, body, x, y, width, height)
values
  ('f0f0f0f0-0c19-0000-1000-0000000000b2',
   'f0f0f0f0-0c19-0000-8000-000000000001', 'text',
   'written by the reviewer', 0, 1100, 260, 140);

select tests.assert_true (
  (select body from public.canvas_nodes
    where id = 'f0f0f0f0-0c19-0000-1000-0000000000b2')
    = 'written by the reviewer',
  'a reviewer edits canvases like every other member (D7)');

-- …and as a COURSE-B contributor they may create a canvas there.
insert into public.canvases (id, course_id, title)
values
  ('f0f0f0f0-0c19-0000-8000-0000000000a2',
   'cccccccc-0000-cccc-0000-000000000002', 'Course B canvas');

select tests.assert_true (
  exists (select 1 from public.canvases
    where id = 'f0f0f0f0-0c19-0000-8000-0000000000a2'),
  'a contributor of COURSE-B can create a COURSE-B canvas');

-- ---------------------------------------------------------------------------
-- Case 10: canvas_versions are write-once — numbers increase, and there is
-- no UPDATE or DELETE grant (immutable, like node_versions).
-- ---------------------------------------------------------------------------
insert into public.canvas_versions (id, canvas_id, label, auto, snapshot)
values
  ('f0f0f0f0-0c19-0000-3000-000000000002',
   'f0f0f0f0-0c19-0000-8000-000000000001', 'Second', true,
   public.canvas_snapshot_json ('f0f0f0f0-0c19-0000-8000-000000000001'));

select tests.assert_true (
  (select version_no from public.canvas_versions
    where id = 'f0f0f0f0-0c19-0000-3000-000000000002') = 2,
  'version numbers increase per canvas (assigned by the guard trigger)');

do $$
begin
  update public.canvas_versions set label = 'hax'
    where id = 'f0f0f0f0-0c19-0000-3000-000000000002';
  raise exception 'ASSERT FAILED: updated a canvas version';
exception when insufficient_privilege then
  null; -- no UPDATE grant on canvas_versions
end $$;

do $$
begin
  delete from public.canvas_versions
    where id = 'f0f0f0f0-0c19-0000-3000-000000000002';
  raise exception 'ASSERT FAILED: deleted a canvas version';
exception when insufficient_privilege then
  null; -- no DELETE grant on canvas_versions
end $$;

-- ---------------------------------------------------------------------------
-- Case 12: restore drops cards whose target no longer exists, reports the
-- counts, and first writes an automatic "Before restore" snapshot. Notes
-- cannot be hard-deleted at the database level, so the version's snapshot
-- is written by hand with a note card whose node_id matches nothing —
-- exactly what a deleted note looks like to the restore path.
-- ---------------------------------------------------------------------------
insert into public.canvas_versions (id, canvas_id, label, auto, snapshot)
values
  ('f0f0f0f0-0c19-0000-3000-000000000003',
   'f0f0f0f0-0c19-0000-8000-000000000001', 'With a dangling card', true,
   jsonb_build_object (
     'nodes', jsonb_build_array (
       jsonb_build_object (
         'id', 'f0f0f0f0-0c19-0000-1000-000000000002',
         'kind', 'text', 'body', 'still here', 'x', 400, 'y', 0,
         'width', 260, 'height', 140, 'z', 0, 'student_visible', true),
       jsonb_build_object (
         'id', 'f0f0f0f0-0c19-0000-1000-000000000092',
         'kind', 'note', 'node_id', 'dddddddd-9999-0000-0000-000000000001',
         'x', 0, 'y', 500, 'width', 320, 'height', 200, 'z', 0,
         'student_visible', true)),
     'edges', '[]'::jsonb,
     'legend', '{}'::jsonb));

-- Leave only the intact text card standing; the restore brings it back.
delete from public.canvas_nodes
  where canvas_id = 'f0f0f0f0-0c19-0000-8000-000000000001'
    and id <> 'f0f0f0f0-0c19-0000-1000-000000000002';

do $$
declare
  r jsonb;
begin
  select public.canvas_restore_version (
    'f0f0f0f0-0c19-0000-3000-000000000003')
  into r;
  if r->>'nodes_restored' <> '1' or r->>'nodes_dropped' <> '1' then
    raise exception 'ASSERT FAILED: restore kept/dropped %/%, expected 1/1 (%s)',
      r->>'nodes_restored', r->>'nodes_dropped', r::text;
  end if;
end $$;

select tests.assert_true (
  exists (select 1 from public.canvas_versions
    where canvas_id = 'f0f0f0f0-0c19-0000-8000-000000000001'
      and label = 'Before restore' and auto),
  'restore wrote an automatic "Before restore" snapshot first');

-- ---------------------------------------------------------------------------
-- Case 11: the card cap lives in `settings`, never in code (constitution
-- rule 8). The guard trigger reads it through canvas_setting_int, which
-- also tolerates the JSON-string form seeds use.
-- ---------------------------------------------------------------------------
set local role postgres;
insert into public.settings (key, value) values ('max_canvas_cards', '2')
on conflict (key) do update set value = '2';
set local role authenticated;

-- Canvas A2 already holds one card; with the cap at 2 exactly one more fits.
insert into public.canvas_nodes
  (id, canvas_id, kind, body, x, y, width, height)
values
  ('f0f0f0f0-0c19-0000-1000-0000000000c1',
   'f0f0f0f0-0c19-0000-8000-000000000002', 'text',
   'fits under the cap', 0, 0, 260, 140);

do $$
begin
  insert into public.canvas_nodes
    (id, canvas_id, kind, body, x, y, width, height)
  values
    ('f0f0f0f0-0c19-0000-1000-0000000000c3',
     'f0f0f0f0-0c19-0000-8000-000000000002', 'text',
     'one card too many', 200, 0, 260, 140);
  raise exception 'ASSERT FAILED: card cap was not enforced';
exception
  when raise_exception then
    if sqlerrm like 'ASSERT FAILED%' then raise; end if;
    -- otherwise the guard's "canvas card limit reached" (expected)
end $$;

set local role postgres;
delete from public.settings where key = 'max_canvas_cards';
set local role authenticated;

commit;
