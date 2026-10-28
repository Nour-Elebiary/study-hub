import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { requireSession } from "@/lib/dal";

/**
 * Auth-gated segment: every request re-checks the session, so these routes
 * are blocking (never prerendered) — Cache Components requires the opt-out.
 */
export const instant = false;

/**
 * Shared chrome for every leader/admin page.
 * NOTE: the authorization *enforcement* lives in requireSession() called by
 * each page too — a layout alone can't re-check on navigation (Next docs).
 */
export default async function LeaderLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-background sticky top-0 border-b">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between px-4">
          <div>
            <p className="text-sm leading-tight font-medium">Study Hub</p>
            <p className="text-muted-foreground text-xs">
              {session.profile.display_name}
              {session.profile.global_role === "admin" && " · admin"}
            </p>
          </div>
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-4 pb-20 sm:pb-8">
        {children}
      </main>
      <nav
        aria-label="Main navigation"
        className="bg-background fixed inset-x-0 bottom-0 border-t md:hidden"
      >
        <ul className="mx-auto flex w-full max-w-2xl">
          <li className="grow">
            <Link
              href="/"
              className="flex h-14 items-center justify-center text-sm font-medium"
            >
              Home
            </Link>
          </li>
          <li className="grow">
            <Link
              href="/courses"
              className="flex h-14 items-center justify-center text-sm font-medium"
            >
              Courses
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  );
}
