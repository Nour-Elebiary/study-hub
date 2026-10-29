import "server-only";
import JSZip from "jszip";
import { createAdminClient } from "@/lib/supabase/admin";
import { slugify } from "@/lib/slug";

export type ExportResult = {
  bytes: Uint8Array;
  filename: string;
  counts: Record<string, number>;
};

/**
 * The content tables saved as JSON, one file each (spec section 11 rule 2:
 * "all content tables"). Deliberately excluded: ai_keys (holds ciphertext),
 * join_codes (holds hashes), audit_log, locks, rate_limits, jobs,
 * worker_heartbeats and ai_usage (operational data, not content), and
 * ai_conversations/ai_messages (chat transcripts stay out of backups).
 * The full list is documented in docs/restore.md.
 */
const CONTENT_TABLES = [
  "courses",
  "course_members",
  "profiles",
  "nodes",
  "node_versions",
  "tags",
  "node_tags",
  "comments",
  "assets",
  "suggestions",
  "settings",
  "ai_limits",
] as const;

type NodeRow = {
  id: string;
  course_id: string;
  area: string;
  kind: string;
  title: string;
  status: string;
  draft_body_md: string;
  published_version_id: string | null;
  updated_at: string | null;
};

type VersionRow = {
  id: string;
  node_id: string;
  version_no: number;
  body_md: string;
};

type CourseRow = { id: string; code: string; title: string };

/**
 * The body to export for a note: the published version when there is one,
 * otherwise the newest version, otherwise the current draft. Drafts are
 * exported too (marked in the frontmatter) — a backup must not lose work.
 */
export function pickNoteBody(
  node: Pick<NodeRow, "draft_body_md" | "published_version_id">,
  versions: VersionRow[],
): { body: string; source: "published" | "version" | "draft" } {
  if (node.published_version_id) {
    const published = versions.find((v) => v.id === node.published_version_id);
    if (published) return { body: published.body_md, source: "published" };
  }
  const newest = [...versions].sort((a, b) => b.version_no - a.version_no)[0];
  if (newest) return { body: newest.body_md, source: "version" };
  return { body: node.draft_body_md, source: "draft" };
}

/** Obsidian-style YAML frontmatter so the files open cleanly in Obsidian. */
export function noteFrontmatter(fields: {
  title: string;
  course: string;
  area: string;
  kind: string;
  status: string;
  source: string;
  updatedAt: string | null;
}): string {
  const lines = [
    "---",
    `title: ${JSON.stringify(fields.title)}`,
    `course: ${JSON.stringify(fields.course)}`,
    `area: ${fields.area}`,
    `kind: ${fields.kind}`,
    `status: ${fields.status}`,
    `body_source: ${fields.source}`,
    `updated: ${fields.updatedAt ?? "unknown"}`,
    "---",
    "",
  ];
  return lines.join("\n");
}

/** A file name that is safe on Windows, macOS and Linux. */
export function noteFileName(title: string, nodeId: string): string {
  return `${slugify(title) || "note"}-${nodeId.slice(0, 8)}.md`;
}

/**
 * Builds the export ZIP (spec section 11 rule 2): content tables as JSON,
 * an Obsidian-compatible Markdown folder, and the list of Drive and web
 * links. Runs with the service role — this is a server-side backup, not a
 * user-facing read, so RLS grants do not apply.
 */
