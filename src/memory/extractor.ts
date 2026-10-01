import type { EventActivity, MemoryCandidate, MemoryType } from '../types.js';
import { classify, isLowValue } from './classifier.js';
import { scoreImportance } from './scorer.js';

export interface ExtractOptions {
  /** minimum importance for a candidate to be kept */
  minImportance: number;
  /** maximum content length to store (chars) */
  maxContentLength: number;
}

export interface MemoryExtractor {
  extract(events: EventActivity[]): MemoryCandidate[] | Promise<MemoryCandidate[]>;
}

/**
 * Stage-1 rule-based extractor.
 * Classifies each activity line, scores importance and drops low-value noise.
 * Kept deliberately deterministic and dependency-free.
 */
export class RuleBasedExtractor implements MemoryExtractor {
  constructor(private readonly options: ExtractOptions) {}

  extract(events: EventActivity[]): MemoryCandidate[] {
    const candidates: MemoryCandidate[] = [];
    for (const event of events) {
      const segments = splitSegments(event.text);
      for (const raw of segments) {
        const segment = normalizeSegment(raw, this.options.maxContentLength);
        if (!segment) continue;
        if (isLowValue(segment)) continue;
        const classification = classify(segment, event.type);
        const importance = scoreImportance(segment, classification.type);
        if (importance < this.options.minImportance) continue;
        candidates.push({
          type: classification.type,
          content: segment,
          importance: round2(importance),
          metadata: {
            extracted_by: 'rule-based',
            confidence: round2(classification.confidence),
            timestamp: event.timestamp ?? Date.now(),
            ...(event.session_id ? { session_id: event.session_id } : {})
          }
        });
      }
    }
    return candidates;
  }
}

function splitSegments(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function normalizeSegment(segment: string, maxLength: number): string | null {
  let normalized = segment.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return null;
  if (normalized.length > maxLength) {
    normalized = normalized.slice(0, maxLength);
  }
  return normalized;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function isMemoryType(value: unknown): value is MemoryType {
  return (
    typeof value === 'string' &&
    new Set(['FACT', 'DECISION', 'ARCHITECTURE', 'TASK', 'PROGRESS', 'ERROR', 'SOLUTION', 'CONTEXT', 'PREFERENCE', 'CHECKPOINT']).has(value)
  );
}