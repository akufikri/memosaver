import type { EventActivity, MemoryCandidate, MemoryType } from '../types.js';
import type { ExtractOptions, MemoryExtractor } from './extractor.js';
import { isMemoryType } from './extractor.js';

export interface LlmExtractorConfig {
  provider?: 'openai-compatible';
  base_url?: string;
  model?: string;
  api_key?: string;
  disabled?: boolean;
}

export interface ChatRequest {
  base_url: string;
  model: string;
  apiKey: string;
  messages: { role: 'system' | 'user'; content: string }[];
}

export type LlmCallFn = (request: ChatRequest) => Promise<string>;

const PROMPT_SYSTEM =
  'You extract durable, high-signal memories from AI software-development activity. ' +
  'Emit ONLY JSON matching: {"memories":[{"content":"...","type":"FACT|DECISION|' +
  'ARCHITECTURE|TASK|PROGRESS|ERROR|SOLUTION|CONTEXT|PREFERENCE|CHECKPOINT","importance":0..1}]}. ' +
  'Drop transient chatter, greetings, re-reads and tool crud. ' +
  'Prefer 1-3 memories per line; empty array is valid. ' +
  'importance: 0.9 decisions/architecture, 0.6-0.8 errors/solutions/tasks, <0.5 routine facts.';

/** Fallback when composeExtractor is called without explicit extract options. */
const DEFAULT_EXTRACT_OPTIONS: ExtractOptions = { minImportance: 0.3, maxContentLength: 20000 };

/**
 * LLM-backed memory extractor behind the same MemoryExtractor interface as the
 * rule-based engine. Degrades gracefully:
 * - disabled / no api_key -> []
 * - network/model error   -> [] (never throws into the extraction pipeline)
 */
export class LlmMemoryExtractor implements MemoryExtractor {
  private readonly config: LlmExtractorConfig;
  private readonly call: LlmCallFn;

  constructor(private readonly options: ExtractOptions, config?: LlmExtractorConfig, call?: LlmCallFn) {
    this.config = config ?? {};
    this.call = call ?? defaultOpenAiCompat;
  }

  async extract(events: EventActivity[]): Promise<MemoryCandidate[]> {
    if (events.length === 0) return [];
    if (this.config.disabled === true || !this.config.api_key) return [];
    try {
      const raw = await this.call({
        base_url: this.config.base_url ?? 'https://api.openai.com/v1',
        model: this.config.model ?? 'gpt-4o-mini',
        apiKey: this.config.api_key,
        messages: [
          { role: 'system', content: PROMPT_SYSTEM },
          { role: 'user', content: buildPrompt(events, this.options) }
        ]
      });
      return parseCandidates(raw, this.options, sharedSessionId(events));
    } catch {
      return [];
    }
  }
}

/**
 * Compose the rule-based extractor with an optional LLM extractor.
 * LLM results win when present; otherwise fall back to the rules. When the LLM
 * is not configured the rule-based extractor is returned unchanged.
 */
export function composeExtractor(
  ruleBased: MemoryExtractor,
  config?: LlmExtractorConfig,
  options?: ExtractOptions
): MemoryExtractor {
  if (!config || config.disabled === true || !config.api_key) return ruleBased;
  const llm = new LlmMemoryExtractor(options ?? DEFAULT_EXTRACT_OPTIONS, config);
  return {
    extract: async (events) => {
      const direct = events.filter((e) => e.type != null);
      const llmEvents = direct.length > 0 ? direct : events;
      const candidates = await llm.extract(llmEvents);
      if (candidates.length > 0) return candidates;
      return ruleBased.extract(events);
    }
  };
}

function buildPrompt(events: EventActivity[], options: ExtractOptions): string {
  const lines = events.map((e, i) => {
    const hint = e.type ? ` (classify-as-${e.type})` : '';
    return `[${i + 1}]${hint} ${e.text}`;
  });
  const threshold = Math.round(options.minImportance * 100);
  return [
    `Extract context memories from ${events.length} activity line(s).`,
    `Rules: keep only importance >= ${threshold}/100, at most ${maxToKeep(events.length)} memories.`,
    ...lines,
    'Emit JSON.'
  ].join('\n');
}

function maxToKeep(n: number): number {
  return Math.max(1, Math.min(8, n));
}

function parseCandidates(raw: string, options: ExtractOptions, sessionId?: string): MemoryCandidate[] {
  const json = extractJson(raw);
  if (!json) return [];
  let parsed: { memories?: unknown };
  try {
    parsed = JSON.parse(json) as { memories?: unknown };
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.memories)) return [];
  const out: MemoryCandidate[] = [];
  for (const item of parsed.memories) {
    const obj = item as Record<string, unknown>;
    const content = typeof obj.content === 'string' ? obj.content.replace(/\s+/g, ' ').trim() : '';
    if (!content) continue;
    const importance = typeof obj.importance === 'number' ? clamp(obj.importance) : 0.5;
    if (importance < options.minImportance) continue;
    const type: MemoryType = isMemoryType(obj.type) ? (obj.type as MemoryType) : 'FACT';
    out.push({
      type,
      content: content.slice(0, options.maxContentLength),
      importance: Math.round(importance * 100) / 100,
      metadata: { extracted_by: 'llm', ...(sessionId ? { session_id: sessionId } : {}) }
    });
  }
  return out;
}

function extractJson(raw: string): string | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * The session id shared by every event, if there is exactly one. LLM candidates
 * cannot be attributed to a single event, so only an unambiguous id is kept.
 */
function sharedSessionId(events: EventActivity[]): string | undefined {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.session_id) ids.add(event.session_id);
  }
  return ids.size === 1 ? [...ids][0] : undefined;
}

/** Default OpenAI-compatible chat completion call via global fetch. */
export async function defaultOpenAiCompat(request: ChatRequest): Promise<string> {
  const res = await fetch(`${request.base_url.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${request.apiKey}`
    },
    body: JSON.stringify({
      model: request.model,
      messages: request.messages,
      response_format: { type: 'json_object' },
      max_tokens: 1200
    })
  });
  if (!res.ok) throw new Error(`llm extractor http ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? '';
}