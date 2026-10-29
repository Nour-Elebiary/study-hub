import { verifyBackupToken } from "@/lib/backup-auth";
import { getSession } from "@/lib/dal";
import { buildExport, recordExportTime } from "@/lib/export";
import { writeAudit } from "@/lib/audit";

/**
 * POST /api/admin/export (spec section 11 rule 2). Two callers:
 * - the weekly GitHub Actions backup job, authenticated with the backup
 *   token (Bearer, hash-compared against BACKUP_TOKEN_HASH);
 * - an admin pressing "Download now" on the Backups screen, authenticated
 *   by their session. Anyone else gets 404.
 * The response is the export ZIP as an attachment; nothing user-facing is
 * returned in errors (and no key material ever leaves the database).
 */
export async function POST(request: Request) {
  const machine = verifyBackupToken(request.headers.get("authorization"));
  let actorId: string | null = null;

  if (!machine) {
    const session = await getSession();
    if (!session || session.profile.global_role !== "admin") {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    actorId = session.userId;
  }

  try {
    const result = await buildExport();
    await recordExportTime();

    if (actorId) {
      await writeAudit({
        actorId,
        action: "export.download",
        entity: "settings",
        entityId: null,
        meta: { counts: result.counts },
      });
    }
    // Machine exports are not audited here: there is no user to attribute,
    // and the workflow run log records them already.

    return new Response(new Uint8Array(result.bytes), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(
      "export failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return Response.json({ error: "export failed" }, { status: 500 });
  }
}
