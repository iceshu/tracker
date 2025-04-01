/// reference types=”vitest” />

import { defineConfig } from "vitest/config";
// import tsconfigPaths from 'vite-tsconfig-paths';

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
  },
});
