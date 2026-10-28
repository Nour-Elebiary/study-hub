-- Study Hub RLS test 11 — student-access tables (spec section 10 rule 1 and
-- rule 4, section 11 rule 5):
--   * join_codes are invisible to every client role (the join server action
--     validates codes with the service-role client; clients get no grants),
--   * suggestions are readable by the same leaders who read the note, but
--     never writable by clients (inserts go through the server action after
--     the rate-limit check),
--   * the shared rate limiter counts, blocks and resets, and clients cannot
--     call it directly through the API.
--
-- Fixtures: seed note eeeeeeee-...-0003 (published, COURSE-A); Leaders A/B/C
-- gained their memberships in earlier test files (state persists).

begin;

-- fixtures as postgres: clients have no grants on these tables at all
insert into public.join_codes (id, course_id, code_hash, label, max_uses)
values (
  'a2a2a2a2-0000-4a2a-8a2a-000000000001',
  'cccccccc-0000-cccc-0000-000000000001',
  'test-hash-not-a-real-code', 'Section 1', 100
);

insert into public.suggestions (id, note_id, text)
values (
  'a3a3a3a3-0000-4a3a-8a3a-000000000001',
  'eeeeeeee-0000-eeee-0000-000000000003',
  'Page 3 says 2+2=5'
);

-- --- anonymous callers see and do nothing ------------------------------------
-- anon has no grants on these tables at all, so even SELECT is denied —
-- stronger than an empty result set.
set local role anon;
set local request.jwt.claims = '{}';

do $$
begin
  perform count (*) from public.join_codes;
  raise exception 'ASSERT FAILED: anon read join codes';
exception
  when insufficient_privilege then
    null; -- expected: join_codes have no client grants at all
end $$;

do $$
begin
  perform count (*) from public.suggestions;
  raise exception 'ASSERT FAILED: anon read suggestions';
exception
  when insufficient_privilege then
    null; -- expected: suggestions grant SELECT to authenticated only
end $$;

do $$
begin
  insert into public.suggestions (note_id, text)
    values ('eeeeeeee-0000-eeee-0000-000000000003', 'anon spam');
  raise exception 'ASSERT FAILED: anon inserted a suggestion';
exception
  when insufficient_privilege then
    null; -- expected: suggestions have no client INSERT grant or policy
end $$;

do $$
begin
  perform public.consume_rate_limit ('anon-hack', 1, 60);
  raise exception 'ASSERT FAILED: anon called the rate limiter';
exception
  when insufficient_privilege then
    null; -- expected: execute revoked from public
end $$;

-- --- Leader A (member of COURSE-A) reads the suggestion, nothing else --------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd01","role":"authenticated"}';

select tests.assert_true (
  (select count (*) from public.suggestions) = 1,
  'a course leader reads their course suggestions'
);

do $$
begin
  perform count (*) from public.join_codes;
  raise exception 'ASSERT FAILED: a leader read join codes';
exception
  when insufficient_privilege then
    null; -- expected: no client role ever reads join codes, not even leaders
end $$;

do $$
begin
  insert into public.suggestions (note_id, text)
    values ('eeeeeeee-0000-eeee-0000-000000000003', 'leader spam');
  raise exception 'ASSERT FAILED: a leader inserted a suggestion';
exception
  when insufficient_privilege then
    null; -- expected: inserts go through the audited server action only
end $$;

do $$
begin
  update public.suggestions set resolved = true
    where id = 'a3a3a3a3-0000-4a3a-8a3a-000000000001';
  raise exception 'ASSERT FAILED: a leader resolved a suggestion directly';
exception
  when insufficient_privilege then
    null; -- expected: resolving is a server action (audited), not a client write
end $$;

-- --- Leader C (no memberships) reads nothing ---------------------------------
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd03","role":"authenticated"}';

select tests.assert_true (
  (select count (*) from public.suggestions) = 0,
  'a leader with no membership reads zero suggestions'
);

-- --- the admin reads suggestions but still cannot write these tables ---------
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

select tests.assert_true (
  (select count (*) from public.suggestions) = 1,
  'the admin reads course suggestions'
);

do $$
begin
  insert into public.join_codes (course_id, code_hash)
    values ('cccccccc-0000-cccc-0000-000000000001', 'admin-hack');
  raise exception 'ASSERT FAILED: an admin inserted a join code directly';
exception
  when insufficient_privilege then
    null; -- expected: join codes are created by the server action only
end $$;

-- --- the rate limiter itself (called as the function owner) ------------------
reset role;

select tests.assert_true (
  public.consume_rate_limit ('test:join', 3, 60),
  'first call inside the limit'
);
select tests.assert_true (
  public.consume_rate_limit ('test:join', 3, 60),
  'second call inside the limit'
);
select tests.assert_true (
  public.consume_rate_limit ('test:join', 3, 60),
  'third call inside the limit'
);
select tests.assert_true (
  not public.consume_rate_limit ('test:join', 3, 60),
  'the fourth call inside one window is blocked'
);

select tests.assert_true (
  public.consume_rate_limit ('test:suggest', 3, 60),
  'a different key has its own window'
);

-- simulate the window passing (the test superuser may touch private tables)
update private.rate_limits
  set window_started_at = now () - interval '120 seconds'
  where key = 'test:join';

select tests.assert_true (
  public.consume_rate_limit ('test:join', 3, 60),
  'after the window passes the caller is allowed again'
);
select tests.assert_true (
  public.consume_rate_limit ('test:join', 3, 60),
  'second call of the fresh window'
);
select tests.assert_true (
  public.consume_rate_limit ('test:join', 3, 60),
  'third call of the fresh window'
);
select tests.assert_true (
  not public.consume_rate_limit ('test:join', 3, 60),
  'the fresh window fills up and blocks again'
);

-- clean up the limiter rows this test created
delete from private.rate_limits where key like 'test:%';

commit;
