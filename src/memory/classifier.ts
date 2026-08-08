import type { MemoryType } from '../types.js';

export const MEMORY_TYPES: readonly MemoryType[] = [
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
];

export interface Classification {
  type: MemoryType;
  confidence: number;
}

const RULES: { type: MemoryType; confidence: number; patterns: RegExp[] }[] = [
  {
    type: 'DECISION',
    confidence: 0.9,
    patterns: [
      /decided/i,
      /\bwe (chose|choose|use|picked)\b/i,
      /\bdecision/i,
      /agreed (on|to)\b/i,
      /we'll? go with/i
    ]
  },
  {
    type: 'ARCHITECTURE',
    confidence: 0.85,
    patterns: [
      /architecture/i,
      /\bpattern\b/i,
      /service layer/i,
      /controller|middleware|repository pattern/i,
      /monolith|microservice/i,
      /schema|foreign key|primary key/i
    ]
  },
  {
    type: 'SOLUTION',
    confidence: 0.9,
    patterns: [
      /\bfixed\b/i,
      /\bsolved\b/i,
      /\bresolved?\b/i,
      /workaround/i,
      /root cause/i,
      /the fix( )?[.,]? (was|is|:)/i
    ]
  },
  {
    type: 'ERROR',
    confidence: 0.9,
    patterns: [/failed/i, /error:/i, /exception/i, /\bbug\b/i, /not working/i, /crash/i, /cannot|cant\[/i]
  },
  {
    type: 'PROGRESS',
    confidence: 0.85,
    patterns: [
      /^completed/i,
      /\bdone\b/i,
      /\bfinished/i,
      /\bimplemented\b/i,
      /works now/i,
      /current state/i,
      /\bprogress/i
    ]
  },
  {
    type: 'TASK',
    confidence: 0.75,
    patterns: [
      /\btodo\b/i,
      /next step/i,
      /next action/i,
      /still need/i,
      /need to (implement|add|fix|create|investigate)/i,
      /\bpending/i,
      /should (implement|add|create)/i
    ]
  },
  {
    type: 'PROGRESS',
    confidence: 0.8,
    patterns: [
      /^completed/i,
      /\bdone\b/i,
      /\bfinished/i,
      /\bimplemented\b/i,
      /works now/i,
      /current state/i,
      /\bprogress/i
    ]
  },
  {
    type: 'PREFERENCE',
    confidence: 0.8,
    patterns: [/preference/i, /\bconvention/i, /we (always|usually|prefer)/i, /naming convention/i]
  },
  {
    type: 'CHECKPOINT',
    confidence: 0.95,
    patterns: [/\bcheckpoint\b/i]
  }
];

const LOW_VALUE_PATTERNS: RegExp[] = [
  /^i( ?')?m? (will )?(inspect|look|check|read|open|review|fetch|see)/i,
  /^let'?s (run|test|try|check)\b/i,
  /^(opening|reading|fetching|looking at|searching for|running|starting|viewing)( |$)/i,
  /^i( ?')?ll/i,
  /^let me/i,
  /^ok[.!]?$/i,
  /^sure[.!]?$/i,
  /^thanks[.!]?$/i,
  /^got it[.!]?$/i,
  /^no issues?[.!]?$/i,
  /^wait[.!]?$/i,
  /^hmm[.!]?$/i
];

/** Heuristic for low-value / transient activity that should not become memory. */
export function isLowValue(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 12) return true;
  if (LOW_VALUE_PATTERNS.some((p) => p.test(trimmed))) return true;
  return false;
}

const RULE_TYPES = new Set<MemoryType>(MEMORY_TYPES);

/** Classify free-form text into a memory type using keyword rules. */
export function classify(text: string, hint?: MemoryType): Classification {
  if (hint && RULE_TYPES.has(hint)) {
    return { type: hint, confidence: 1 };
  }
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(text))) {
      return { type: rule.type, confidence: rule.confidence };
    }
  }
  return { type: 'FACT', confidence: 0.4 };
}