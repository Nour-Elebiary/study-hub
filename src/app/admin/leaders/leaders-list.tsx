import { LeaderActions } from "@/app/admin/leaders/leader-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type LeaderRow = {
  id: string;
  email: string;
  displayName: string;
  globalRole: "admin" | "leader";
  isActive: boolean;
  deletedAt: string | null;
  lastSignIn: string | null;
  courses: string[];
};

export function createLeaderFlowHint(): string {
  return (
    "Create every leader account here. Share the temporary password in " +
    "person or through your class channel — the leader chooses a new " +
    "password at first sign-in."
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "Never signed in";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** The Leaders screen: list with status, last sign-in, courses and actions. */
export function LeadersList({ leaders }: { leaders: LeaderRow[] }) {
  if (leaders.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground pt-6 text-sm">
          No leaders yet. Create the first one above.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3">
      {leaders.map((leader) => (
        <Card key={leader.id} className={leader.deletedAt ? "opacity-60" : ""}>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">{leader.displayName}</CardTitle>
              {leader.globalRole === "admin" && (
                <Badge variant="secondary">admin</Badge>
              )}
              {!leader.isActive && !leader.deletedAt && (
                <Badge variant="outline">disabled</Badge>
              )}
              {leader.deletedAt && <Badge variant="outline">deleted</Badge>}
            </div>
            <p className="text-muted-foreground text-sm break-all">
              {leader.email}
            </p>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm">
              <span className="text-muted-foreground">Last sign-in: </span>
              {formatDate(leader.lastSignIn)}
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">Courses: </span>
              {leader.courses.length > 0 ? (
                leader.courses.join(", ")
              ) : (
                <span className="text-muted-foreground">none yet</span>
              )}
            </p>
            <LeaderActions
              leader={{
                id: leader.id,
                email: leader.email,
                displayName: leader.displayName,
                isActive: leader.isActive,
                isDeleted: Boolean(leader.deletedAt),
                isAdmin: leader.globalRole === "admin",
              }}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
