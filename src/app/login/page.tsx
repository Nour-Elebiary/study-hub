import type { Metadata } from "next";
import { LoginForm } from "@/app/login/login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="bg-muted flex flex-1 items-center justify-center px-4 py-12">
      <LoginForm />
    </main>
  );
}
