import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found — Study Hub" };

/**
 * Shown whenever a page is missing or not allowed: a draft, another
 * course's content, or a mistyped address (spec section 10 rule 2 —
 * students only ever see published content from their own courses).
 * Plain language, one clear way back (constitution rule 6).
 */
export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-content-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="text-muted-foreground text-sm">
        This page does not exist, or you do not have access to it. It may be
        unpublished, or it may belong to a different course.
      </p>
      <Link href="/" className="text-sm underline underline-offset-4">
        Back to the home page
      </Link>
    </main>
  );
}
