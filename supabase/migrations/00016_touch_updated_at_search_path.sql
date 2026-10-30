-- Study Hub — pin the search_path on touch_updated_at (security advisor
-- finding "function_search_path_mutable"). Every other function in this
-- project sets `set search_path = ''`; this trigger function was missed.
-- With an empty search_path, pg_catalog is still searched implicitly first,
-- so now() keeps resolving to the built-in. No behavior change — this only
-- removes the ability of a schema object to shadow the function's calls.

alter function public.touch_updated_at() set search_path = '';
