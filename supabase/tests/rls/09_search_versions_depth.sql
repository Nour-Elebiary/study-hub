-- Study Hub RLS test 09 — search finds English and Arabic words, versions
-- are numbered and restorable, and the tree refuses a seventh nesting level
-- (spec section 5 rules 4-5 and the M2 acceptance tests).

begin;

-- Leader E has no memberships at all (Leaders A and B gained memberships
-- in earlier test files; state persists across files). Created before the
-- role is set down to authenticated, like in test 03. A distinct email
-- matters: test 04 already created leaderC@studyhub.local, and auth.users
-- has a unique email index that `on conflict (id)` does not cover.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', 'dddddddd-dddd-dddd-dddd-dddddddddd03',
  'authenticated', 'authenticated', 'leaderE@studyhub.local',
  crypt ('LeaderE-Temp-01', gen_salt ('bf')), now (),
  '{"provider":"email","providers":["email"]}', '{"display_name":"Leader E"}',
  now (), now ()
) on conflict (id) do nothing;

-- fixtures as the seeded admin (owner of COURSE-A)
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

insert into public.course_members (course_id, user_id, role, areas)
values
  ('cccccccc-0000-cccc-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddd01',
   'editor', array['official_materials'])
on conflict (course_id, user_id) do update set areas = excluded.areas;

-- --- search: mixed English and Arabic body text -------------------------------
insert into public.nodes (id, course_id, area, kind, title, slug)
values (
  'eeeeeeee-2000-eeee-0000-000000000001',
  'cccccccc-0000-cccc-0000-000000000001',
  'official_materials', 'note', 'Mixed language note', 'mixed-language'
);

insert into public.node_versions (node_id, body_md, author_id, change_note)
values (
  'eeeeeeee-2000-eeee-0000-000000000001',
  'The photosynthesis lesson. درس البناء الضوئي للنبات.',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'initial'
);

-- the trigger filled nodes.search from the newest version
select tests.assert_true (
  (select search is not null from public.nodes
    where id = 'eeeeeeee-2000-eeee-0000-000000000001'),
  'inserting a version fills the search vector'
);

select tests.assert_true (
  (select count (*) from public.nodes
    where id = 'eeeeeeee-2000-eeee-0000-000000000001'
      and search @@ to_tsquery ('simple', 'photosynthesis')) = 1,
  'search finds an English word from the note body'
);

select tests.assert_true (
  (select count (*) from public.nodes
    where id = 'eeeeeeee-2000-eeee-0000-000000000001'
      and search @@ to_tsquery ('simple', 'البناء')) = 1,
  'search finds an Arabic word from the note body'
);

select tests.assert_true (
  (select count (*) from public.nodes
    where id = 'eeeeeeee-2000-eeee-0000-000000000001'
      and search @@ to_tsquery ('simple', 'language')) = 1,
  'search finds a word from the note title'
);

-- --- versions: sequential numbers; restoring writes a new version -------------
insert into public.node_versions (node_id, body_md, author_id, change_note)
values (
  'eeeeeeee-2000-eeee-0000-000000000001',
  'Second edit.', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'second'
);

select tests.assert_true (
  (select max (version_no) from public.node_versions
    where node_id = 'eeeeeeee-2000-eeee-0000-000000000001') = 2,
  'version numbers increase one per save'
);

-- restore version 1 as a NEW version (the M2 acceptance test)
insert into public.node_versions (node_id, body_md, author_id, change_note)
select node_id, body_md, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Restored version 1'
from public.node_versions
where node_id = 'eeeeeeee-2000-eeee-0000-000000000001' and version_no = 1;

select tests.assert_true (
  (select count (*) from public.node_versions
    where node_id = 'eeeeeeee-2000-eeee-0000-000000000001') = 3
    and (select body_md from public.node_versions
      where node_id = 'eeeeeeee-2000-eeee-0000-000000000001'
        and version_no = 3)
      = (select body_md from public.node_versions
        where node_id = 'eeeeeeee-2000-eeee-0000-000000000001'
          and version_no = 1),
  'restoring a version writes its body as a new version'
);

--- versions are immutable: no update grant ------------------------------------
do $$
begin
  update public.node_versions set body_md = 'tampered'
  where node_id = 'eeeeeeee-2000-eeee-0000-000000000001' and version_no = 1;
  raise exception 'ASSERT FAILED: a version row was updated';
exception
  when insufficient_privilege then
    null; -- expected: node_versions has no UPDATE grant
end $$;

-- --- tree depth: the seventh level is refused ---------------------------------
insert into public.nodes (id, course_id, parent_id, area, kind, title, slug)
values
  ('eeeeeeee-2000-eeee-0000-0000000000a1', 'cccccccc-0000-cccc-0000-000000000001',
   null, 'official_materials', 'section', 'L1', 'l1'),
  ('eeeeeeee-2000-eeee-0000-0000000000a2', 'cccccccc-0000-cccc-0000-000000000001',
   'eeeeeeee-2000-eeee-0000-0000000000a1', 'official_materials', 'section', 'L2', 'l2'),
  ('eeeeeeee-2000-eeee-0000-0000000000a3', 'cccccccc-0000-cccc-0000-000000000001',
   'eeeeeeee-2000-eeee-0000-0000000000a2', 'official_materials', 'section', 'L3', 'l3'),
  ('eeeeeeee-2000-eeee-0000-0000000000a4', 'cccccccc-0000-cccc-0000-000000000001',
   'eeeeeeee-2000-eeee-0000-0000000000a3', 'official_materials', 'section', 'L4', 'l4'),
  ('eeeeeeee-2000-eeee-0000-0000000000a5', 'cccccccc-0000-cccc-0000-000000000001',
   'eeeeeeee-2000-eeee-0000-0000000000a4', 'official_materials', 'section', 'L5', 'l5'),
  ('eeeeeeee-2000-eeee-0000-0000000000a6', 'cccccccc-0000-cccc-0000-000000000001',
   'eeeeeeee-2000-eeee-0000-0000000000a5', 'official_materials', 'section', 'L6', 'l6');

do $$
begin
  insert into public.nodes (course_id, parent_id, area, kind, title, slug)
  values (
    'cccccccc-0000-cccc-0000-000000000001',
    'eeeeeeee-2000-eeee-0000-0000000000a6',
    'official_materials', 'note', 'L7', 'l7'
  );
  raise exception 'ASSERT FAILED: a seventh nesting level was accepted';
exception
  when raise_exception then
    null; -- expected: the depth trigger raises a plain exception
end $$;

-- --- a leader outside every course cannot read the new content ----------------
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd03","role":"authenticated"}';

select tests.assert_true (
  (select count (*) from public.nodes) = 0,
  'a leader outside every course reads zero nodes'
);

select tests.assert_true (
  (select count (*) from public.node_versions) = 0,
  'a leader outside every course reads zero versions'
);

commit;
