-- Study Hub — first sign-in password enforcement (spec section 9 step 4).
-- `must_change_password` has no UPDATE grant for `authenticated`, so a leader
-- cannot clear it from the client. The only path that clears it is an actual
-- change of the auth password, detected here by comparing encrypted_password.

create or replace function public.handle_password_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    update public.profiles
    set must_change_password = false
    where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_user_password_changed
after update on auth.users
for each row
execute function public.handle_password_change ();
