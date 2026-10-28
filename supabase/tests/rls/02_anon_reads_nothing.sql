-- Study Hub RLS test 02 — an anonymous caller reads nothing (spec M0 step 5).

begin;

-- no fixture needed; anon role with an empty (anonymous) token context
set local role anon;
set local request.jwt.claims = '{}';

select tests.assert_true (
  (select count (*) from public.profiles) = 0,
  'anon must read zero profile rows'
);

select tests.assert_true (
  (select count (*) from public.courses) = 0,
  'anon must read zero course rows'
);

select tests.assert_true (
  (select count (*) from public.course_members) = 0,
  'anon must read zero membership rows'
);

select tests.assert_true (
  (select count (*) from public.settings) = 0,
  'anon must read zero settings rows'
);

select tests.assert_true (
  (select count (*) from public.audit_log) = 0,
  'anon must read zero audit rows'
);

commit;
