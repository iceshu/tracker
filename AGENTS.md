# AGENTS.md

## Cursor Cloud specific instructions

### Overview
`tc-tracker` is a browser-side web performance monitoring SDK (TypeScript, Rollup, Vitest). It captures JS errors, HTTP requests, performance metrics, user behavior, and Vue.js errors. There is no backend in this repo — the SDK sends data to an external endpoint.

### Node.js version
This project requires **Node.js 20** (not 22+). The `rollup.config.mjs` uses `import ... assert { type: "json" }` syntax which is removed in Node 22. Use `nvm use 20` before running any commands.

### Key commands (root SDK)
- `pnpm install --ignore-workspace` — install root deps (use `--ignore-workspace` to avoid errors from the Vue example's missing yalc link)
- `pnpm build` — production build via Rollup (outputs `dist/`)
- `pnpm dev` — watch mode (Rollup)
- `pnpm test` — Vitest (no test files exist at root; only in the Vue example)

### esbuild build scripts
After `pnpm install`, run `pnpm rebuild esbuild` to ensure esbuild's binary is available. pnpm 10 blocks build scripts by default and esbuild is needed by Vitest.

### Vue example app (`examples/vue/vue-project/`)
The Vue example depends on the SDK via `yalc`. To set it up:
1. Build the SDK: `pnpm build` (at root)
2. Publish locally: `yalc publish` (at root; requires `yalc` installed globally)
3. Link: `cd examples/vue/vue-project && yalc add tc-tracker`
4. Install: `pnpm install` then `pnpm rebuild esbuild vue-demi`
5. Dev server: `pnpm dev` (Vite on port 5173)
6. Lint: `pnpm lint` (ESLint)
7. Tests: `pnpm test:unit` (Vitest)

### Lint
There is no ESLint configuration at the root SDK level. Lint is only available in the Vue example (`examples/vue/vue-project/pnpm lint`).

### No backend required
The SDK sends data to a configurable `dns` endpoint (default `http://localhost:4001/log` in the Vue example). `ERR_CONNECTION_REFUSED` errors in the console are expected when no backend is running — the SDK still initializes and captures data.
