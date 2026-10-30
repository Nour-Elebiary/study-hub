import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { TextSizeControl } from "@/components/text-size";

/**
 * Student site chrome (spec section 10): plain, fast, no accounts. The
 * authorization gate lives in requireStudentScope() called by each page —
 * the join page must stay reachable without a cookie, so the layout itself
 * never redirects. The header hides when printing (comfort rule 6).
 */
export const instant = false;

export default async function StudentLayout({ children }: LayoutProps<"/s">) {
  const t = await getTranslations();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-background sticky top-0 border-b print:hidden">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between gap-2 px-4 md:max-w-3xl">
          <Link href="/s" className="text-sm font-semibold">
            {t("app.name")}
          </Link>
          <div className="flex items-center gap-1">
            <TextSizeControl />
            <nav
              aria-label={t("student.nav.ariaLabel")}
              className="flex items-center gap-3"
            >
              <Link href="/s/search" className="text-sm font-medium">
                {t("student.nav.search")}
              </Link>
              <Link href="/s/tags" className="text-sm font-medium">
                {t("student.nav.tags")}
              </Link>
            </nav>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-4 pb-16 md:max-w-3xl">
        {children}
      </main>
    </div>
  );
}
