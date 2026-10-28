-- Study Hub RLS test 04 — an admin reads every profile and every course
-- (spec M0 step 5).

begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1', 'authenticated', 'authenticated',
   'leaderC@studyhub.local', crypt ('LeaderC-Temp-01', gen_salt ('bf')), now (),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Leader C"}', now (), now ());

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2', 'authenticated', 'authenticated',
   'leaderD@studyhub.local', crypt ('LeaderD-Temp-01', gen_salt ('bf')), now (),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Leader D"}', now (), now ());

-- the seed admin (aaaaaaaa…) acts
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

select tests.assert_true (
  (select count (*) from public.profiles) >= 3,
  'admin reads all profile rows (seed admin + 2 test leaders)'
);

select tests.assert_true (
  (select count (*) from public.courses) >= 2,
  'admin reads all course rows including the two sample courses'
);

-- admins may archive a course
update public.courses set archived = true
where code = 'COURSE-B';
select tests.assert_true (
  (select archived from public.courses where code = 'COURSE-B'),
  'admin can archive a course'
);

commit;
