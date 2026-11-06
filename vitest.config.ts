import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: "forks",
    setupFiles: ["tests/setup-env.ts"],
    // Integration tests run ffmpeg/Chrome workloads; running files serially avoids CPU-contention timeouts.
    fileParallelism: false,
  },
});
