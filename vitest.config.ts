import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve("src"),
      // Unit tests run in Node, not a React Server Component environment, so
      // point the marker package at its empty entry. Next.js still enforces
      // server-only in the real build.
      "server-only": path.resolve("node_modules/server-only/empty.js"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.{ts,tsx}"],
  },
});
