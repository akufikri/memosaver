# MemoSaver Development

## Stack

- Node.js **>= 22.5** (built-in `node:sqlite`)
- TypeScript strict + ESM + `NodeNext`
- `vitest` for tests
- `@modelcontextprotocol/sdk`
- `commander` CLI, `zod` schemas

## Scripts

```bash
pnpm typecheck       # tsc --noEmit
pnpm lint            # eslint src tests (recommended rules; warns on explicit any)
pnpm test            # vitest run (64 tests)
pnpm test:watch      # vitest in watch mode
pnpm acceptance      # scripts/acceptance.mjs: real stdio MCP resume across two sessions
pnpm build           # tsc → dist/, then copy src/web assets into dist/web
pnpm dev             # tsx src/cli/index.ts
```

Watches:

```bash
pnpm test:watch
pnpm build           # iterate
```

## Layout

- `src/service/` — the only orchestrator import chain shared by MCP + CLI
- `src/mcp/` — protocol adapter; must stay dependency-light
- `src/memory/extractor.ts` — `RuleBasedExtractor`. The LLM extractor plugs in behind the
  same `MemoryExtractor` interface via `composeExtractor()` in `src/memory/llm-extractor.ts`
- `scripts/acceptance.mjs` — spawns the real `dist/mcp/entry.js` over stdio and drives 12
  checks (session lifecycle, resume, search, timeline, export/import). Each run uses a fresh
  temp home; set `MEMOSAVER_ACCEPT_HOME` to reuse one instead.

## Project conventions

- Strict types everywhere; no `any` (eslint warns on explicit `any`)
- Never mutate imports; snapshot-consistent repo patterns for tests
- Errors from `src/util/errors.ts` are the only throwables at the domain boundary
- Keep stdout/piping clean for MCP: logging → `src/util/logger.ts` (writes to stderr)

## Vendored Archify renderer

`memosaver visual` serves an Archify architecture diagram. The renderer is vendored at
`vendor/archify/` (MIT, upstream `tt-a1i/archify`, trimmed file list and update procedure in
`vendor/archify/VENDOR.md`) and copied to `dist/web/vendor/archify/` by
`scripts/copy-web-assets.mjs` during `pnpm build`.

- Renderer entry: `vendor/archify/bin/archify.mjs`, invoked as a subprocess
  (`render architecture <spec.json> <out.html>`). It validates its own layout and exits non-zero
  on a rejected specification.
- `src/web/archify-spec.ts` builds the specification from SQLite: grid cells, explicit
  relationship sides and waypoints through the empty bands, and computed label positions.
  Layout rules matter — an edge crossing an unrelated node or a sublabel wider than its cell is
  a hard renderer error.
- Readability is a layout constraint, not a viewer setting: the workspace overview wraps
  projects into a compact grid (6 columns) instead of one long row, because the viewer fits the
  whole diagram to the window — 11 nodes in a single row shrank every label to ~3px.
- `src/web/archify-render.ts` retries with a reduced specification (labels dropped, then
  relationships dropped) and reports which variant rendered, so a degradation is never silent.
- Never edit files under `vendor/archify/` by hand: re-copy from the upstream skill, then run
  the render smoke command in `VENDOR.md`.

## Database changes

- Migrations in `src/storage/migrations.ts` — append, don't edit existing
- Always `transactions` around multi-statement writes
- Use prepared statements; no string interpolation in SQL

## Docs parity

When you change one of the docs below, check the matching implementation:

| doc | implementation |
| --- | --- |
| `docs/mcp.md` | `src/mcp/` |
| `docs/memory.md` | `src/memory/` |
| `docs/sessions.md` | `src/service/`, `src/context/` |
| `docs/architecture.md` | whole `src/` |

## Gotchas

- Don't import `node:sqlite` inside `src/mcp/entry.ts` at top level of the bundle — use
  `createRequire`. Keeps SSR/vite bundlers from choking, and the module separation clear.
- Without `dangerouslyAllowAllBuilds` in `pnpm-workspace.yaml`, pnpm 10+ blocks native
  build steps (esbuild etc.).