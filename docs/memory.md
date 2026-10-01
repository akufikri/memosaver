# MemoSaver Memory System

At MemoSaver's core: capture knowledge without asking the agent to do anything
every single time. Two entry paths — **explicit saves** (`memory_insert`) and
**automatic capture** (`activity_log` buffer + `memory_capture`).

## Memory record

```jsonc
{
  "id": "memory_<uuid>",
  "project_id": "<sha256 of the normalized project path>",
  "session_id": "session_<uuid>",  // null for unscoped or imported memories
  "type": "DECISION",              // one of the 10 uppercase types below
  "content": "Postgres JSONB chosen for flexible metadata",
  "importance": 0.82,              // 0..1; auto-scored when not supplied
  "metadata": { "extracted_by": "rule-based", "confidence": 0.9, "timestamp": 1750000000000 },
  "created_at": 1750000000000,     // epoch ms
  "updated_at": 1750000000000
}
```

`memory_insert` accepts `type`, `importance` and `dedupe`; everything else in
`metadata` is caller-supplied. Automatic capture adds `extracted_by`, `confidence`,
`timestamp` and (when the activity carried one) `session_id`.

### Classifier (rule-based)

`classify(text, hint?)` returns the first matching rule; a `type` argument supplied by the
caller wins outright at confidence 1.

| type | matches | confidence |
| --- | --- | --- |
| `CHECKPOINT` | checkpoint | 0.95 |
| `DECISION` | decided / chose / choose / use / picked / decision / agreed to | 0.9 |
| `SOLUTION` | fixed / solved / resolved / workaround / root cause / "the fix was" | 0.9 |
| `ERROR` | failed / `error:` / exception / bug / not working / crash / cannot / can't | 0.9 |
| `ARCHITECTURE` | architecture / pattern / service layer / controller / middleware / monolith / microservice / schema / foreign key | 0.85 |
| `PROGRESS` | starts with "completed" / done / finished / implemented / works now / current state / progress | 0.85 |
| `PREFERENCE` | preference / convention / we always / we usually / we prefer / naming convention | 0.8 |
| `TASK` | todo / next step / next action / still need / need to implement\|add\|fix\|create\|investigate / pending | 0.75 |

No rule matches → `FACT` at confidence 0.4. `CONTEXT` only appears when the caller passes
`type: "CONTEXT"` explicitly.

Noise is dropped before classification: segments shorter than 12 characters and transient
chatter ("I'll inspect…", "let's run…", "opening…", "ok", "thanks").

### Importance scorer

`scoreImportance(text, type)` = `0.25` base + type boost (CHECKPOINT/DECISION +0.5,
ARCHITECTURE +0.45, SOLUTION +0.4, PREFERENCE +0.35, ERROR +0.3, PROGRESS +0.25,
TASK +0.2, CONTEXT +0.15, FACT +0.1), then:

- +0.2 for a strong signal (critical / important / must / crucial / do not / remember /
  key decision / decided / root cause / production outage) — first match only
- +0.1 for architecture vocabulary (architecture / pattern / we use / convention / schema /
  endpoint / database) when the type is ARCHITECTURE, DECISION or PREFERENCE
- +0.15 for an ERROR that also names a cause (because / caused / due to / since / root)
- −0.15 when the text is shorter than 4 words, −0.05 when longer than 40

Clamped to 0..1. Automatic capture drops candidates below `memory.min_importance`
(default 0.3); explicit `memory_insert` stores whatever importance it is given.

### Deduplication

Automatic capture (`activity_log`, `memory_capture`) always dedupes; `memory_insert`
dedupes when called with `dedupe: true`. A candidate whose normalized content
(whitespace collapsed, lowercased) already exists in the project is **dropped** — nothing
is merged, nothing is overwritten, no importance is raised. `memory_import` does not
dedupe: imported rows are inserted as-is.

## Retrieval

- `memory_search` → FTS5 `bm25()` relevance over `content`
- `memory_search_hybrid` → BM25 results re-ranked by normalized token overlap
  with the query (Jaccard) blended with memory importance; used when exact FTS
  matches are sparse
- `memory_recall` → order by `importance DESC`, `created_at DESC`
- `activity_log` extracts only its own buffered text

Query text is sanitized before it reaches FTS5: each word becomes a quoted phrase
and terms are AND-ed, so operator characters (`:`, `"`, `-`, `AND`/`OR`) return
results instead of raising `fts5: syntax error`. A query with no usable word
returns an empty list.

Hybrid tuning lives in `config.json` → `search.importance_weight` (importance
share of the blended score, default 0.35) and `search.hybrid` (`false` keeps
pure BM25 order). `overlap_weight` stays per-call.

Passing a `project_path` that MemoSaver has never seen is an error, not a
filter-less search: reads never silently widen to every project. Omit the
project arguments deliberately to search across all projects.

## LLM extractor (optional)

Set `memory.llm` in `config.json` to route extraction through an OpenAI-compatible
chat endpoint instead of (or layered on top of) the local rules:

```jsonc
{
  "memory": {
    "llm": { "base_url": "https://api.openai.com/v1", "model": "gpt-4o-mini", "api_key": "…" }
  }
}
```

- No `api_key` or `disabled: true` → the local `RuleBasedExtractor` remains active
  (that is the zero-config, fully offline default).
- LLM results win when present; on network/model failure the pipeline falls back
  to the rule-based extractor and never throws into the agent session.

## Buffer (automatic capture)

`activity_log(text, project_path?)` appends to an in-memory buffer. Each event keeps the
`session_id` it was logged with, so flushed memories stay visible to session-scoped recall
and `session_timeline`. The buffer flushes to the extraction pipeline when:

- it reaches `memory.buffer_size` (default 20) entries, or
- `memory.debounce_ms` (default 8000 ms) passes since the last buffered entry.

Flush runs the classifier+scorer and stores `activity_log` memories. A failed flush never
drops the agent's session; the failure is logged and the agent can call `memory_capture`
directly instead.

## Export / import

`memory_export` writes a portable JSON document (`app`, `version`, `project`,
`memories`). `memory_import` restores it inside a single transaction, so a
failing row rolls the whole import back instead of leaving a partial copy.

Session ids are machine-local: when an imported memory references a session that
does not exist locally, the memory is stored unscoped (`session_id = null`) and
the original id is kept in `metadata.imported_session_id`. Memories whose
project cannot be resolved locally are skipped and counted in `skipped`.

## Storage

FTS5 external content table + triggers, kept in `~/.memosaver/memosaver.db` alongside
sessions and checkpoints. Foreign keys: `memories.project_id` and
`checkpoints.session_id` cascade on delete, while `memories.session_id` is
`ON DELETE SET NULL` — deleting a session keeps its memories, unscoped.

## Future

- LLM providers behind `MemoryExtractor`/`MemoryRetriever` interfaces (OpenAI/Claude)
- vector embeddings + hybrid result rerank
- `SecretDetector`/`Redactor` before extraction