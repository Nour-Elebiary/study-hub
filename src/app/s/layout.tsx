import Link from "next/link";

/**
 * Student site chrome (spec section 10): plain, fast, no accounts. The
 * authorization gate lives in requireStudentScope() called by each page —
 * the join page must stay reachable without a cookie, so the layout itself
 * never redirects.
 */
export const instant = false;

export default async function StudentLayout({ children }: LayoutProps<"/s">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-background sticky top-0 border-b">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between px-4">
          <Link href="/s" className="text-sm font-semibold">
            Study Hub
          </Link>
          <span className="text-muted-foreground text-xs">Student view</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-4 pb-16">
        {children}
      </main>
    </div>
  );
}
