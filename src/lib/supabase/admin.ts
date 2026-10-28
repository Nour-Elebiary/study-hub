import "server-only";
import { createClient } from "@supabase/supabase-js";
import { requiredServerEnv } from "@/lib/env";

/**
 * Service-role client. Bypasses RLS — used ONLY inside server actions for
 * the small set of operations the spec reserves for the server:
 * creating leaders, resetting passwords, and writing audit rows.
 * Never imported from a Client Component (`server-only` enforces this).
 */
export function createAdminClient() {
  return createClient(
    requiredServerEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredServerEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
