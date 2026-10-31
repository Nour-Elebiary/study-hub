-- Study Hub — M9 Canvas operations (CANVAS-SPEC section 5.3): pure RPCs.
-- All three are `security invoker`, so the RLS policies and column grants
-- from 00018 still apply inside them. Execute is revoked from public and
-- anon and granted to authenticated; students (account-less) read through
-- the app's service-role client and never call these RPCs.

-- ---------------------------------------------------------------------------
-- Snapshot: the full current state of a canvas as JSON for the versions
-- table. Read-only; the caller's RLS decides which canvases they can read.
-- ---------------------------------------------------------------------------
create or replace function public.canvas_snapshot_json(p_canvas_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object (
    'nodes', coalesce (
      (select jsonb_agg (
                to_jsonb (n) - 'course_id' - 'canvas_id' - 'created_by'
                - 'created_at' - 'updated_at'
              )
         from public.canvas_nodes n
        where n.canvas_id = p_canvas_id),
      '[]'::jsonb),
    'edges', coalesce (
      (select jsonb_agg (
                to_jsonb (e) - 'course_id' - 'canvas_id' - 'created_by'
                - 'created_at' - 'updated_at'
              )
         from public.canvas_edges e
        where e.canvas_id = p_canvas_id),
      '[]'::jsonb),
    'legend', (select legend from public.canvases where id = p_canvas_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- Atomic batch of at most 200 ops (last write wins inside one batch: ops
-- apply in order, a later op on the same card overwrites an earlier one —
-- spec decision D6). One failing op rolls back the whole call, so the
-- client's optimistically applied state on failure must be refetched.
-- Returns { rev, applied, skipped }.
-- ---------------------------------------------------------------------------
create or replace function public.canvas_apply_ops(p_canvas_id uuid, p_ops jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_op jsonb;
  v_name text;
  v_rows int;
  v_applied int := 0;
  v_skipped int := 0;
  v_rev bigint;
begin
  if jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) > 200 then
    raise exception 'ops must be an array of at most 200 items';
  end if;

  -- Lock the canvas row so concurrent edits cannot interleave between the
  -- ops of one call. Under RLS an invisible or soft-deleted canvas = not
  -- found; the caller's select/update policies decide visibility.
  perform 1 from public.canvases
    where id = p_canvas_id and deleted_at is null for update;
  if not found then
    raise exception 'canvas not found';
  end if;

  for v_op in select value from jsonb_array_elements(p_ops) loop
    v_name := v_op->>'op';

    if v_name = 'node.add' then
      insert into public.canvas_nodes
        (id, canvas_id, kind, node_id, asset_id, url, x, y, width, height, z, color, body, label, student_visible)
      values
        ((v_op->>'id')::uuid, p_canvas_id, v_op->>'kind',
         (v_op->>'node_id')::uuid, (v_op->>'asset_id')::uuid, v_op->>'url',
         (v_op->>'x')::float8, (v_op->>'y')::float8,
         (v_op->>'width')::float8, (v_op->>'height')::float8,
         coalesce((v_op->>'z')::int, 0), v_op->>'color', v_op->>'body', v_op->>'label',
         coalesce((v_op->>'student_visible')::boolean, true));
      v_rows := 1;

    elsif v_name = 'node.update' then
      -- `v_op ? 'color'` (key present, even as JSON null) SETs the column —
      -- so an explicit null clears the colour, an absent key keeps it.
      update public.canvas_nodes set
        x      = case when v_op ? 'x'      then (v_op->>'x')::float8      else x end,
        y      = case when v_op ? 'y'      then (v_op->>'y')::float8      else y end,
        width  = case when v_op ? 'width'  then (v_op->>'width')::float8  else width end,
        height = case when v_op ? 'height' then (v_op->>'height')::float8 else height end,
        z      = case when v_op ? 'z'      then (v_op->>'z')::int         else z end,
        color  = case when v_op ? 'color'  then v_op->>'color'            else color end,
        body   = case when v_op ? 'body'   then v_op->>'body'             else body end,
        label  = case when v_op ? 'label'  then v_op->>'label'            else label end,
        url    = case when v_op ? 'url'    then v_op->>'url'              else url end,
        student_visible = case when v_op ? 'student_visible'
                               then (v_op->>'student_visible')::boolean
                               else student_visible end
      where id = (v_op->>'id')::uuid and canvas_id = p_canvas_id;
      get diagnostics v_rows = row_count;

    elsif v_name = 'node.delete' then
      delete from public.canvas_nodes
        where id = (v_op->>'id')::uuid and canvas_id = p_canvas_id;
      get diagnostics v_rows = row_count;

    elsif v_name = 'edge.add' then
      insert into public.canvas_edges
        (id, canvas_id, from_node, to_node, from_side, to_side, from_end, to_end, label, color)
      values
        ((v_op->>'id')::uuid, p_canvas_id,
         (v_op->>'from_node')::uuid, (v_op->>'to_node')::uuid,
         coalesce(v_op->>'from_side', 'right'), coalesce(v_op->>'to_side', 'left'),
         coalesce(v_op->>'from_end', 'none'), coalesce(v_op->>'to_end', 'arrow'),
         v_op->>'label', v_op->>'color');
      v_rows := 1;

    elsif v_name = 'edge.update' then
      update public.canvas_edges set
        from_side = case when v_op ? 'from_side' then v_op->>'from_side' else from_side end,
        to_side   = case when v_op ? 'to_side'   then v_op->>'to_side'   else to_side end,
        from_end  = case when v_op ? 'from_end'  then v_op->>'from_end'  else from_end end,
        to_end    = case when v_op ? 'to_end'    then v_op->>'to_end'    else to_end end,
        label     = case when v_op ? 'label'     then v_op->>'label'     else label end,
        color     = case when v_op ? 'color'     then v_op->>'color'     else color end
      where id = (v_op->>'id')::uuid and canvas_id = p_canvas_id;
      get diagnostics v_rows = row_count;

    elsif v_name = 'edge.delete' then
      delete from public.canvas_edges
        where id = (v_op->>'id')::uuid and canvas_id = p_canvas_id;
      get diagnostics v_rows = row_count;

    else
      raise exception 'unknown op: %', coalesce(v_name, '(missing op)');
    end if;

    if v_rows > 0 then
      v_applied := v_applied + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  -- Every successful call (even all-skipped batches reflect a sync) bumps
  -- rev so M10 history/M13 sync can depend on a monotonic counter.
  update public.canvases set rev = rev + 1
    where id = p_canvas_id
    returning rev into v_rev;

  return jsonb_build_object('rev', v_rev, 'applied', v_applied, 'skipped', v_skipped);
end $$;

-- ---------------------------------------------------------------------------
-- Restore one version. Always snapshots the CURRENT state first so a
-- restore is itself undoable, then wipes cards + edges and re-creates them
-- from the snapshot, silently dropping cards whose note or file was deleted
-- in the meantime (the UI shows the returned counts, spec 5.3 agent note).
-- ---------------------------------------------------------------------------
create or replace function public.canvas_restore_version(p_version_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v public.canvas_versions;
  n_total int;
  n_nodes int;
  n_edges_total int;
  n_edges int;
begin
  select * into v from public.canvas_versions where id = p_version_id;
  if not found then
    raise exception 'version not found';
  end if;

  perform 1 from public.canvases
    where id = v.canvas_id and deleted_at is null for update;
  if not found then
    raise exception 'canvas not found';
  end if;

  insert into public.canvas_versions (id, canvas_id, label, auto, snapshot)
  values (
    gen_random_uuid (), v.canvas_id, 'Before restore', true,
    public.canvas_snapshot_json (v.canvas_id));

  delete from public.canvas_nodes where canvas_id = v.canvas_id;  -- edges cascade

  n_total := jsonb_array_length(v.snapshot->'nodes');
  insert into public.canvas_nodes
    (id, canvas_id, kind, node_id, asset_id, url, x, y, width, height, z, color, body, label, student_visible)
  select
    (j->>'id')::uuid, v.canvas_id, j->>'kind',
    nullif(j->>'node_id','')::uuid, nullif(j->>'asset_id','')::uuid,
    j->>'url', (j->>'x')::float8, (j->>'y')::float8,
    (j->>'width')::float8, (j->>'height')::float8,
    coalesce((j->>'z')::int, 0), j->>'color', j->>'body', j->>'label',
    coalesce((j->>'student_visible')::boolean, true)
  from jsonb_array_elements(v.snapshot->'nodes') j
  where j->>'kind' not in ('note', 'file')
     or (j->>'kind' = 'note' and exists (
           select 1 from public.nodes x
            where x.id = (j->>'node_id')::uuid and x.deleted_at is null))
     or (j->>'kind' = 'file' and exists (
           select 1 from public.assets a where a.id = (j->>'asset_id')::uuid));
  get diagnostics n_nodes = row_count;

  n_edges_total := jsonb_array_length(v.snapshot->'edges');
  insert into public.canvas_edges
    (id, canvas_id, from_node, to_node, from_side, to_side, from_end, to_end, label, color)
  select
    (e->>'id')::uuid, v.canvas_id, (e->>'from_node')::uuid, (e->>'to_node')::uuid,
    e->>'from_side', e->>'to_side', e->>'from_end', e->>'to_end', e->>'label', e->>'color'
  from jsonb_array_elements(v.snapshot->'edges') e
  where exists (select 1 from public.canvas_nodes c
                 where c.id = (e->>'from_node')::uuid and c.canvas_id = v.canvas_id)
    and exists (select 1 from public.canvas_nodes c
                 where c.id = (e->>'to_node')::uuid and c.canvas_id = v.canvas_id);
  get diagnostics n_edges = row_count;

  update public.canvases
    set legend = coalesce(v.snapshot->'legend', '{}'::jsonb), rev = rev + 1
    where id = v.canvas_id;

  return jsonb_build_object (
    'nodes_restored', n_nodes, 'nodes_dropped', n_total - n_nodes,
    'edges_restored', n_edges, 'edges_dropped', n_edges_total - n_edges);
end $$;

revoke all on function
    public.canvas_snapshot_json (uuid),
    public.canvas_apply_ops (uuid, jsonb),
    public.canvas_restore_version (uuid)
  from public, anon;
grant execute on function
    public.canvas_snapshot_json (uuid),
    public.canvas_apply_ops (uuid, jsonb),
    public.canvas_restore_version (uuid)
  to authenticated;
