import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { checkRecentLogin } from "@/lib/admin-auth";
import { getSession } from "@/lib/dal";
import { SETTING_DEFS, writeSetting } from "@/lib/settings";
import { settingsUpdateSchema } from "@/lib/schemas";

const bodySchema = settingsUpdateSchema.extend({ password: z.string() });

/**
 * PUT /api/admin/settings (spec section 9, Settings row). Editing limits is
 * a sensitive action, so a login older than 10 minutes needs the admin's
 * password again (section 9 rule 1). Admins only; anyone else 404.
 */
export async function PUT(request: Request) {
  const session = await getSession();
  if (!session || session.profile.global_role !== "admin") {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Check the form." },
      { status: 400 },
    );
  }

  const login = await checkRecentLogin(parsed.data.password || undefined);
  if (!login.ok) {
    return Response.json(
      { error: "Please confirm your password.", needsPassword: true },
      { status: 401 },
    );
  }

  try {
    for (const def of SETTING_DEFS) {
      const value = (
        parsed.data as Record<string, string | number | undefined>
      )[def.key];
      if (value !== undefined) await writeSetting(def.key, value);
    }
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The settings could not be saved.",
      },
      { status: 500 },
    );
  }

  await writeAudit({
    actorId: session.userId,
    action: "settings.updated",
    entity: "settings",
    entityId: null,
    meta: { keys: SETTING_DEFS.map((d) => d.key) },
  });

  return Response.json({ ok: true });
}
