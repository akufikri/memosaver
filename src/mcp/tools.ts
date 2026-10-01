import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EventActivity, MemoryType, SessionStatus } from '../types.js';
import { MemoSaverService } from '../service/memosaver-service.js';
import type { MemoryExportInput } from '../service/memosaver-service.js';
import { InvalidInputError, NotFoundError } from '../util/errors.js';
import { wrapTool as wrap } from './tool-result.js';

const memoryTypeSchema = z
  .enum(['FACT', 'DECISION', 'ARCHITECTURE', 'TASK', 'PROGRESS', 'ERROR', 'SOLUTION', 'CONTEXT', 'PREFERENCE', 'CHECKPOINT'])
  .optional()
  .describe('memory classification');

function resolveProjectId(
  service: MemoSaverService,
  args: { project_id?: string; project_path?: string }
): string {
  if (args.project_id) return args.project_id;
  if (args.project_path && args.project_path.length > 0) {
    return service.ensureProjectByPath(args.project_path).id;
  }
  throw new InvalidInputError('project_id or project_path is required');
}

function optionalProjectId(
  service: MemoSaverService,
  args: { project_id?: string; project_path?: string }
): string | undefined {
  if (args.project_id) return args.project_id;
  if (args.project_path && args.project_path.length > 0) {
    const project = service.getProjectByPath(args.project_path);
    // Never silently drop the filter: that would leak results from every other
    // project when the caller asked for one specific path.
    if (!project) throw new NotFoundError(`project not found for path: ${args.project_path}`);
    return project.id;
  }
  return undefined;
}

function asType(value: unknown): MemoryType | undefined {
  return typeof value === 'string' ? (value as MemoryType) : undefined;
}

