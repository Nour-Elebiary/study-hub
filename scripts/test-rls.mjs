#!/usr/bin/env node
// Study Hub — RLS test runner (spec M0 step 5; supabase/tests/rls).
// Requires local Supabase (Docker) locally, and `supabase/setup-cli` in CI.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const SUPA = ["supabase"]; // via npx so it works with or without a global install

function run(args) {
  const res = spawnSync("npx", [...SUPA, ...args], {
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

// 1. local supabase must be up
const status = run(["status"]);
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

// 3. run each test file; a failing assert makes db execute exit non-zero
const files = readdirSync(join("supabase", "tests", "rls"))
  .filter((f) => f.endsWith(".sql"))
  .sort();

for (const file of files) {
  const res = run([
    "db",
    "execute",
    "--file",
    join("supabase", "tests", "rls", file),
  ]);
  if (!res.ok) {
    console.error(`FAIL ${file}\n${res.out}`);
    process.exit(1);
  }
  console.log(`PASS ${file}`);
}

console.log(`\nall ${files.length} RLS test files passed`);
