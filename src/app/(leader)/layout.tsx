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
 *
 * One app, four device views (mobile-first at 360 px, spec rule 6):
 *  - phone (360 px+): sticky header + fixed bottom tab bar.
 *  - tablet (768 px+): same chrome, wider single column.
 *  - laptop (1024 px+): the bottom bar is replaced by a fixed left sidebar
 *    holding every destination; the content column widens.
 *  - desktop (1280 px+): the content column reaches its widest measure.
 * The mobile chrome stays mounted below lg so nothing moves for the
 * Playwright mobile viewport.
 */
export default async function LeaderLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();
  const isAdmin = session.profile.global_role === "admin";

  const navLinks = [
    { href: "/", label: "Home" },
    { href: "/courses", label: "Courses" },
    { href: "/search", label: "Search" },
    { href: "/jobs", label: "Jobs" },
    ...(isAdmin ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <aside className="bg-background fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r lg:flex">
        <div className="flex h-14 shrink-0 items-center border-b px-4">
          <div>
            <p className="text-sm leading-tight font-medium">Study Hub</p>
            <p className="text-muted-foreground text-xs">
              {session.profile.display_name}
              {isAdmin && " · admin"}
            </p>
          </div>
        </div>
        <nav
          aria-label="Sidebar navigation"
          className="flex flex-col gap-1 p-3"
        >
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="hover:bg-muted inline-flex h-9 items-center rounded-md px-3 text-sm font-medium"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex min-h-dvh flex-col lg:pl-60">
        <header className="bg-background sticky top-0 border-b">
          <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between px-4 md:max-w-3xl lg:max-w-4xl xl:max-w-5xl">
            <div>
              <p className="text-sm leading-tight font-medium">Study Hub</p>
              <p className="text-muted-foreground text-xs">
                {session.profile.display_name}
                {session.profile.global_role === "admin" && " · admin"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/jobs"
                className="hover:bg-muted inline-flex h-9 items-center rounded-md px-3 text-sm font-medium"
              >
                Jobs
              </Link>
              {isAdmin && (
                <Link
                  href="/admin"
                  className="hover:bg-muted inline-flex h-9 items-center rounded-md px-3 text-sm font-medium"
                >
                  Admin
                </Link>
              )}
              <SignOutButton />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-4 pb-20 md:max-w-3xl lg:max-w-4xl lg:pb-8 xl:max-w-5xl">
          {children}
        </main>
        <nav
          aria-label="Main navigation"
          className="bg-background fixed inset-x-0 bottom-0 border-t lg:hidden"
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
            <li className="grow">
              <Link
                href="/search"
                className="flex h-14 items-center justify-center text-sm font-medium"
              >
                Search
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </div>
  );
}
