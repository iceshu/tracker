/// <reference types="vitest" />

import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  plugins: [],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "dist/",
        "examples/",
        "**/*.d.ts",
        "**/*.config.*",
        "watch.js",
      ],
    },
    include: ["src/**/*.{test,spec}.{js,ts}"],
    exclude: ["node_modules/", "dist/", "examples/"],
  },
});
