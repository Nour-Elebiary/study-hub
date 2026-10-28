import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/health — one trivial database query, 200 when alive.
 * Used by the GitHub Actions keep-alive workflow (M8) and uptime checks.
 * Public to the proxy matcher; returns no user data.
 */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return Response.json(
      { status: "error", error: "service not configured" },
      { status: 500 },
    );
  }

  // Service-role client used only for the existence probe; never returned.
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await admin.from("settings").select("key").limit(1);
  if (error) {
    return Response.json({ status: "error" }, { status: 503 });
  }

  return Response.json({ status: "ok" });
}
