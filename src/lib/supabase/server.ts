import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requiredPublicEnv } from "@/lib/env";

/**
 * Server-side Supabase client bound to the Next.js cookie store.
 * Used in Server Components, Server Actions, and Route Handlers.
 * The browser never sees the service-role key; RLS decides everything else.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    requiredPublicEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredPublicEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — the session refresh in the
            // proxy (middleware) layer handles cookie rotation instead.
          }
        },
      },
    },
  );
}
