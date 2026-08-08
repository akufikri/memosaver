import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { MemoSaverError } from '../util/errors.js';

/** Wrap a tool handler value as an MCP text result. */
export function okResult(value: unknown): CallToolResult {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }] };
}

export function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ ok: false, error: message }, null, 2) }],
    isError: true
  };
}

/**
 * Adapt a domain handler to MCP callback form: catches domain errors and
 * returns them as predictable error results so the agent never crashes.
 */
export function wrapTool<Args>(
  handler: (args: Args) => unknown | Promise<unknown>
): (args: Args) => Promise<CallToolResult> {
  return async (args: Args): Promise<CallToolResult> => {
    try {
      return okResult(await handler(args));
    } catch (err) {
      if (err instanceof MemoSaverError) return errorResult(err.message);
      if (err instanceof Error) return errorResult(err.message);
      return errorResult(String(err));
    }
  };
}