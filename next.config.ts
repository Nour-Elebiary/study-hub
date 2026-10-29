import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

/**
 * Security headers and a strict Content-Security-Policy (spec section 11.5).
 *
 * The policy is header-based rather than middleware/nonce-based so it also
 * covers static responses and needs no extra request hop. Trade-off: Next's
 * hydration bootstrap and the tiny text-size script in the root layout are
 * inline, so script/style keep 'unsafe-inline'. Everything else is locked
 * down hard: no framing, no plugins, no base hijacking, and the only external
 * origin allowed is the project's own Supabase instance (from
 * NEXT_PUBLIC_SUPABASE_URL, plus the *.supabase.co wildcard for production).
 * See docs/QUESTIONS.md #23 for the nonce-based upgrade path.
 */

/** The Supabase project's HTTP and WebSocket origins. */
function supabaseOrigins(): string[] {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const origins = ["https://*.supabase.co"];
  if (raw) {
    const base = raw.replace(/\/+$/, "");
    origins.push(base, base.replace(/^http/, "ws"));
  }
  return origins;
}

function contentSecurityPolicy(): string {
  const supabase = supabaseOrigins().join(" ");
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: " + supabase,
    "media-src 'self' blob: " + supabase,
    "font-src 'self'",
    "connect-src 'self' " + supabase,
    // blob: workers are needed for heavy in-browser jobs (Whisper fallback).
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Camera and microphone stay available to this origin only (camera upload,
  // voice recording and dictation); everything else is off.
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

// next-intl (spec section 12 stack). The request config lives outside the
// default location, so its path is given explicitly.
const withNextIntl = createNextIntlPlugin("./src/lib/i18n/request.ts");

export default withNextIntl(nextConfig);
