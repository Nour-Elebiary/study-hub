-- Study Hub — Hosted seed (adapted from seed.sql for hosted Supabase)
-- Creates admin accounts, sample courses, content, and join code.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'authenticated', 'authenticated',
  'admin@studyhub.local',
  crypt ('ChangeMe-Admin-01', gen_salt ('bf')),
  now (),
  '{"provider":"email","providers":["email"]}',
  '{"display_name":"Nour (admin)","global_role":"admin"}',
  now (), now ()
) on conflict (id) do nothing;

insert into auth.identities (
  provider_id, user_id, provider, identity_data, last_sign_in_at, created_at, updated_at
) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'email',
  jsonb_build_object ('sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'email', 'admin@studyhub.local', 'email_verified', false),
  null, now (), now ()
) on conflict (provider_id, provider) do nothing;

update public.profiles set global_role = 'admin', must_change_password = true
where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- second admin
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'authenticated', 'authenticated',
  'admin2@studyhub.local',
  crypt ('ChangeMe-Admin-02', gen_salt ('bf')),
  now (),
  '{"provider":"email","providers":["email"]}',
  '{"display_name":"Backup admin","global_role":"admin"}',
  now (), now ()
) on conflict (id) do nothing;

insert into auth.identities (
  provider_id, user_id, provider, identity_data, last_sign_in_at, created_at, updated_at
) values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'email',
  jsonb_build_object ('sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'email', 'admin2@studyhub.local', 'email_verified', false),
  null, now (), now ()
) on conflict (provider_id, provider) do nothing;

update public.profiles set global_role = 'admin', must_change_password = true
where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- two sample courses
insert into public.courses (id, code, title, semester, created_by)
values
  ('cccccccc-0000-cccc-0000-000000000001', 'COURSE-A', 'Course A (sample)', '2026 Term 1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('cccccccc-0000-cccc-0000-000000000002', 'COURSE-B', 'Course B (sample)', '2026 Term 1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
on conflict (code) do nothing;

insert into public.course_members (course_id, user_id, role, areas)
values
  ('cccccccc-0000-cccc-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner',
    array['official_materials','student_notes','quiz_exam_prep','external_resources','glossary','open_questions']),
  ('cccccccc-0000-cccc-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner',
    array['official_materials','student_notes','quiz_exam_prep','external_resources','glossary','open_questions'])
on conflict (course_id, user_id) do nothing;

-- default settings
insert into public.settings (key, value)
values
  ('site_name', '"Study Hub"'),
  ('max_file_mb', '10'),
  ('retention_ai_days', '90'),
  ('retention_audit_days', '365'),
  ('retention_deleted_note_days', '30'),
  ('ai_daily_allowance_per_leader', '0')
on conflict (key) do nothing;

-- sample content
insert into public.nodes (id, course_id, parent_id, area, kind, title, slug, sort_order, status, created_by)
values
  ('eeeeeeee-0000-eeee-0000-000000000001', 'cccccccc-0000-cccc-0000-000000000001', null,
    'official_materials', 'section', 'Week 1', 'week-1', 0, 'published',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('eeeeeeee-0000-eeee-0000-000000000002', 'cccccccc-0000-cccc-0000-000000000001',
    'eeeeeeee-0000-eeee-0000-000000000001',
    'official_materials', 'note', 'Lecture 1 (draft)', 'lecture-1', 0, 'draft',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('eeeeeeee-0000-eeee-0000-000000000003', 'cccccccc-0000-cccc-0000-000000000001', null,
    'quiz_exam_prep', 'note', 'Quiz 1 prep', 'quiz-1-prep', 0, 'published',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
on conflict (id) do nothing;

insert into public.node_versions (node_id, version_no, body_md, author_id, change_note)
values
  ('eeeeeeee-0000-eeee-0000-000000000002', 1,
    '## Lecture 1\n\nDraft notes for the first lecture. المحاضرة الأولى.',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Initial draft'),
  ('eeeeeeee-0000-eeee-0000-000000000003', 1,
    '## Quiz 1 prep\n\nQuestions and answers for quiz 1. اختبار أول.',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'First published version')
on conflict (node_id, version_no) do nothing;

update public.nodes
set published_version_id = (
  select id from public.node_versions
  where node_id = 'eeeeeeee-0000-eeee-0000-000000000003' and version_no = 1
)
where id = 'eeeeeeee-0000-eeee-0000-000000000003';

insert into public.tags (id, name)
values
  ('f0f0f0f0-0000-4f0f-8f0f-000000000001', 'quiz1'),
  ('f0f0f0f0-0000-4f0f-8f0f-000000000002', 'final')
on conflict (name) do nothing;

insert into public.node_tags (node_id, tag_id)
values
  ('eeeeeeee-0000-eeee-0000-000000000003', 'f0f0f0f0-0000-4f0f-8f0f-000000000001')
on conflict (node_id, tag_id) do nothing;

-- sample asset
insert into public.assets (
  id, course_id, node_id, kind, storage, path_or_url, title, mime, size_bytes,
  created_by
) values (
  'a1a1a1a1-0000-4a1a-8a1a-000000000001',
  'cccccccc-0000-cccc-0000-000000000001',
  'eeeeeeee-0000-eeee-0000-000000000003',
  'document', 'drive',
  'https://drive.google.com/file/d/1EXAMPLE-quiz1-answer-sheet/view',
  'Quiz 1 answer sheet (on Drive)',
  'application/pdf',
  15728640,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
) on conflict (id) do nothing;

-- join code — hash uses our real JOIN_COOKIE_SECRET
insert into public.join_codes (course_id, code_hash, label)
values (
  'cccccccc-0000-cccc-0000-000000000001',
  '3c320fafe56d4e195ff5c783cb6ca70c33d36505b1db3ba0e5fa4ff736346166',
  'Sample join code for Course A (used by the e2e tests)'
) on conflict (code_hash) do nothing;

