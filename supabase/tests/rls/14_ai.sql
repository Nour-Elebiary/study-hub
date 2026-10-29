-- Study Hub RLS test 14 — AI key pool, usage, conversations (spec sections
-- 5 and 8). The key pool's rules are stricter than most tables:
--
--   * a leader sees only their own keys' metadata, an admin sees all;
--   * NO client role can ever read key_ciphertext (column grants omit it) —
--     "No endpoint ever returns a key" starts at the database;
--   * clients cannot insert, update or delete keys, usage, messages or
--     handoffs — the server (service role) writes those;
--   * conversations and their messages belong to one user only;
--   * one key per Google Cloud project (project_label is unique).
--
-- Fixtures from earlier tests: Leader A = editor in COURSE-A
-- (dddddddd-dddd-dddd-dddd-dddddddddd01), Leader B = contributor in
-- COURSE-B and reviewer in COURSE-A (...02), admin =
-- aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.

begin;

-- --- Leader A adds their own key (as the server would: service role) --------
set local role service_role;

insert into public.ai_keys (
  id, owner_id, label, provider, key_ciphertext, key_last4, project_label
) values (
  '7a7a7a7a-0000-4a7a-8a7a-000000000001',
  'dddddddd-dddd-dddd-dddd-dddddddddd01',
  'Leader A key', 'gemini',
  'AGRCA0UEgYJDQsMDQ4PEA==',
  'a1b2', 'leader-a-project'
);

insert into public.ai_keys (
  id, owner_id, label, provider, key_ciphertext, key_last4, project_label
) values (
  '7a7a7a7a-0000-4a7a-8a7a-000000000002',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Admin key', 'gemini',
  'ERIDAYUEgYJDQsMDQ4PEA==',
  'c3d4', 'admin-project'
);

-- --- a second key for the same project is refused (spec section 8) -----------
do $$
begin
  insert into public.ai_keys (
    owner_id, label, provider, key_ciphertext, key_last4, project_label
  ) values (
    'dddddddd-dddd-dddd-dddd-dddddddddd01', 'Duplicate project', 'gemini',
    'IRIDAYUEgYJDQsMDQ4PEA==', 'e5f6', 'leader-a-project'
  );
  raise exception 'ASSERT FAILED: two keys accepted for one project_label';
exception
  when unique_violation then
    null; -- expected
end $$;

-- --- Leader A sees their own key's metadata ----------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd01","role":"authenticated"}';

select tests.assert_true (
  (select count (*) from public.ai_keys) = 1,
  'a leader sees only their own key'
);

select tests.assert_true (
  (select key_last4 from public.ai_keys
     where id = '7a7a7a7a-0000-4a7a-8a7a-000000000001') = 'a1b2',
  'the owner reads their key''s masked last4'
);

--- the ciphertext column is unreadable by a client role ------------------------
do $$
begin
  perform (select key_ciphertext from public.ai_keys);
  raise exception 'ASSERT FAILED: client role read key_ciphertext';
exception
  when insufficient_privilege then
    null; -- expected: the column grant (00010) omits key_ciphertext, so the
          -- executor rejects the read with 42501. Column grants deny access
          -- but do not hide the column from the catalog, so this is an
          -- insufficient_privilege error, not undefined_column.
end $$;

--- clients cannot create, change or remove keys --------------------------------
do $$
begin
  insert into public.ai_keys (
    owner_id, label, provider, key_ciphertext, key_last4, project_label
  ) values (
    'dddddddd-dddd-dddd-dddd-dddddddddd01', 'Self-made', 'gemini',
    'MRIDAYUEgYJDQsMDQ4PEA==', '9999', 'sneaky-project'
  );
  raise exception 'ASSERT FAILED: client inserted an ai_keys row';
exception
  when insufficient_privilege then
    null; -- expected: insert is server-only
end $$;

do $$
begin
  update public.ai_keys set status = 'disabled';
  raise exception 'ASSERT FAILED: client updated an ai_keys row';
exception
  when insufficient_privilege then
    null; -- expected
end $$;

do $$
begin
  delete from public.ai_keys;
  raise exception 'ASSERT FAILED: client deleted an ai_keys row';
exception
  when insufficient_privilege then
    null; -- expected
end $$;

--- another leader sees nothing -------------------------------------------------
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd02","role":"authenticated"}';

select tests.assert_true (
  (select count (*) from public.ai_keys) = 0,
  'another leader sees no keys at all'
);

--- the admin sees every key's metadata -----------------------------------------
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

select tests.assert_true (
  (select count (*) from public.ai_keys) = 2,
  'the admin sees all keys'' metadata'
);

-- --- ai_limits: admin edits, leaders cannot read ------------------------------
set local role service_role;

