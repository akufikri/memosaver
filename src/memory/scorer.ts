import type { MemoryType } from '../types.js';

/** Rule-based importance scorer. Returns 0..1. */
export function scoreImportance(text: string, type: MemoryType): number {
  const t = text.toLowerCase();
  let score = 0.25;

  const typeBoost: Record<MemoryType, number> = {
    FACT: 0.1,
    DECISION: 0.5,
    ARCHITECTURE: 0.45,
    TASK: 0.2,
    PROGRESS: 0.25,
    ERROR: 0.3,
    SOLUTION: 0.4,
    CONTEXT: 0.15,
    PREFERENCE: 0.35,
    CHECKPOINT: 0.5
  };
  score += typeBoost[type] ?? 0.1;

  const strongSignals = [
    'critical',
    'important',
    'must',
    'crucial',
    'do not',
    'remember',
    'key decision',
    'decided',
    'decided to',
    'root cause',
    'production outage'
  ];
  for (const signal of strongSignals) {
    if (t.includes(signal)) {
      score += 0.2;
      break;
    }
  }

  const architectureSignals = ['architecture', 'pattern', 'we use', 'convention', 'schema', 'endpoint', 'database'];
  if (type === 'ARCHITECTURE' || type === 'DECISION' || type === 'PREFERENCE') {
    for (const signal of architectureSignals) {
      if (t.includes(signal)) {
        score += 0.1;
        break;
      }
    }
  }

  if (type === 'ERROR' && /failed|error|exception|bug/i.test(t) && /because|caused|due to|since|root/i.test(t)) {
    score += 0.15;
  }

  const words = text.split(/\s+/).filter((w) => w.length > 0).length;
  if (words < 4) score -= 0.15;
  if (words > 40) score -= 0.05;

  return clamp(score, 0, 1);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}