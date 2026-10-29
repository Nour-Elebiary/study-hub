#!/usr/bin/env node
// Study Hub — RLS test runner (spec M0 step 5; supabase/tests/rls).
// Requires local Supabase (Docker) locally, and `supabase/setup-cli` in CI.
// Test files are multi-statement SQL, executed with the pg driver's simple
// query protocol (the Supabase CLI's `db query` only allows one command).
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

// A CI failure with no output is undiagnosable, so nothing may exit without
// printing: these handlers are the last line of defence (Node prints
// uncaught errors itself, but an explicit handler guarantees it).
process.on("uncaughtException", (err) => {
  console.error(`UNCAUGHT EXCEPTION\n${err?.stack ?? err}`);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error(`UNHANDLED REJECTION\n${err?.stack ?? err}`);
  process.exit(1);
});

function run(args) {
  // Direct argv, no shell: no quoting/DEP0190 concerns, and spawn failures
  // come back as res.error instead of a shell's exit code.
  const res = spawnSync("supabase", args, {
    encoding: "utf8",
    env: process.env,
    // db reset prints migrations + the full startup banner; keep headroom.
    maxBuffer: 16 * 1024 * 1024,
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  if (res.error) {
    // The child never ran (ENOENT) or was killed (ENOMEM, signal, …).
    console.error(
      `spawn "supabase ${args.join(" ")}" failed: ${res.error}` +
        ` (status: ${res.status}, signal: ${res.signal})`,
    );
  }
  return {
    ok: res.error == null && res.status === 0 && !/\bERROR\b/.test(out),
    out,
    status: res.status,
  };
}

// 1. local supabase must be up (env output also gives us the DB_URL)
console.log("checking local supabase status…");
const status = run(["status", "-o", "env"]);
if (!status.ok) {
  console.error(
    "Local Supabase is not running. Start it with `npm run supabase:start`\n" +
      "(requires Docker Desktop). CI runs these tests against its own instance.",
  );
  if (status.out.trim()) console.error(status.out.trimEnd());
  process.exit(1);
}

// 2. reset: apply all migrations + seed.sql on a clean database
console.log("resetting the database (migrations + seed)…");
const reset = run(["db", "reset"]);
if (!reset.ok) {
  console.error(`db reset failed\n${reset.out}`);
  process.exit(1);
}
console.log("migrations + seed applied");

// 3. connect as the local postgres superuser (the tests set role claims and
// assert on RLS behaviour, which needs to bypass RLS itself)
const fromStatus = status.out.match(/^DB_URL=(.*)$/m)?.[1]?.replaceAll('"', "");
const connectionString =
  fromStatus || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const client = new pg.Client({ connectionString });
await client.connect();
console.log("connected as the postgres superuser");

// 4. run each test file in order; a failing assert throws and stops the run
const files = readdirSync(join("supabase", "tests", "rls"))
  .filter((f) => f.endsWith(".sql"))
  .sort();
console.log(`running ${files.length} RLS test files`);

try {
  for (const file of files) {
    const sql = readFileSync(join("supabase", "tests", "rls", file), "utf8");
    try {
      await client.query(sql);
    } catch (err) {
      console.error(`FAIL ${file}\n${err.message}`);
      // Postgres reports the failing statement's position inside the
      // multi-statement file; print everything that narrows the line down.
      if (err.position) console.error(`statement position: ${err.position}`);
      if (err.where) console.error(`context: ${err.where}`);
      if (err.detail) console.error(`detail: ${err.detail}`);
      if (err.hint) console.error(`hint: ${err.hint}`);
      process.exit(1);
    }
    console.log(`PASS ${file}`);
  }
} finally {
  await client.end();
}

console.log(`\nall ${files.length} RLS test files passed`);
