import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { requireSession } from "@/lib/dal";

/**
 * Auth-gated segment: every request re-checks the session, so these routes
 * are blocking (never prerendered) — Cache Components requires the opt-out.
 */
export const instant = false;

/**
 * Chrome for admin pages. Every page inside also calls its own gate
 * (requireAdmin or requireAdminOrCourseOwner) so authorization is
 * re-checked on navigation, not just here.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const session = await requireSession();
  const isAdmin = session.profile.global_role === "admin";

  const tabs = [
    { href: "/admin/leaders", label: "Leaders", adminOnly: true },
    { href: "/admin/courses", label: "Courses", adminOnly: true },
    { href: "/admin/team", label: "Team", adminOnly: false },
    { href: "/admin/ai", label: "AI", adminOnly: true },
    { href: "/admin/audit", label: "Audit log", adminOnly: true },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-background sticky top-0 border-b">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-4">
          <div>
            <p className="text-sm leading-tight font-medium">Study Hub admin</p>
            <p className="text-muted-foreground text-xs">
              {session.profile.display_name}
            </p>
          </div>
          <SignOutButton />
        </div>
        <nav aria-label="Admin sections" className="border-t md:border-t-0">
          <ul className="mx-auto flex w-full max-w-3xl gap-1 overflow-x-auto px-2 pt-1 pb-2 md:pt-2">
            {tabs
              .filter((tab) => isAdmin || !tab.adminOnly)
              .map((tab) => (
                <li key={tab.href}>
                  <Link
                    href={tab.href}
                    className="hover:bg-muted inline-flex h-9 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap"
                  >
                    {tab.label}
                  </Link>
                </li>
              ))}
            <li className="ms-auto">
              <Link
                href="/"
                className="text-muted-foreground hover:bg-muted inline-flex h-9 items-center rounded-md px-3 text-sm whitespace-nowrap"
              >
                ← Back to hub
              </Link>
            </li>
          </ul>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-4 pb-16">
        {children}
      </main>
    </div>
  );
}
