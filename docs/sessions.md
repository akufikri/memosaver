# MemoSaver Sessions

A session is a discrete, recoverable work block. The design goal: **reopen a project
and instantly know where you left off**, even weeks later.

## Lifecycle

```
                    ┌─────────────────────────────────────────────┐
                    │                                             │
  session_start ───►│   ACTIVE (one per project at a time)        │
                    │   memories + activity_log + checkpoints     │
                    │   accumulate with project_id + session_id   │
                    │                                             │
                    └──────┬──────────────────────────────────────┘
                           │
             session_end(status)            process dies / timeout
                           │                           │
                           ▼                           ▼
                    COMPLETED                     INTERRUPTED
```

- `session_start`:
  - resolves the project (realpath → deterministic sha256 id), creates it if new
  - **auto-interrupts** any still-`active` session for that project
  - creates a new `ACTIVE` session
  - if the project has prior memories, builds and returns `resume_context`
- `session_checkpoint(session_id, goal?, current_task?, summary?, completed?, pending?, blockers?, next_action?, current_state?)`:
  - snapshot; the newest checkpoint drives the resume context
  - copies `goal` / `current_task` / `next_action` / `summary` onto the session when supplied
  - also writes a `CHECKPOINT` memory into the project so the state is searchable
- `session_end(status = "completed")`: closes; records `summary` if provided
  and **auto-creates a final checkpoint** when the session carried state and no
  checkpoint was captured yet, so the next resume always has a snapshot.
- `session_timeline`: checkpoints + memories of one session in chronological order.

## State machine

| status | meaning |
| --- | --- |
| `active` | open; one per project |
| `completed` | closed cleanly via `session_end` |
| `interrupted` | process exited / crashed mid-work; auto-set on next start |

## Resume context

Built by `ContextBuilder` from the project row, the latest session, the latest checkpoint
and up to 60 recalled memories. Sections, in emission order:

| section | content | cap |
| --- | --- | --- |
| `PROJECT CONTEXT` | name, path, last updated | — |
| `LAST SESSION` | agent, start/end, goal, current task, summary, next action; titled `LAST SESSION [claude-code → opencode]` when the agent changed | — |
| `LATEST CHECKPOINT` | goal, completed, pending, blockers, next action | — |
| `PENDING TASKS` | `TASK` memories | 6 |
| `IMPORTANT DECISIONS` | `DECISION` / `ARCHITECTURE` / `PREFERENCE` memories | 8 |
| `LAST BLOCKERS` | `ERROR` memories | 3 |
| `KEY CONTEXT` | remaining memories with importance ≥ 0.6 | `resume.max_memories − 8` |

Ordering is deliberate: state before history, decisions before facts, so the agent regains
"working memory" with the least tokens. `resume_available` is true when a session or any
memory exists; pass `resume: false` to `session_start` to skip building it.

Budget: sections are kept in order until `resume.max_tokens` (default 4000, estimated at
4 characters per token) is reached; the tail is dropped.

## Failure-safety

- If a session never calls `session_end` (crash, laptop closed), the next `session_start`
  marks it `interrupted` — the agent gets context about *both* the interruption and the
  state as of the last checkpoint.
- Writes run in SQLite WAL mode. Multi-statement writes (migrations, `memory_import`) are
  wrapped in one transaction; single-statement updates rely on SQLite's own atomicity.

## CLI

```bash
memosaver sessions                          # all sessions, grouped
memosaver sessions <project_path>           # sessions for a project
memosaver session <id> --timeline           # chronological events of a session
memosaver session <id> --end                # complete
memosaver session <id> --interrupt          # mark interrupted
```