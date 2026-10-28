/**
 * Asserts a Lighthouse JSON report's performance score meets the minimum
 * (spec section 10 rule 5: mobile performance of at least 90 on the student
 * Home and Note pages).
 * Usage: node scripts/check-lighthouse.mjs <report.json> <min-score-0-100>
 * Exits 0 when the score meets the minimum, 1 when it does not.
 */
import { readFileSync } from "node:fs";

const [file, minArg] = process.argv.slice(2);
if (!file || !minArg) {
  console.error("usage: node scripts/check-lighthouse.mjs <report.json> <min>");
  process.exit(2);
}

const min = Number(minArg);
const report = JSON.parse(readFileSync(file, "utf8"));
const score = report.categories?.performance?.score;
if (typeof score !== "number") {
  console.error(`No performance score found in ${file}.`);
  process.exit(1);
}

const percent = Math.round(score * 100);
console.log(`Lighthouse performance: ${percent}/100 (minimum ${min})`);
if (percent < min) process.exit(1);
