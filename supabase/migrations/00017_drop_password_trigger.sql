-- Study Hub — remove the database-side password-change detector.
--
-- The `on_user_password_changed` trigger cleared `must_change_password` when
-- auth.users.encrypted_password changed. Supabase's GoTrue rewrites the
-- stored hash on every sign-in when it upgrades the hash format (for example
-- a pgcrypto-seeded `$2a$` hash becomes `$2b$`), which fires this trigger and
-- clears the flag even though the person never changed their password. Seed
-- accounts could therefore skip the first-sign-in password change silently.
--
-- The app now clears the flag itself in the change-password server action,
-- where a real, successful password change is already verified by GoTrue.

drop trigger if exists on_user_password_changed on auth.users;
drop function if exists public.handle_password_change ();
