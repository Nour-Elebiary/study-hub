import { createBrowserClient } from "@supabase/ssr";
import { requiredPublicEnv } from "@/lib/env";

/**
 * Browser-side Supabase client (anon key only — RLS decides everything).
 * Used for the soft-lock heartbeat and presence, which run while the editor
 * is open and must not round-trip through the server every 30 seconds.
 */
export function createBrowserSupabase() {
  return createBrowserClient(
    requiredPublicEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredPublicEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  );
}
