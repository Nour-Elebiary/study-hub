// Study Hub — Fail loud on missing environment variables (spec section 12).
export function requiredPublicEnv(
  name: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY",
): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill in the values (see README).`,
    );
  }
  return value;
}

export function requiredServerEnv(
  name:
    | "NEXT_PUBLIC_SUPABASE_URL"
    | "NEXT_PUBLIC_SUPABASE_ANON_KEY"
    | "SUPABASE_SERVICE_ROLE_KEY"
    | "ENCRYPTION_KEY"
    | "WORKER_TOKEN_HASH"
    | "BACKUP_TOKEN_HASH"
    | "JOIN_COOKIE_SECRET"
    | "APP_URL",
): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill in the values (see README).`,
    );
  }
  return value;
}
