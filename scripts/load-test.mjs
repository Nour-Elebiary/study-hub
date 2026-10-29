#!/usr/bin/env node
/**
 * Load test (spec section 13, M8: "20 concurrent users work without errors").
 *
 * Usage:
 *   node scripts/load-test.mjs
 *
 * Environment:
 *   APP_URL              default http://127.0.0.1:3000
 *   JOIN_COOKIE_SECRET   signs the student cookie (same secret as the app)
 *   LOAD_NOTE_ID         a note id to read; defaults to the seed note
 *   LOAD_USERS           default 20, LOAD_ROUNDS default 10
 *
 * Twenty virtual users walk the same paths a real session walks: the
 * landing page, the join page, the student home and a note page. Every
 * response must be 2xx; the script prints latency percentiles and exits
 * non-zero on any error, so CI fails loudly.
 */

import { createHmac } from "node:crypto";

const APP_URL = (process.env.APP_URL ?? "http://127.0.0.1:3000").replace(
  /\/+$/,
  "",
);
const USERS = Number(process.env.LOAD_USERS ?? 20);
const ROUNDS = Number(process.env.LOAD_ROUNDS ?? 10);
const NOTE_ID =
  process.env.LOAD_NOTE_ID ?? "eeeeeeee-0000-eeee-0000-000000000003";

const secret = process.env.JOIN_COOKIE_SECRET;
if (!secret) {
  console.error("Set JOIN_COOKIE_SECRET (the same value the app uses).");
  process.exit(1);
}

/** The signed 90-day student cookie, minted the same way the join flow does. */
function studentCookie() {
  const body = Buffer.from(
    JSON.stringify({ v: 1, iat: Date.now(), scope: { all: true } }),
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `sh_student=${body}.${sig}`;
}

/** One warm-up request so the first measured round does not pay cold-start. */
async function warmUp() {
  const res = await fetch(`${APP_URL}/api/health`);
  if (!res.ok) {
    console.error(
      `The app is not reachable at ${APP_URL} (health returned ${res.status}).`,
    );
    process.exit(1);
  }
}

const latencies = [];
let errors = 0;
let requests = 0;

async function get(path, { cookie } = {}) {
  const started = performance.now();
  try {
    const res = await fetch(`${APP_URL}${path}`, {
      headers: cookie ? { cookie } : {},
      redirect: "manual",
    });
    const ms = performance.now() - started;
    requests++;
    latencies.push(ms);
    // 3xx from the student pages is fine (redirect to /s after joining),
    // anything 4xx/5xx is an error for this test's purposes.
    if (res.status >= 400) {
      errors++;
      console.error(`  ${res.status} on GET ${path}`);
    }
  } catch (error) {
    requests++;
    errors++;
    console.error(`  network error on GET ${path}: ${error.message}`);
  }
}

async function user() {
  const cookie = studentCookie();
  for (let round = 0; round < ROUNDS; round++) {
    await get("/");
    await get("/s/join");
    await get("/s", { cookie });
    await get(`/s/notes/${NOTE_ID}`, { cookie });
  }
}

function percentile(list, p) {
  const sorted = [...list].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[index];
}

await warmUp();
console.log(
  `Load test: ${USERS} concurrent users x ${ROUNDS} rounds x 4 pages against ${APP_URL}`,
);
const startedAt = performance.now();
await Promise.all(Array.from({ length: USERS }, () => user()));
const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);

console.log(
  `Requests: ${requests} in ${seconds}s (${(requests / seconds).toFixed(1)} req/s)`,
);
console.log(
  `Latency ms: p50=${percentile(latencies, 50).toFixed(0)}` +
    ` p95=${percentile(latencies, 95).toFixed(0)}` +
    ` max=${percentile(latencies, 100).toFixed(0)}`,
);
console.log(`Errors: ${errors}`);

if (errors > 0) {
  console.error("FAILED: some requests returned errors.");
  process.exit(1);
}
console.log("PASSED: every request succeeded.");
