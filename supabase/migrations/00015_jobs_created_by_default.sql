-- Study Hub — jobs.created_by defaults to the caller (spec section 7): the
-- browser runner and the worker never pass created_by, the column carries
-- "who started this job", and the insert policy requires it to equal
-- auth.uid(). Nodes, assets and suggestions already declare the same default
-- (00005/00006/00007); 00008 missed it on jobs, so every job insert through
-- the server action arrived with created_by = null and failed the WITH CHECK
-- ("new row violates row-level security policy") — caught by RLS test 12.
alter table public.jobs alter column created_by set default auth.uid ();