/** Register every MemoSaver MCP tool. */
export function registerTools(mcp: McpServer, service: MemoSaverService): void {
  mcp.registerTool(
    'session_start',
    {
      description:
        'Start a MemoSaver session for a project. Closes any previous interrupted session. Returns a resume context when a previous session exists.',
      inputSchema: {
        project_path: z.string().describe('absolute path to the project directory'),
        agent: z.string().describe('agent identifier, e.g. claude-code or opencode'),
        resume: z.boolean().optional().describe('set false to skip resume-context generation')
      }
    },
    wrap(async (args) => {
      const { project_path: projectPath, agent, resume } = args as {
        project_path: string;
        agent: string;
        resume?: boolean;
      };
      return service.startSession(projectPath, agent, resume !== false);
    })
  );

  mcp.registerTool(
    'session_checkpoint',
    {
      description:
        'Create a checkpoint capturing goal, current state, completed work, pending work, blockers and the next action for a session.',
      inputSchema: {
        session_id: z.string(),
        goal: z.string().optional(),
        current_task: z.string().optional(),
        summary: z.string().optional(),
        completed: z.string().optional(),
        pending: z.string().optional(),
        blockers: z.string().optional(),
        next_action: z.string().optional(),
        current_state: z.string().optional()
      }
    },
    wrap(async (args) => {
      const { session_id: sessionId, ...rest } = args as Record<string, string>;
      if (sessionId == null) throw new InvalidInputError('session_id is required');
      return service.createCheckpoint(sessionId, rest);
    })
  );

  mcp.registerTool(
    'session_end',
    {
      description: 'End a session as completed (default) or interrupted. May attach a final summary.',
      inputSchema: {
        session_id: z.string(),
        status: z.enum(['completed', 'interrupted']).optional(),
        summary: z.string().optional()
      }
    },
    wrap(async (args) => {
      const { session_id: sessionId, status, summary } = args as Record<string, string | undefined>;
      if (sessionId == null) throw new InvalidInputError('session_id is required');
      const ended = service.endSession(sessionId, { status: asStatus(status), summary });
      return ended ?? { ok: false, error: `session not found: ${sessionId}` };
    })
  );

  mcp.registerTool(
    'session_status',
    {
      description: 'Inspect sessions. Returns a specific session, a project s sessions, or all sessions.',
      inputSchema: {
        session_id: z.string().optional(),
        project_id: z.string().optional(),
        project_path: z.string().optional()
      }
    },
    wrap(async (args) => {
      const { session_id: sessionId, project_id: pid, project_path: pPath } = args as Record<string, string | undefined>;
      if (sessionId) return service.getSession(sessionId);
      const resolved = optionalProjectId(service, { project_id: pid, project_path: pPath });
      return service.listSessions(resolved);
    })
  );

  mcp.registerTool(
    'memory_insert',
    {
      description:
        'Explicitly save a memory. Use for high-value facts, decisions, architecture notes, errors, solutions or progress.',
      inputSchema: {
        project_id: z.string().optional(),
        project_path: z.string().optional().describe('absolute project path'),
        session_id: z.string().optional(),
        content: z.string().min(1).describe('memory content'),
        type: memoryTypeSchema,
        importance: z.number().min(0).max(1).optional().describe('importance 0..1'),
        dedupe: z.boolean().optional().describe('skip if identical memory exists in project')
      }
    },
    wrap(async (args) => {
      const { project_id: pid, project_path: pPath, session_id: sessionId, content, type, importance, dedupe } =
        args as Record<string, unknown>;
      return service.engine.save({
        projectId: resolveProjectId(service, { project_id: pid as string, project_path: pPath as string }),
        sessionId: sessionId as string | undefined,
        content: content as string,
        type: asType(type),
        importance: importance as number | undefined,
        dedupe: dedupe as boolean | undefined
      });
    })
  );

  mcp.registerTool(
    'memory_recall',
    {
      description: 'Recall the most important memories for a project (or one session), sorted by importance.',
      inputSchema: {
        project_id: z.string().optional(),
        project_path: z.string().optional(),
        session_id: z.string().optional(),
        type: memoryTypeSchema,
        min_importance: z.number().min(0).max(1).optional(),
        limit: z.number().int().min(1).max(200).optional()
      }
    },
    wrap(async (args) => {
      const { project_id: pid, project_path: pPath, session_id: sessionId, type, min_importance, limit } =
        args as Record<string, unknown>;
      return service.retriever.recall(resolveProjectId(service, { project_id: pid as string, project_path: pPath as string }), {
        session_id: sessionId as string | undefined,
        type: asType(type),
        min_importance: min_importance as number | undefined,
        limit: (limit as number) ?? 50
      });
    })
  );

  mcp.registerTool(
    'memory_search',
    {
      description: 'Keyword search over project memories using SQLite FTS5 (BM25 relevance).',
      inputSchema: {
        query: z.string().min(1).describe('search keywords, e.g. "authentication architecture"'),
        project_id: z.string().optional(),
        project_path: z.string().optional(),
        session_id: z.string().optional(),
        type: memoryTypeSchema,
        limit: z.number().int().min(1).max(100).optional()
      }
    },
    wrap(async (args) => {
      const { query, project_id: pid, project_path: pPath, session_id: sessionId, type, limit } = args as Record<string, unknown>;
      return service.retriever.search(query as string, {
        project_id: optionalProjectId(service, { project_id: pid as string, project_path: pPath as string }),
        session_id: sessionId as string | undefined,
        type: asType(type),
        limit: (limit as number) ?? 20
      });
    })
  );

  mcp.registerTool(
    'memory_search_hybrid',
    {
      description:
        'Hybrid search: BM25 keyword matches re-ranked with lexical token overlap and importance. Use when FTS5 exact matches are sparse.',
      inputSchema: {
        query: z.string().min(1),
        project_id: z.string().optional(),
        project_path: z.string().optional(),
        session_id: z.string().optional(),
        type: memoryTypeSchema,
        limit: z.number().int().min(1).max(200).optional()
      }
    },
    wrap(async (args) => {
      const { query, project_id: pid, project_path: pPath, session_id: sessionId, type, limit } = args as Record<string, unknown>;
      return service.searchHybrid(query as string, {
        project_id: optionalProjectId(service, { project_id: pid as string, project_path: pPath as string }),
        session_id: sessionId as string | undefined,
        type: asType(type),
        limit: (limit as number) ?? 20
      });
    })
  );

  mcp.registerTool(
    'memory_update',
    {
      description: 'Update an existing memory (content, type, importance, metadata).',
      inputSchema: {
        memory_id: z.string().min(1),
        content: z.string().min(1).optional(),
        type: memoryTypeSchema,
        importance: z.number().min(0).max(1).optional(),
        metadata: z.record(z.unknown()).optional()
      }
    },
    wrap(async (args) => {
      const { memory_id: memoryId, content, type, importance, metadata } = args as Record<string, unknown>;
      const updated = service.updateMemory(memoryId as string, {
        content: content as string | undefined,
        type: asType(type),
        importance: importance as number | undefined,
        metadata: metadata as Record<string, unknown> | undefined
      });
      if (!updated) throw new NotFoundError(`memory not found: ${memoryId}`);
      return updated;
    })
  );

  mcp.registerTool(
    'session_timeline',
    {
      description: 'Chronological timeline of a session: checkpoints and memories.',
      inputSchema: { session_id: z.string().min(1) }
    },
    wrap(async (args) => {
      const sessionId = (args as { session_id: string }).session_id;
      return service.sessionTimeline(sessionId);
    })
  );

  mcp.registerTool(
    'memory_delete',
    {
      description: 'Delete a memory by its id.',
      inputSchema: { memory_id: z.string().min(1) }
    },
    wrap(async (args) => {
      const memoryId = (args as { memory_id: string }).memory_id;
      if (!service.engine.delete(memoryId)) {
        throw new NotFoundError(`memory not found: ${memoryId}`);
      }
      return { deleted: true };
    })
  );

  mcp.registerTool(
    'memory_capture',
    {
      description: 'Run the extraction pipeline immediately on raw activity text and persist resulting memories.',
      inputSchema: {
        project_id: z.string().optional(),
        project_path: z.string().optional(),
        session_id: z.string().optional(),
        text: z.string().min(1).describe('activity text produced by the agent'),
        type: memoryTypeSchema
      }
    },
    wrap(async (args) => {
      const { project_id: pid, project_path: pPath, session_id: sessionId, text, type } = args as Record<string, unknown>;
      return service.engine.capture(
        resolveProjectId(service, { project_id: pid as string, project_path: pPath as string }),
        text as string,
        asType(type),
        sessionId as string | undefined
      );
    })
  );

  mcp.registerTool(
    'activity_log',
    {
      description:
        'Append one raw activity event (agent message, decision, error, file change, progress note) to MemoSaver s buffer. Buffered events are drained to persistent memory automatically; set flush=true to extract immediately.',
      inputSchema: {
        project_id: z.string().optional(),
        project_path: z.string().optional(),
        session_id: z.string().optional(),
        text: z.string().min(1),
        type: memoryTypeSchema,
        flush: z.boolean().optional().describe('flush the buffer immediately')
      }
    },
    wrap(async (args) => {
      const { project_id: pid, project_path: pPath, session_id: sessionId, text, type, flush } = args as Record<string, unknown>;
      const projectId = resolveProjectId(service, { project_id: pid as string, project_path: pPath as string });
      const event: EventActivity = {
        text: text as string,
        type: asType(type),
        session_id: sessionId as string | undefined,
        timestamp: Date.now()
      };
      service.engine.bufferEvent(projectId, event);
      if (flush === true) return service.engine.flushBuffer(projectId);
      return { buffered: true, pending: service.engine.bufferedCount(projectId) };
    })
  );

  mcp.registerTool(
    'memory_export',
    {
      description: 'Export project memories as a portable JSON document.',
      inputSchema: {
        project_id: z.string().optional(),
        project_path: z.string().optional(),
        type: memoryTypeSchema
      }
    },
    wrap(async (args) => {
      const { project_id: pid, project_path: pPath, type } = args as Record<string, unknown>;
      return service.exportMemories({
        project_id: optionalProjectId(service, { project_id: pid as string, project_path: pPath as string }),
        type: asType(type)
      });
    })
  );

  mcp.registerTool(
    'memory_import',
    {
      description: 'Import memories from a JSON export document produced by memory_export.',
      inputSchema: {
        document: z.unknown().describe('the full memory export document (its "memories" array)')
      }
    },
    wrap(async (args) => {
      const { document } = args as { document: unknown };
      const doc = asExportDocument(document);
      if (!doc) throw new InvalidInputError('document must be a valid memosaver export document');
      return service.importMemories(doc);
    })
  );
}

function asExportDocument(value: unknown): MemoryExportInput | null {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  return value as MemoryExportInput;
}

function asStatus(value: string | undefined): SessionStatus | undefined {
  if (value === 'completed' || value === 'interrupted' || value === 'active') return value;
  return undefined;
}