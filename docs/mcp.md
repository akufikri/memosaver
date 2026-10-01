# MemoSaver MCP Interface

MemoSaver speaks the Model Context Protocol over stdio. The server binary is `memosaver-mcp` (or `node dist/mcp/entry.js`).

## Transport & logging

- Transport: stdio (one server per client).
- **stdout is reserved for JSON-RPC** — all diagnostics go to stderr and the log file (`~/.memosaver/logs/memosaver.log`).
- Every tool returns a structured result; failures are reported via the MCP error channel rather than crashing the agent.

## Lifecycle tools

| Tool | Arguments | Returns |
| --- | --- | --- |
| `session_start` | `project_path` (req), `agent` (req), `resume?` | `{ project, created_project, session, resume }` — `resume_available: false` when `resume: false` |
| `session_checkpoint` | `session_id` (req), `goal?`, `current_task?`, `summary?`, `completed?`, `pending?`, `blockers?`, `next_action?`, `current_state?` | checkpoint |
| `session_end` | `session_id` (req), `status?` (`completed` \| `interrupted`), `summary?` | session, or `{ ok: false, error }` when the id is unknown |
| `session_status` | `session_id?`, `project_id?`, `project_path?` | one session, or the project's sessions, or all sessions |
| `session_timeline` | `session_id` (req) | `{ session, checkpoints, memories, events }` |

`project_id` wins over `project_path`. A `project_path` MemoSaver has never seen is an
error (`NOT_FOUND`), never a silently unscoped query.

## Memory tools

| Tool | Arguments | Returns |
| --- | --- | --- |
| `memory_insert` | `project_id?` \| `project_path?` (one required), `content` (req), `session_id?`, `type?`, `importance?` (0..1), `dedupe?` | created memory, or `null` when deduped |
| `memory_update` | `memory_id` (req), `content?`, `type?`, `importance?`, `metadata?` | updated memory, or `NOT_FOUND` |
| `memory_delete` | `memory_id` (req) | `{ deleted: true }`, or `NOT_FOUND` |
| `memory_recall` | `project_id?` \| `project_path?` (one required), `session_id?`, `type?`, `min_importance?`, `limit?` (≤200, default 50) | memories ordered by importance |
| `memory_search` | `query` (req), `project_id?` \| `project_path?`, `session_id?`, `type?`, `limit?` (≤100, default 20) | `{ memory, score }[]` (BM25 rank) |
| `memory_search_hybrid` | same as `memory_search` (`limit` ≤200) | `{ memory, score, meta: { overlap, bm25 } }[]` |
| `memory_capture` | `project_id?` \| `project_path?` (one required), `text` (req), `session_id?`, `type?` | `{ captured, ignored, memories }` |
| `activity_log` | `project_id?` \| `project_path?` (one required), `text` (req), `session_id?`, `type?`, `flush?` | `{ buffered, pending }`, or the capture result when `flush: true` |
| `memory_export` | `project_id?` \| `project_path?`, `type?` | export document (`app`, `version`, `exported_at`, `project`, `memories`) |
| `memory_import` | `document` (req, a `memory_export` document) | `{ imported, skipped, ids }` |

Omit every project argument on a read tool to search across all projects deliberately.
Unknown `memory_id`/`session_id` values surface as `NOT_FOUND` errors, not empty lists.

## Resume contract

A successful `session_start` on a project with prior state returns `resume`:

```jsonc
{
  "project_id": "<sha256 path hash>",
  "session_id": "session_<uuid>",   // latest session, null when there is none
  "project_name": "project-a",
  "resume_available": true,
  "context": "PROJECT CONTEXT\n...\n\nLAST SESSION\n...",  // rendered text for the agent
  "sections": [
    { "title": "PROJECT CONTEXT",    "body": "...", "source": "project" },
    { "title": "LAST SESSION",       "body": "...", "source": "session" },
    { "title": "LATEST CHECKPOINT",  "body": "...", "source": "checkpoint" },
    { "title": "PENDING TASKS",      "body": "...", "source": "memory" },
    { "title": "IMPORTANT DECISIONS","body": "...", "source": "memory" },
    { "title": "LAST BLOCKERS",      "body": "...", "source": "memory" },
    { "title": "KEY CONTEXT",        "body": "...", "source": "history" }
  ],
  "generated_at": 1750000000000
}
```

Sections are emitted in that order and only when non-empty; the tail is dropped when the
rendered context exceeds `resume.max_tokens` (default 4000). See `docs/sessions.md`.