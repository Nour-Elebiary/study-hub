"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { joinAction } from "@/app/s/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function JoinForm({ defaultCode = "" }: { defaultCode?: string }) {
  const [state, formAction, pending] = useActionState(joinAction, null);
  const t = useTranslations("student.join");

  return (
    <form action={formAction} className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="code">{t("label")}</Label>
        <Input
          id="code"
          name="code"
          defaultValue={defaultCode}
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          placeholder="ABCD-EFGH"
          required
          className="h-12 text-center text-lg tracking-widest uppercase"
        />
      </div>
      {state?.error && (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? t("checking") : t("submit")}
      </Button>
    </form>
  );
}
