import type { Memory, MemoryType } from '../types.js';
import {
  MemoryRepository,
  type MemorySearchOptions,
  type MemorySearchResult
} from '../storage/repositories/memory-repository.js';

export interface RecallOptions {
  session_id?: string;
  type?: MemoryType;
  min_importance?: number;
  limit?: number;
}

export interface HybridSearchOptions extends MemorySearchOptions {
  /** weight given to lexical overlap vs BM25 (0..1) */
  overlap_weight?: number;
}

export interface HybridSearchResult {
  memory: Memory;
  /** blended score 0..1 */
  score: number;
  /** how much of the score came from lexical overlap vs BM25 */
  meta: { overlap: number; bm25: number };
}

const DEFAULT_OVERLAP_WEIGHT = 0.5;
const DEFAULT_IMPORTANCE_WEIGHT = 0.3;

/**
 * Retrieval facade. Keyword FTS (BM25) + metadata filtering.
 * `searchHybrid` blends BM25 with token-overlap similarity and importance so
 * results stay relevant even when FTS finds few/zero exact matches.
 */
export interface RetrieverOptions {
  /** weight given to memory importance in hybrid scoring (0..1) */
  importanceWeight?: number;
  /** false keeps pure BM25 order (disables the overlap/importance blend) */
  hybrid?: boolean;
}

export class MemoryRetriever {
  constructor(
    private readonly repository: MemoryRepository,
    private readonly options: RetrieverOptions = {}
  ) {}

  /** Keyword search over memory content (BM25-ranked). */
  search(query: string, options: MemorySearchOptions = {}): MemorySearchResult[] {
    return this.repository.search(query, options);
  }

  /**
   * Hybrid search: run BM25, then re-rank by normalized token overlap with the
   * query and memory importance. Falls back to overlap ranking alone when FTS
   * returns nothing.
   */
  searchHybrid(query: string, options: HybridSearchOptions = {}): HybridSearchResult[] {
    const limit = options.limit ?? 20;
    const overlapWeight = options.overlap_weight ?? DEFAULT_OVERLAP_WEIGHT;
    const importanceWeight = this.options.importanceWeight ?? DEFAULT_IMPORTANCE_WEIGHT;

    const ftsResults = this.repository.search(query, { ...options, limit: limit * 4 });
    if (this.options.hybrid === false) {
      return ftsResults.slice(0, limit).map((r) => {
        const score = normalizeRank(r.score);
        return { memory: r.memory, score, meta: { overlap: 0, bm25: round3(score) } };
      });
    }
    const ftsById = new Map<string, number>();
    for (const r of ftsResults) {
      ftsById.set(r.memory.id, normalizeRank(r.score));
    }

    let pool = ftsResults.map((r) => r.memory);
    if (pool.length < limit) {
      const extras = this.repository.list({
        project_id: options.project_id,
        session_id: options.session_id,
        type: options.type,
        limit: limit * 4
      });
      const seen = new Set(pool.map((m) => m.id));
      pool = [...pool, ...extras.filter((m) => !seen.has(m.id))];
    }

    const queryTokens = tokenize(query);
    const scored = pool
      .map((memory) => {
        const overlap = tokenOverlap(queryTokens, tokenize(memory.content));
        const bm25 = ftsById.get(memory.id) ?? 0;
        const blended = overlapWeight * overlap + (1 - overlapWeight) * bm25;
        const withImportance = blended * (1 - importanceWeight) + memory.importance * importanceWeight;
        return { memory, score: withImportance, overlap, bm25 };
      })
      .filter((r) => r.overlap > 0 || r.bm25 > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map(({ memory, score, overlap, bm25 }) => ({
      memory,
      score,
      meta: { overlap: round3(overlap), bm25: round3(bm25) }
    }));
  }

  /** Recall sorted by importance. Project scope default. */
  recall(projectId: string, options: RecallOptions = {}): Memory[] {
    return this.repository.list({
      project_id: projectId,
      session_id: options.session_id,
      type: options.type,
      min_importance: options.min_importance,
      limit: options.limit
    });
  }

  /** Recent memories by createdAt (newest first). */
  recent(projectId: string, limit = 20): Memory[] {
    return this.repository.recentByProject(projectId, limit);
  }
}

/** Tokenize into lowercase alphanumeric terms (2+ chars). */
function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 1);
}

/** Jaccard overlap between two token sets, 0..1. */
function tokenOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const hits = a.filter((t) => setB.has(t)).length;
  return hits / a.length;
}

/** Map a negative BM25 rank to a positive 0..1 score. */
function normalizeRank(rank: number): number {
  const clamped = Math.min(0, Math.max(rank, -10));
  return Math.min(1, Math.max(0, -clamped / 10));
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}