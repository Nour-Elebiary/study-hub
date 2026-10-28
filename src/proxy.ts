import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next.js 16 Proxy (formerly Middleware).
 * Optimistic checks only: session validation + route redirects.
 * Real authorization stays in the (Server Components, Server Actions) and
 * Postgres RLS — the proxy is never the only line of defense.
 */
export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);

  const path = request.nextUrl.pathname;
  const isPublic =
    path.startsWith("/login") ||
    path.startsWith("/s") || // student site (M4) — join-code gated, no accounts
    path.startsWith("/reset-password");

  // Signed-in users leave the login page.
  if (user && path === "/login") {
    return NextResponse.redirect(new URL("/", request.nextUrl));
  }

  // Leaders/admins are the only authenticated audience for app routes.
  if (!user && !isPublic) {
    const loginUrl = new URL("/login", request.nextUrl);
    loginUrl.searchParams.set("next", path);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // Everything except the API (public/health + worker endpoints), the student
  // site's static assets, and Next internals.
  matcher: [
    "/((?!api|s|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest)$).*)",
  ],
};
