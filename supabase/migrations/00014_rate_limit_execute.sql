-- Study Hub — only the server may call the rate limiter (spec section 10):
-- clients reach it only through the server actions, which use the
-- service-role client. Supabase's default privileges grant EXECUTE on new
-- functions directly to anon and authenticated, so the revoke from public
-- in 00007 was not enough — those direct grants remained and an anonymous
-- caller could invoke the limiter through the API (caught by RLS test 11).
revoke execute on function public.consume_rate_limit (text, integer, integer)
  from anon, authenticated;
