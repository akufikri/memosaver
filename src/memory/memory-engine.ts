import type { CaptureResult, EventActivity, Memory, MemoryType } from '../types.js';
import { MemoryRepository } from '../storage/repositories/memory-repository.js';
import { RuleBasedExtractor, type MemoryExtractor } from './extractor.js';
import { scoreImportance } from './scorer.js';
import { InvalidInputError } from '../util/errors.js';
import { newId } from '../util/id.js';

export interface SaveMemoryInput {
  projectId: string;
  sessionId?: string | null;
  type?: MemoryType;
  content: string;
  importance?: number;
  metadata?: Record<string, unknown>;
  /** skip if a memory with the same normalized content exists in the project */
  dedupe?: boolean;
}

export interface EngineConfig {
  minImportance: number;
  maxContentLength: number;
  bufferSize: number;
  debounceMs: number;
}

const VALID_TYPES = new Set<MemoryType>([
  'FACT',
  'DECISION',
  'ARCHITECTURE',
  'TASK',
  'PROGRESS',
  'ERROR',
  'SOLUTION',
  'CONTEXT',
  'PREFERENCE',
  'CHECKPOINT'
]);

export class MemoryEngine {
  private readonly extractor: MemoryExtractor;
  private readonly buffer = new Map<string, EventActivity[]>();
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly repository: MemoryRepository,
    private readonly config: EngineConfig,
    extractor?: MemoryExtractor
  ) {
    this.extractor =
      extractor ??
      new RuleBasedExtractor({
        minImportance: config.minImportance,
        maxContentLength: config.maxContentLength
      });
  }

  save(input: SaveMemoryInput): Memory | null {
    const content = normalizeContent(input.content, this.config.maxContentLength);
    if (content.length === 0) throw new InvalidInputError('memory content cannot be empty');

    const type: MemoryType = input.type ?? 'FACT';
    if (!VALID_TYPES.has(type as MemoryType)) {
      throw new InvalidInputError(`invalid memory type: ${String(input.type)}`);
    }

    if (input.dedupe && this.repository.existsNormalized(content, input.projectId)) {
      return null;
    }

    const importance =
      input.importance != null ? clampImportance(input.importance) : scoreImportance(content, type);
    return this.repository.insert({
      id: newId('memory'),
      project_id: input.projectId,
      session_id: input.sessionId ?? null,
      type: type as MemoryType,
      content,
      importance,
      metadata: input.metadata ?? {},
      created_at: Date.now(),
      updated_at: Date.now()
    });
  }

  delete(id: string): boolean {
    return this.repository.delete(id);
  }

  update(
    id: string,
    patch: { content?: string; type?: MemoryType; importance?: number; metadata?: Record<string, unknown> }
  ): Memory | null {
    if (patch.content != null) {
      const content = normalizeContent(patch.content, this.config.maxContentLength);
      if (content.length === 0) throw new InvalidInputError('memory content cannot be empty');
      patch.content = content;
    }
    if (patch.type != null && !VALID_TYPES.has(patch.type as MemoryType)) {
      throw new InvalidInputError(`invalid memory type: ${String(patch.type)}`);
    }
    if (patch.importance != null) {
      patch.importance = clampImportance(patch.importance);
    }
    return this.repository.update(id, patch);
  }

  /** Append activity to the in-memory buffer for later batch extraction. */
  bufferEvent(projectId: string, event: EventActivity): void {
    const queue = this.buffer.get(projectId) ?? [];
    queue.push(event);
    this.buffer.set(projectId, queue);

    // force flush when buffer full
    if (queue.length >= this.config.bufferSize) {
      this.cancelDebounce(projectId);
      this.flushBuffer(projectId).catch(() => {});
      return;
    }

    // reset idle debounce timer
    if (this.config.debounceMs > 0) {
      this.cancelDebounce(projectId);
      const timer = setTimeout(() => {
        this.debounceTimers.delete(projectId);
        this.flushBuffer(projectId).catch(() => {});
      }, this.config.debounceMs);
      this.debounceTimers.set(projectId, timer);
    }
  }

  private cancelDebounce(projectId: string): void {
    const t = this.debounceTimers.get(projectId);
    if (t !== undefined) { clearTimeout(t); this.debounceTimers.delete(projectId); }
  }

  /** Flush all project buffers — call before process exit. */
  async flushAll(): Promise<void> {
    const ids = [...this.buffer.keys()];
    await Promise.all(ids.map((id) => this.flushBuffer(id)));
  }

  /** Number of buffered events for a project. */
  bufferedCount(projectId: string): number {
    return this.buffer.get(projectId)?.length ?? 0;
  }

  /**
   * Flush buffered events through the extraction pipeline and store results.
   * Safe to call repeatedly; the buffer is cleared after extraction.
   */
  async flushBuffer(projectId: string): Promise<CaptureResult> {
    const events = this.buffer.get(projectId) ?? [];
    if (events.length === 0) {
      return { captured: 0, ignored: 0, memories: [] };
    }
    this.buffer.set(projectId, []);
    return this.processEvents(projectId, events);
  }

  /**
   * Full extraction pipeline: classify, score, filter, deduplicate, store.
   */
  async processEvents(projectId: string, events: EventActivity[]): Promise<CaptureResult> {
    if (events.length === 0) return { captured: 0, ignored: 0, memories: [] };
    const candidates = await this.extractor.extract(events);
    const stored: Memory[] = [];
    let ignored = 0;
    for (const candidate of candidates) {
      const saved = this.save({
        projectId,
        sessionId: candidate.metadata?.session_id != null ? String(candidate.metadata.session_id) : undefined,
        type: candidate.type,
        content: candidate.content,
        importance: candidate.importance,
        metadata: candidate.metadata,
        dedupe: true
      });
      if (saved) stored.push(saved);
      else ignored += 1;
    }
    return { captured: stored.length, ignored, memories: stored };
  }

  /**
   * Capture one raw activity directly through the pipeline without buffering.
   */
  capture(projectId: string, text: string, hint?: MemoryType, sessionId?: string): Promise<CaptureResult> {
    const event: EventActivity = { text: text, type: hint, session_id: sessionId, timestamp: Date.now() };
    return this.processEvents(projectId, [event]);
  }
}

function normalizeContent(content: string, maxLength: number): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

function clampImportance(value: number): number {
  return Math.min(1, Math.max(0, value));
}