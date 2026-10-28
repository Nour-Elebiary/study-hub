-- Study Hub — M0 Foundation: helper functions, RLS policies, auth trigger.
-- Every table here has row-level security enabled and tested (spec section 11.3).

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so RLS never recurses)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid ()
      and global_role = 'admin'
      and is_active
  );
$$;

create or replace function public.can_access_course(course uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin ()
    or exists (
      select 1
      from public.course_members m
      where m.course_id = course
        and m.user_id = auth.uid ()
    );
$$;

create or replace function public.is_course_owner(course uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.course_members m
    where m.course_id = course
      and m.user_id = auth.uid ()
      and m.role = 'owner'
  );
$$;

-- Trigger: create a profiles row for every new auth user (spec M0 step 3).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, global_role, must_change_password)
  values (
    new.id,
    coalesce (new.raw_user_meta_data ->> 'display_name', split_part (new.email, '@', 1)),
    case
      when new.raw_user_meta_data ->> 'global_role' in ('admin', 'leader')
      then new.raw_user_meta_data ->> 'global_role'
      else 'leader'
    end,
    true -- force password change until the user sets their own password
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user ();

-- ---------------------------------------------------------------------------
-- Enable RLS on EVERY table (defensive — new tables must add policies)
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.course_members enable row level security;
alter table public.settings enable row level security;
alter table public.audit_log enable row level security;
alter table public.profiles force row level security;
alter table public.courses force row level security;
alter table public.course_members force row level security;
alter table public.settings force row level security;
alter table public.audit_log force row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- Leaders read and update only their own row; admins read all.
-- Leaders may only change display_name (column grant below).
-- Insert/delete: server-side only (service role + trigger).
-- ---------------------------------------------------------------------------
create policy select_own_or_admin_profiles on public.profiles
  as permissive for select to authenticated
  using (id = auth.uid () or public.is_admin ());

create policy update_own_profiles on public.profiles
  as permissive for update to authenticated
  using (id = auth.uid ())
  with check (id = auth.uid ());

revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- courses
-- Select: active members of the course, or an admin (includes archived).
-- Insert/update: admin only. Delete: none (archive instead).
-- ---------------------------------------------------------------------------
create policy select_member_courses on public.courses
  as permissive for select to authenticated
  using (public.can_access_course (id));

create policy select_admin_courses on public.courses
  as permissive for select to authenticated
  using (public.is_admin ());

create policy insert_courses_admin on public.courses
  as permissive for insert to authenticated
  with check (public.is_admin ());

create policy update_courses_admin on public.courses
  as permissive for update to authenticated
  using (public.is_admin ())
  with check (public.is_admin ());

-- ---------------------------------------------------------------------------
-- course_members
-- Select: own membership, course owner, or admin.
-- Write: course owner or admin (M1 adds the admin portal on the server).
-- ---------------------------------------------------------------------------
create policy select_own_membership_course_members on public.course_members
  as permissive for select to authenticated
  using (user_id = auth.uid ());

create policy select_course_owner_course_members on public.course_members
  as permissive for select to authenticated
  using (public.is_course_owner (course_id));

create policy select_admin_course_members on public.course_members
  as permissive for select to authenticated
  using (public.is_admin ());

create policy write_owner_or_admin_course_members
  on public.course_members
  as permissive for all to authenticated
  using (public.is_course_owner (course_id) or public.is_admin ())
  with check (public.is_course_owner (course_id) or public.is_admin ());

-- ---------------------------------------------------------------------------
-- settings
-- Leaders read; only admins write (M1 admin screens edit the limit table).
-- ---------------------------------------------------------------------------
create policy select_settings_authenticated on public.settings
  as permissive for select to authenticated
  using (true);

create policy write_settings_admin on public.settings
  as permissive for all to authenticated
  using (public.is_admin ())
  with check (public.is_admin ());

-- ---------------------------------------------------------------------------
-- audit_log
-- Admin read-only for all roles except service_role, which bypasses RLS.
-- ---------------------------------------------------------------------------
create policy select_admin_audit_log on public.audit_log
  as permissive for select to authenticated
  using (public.is_admin ());

-- No insert/update/delete policies for authenticated: server-only writes.
