#!/usr/bin/env node
// Study Hub — RLS test runner (spec M0 step 5; supabase/tests/rls).
// Requires local Supabase (Docker) locally, and `supabase/setup-cli` in CI.
// Test files are multi-statement SQL, executed with the pg driver's simple
// query protocol (the Supabase CLI's `db query` only allows one command).
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const SUPA = ["supabase"]; // via npx so it works with or without a global install

function run(args) {
  // join into one command string: spawnSync with shell:true and an args array
  // is deprecated (DEP0190) and the paths here never contain spaces
  const res = spawnSync([...SUPA, ...args].join(" "), {
    shell: true,
    encoding: "utf8",
    env: process.env,
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  return {
    ok: res.status === 0 && !/\bERROR\b/.test(out),
    out,
    status: res.status,
  };
}

// 1. local supabase must be up (env output also gives us the DB_URL)
const status = run(["status", "-o", "env"]);
if (!status.ok) {
  console.error(
    "Local Supabase is not running. Start it with `npm run supabase:start`\n" +
      "(requires Docker Desktop). CI runs these tests against its own instance.",
  );
  process.exit(1);
}

// 2. reset: apply all migrations + seed.sql on a clean database
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

// 4. run each test file in order; a failing assert throws and stops the run
const files = readdirSync(join("supabase", "tests", "rls"))
  .filter((f) => f.endsWith(".sql"))
  .sort();

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
