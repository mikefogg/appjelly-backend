import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/helpers/setup.js"],
    testTimeout: 10000,
    hookTimeout: 10000,
    globals: true,
    clearMocks: true,
    restoreMocks: true,
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true, // Run tests sequentially to avoid database deadlocks
      },
    },
  },
  resolve: {
    alias: {
      "#src": new URL("./src", import.meta.url).pathname,
      "#root": new URL(".", import.meta.url).pathname,
    },
  },
});