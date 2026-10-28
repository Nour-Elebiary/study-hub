-- Study Hub — Local/CI seed (spec section 5 rule 1 + M0 step 4).
-- LOCAL AND CI ONLY: creates the first admin with a known temporary password.
-- The hosted project's real admin is created through the Supabase dashboard
-- or the admin portal (M1); never run this seed against production data.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'authenticated', 'authenticated',
  'admin@studyhub.local',
  crypt ('ChangeMe-Admin-01', gen_salt ('bf')),   -- temporary; must_change_password = true
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

-- trigger fires and creates the profile; set admin-specific fields
update public.profiles set global_role = 'admin', must_change_password = true
where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- second admin: at least two admins must exist so one lost account never
-- locks everyone out (spec section 9, security rule 2)
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

-- two sample courses, owned by the admin with all six areas (spec section 4)
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

-- default settings (limits live in data, not code — spec rule 8)
insert into public.settings (key, value)
values
  ('site_name', '"Study Hub"'),
  ('max_file_mb', '10'),
  ('retention_ai_days', '90'),
  ('retention_audit_days', '365'),
  ('retention_deleted_note_days', '30'),
  ('ai_daily_allowance_per_leader', '0')
on conflict (key) do nothing;
