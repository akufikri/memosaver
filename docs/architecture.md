# MemoSaver Architecture

`src/` layout with a strict layering: MCP adapter → application service → domain modules → repository → SQLite.

## Layers

```
AI agent (Claude Code / OpenCode)
         │ MCP (stdio)
         ▼
src/mcp/          Adapter. Defines tools + zod input schemas, converts service
                  values to MCP results. No SQL here.
                  ├─ server.ts   StdioServerTransport
                  ├─ tools.ts    registerTools(): inbound validation
                  └─ tool-result.ts  ok/error result wrapping (graceful failures)

src/service/     MemoSaverService. Business orchestration. Used by MCP and CLI.
                  startSession / endSession / createCheckpoint / buildResumeContext
                  / listMemories / search / recall ...

src/project/     ProjectDetector (realpath → sha256 id) + ProjectManager
src/memory/      MemoryEngine (save/capture pipeline + buffer),
                  extractor.ts (rule-based, LLM behind same interface),
                  classifier.ts, scorer.ts, retriever.ts (FTS5 facade)
src/context/     ContextBuilder — resume sections, token budget trimming
src/storage/     Database (node:sqlite + transactions), migrations, repositories
src/util/        config, logger (stderr + file, redaction), errors, ids
src/web/         Memory-graph diagram server: archify-spec.ts (SQLite → Archify
                  specification), archify-render.ts (spawns the vendored renderer in
                  vendor/archify, retries with a reduced spec, never serves a broken page)
src/cli/         commander commands; product / debugging surface
```

## Key decisions

- **`node:sqlite`** (built-in) instead of better-sqlite3 → zero native builds, cross-platform.
- **No ORM.** Thin prepared-statement repositories; business logic stays out of SQL.
- **Deterministic ids**: `project.id = sha256(realpath)`, so reopening the same folder via a symlink or `..` resolves to the same project.
- **FTS5 external content** with triggers; search uses `bm25()`.
- **Stdout is protocol**: all logging goes to stderr and the append-only log file so MCP JSON-RPC is clean.
- **Graceful failure**: every MCP call is wrapped; domain errors return `isError` results, never crash the agent process.

## Failure handling

- SQLite failures → `DatabaseError`, surface only if the agent needs the info
- Corrupt/empty memories → skipped
- LLM/extractor failures → the pipeline falls back to the rule-based extractor and never
  throws into the agent session; buffer flush failures are logged, not swallowed
- Unexpected process exit → previous session auto-`interrupted` on next start

## Storage

`~/.memosaver/memosaver.db` (WAL). See `docs/memory.md` and `impl status`.  Migration for the schema:
`src/storage/migrations.ts`.