import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { JoinForm } from "@/app/s/join/join-form";
import { sanitizeJoinCodeParam } from "@/lib/join-code";
import { getStudentScope } from "@/lib/student-access";

export const metadata: Metadata = { title: "Join — Study Hub" };

/**
 * The student entry point (spec section 10 rule 1): one join code, no
 * account. Students who already joined go straight to their courses.
 * A share link or QR code (spec section 9) prefills the code with ?code=;
 * the student still presses the button, so nothing joins automatically.
 */
export default async function JoinPage({ searchParams }: PageProps<"/s/join">) {
  if (await getStudentScope()) {
    redirect("/s");
  }

  const t = await getTranslations("student.join");
  const params = await searchParams;
  const raw = typeof params.code === "string" ? params.code : "";
  // Sanitized server-side: only the code alphabet survives, so a crafted
  // link cannot smuggle markup into the page.
  const defaultCode = raw ? sanitizeJoinCodeParam(raw) : "";

  return (
    <div className="grid gap-6 pt-8">
      <div className="grid gap-2 text-center">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("intro")}</p>
      </div>
      <JoinForm defaultCode={defaultCode} />
    </div>
  );
}
