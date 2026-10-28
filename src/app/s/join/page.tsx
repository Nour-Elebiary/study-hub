import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { JoinForm } from "@/app/s/join/join-form";
import { getStudentScope } from "@/lib/student-access";

export const metadata: Metadata = { title: "Join — Study Hub" };

/**
 * The student entry point (spec section 10 rule 1): one join code, no
 * account. Students who already joined go straight to their courses.
 */
export default async function JoinPage() {
  if (await getStudentScope()) {
    redirect("/s");
  }

  return (
    <div className="grid gap-6 pt-8">
      <div className="grid gap-2 text-center">
        <h1 className="text-2xl font-bold">Welcome to Study Hub</h1>
        <p className="text-muted-foreground text-sm">
          Enter the join code your teacher gave you. You do not need an account
          — this device will remember you for 90 days.
        </p>
      </div>
      <JoinForm />
    </div>
  );
}
