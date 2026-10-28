// Copies the pdf.js worker into public/ so the browser can load it at
// /pdf.worker.min.mjs (pdf.js needs its worker next to the site).
// Runs before dev and build (see package.json scripts).
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(
  root,
  "node_modules",
  "pdfjs-dist",
  "build",
  "pdf.worker.min.mjs",
);
const targetDir = join(root, "public");
const target = join(targetDir, "pdf.worker.min.mjs");

if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);
console.log("Copied pdf.worker.min.mjs to public/");
