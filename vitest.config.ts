import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// The analysis/grade/club/library/trends logic is pure (no DOM), so a node
// environment is enough — and fast. The "@/..." alias mirrors tsconfig paths so
// tests import modules exactly the way the app does.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["lib/pose.ts", "lib/draw.ts", "lib/**/*.test.ts"],
    },
  },
});
