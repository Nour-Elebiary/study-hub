#!/usr/bin/env node
/**
 * Restore drill (spec section 11 rule 4): load a Study Hub export into a
 * fresh, empty Supabase project and confirm the app works.
 *
 * Usage:
 *   node scripts/restore.mjs <export.zip | exported-json-folder>
 *
 * Required environment variables (the TARGET project, not the old one):
 *   RESTORE_SUPABASE_URL          e.g. https://xxxx.supabase.co
 *   RESTORE_SERVICE_ROLE_KEY      the new project's service_role key
 *
 * What it does, in order:
 *   1. Refuses to run unless the target project is empty (safety).
 *   2. Recreates every leader as an auth user (random password, no email
 *      sent) and remaps their ids — auth users cannot keep their old ids.
 *   3. Inserts the content tables in dependency order, keeping the original
 *      note/course ids, and rewires the published-version pointers.
 *   4. Prints a per-table count so a human can compare with manifest.json.
 *
 * Not restored (by design, see docs/restore.md): passwords, AI keys,
 * join codes, Supabase Storage file contents, audit history, AI chats.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import JSZip from "jszip";

const TABLES = [
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
];

const url = process.env.RESTORE_SUPABASE_URL;
const key = process.env.RESTORE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "Set RESTORE_SUPABASE_URL and RESTORE_SERVICE_ROLE_KEY for the NEW project first.",
  );
  process.exit(1);
}

const input = process.argv[2];
if (!input || !existsSync(input)) {
  console.error("Give the path to an export ZIP (or its extracted folder).");
  process.exit(1);
}

const restHeaders = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

async function restInsert(table, rows) {
  if (!rows.length) return 0;
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...restHeaders, Prefer: "return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    throw new Error(
      `Insert into ${table} failed: ${res.status} ${await res.text()}`,
    );
  }
  return rows.length;
}

async function restUpdate(table, column, value, matches) {
  // Small targeted updates (published_version_id, comment parents).
  const params = new URLSearchParams();
  for (const [col, id] of matches) params.set(col, `eq.${id}`);
  const res = await fetch(`${url}/rest/v1/${table}?${params.toString()}`, {
    method: "PATCH",
    headers: { ...restHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ [column]: value }),
  });
  if (!res.ok) {
    throw new Error(
      `Update on ${table} failed: ${res.status} ${await res.text()}`,
    );
  }
}

async function readTables(input) {
  if (statSync(input).isDirectory()) {
    const tables = new Map();
    for (const file of readdirSync(input)) {
      const match = file.match(/^(.+)\.json$/);
      if (match && TABLES.includes(match[1])) {
        tables.set(
          match[1],
          JSON.parse(readFileSync(`${input}/${file}`, "utf8")),
        );
      }
    }
    return tables;
  }
  const zip = await JSZip.loadAsync(readFileSync(input));
  const tables = new Map();
  for (const name of Object.keys(zip.files)) {
    const match = name.match(/^json\/(.+)\.json$/);
    if (match && TABLES.includes(match[1])) {
      tables.set(match[1], JSON.parse(await zip.files[name].async("string")));
    }
  }
  return tables;
}

async function main() {
  const tables = await readTables(input);
  const missing = TABLES.filter((t) => !tables.has(t));
  if (missing.length) {
    console.error(`The export is missing: ${missing.join(", ")}. Aborting.`);
    process.exit(1);
  }

  // 1. Safety: only restore into an empty project.
  const probe = await fetch(`${url}/rest/v1/courses?select=id&limit=1`, {
    headers: restHeaders,
  });
  const existing = await probe.json();
  if (probe.ok && existing.length > 0) {
    console.error(
      "The target project already has courses. Refusing to restore over them.",
    );
    process.exit(1);
  }

  const counts = {};

  // 2. Recreate auth users and build the old-profile-id -> new-user-id map.
  const profiles = tables.get("profiles");
  const userIdMap = new Map();
  for (const [i, profile] of profiles.entries()) {
    const res = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: restHeaders,
      body: JSON.stringify({
        email: `restored-${i + 1}@restore.local`,
        password: randomBytes(24).toString("base64url") + "Aa1!",
        email_confirm: true,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `Could not create user ${i + 1}: ${res.status} ${await res.text()}`,
      );
    }
    const body = await res.json();
    const newId = body.user?.id ?? body.id;
    userIdMap.set(profile.id, newId);
    counts["auth_users"] = (counts["auth_users"] ?? 0) + 1;
  }
  const remapUser = (oldId) => (oldId && userIdMap.get(oldId)) || null;

  // 3. Content tables in dependency order.
  const newProfiles = profiles.map((p) => ({
    id: userIdMap.get(p.id),
    display_name: p.display_name,
    global_role: p.global_role,
    is_active: p.is_active,
    must_change_password: true, // old passwords are not in the export
    created_by: remapUser(p.created_by),
  }));
  counts["profiles"] = await restInsert("profiles", newProfiles);

  const courses = tables.get("courses");
  counts["courses"] = await restInsert(
    "courses",
    courses.map((c) => ({ ...c, created_by: remapUser(c.created_by) })),
  );

  const courseMembers = tables.get("course_members");
  counts["course_members"] = await restInsert(
    "course_members",
    courseMembers.map((m) => ({ ...m, user_id: remapUser(m.user_id) })),
  );

  // Nodes: parents before children, published pointer filled in later.
  const nodes = tables.get("nodes");
  const byParent = new Map();
  for (const node of nodes) {
    const list = byParent.get(node.parent_id) ?? [];
    list.push(node);
    byParent.set(node.parent_id, list);
  }
  const orderedNodes = [];
  const queue = [...(byParent.get(null) ?? [])];
  while (queue.length) {
    const node = queue.shift();
    orderedNodes.push(node);
    queue.push(...(byParent.get(node.id) ?? []));
  }
  if (orderedNodes.length !== nodes.length) {
    throw new Error(
      "Node tree is broken (a parent is missing from the export).",
    );
  }
  counts["nodes"] = await restInsert(
    "nodes",
    orderedNodes.map((n) => ({
      ...n,
      parent_id: n.parent_id, // parents already inserted by the ordering above
      assigned_to: remapUser(n.assigned_to),
      created_by: remapUser(n.created_by),
      published_version_id: null,
    })),
  );

  const versions = tables.get("node_versions");
  counts["node_versions"] = await restInsert(
    "node_versions",
    versions.map((v) => ({ ...v, author_id: remapUser(v.author_id) })),
  );

  // Rewire published pointers (only where the version came along).
  for (const node of nodes) {
    if (!node.published_version_id) continue;
    const stillThere = versions.some((v) => v.id === node.published_version_id);
    if (stillThere) {
      await restUpdate(
        "nodes",
        "published_version_id",
        node.published_version_id,
        [["id", node.id]],
      );
    }
  }

  counts["tags"] = await restInsert("tags", tables.get("tags"));
  counts["node_tags"] = await restInsert("node_tags", tables.get("node_tags"));

  // Comments: insert flat, then restore the thread links.
  const comments = tables.get("comments");
  counts["comments"] = await restInsert(
    "comments",
    comments.map((c) => ({
      ...c,
      parent_id: null,
      author_id: remapUser(c.author_id),
    })),
  );
  for (const c of comments) {
    if (c.parent_id) {
      await restUpdate("comments", "parent_id", c.parent_id, [["id", c.id]]);
    }
  }

  counts["assets"] = await restInsert(
    "assets",
    tables
      .get("assets")
      .map((a) => ({ ...a, created_by: remapUser(a.created_by) })),
  );

  counts["suggestions"] = await restInsert(
    "suggestions",
    tables
      .get("suggestions")
      .map((s) => ({ ...s, resolved_by: remapUser(s.resolved_by) })),
  );

  counts["settings"] = await restInsert("settings", tables.get("settings"));

  // ai_limits has defaults seeded by the migrations; upsert over them.
  const limits = tables.get("ai_limits");
  if (limits.length) {
    const res = await fetch(
      `${url}/rest/v1/ai_limits?on_conflict=provider,model`,
      {
        method: "POST",
        headers: {
          ...restHeaders,
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(limits),
      },
    );
    if (!res.ok) {
      throw new Error(
        `Insert into ai_limits failed: ${res.status} ${await res.text()}`,
      );
    }
    counts["ai_limits"] = limits.length;
  }

  console.log("Restore finished. Row counts:");
  for (const [table, count] of Object.entries(counts)) {
    console.log(`  ${table}: ${count}`);
  }
  console.log(
    "\nNext steps: every leader signs in with a password the admin resets" +
      " from the Leaders screen, and file uploads must be re-uploaded by hand" +
      " (the export holds their metadata and OCR text, not the files).",
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
