-- Study Hub — M1 Roles and admin portal.
-- Adds leader lifecycle columns to profiles. All admin mutations go through
-- server-side service-role calls (audited); leaders still only get
-- display_name + tour_done column grants, so a disabled leader cannot
-- re-enable themselves through the database API (spec section 9).

alter table public.profiles
  add column if not exists deleted_at timestamptz;

alter table public.profiles
  add column if not exists tour_done boolean not null default false;

comment on column public.profiles.deleted_at is
  'Soft delete: set by an admin from the server. A soft-deleted leader is '
  'blocked at sign-in and in the session gate.';
comment on column public.profiles.tour_done is
  'Set by the leader after the 3-step first-run tour.';

-- Leaders may set their own display_name and finish their own tour — nothing
-- else. (Re-grant to include tour_done.)
revoke update on public.profiles from authenticated;
grant update (display_name, tour_done) on public.profiles to authenticated;