insert into public.ai_limits (id, provider, model, rpm, tpm, rpd)
values (
  '8b8b8b8b-0000-4b8b-8b8b-000000000001',
  'gemini', 'gemini-2.5-flash-lite', 10, 200000, 200
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd01","role":"authenticated"}';

select tests.assert_true (
  (select count (*) from public.ai_limits) = 0,
  'a leader cannot read ai_limits (the router reads them server-side)'
);

set local request.jwt.claims =
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

select tests.assert_true (
  (select rpd from public.ai_limits
     where model = 'gemini-2.5-flash-lite') = 200,
  'the admin reads ai_limits to edit them when Google changes the numbers'
);

update public.ai_limits set soft_pct = 70
where id = '8b8b8b8b-0000-4b8b-8b8b-000000000001';

select tests.assert_true (
  (select soft_pct from public.ai_limits
     where id = '8b8b8b8b-0000-4b8b-8b8b-000000000001') = 70,
  'the admin updates ai_limits'
);

-- --- ai_usage: written by the server, read by the admin ----------------------
set local role service_role;

insert into public.ai_usage (key_id, model, bucket_start, bucket_kind, requests, tokens_est)
values (
  '7a7a7a7a-0000-4a7a-8a7a-000000000001', 'gemini-2.5-flash-lite',
  date_trunc ('minute', now ()), 'minute', 3, 1500
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd01","role":"authenticated"}';

select tests.assert_true (
  (select count (*) from public.ai_usage) = 0,
  'a leader cannot read usage rows (not even for their own key)'
);

set local request.jwt.claims =
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

select tests.assert_true (
  (select requests from public.ai_usage
     where key_id = '7a7a7a7a-0000-4a7a-8a7a-000000000001'
       and bucket_kind = 'minute') = 3,
  'the admin reads usage bars for every key'
);

-- --- conversations and messages belong to one user ----------------------------
set local role service_role;

insert into public.ai_conversations (id, user_id, node_id, title)
values (
  '9c9c9c9c-0000-4c9c-8c9c-000000000001',
  'dddddddd-dddd-dddd-dddd-dddddddddd01',
  null, 'Clean the OCR text'
);

insert into public.ai_messages (id, conversation_id, role, content)
values
  ('adadadad-0000-4dad-8dad-000000000001',
   '9c9c9c9c-0000-4c9c-8c9c-000000000001', 'user', 'Clean this OCR text'),
  ('adadadad-0000-4dad-8dad-000000000002',
   '9c9c9c9c-0000-4c9c-8c9c-000000000001', 'assistant', 'Here is the clean text');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd01","role":"authenticated"}';

select tests.assert_true (
  (select count (*) from public.ai_messages
     where conversation_id = '9c9c9c9c-0000-4c9c-8c9c-000000000001') = 2,
  'the owner reads their conversation''s messages'
);

--- the owner can delete their own messages (retention rule) --------------------
delete from public.ai_messages
where id = 'adadadad-0000-4dad-8dad-000000000001';

select tests.assert_true (
  (select count (*) from public.ai_messages
     where conversation_id = '9c9c9c9c-0000-4c9c-8c9c-000000000001') = 1,
  'the author deletes their own message'
);

--- another leader sees neither the conversation nor its messages ---------------
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd02","role":"authenticated"}';

select tests.assert_true (
  (select count (*) from public.ai_conversations) = 0
  and (select count (*) from public.ai_messages) = 0,
  'another leader sees no conversations or messages'
);

--- clients cannot forge messages or handoffs ----------------------------------
do $$
begin
  insert into public.ai_messages (conversation_id, role, content)
  values (
    '9c9c9c9c-0000-4c9c-8c9c-000000000001', 'assistant', 'forged reply'
  );
  raise exception 'ASSERT FAILED: client inserted an ai_messages row';
exception
  when insufficient_privilege then
    null; -- expected: the endpoint writes both sides
end $$;

do $$
begin
  insert into public.ai_handoffs (conversation_id, from_key_id, reason)
  values (
    '9c9c9c9c-0000-4c9c-8c9c-000000000001',
    '7a7a7a7a-0000-4a7a-8a7a-000000000001', 'forged'
  );
  raise exception 'ASSERT FAILED: client inserted an ai_handoffs row';
exception
  when insufficient_privilege then
    null; -- expected
end $$;

--- the owner reads handoffs on their own conversation --------------------------
set local role service_role;

insert into public.ai_handoffs (conversation_id, from_key_id, to_key_id, reason, packet)
values (
  '9c9c9c9c-0000-4c9c-8c9c-000000000001',
  '7a7a7a7a-0000-4a7a-8a7a-000000000001',
  '7a7a7a7a-0000-4a7a-8a7a-000000000002',
  '429 on previous key',
  '{"schema_version":1}'::jsonb
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd01","role":"authenticated"}';

select tests.assert_true (
  (select reason from public.ai_handoffs
     where conversation_id = '9c9c9c9c-0000-4c9c-8c9c-000000000001')
    = '429 on previous key',
  'the owner reads the handoff history of their conversation'
);

commit;