export async function buildExport(): Promise<ExportResult> {
  const admin = createAdminClient();
  const counts: Record<string, number> = {};

  // One fetch per table, reused for both the JSON files and the Markdown.
  const tables = new Map<string, Record<string, unknown>[]>();
  for (const table of CONTENT_TABLES) {
    let query = admin.from(table).select("*");
    // Soft-deleted nodes keep their 30-day retention window (spec rule 5);
    // a backup includes them so a restore can finish that window.
    if (table === "nodes") query = query.is("deleted_at", null);
    const { data, error } = await query;
    if (error) {
      throw new Error(`Export failed reading ${table}: ${error.message}`);
    }
    const rows = data ?? [];
    tables.set(table, rows);
    counts[table] = rows.length;
  }

  const zip = new JSZip();
  for (const [table, rows] of tables) {
    zip.file(`json/${table}.json`, JSON.stringify(rows, null, 2));
  }

  // Obsidian-compatible Markdown: one file per note, in a folder per course.
  const nodes = tables.get("nodes") as unknown as NodeRow[];
  const versions = tables.get("node_versions") as unknown as VersionRow[];
  const courses = tables.get("courses") as unknown as CourseRow[];

  const versionsByNode = new Map<string, VersionRow[]>();
  for (const v of versions) {
    const list = versionsByNode.get(v.node_id) ?? [];
    list.push(v);
    versionsByNode.set(v.node_id, list);
  }
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const folderByCourse = new Map<string, string>(
    courses.map((c) => [c.id, c.code || slugify(c.title)]),
  );

  const markdownRoot = zip.folder("markdown");
  if (!markdownRoot) {
    throw new Error("Could not create the markdown folder in the ZIP");
  }
  let markdownCount = 0;
  for (const node of nodes) {
    const { body, source } = pickNoteBody(
      node,
      versionsByNode.get(node.id) ?? [],
    );
    if (!body.trim()) continue;
    const course = courseById.get(node.course_id);
    const folder = folderByCourse.get(node.course_id) ?? "unknown-course";
    const frontmatter = noteFrontmatter({
      title: node.title,
      course: course ? `${course.code} — ${course.title}` : "Unknown course",
      area: node.area,
      kind: node.kind,
      status: node.status,
      source,
      updatedAt: node.updated_at,
    });
    const courseFolder = markdownRoot.folder(folder);
    if (!courseFolder) {
      throw new Error("Could not create a course folder in the ZIP");
    }
    courseFolder.file(noteFileName(node.title, node.id), frontmatter + body);
    markdownCount++;
  }
  counts["markdown_files"] = markdownCount;

  // The list of Drive and web links (spec section 11 rule 2): these point
  // outside the app, so a backup cannot contain their contents — only the
  // addresses, so the school can re-check them after a restore.
  const allAssets = tables.get("assets") as unknown as Array<{
    title: string;
    path_or_url: string;
    storage: string;
    course_id: string | null;
  }>;
  const linkAssets = allAssets.filter((a) =>
    ["drive", "link"].includes(a.storage),
  );
  const linkLines = [
    "# External links in this backup",
    "",
    "These files live outside Study Hub (Google Drive or the web).",
    "They are not inside the ZIP — check each link still works after a restore.",
    "",
    ...linkAssets.map((a) => {
      const course = a.course_id ? courseById.get(a.course_id) : undefined;
      return `- [${a.title || "Untitled"}](${a.path_or_url}) — ${
        a.storage === "drive" ? "Google Drive" : "web link"
      }${course ? ` — ${course.code}` : ""}`;
    }),
  ];
  zip.file("links.md", linkLines.join("\n"));
  counts["external_links"] = linkAssets.length;

  const generatedAt = new Date().toISOString();
  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        generated_at: generatedAt,
        format: "study-hub-export/1",
        counts,
        excluded:
          "ai_keys (secret material), join_codes (hashes), audit_log, locks, rate_limits, jobs, worker_heartbeats, ai_usage, ai_conversations, ai_messages",
      },
      null,
      2,
    ),
  );

  const bytes = await zip.generateAsync({ type: "uint8array" });
  const stamp = generatedAt.slice(0, 16).replace(/[-:T]/g, "");
  return {
    bytes,
    filename: `study-hub-export-${stamp}.zip`,
    counts,
  };
}

/** Records the export time for the Backups screen (spec section 9). */
export async function recordExportTime(): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("settings")
    .upsert({ key: "last_export_at", value: new Date().toISOString() });
  if (error) {
    throw new Error(`Could not record the export time: ${error.message}`);
  }
}
