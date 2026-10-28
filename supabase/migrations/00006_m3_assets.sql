-- Study Hub — M3 Files and mind-map: the assets table and the private
-- storage bucket (spec sections 5 and 6, upload rules in section 11 rule 4).
-- Every table: RLS on, policies in this file, tested in supabase/tests/rls/10.

-- ---------------------------------------------------------------------------
-- assets — small files in Storage, big files as Drive or web links
-- path_or_url is the storage path ("{course_id}/{random-name}") for
-- storage='supabase', or the link for 'drive' and 'link'.
-- title is the display name (rename); the storage name stays random.
-- ---------------------------------------------------------------------------
create table public.assets (
  id uuid primary key default gen_random_uuid (),
  course_id uuid not null references public.courses (id) on delete cascade,
  node_id uuid references public.nodes (id) on delete cascade,
  kind text not null
    check (kind in ('image', 'pdf', 'audio', 'video', 'document', 'other')),
  storage text not null check (storage in ('supabase', 'drive', 'link')),
  path_or_url text not null,
  drive_file_id text,
  title text not null default '',
  mime text not null default 'application/octet-stream',
  size_bytes bigint,
  ai_allowed boolean not null default false,
  ocr_text text,
  transcript_text text,
  student_visible boolean not null default true,
  student_downloadable boolean not null default true,
  created_by uuid references auth.users (id) on delete set null
    default auth.uid (),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index assets_course_id_idx on public.assets (course_id);
create index assets_node_id_idx on public.assets (node_id);

create trigger assets_touch_updated_at
before update on public.assets
for each row execute function public.touch_updated_at ();

-- ---------------------------------------------------------------------------
-- The private storage bucket. The 10 MB gate is enforced again here at the
-- storage level (the number lives in settings.max_file_mb for the UI).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('assets', 'assets', false, 10485760)
on conflict (id) do nothing;

-- Objects live under "{course_id}/{random-name}" so the policies can tie a
-- file to the course the caller belongs to (section 11 rule 4: random names).
create or replace function public.can_access_storage_path(path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    path ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
    and public.can_access_course (
      ((regexp_match (path, '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/'))[1])::uuid
    );
$$;

create policy "assets_bucket_read" on storage.objects
  as permissive for select to authenticated
  using (bucket_id = 'assets' and public.can_access_storage_path (name));

create policy "assets_bucket_insert" on storage.objects
  as permissive for insert to authenticated
  with check (bucket_id = 'assets' and public.can_access_storage_path (name));

create policy "assets_bucket_update" on storage.objects
  as permissive for update to authenticated
  using (bucket_id = 'assets' and public.can_access_storage_path (name))
  with check (bucket_id = 'assets' and public.can_access_storage_path (name));

create policy "assets_bucket_delete" on storage.objects
  as permissive for delete to authenticated
  using (bucket_id = 'assets' and public.can_access_storage_path (name));

-- ---------------------------------------------------------------------------
-- Enable and force RLS
-- ---------------------------------------------------------------------------
alter table public.assets enable row level security;
alter table public.assets force row level security;

-- ---------------------------------------------------------------------------
-- assets
-- Read: every member of the course (spec section 4 — reviewers read).
-- Insert: admin, owner, editor or contributor (the upload row in the matrix);
-- a reviewer never uploads. A node-level asset requires write rights in the
-- node's area; a course-level asset (node_id null) any editor/contributor.
-- Update (rename, replace, student flags): admin, owner, or the creator.
-- Delete: admin, owner, or the creator.
-- ai_allowed has no client grant: it is flipped through the server later
-- (M7), so the AI router can trust it.
-- ---------------------------------------------------------------------------
create policy select_course_assets on public.assets
  as permissive for select to authenticated
  using (public.can_access_course (course_id));

create policy insert_writable_assets on public.assets
  as permissive for insert to authenticated
  with check (
    public.is_admin ()
    or public.is_course_owner (course_id)
    or public.course_role (course_id) in ('editor', 'contributor')
  );

create policy update_own_or_owner_assets on public.assets
  as permissive for update to authenticated
  using (
    public.is_admin ()
    or public.is_course_owner (course_id)
    or created_by = auth.uid ()
  )
  with check (
    public.is_admin ()
    or public.is_course_owner (course_id)
    or created_by = auth.uid ()
  );

create policy delete_own_or_owner_assets on public.assets
  as permissive for delete to authenticated
  using (
    public.is_admin ()
    or public.is_course_owner (course_id)
    or created_by = auth.uid ()
  );

revoke insert, update, delete on public.assets from authenticated;
grant insert (
  course_id, node_id, kind, storage, path_or_url, drive_file_id,
  title, mime, size_bytes, student_visible, student_downloadable
) on public.assets to authenticated;
grant update (
  node_id, title, path_or_url, drive_file_id, mime, size_bytes,
  ocr_text, transcript_text, student_visible, student_downloadable
) on public.assets to authenticated;
