import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // The live suites share one Supabase project and clean up by email prefix; run files
  // serially so they never delete each other's test users mid-run.
  test: { fileParallelism: false },
  resolve: {
    alias: {
      // Mirror tsconfig "@/*" so tests can import app modules.
      "@": root,
      // The `server-only` guard throws outside a server bundle; stub it for node tests.
      "server-only": path.join(root, "tests/stubs/server-only.js"),
    },
  },
});
