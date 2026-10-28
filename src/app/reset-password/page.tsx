import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChangePasswordForm } from "@/app/reset-password/change-password-form";
import { getSession } from "@/lib/dal";

// Reads the session on every request — blocking route, not prerendered.
export const instant = false;

export const metadata: Metadata = { title: "Choose your password" };

export default async function ResetPasswordPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  if (!session.profile.must_change_password) {
    redirect("/");
  }

  return (
    <main className="bg-muted flex flex-1 items-center justify-center px-4 py-12">
      <ChangePasswordForm />
    </main>
  );
}
