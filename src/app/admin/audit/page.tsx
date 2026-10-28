import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireAdmin } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Audit log" };

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Audit log (spec section 9): who did what and when. Written by the server
 * only; admins read it here. Course-owner filtering arrives with content in
 * M2 (there is nothing course-scoped to show yet).
 */
export default async function AdminAuditPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data: entries } = await supabase
    .from("audit_log")
    .select("id, actor_id, action, entity, entity_id, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name");
  const nameByUser = new Map(
    (profiles ?? []).map((p) => [p.id, p.display_name]),
  );

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-bold">Audit log</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          The last 100 actions, newest first. Every admin action is recorded
          here automatically.
        </p>
      </div>

      <Card className="hidden md:block">
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>On</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(entries ?? []).map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatWhen(entry.created_at)}
                  </TableCell>
                  <TableCell>
                    {nameByUser.get(entry.actor_id ?? "") ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{entry.action}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {entry.entity}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Mobile-first stacked list */}
      <div className="grid gap-2 md:hidden">
        {(entries ?? []).map((entry) => (
          <Card key={entry.id}>
            <CardContent className="grid gap-1 pt-4 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{entry.action}</Badge>
                <span className="text-muted-foreground text-xs">
                  {formatWhen(entry.created_at)}
                </span>
              </div>
              <p>
                <span className="text-muted-foreground">Who: </span>
                {nameByUser.get(entry.actor_id ?? "") ?? "—"}
              </p>
              <p className="text-muted-foreground text-xs">{entry.entity}</p>
            </CardContent>
          </Card>
        ))}
        {(entries ?? []).length === 0 && (
          <p className="text-muted-foreground text-sm">No entries yet.</p>
        )}
      </div>
    </div>
  );
}
