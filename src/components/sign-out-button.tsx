import { signOutAction } from "@/app/login/actions";
import { Button } from "@/components/ui/button";

/**
 * Server-component sign-out: a plain form posting to a Server Action.
 * No client JavaScript needed.
 */
export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="outline" size="sm">
        Sign out
      </Button>
    </form>
  );
}
