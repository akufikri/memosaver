import type { Checkpoint, Memory, MemoryType, Project, ResumeContext, Session, SessionStatus } from '../types.js';
import { MEMORY_TYPES } from '../types.js';
const VALID_MEMORY_TYPES = new Set<string>(MEMORY_TYPES);
import type { Database } from '../storage/database.js';
import { ProjectRepository } from '../storage/repositories/project-repository.js';
import { SessionRepository } from '../storage/repositories/session-repository.js';
import { CheckpointRepository, type CheckpointInput } from '../storage/repositories/checkpoint-repository.js';
import { MemoryRepository } from '../storage/repositories/memory-repository.js';
import { MemoryEngine } from '../memory/memory-engine.js';
import { MemoryRetriever, type HybridSearchResult } from '../memory/retriever.js';
import { ProjectManager } from '../project/project-manager.js';
import { ContextBuilder } from '../context/context-builder.js';
import { NotFoundError, InvalidInputError } from '../util/errors.js';
import { newId } from '../util/id.js';
import type { MemoSaverConfig } from '../util/config.js';
import type { Logger } from '../util/logger.js';

export interface SessionStartResult {
  project: Project;
  created_project: boolean;
  session: Session;
  resume: ResumeContext;
}

export interface ServiceStatus {
  projects: number;
  sessions: number;
  memories: number;
  active_sessions: number;
}

export interface CheckpointCreateInput extends CheckpointInput {
  summary?: string | null;
  current_task?: string | null;
}

export interface MemoryExportDocument {
  app: 'memosaver';
  version: number;
  exported_at: number;
  project?: Project | null;
  memories: Memory[];
}

/** Loose input shape accepted by importMemories (e.g. from MCP JSON). */
export interface MemoryExportInput {
  app?: string;
  version?: number;
  exported_at?: number;
  project?: { id?: string; path?: string; name?: string } | null;
  memories?: Array<{
    project_id?: string;
    session_id?: string | null;
    type?: string;
    content?: string;
    importance?: number;
    metadata?: Record<string, unknown>;
  }>;
}

export interface SessionTimeline {
  session: Session;
  checkpoints: Checkpoint[];
  memories: Memory[];
  events: TimelineEvent[];
}

export type TimelineEvent =
  | { at: number; kind: 'checkpoint'; checkpoint: Checkpoint }
  | { at: number; kind: 'memory'; memory: Memory };

/** Application service. Shared by MCP adapter, CLI and future integrations. */
export class MemoSaverService {
  projects: ProjectRepository;
  sessions: SessionRepository;
  checkpoints: CheckpointRepository;
  memories: MemoryRepository;
  engine: MemoryEngine;
  retriever: MemoryRetriever;
  private readonly projectManager: ProjectManager;
  private readonly contextBuilder: ContextBuilder;
  private readonly logger: Logger;
  private readonly configConfig: MemoSaverConfig;

  constructor(db: Database, engine: MemoryEngine, config: MemoSaverConfig, logger: Logger, contextBuilder?: ContextBuilder) {
    this.logger = logger;
    this.configConfig = config;
    this.projects = new ProjectRepository(db);
    this.sessions = new SessionRepository(db);
    this.checkpoints = new CheckpointRepository(db);
    this.memories = new MemoryRepository(db);
    this.projectManager = new ProjectManager(this.projects);
    this.engine = engine;
    this.retriever = new MemoryRetriever(this.memories);
    this.contextBuilder = contextBuilder ?? new ContextBuilder();
  }

  status(): ServiceStatus {
    return {
      projects: this.projects.list().length,
      sessions: this.sessions.list(1000000).length,
      memories: this.memories.count(),
      active_sessions: this.sessions.activeCount()
    };
  }

  /**
   * Start a session for a project path. Previous active sessions of that
   * project are closed as interrupted; a resume context is built if possible.
   */
  startSession(projectPath: string, agent: string, resume = true): SessionStartResult {
    const { project, created } = this.projectManager.ensureProject(projectPath);
    const closed = this.sessions.closeActiveForProject(project.id, 'interrupted');
    if (closed > 0) {
      this.logger.info('closed interrupted sessions', { count: closed, project: project.id });
    }

    const session: Session = {
      id: newId('session'),
      project_id: project.id,
      agent: agent || 'unknown',
      started_at: Date.now(),
      ended_at: null,
      status: 'active',
      summary: null,
      goal: null,
      current_task: null,
      next_action: null
    };
    this.sessions.create(session);
    this.projects.setLastSession(project.id, session.id);

    const resumeContext = resume ? this.buildResumeContext(project.id, agent) : this.emptyResume(project);
    this.logger.info('session started', { session: session.id, project: project.id, agent });
    return { session, project, created_project: created, resume: resumeContext };
  }

  endSession(
    sessionId: string,
    options: { status?: SessionStatus; summary?: string } = {}
  ): Session | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const status: SessionStatus =
      options.status ?? (session.status === 'active' ? 'completed' : session.status);
    const ended = this.sessions.update(sessionId, {
      status,
      ended_at: Date.now(),
      summary: options.summary ?? session.summary
    });
    // Automatic checkpoint: persist the final state of a session so the next
    // resume has a concrete snapshot even if the agent never called
    // session_checkpoint. One per session only; guard against duplicates.
    if (ended && status !== 'active') {
      const existing = this.checkpoints.latestForSession(sessionId);
      if (!existing && (session.goal || session.current_task || ended.summary || ended.next_action)) {
        this.createCheckpoint(sessionId, {
          goal: session.goal ?? undefined,
          current_task: session.current_task ?? undefined,
          current_state: session.current_task ?? undefined,
          next_action: session.next_action ?? undefined,
          summary: ended.summary ?? undefined
        });
      }
    }
    this.logger.info('session ended', { session: sessionId, status });
    return ended;
  }

  createCheckpoint(sessionId: string, input: CheckpointCreateInput): Checkpoint {
    const session = this.sessions.get(sessionId);
    if (!session) throw new NotFoundError(`session not found: ${sessionId}`);

    if (input.goal != null) this.sessions.update(sessionId, { goal: input.goal });
    if (input.current_task != null) this.sessions.update(sessionId, { current_task: input.current_task });
    if (input.next_action != null) this.sessions.update(sessionId, { next_action: input.next_action });
    if (input.summary != null) this.sessions.update(sessionId, { summary: input.summary });

    const checkpoint = this.checkpoints.create(newId('checkpoint'), sessionId, {
      goal: input.goal ?? session.goal ?? null,
      current_state: input.current_state ?? session.current_task ?? null,
      completed: input.completed ?? null,
      pending: input.pending ?? null,
      blockers: input.blockers ?? null,
      next_action: input.next_action ?? null
    });

    this.engine.save({
      projectId: session.project_id,
      sessionId,
      type: 'CHECKPOINT',
      content: `${input.completed ?? 'work'} checkpointed; next${input.next_action ? `: ${input.next_action}` : ''}${
        input.pending ? `; pending: ${input.pending}` : ''
      }`,
      importance: 0.65,
      metadata: { checkpoint_id: checkpoint.id }
    });

    this.logger.info('checkpoint created', { checkpoint: checkpoint.id, session: sessionId });
    return checkpoint;
  }

  /**
   * Build the resume context for a project using the latest session,
   * latest checkpoint and relevant memories.
   */
  buildResumeContext(projectId: string, currentAgent?: string): ResumeContext {
    const project = this.projects.get(projectId);
    if (!project) throw new NotFoundError(`project not found: ${projectId}`);

    const latestSession = this.sessions.latestForProject(projectId, true);
    const latestCheckpoint =
      latestSession != null
        ? this.checkpoints.latestForSession(latestSession.id)
        : this.checkpoints.lastForProject(projectId);
    const memories = this.retriever.recall(projectId, { limit: 60 });

    return this.contextBuilder.build(project, latestSession, latestCheckpoint, memories, {
      maxTokens: this.configConfig.resume?.max_tokens ?? 4000,
      maxMemories: this.configConfig.resume?.max_memories ?? 25,
      currentAgent
    });
  }

  /** Create-or-get a project from a path. */
  ensureProjectByPath(rawPath: string): Project {
    return this.projectManager.ensureProject(rawPath).project;
  }

  getProjectByPath(rawPath: string): Project | null {
    return this.projectManager.get(rawPath);
  }

  getProject(id: string): Project | null {
    return this.projects.get(id);
  }

  listProjects(): Project[] {
    return this.projects.list();
  }

  listMemories(options: { project_id?: string; session_id?: string; type?: MemoryType; limit?: number } = {}): Memory[] {
    return this.memories.list({
      project_id: options.project_id,
      session_id: options.session_id,
      type: options.type,
      limit: options.limit
    });
  }

  listSessions(projectId?: string, limit = 50): Session[] {
    return this.sessions.list(limit, projectId);
  }

  getSession(id: string): Session | null {
    return this.sessions.get(id);
  }

  getCheckpoint(id: string): Checkpoint | null {
    return this.checkpoints.get(id);
  }

  getMemory(id: string): Memory | null {
    return this.memories.get(id);
  }

  /** Update an existing memory (content, type, importance, metadata). */
  updateMemory(
    id: string,
    patch: { content?: string; type?: MemoryType; importance?: number; metadata?: Record<string, unknown> }
  ): Memory | null {
    return this.engine.update(id, patch);
  }

  /**
   * Hybrid recall: keyword search (FTS5 BM25) re-ranked by lexical overlap and
   * importance. Returns MemorySearchResult with a normalized score 0..1.
   */
  searchHybrid(query: string, options: { project_id?: string; session_id?: string; type?: MemoryType; limit?: number } = {}): HybridSearchResult[] {
    return this.retriever.searchHybrid(query, options);
  }

  /** Export project memories (optionally a subset) as a portable JSON document. */
  exportMemories(options: { project_id?: string; session_id?: string; type?: MemoryType } = {}): MemoryExportDocument {
    const memories = this.memories.list({
      project_id: options.project_id,
      session_id: options.session_id,
      type: options.type,
      limit: 100000
    });
    const project = options.project_id ? this.projects.get(options.project_id) : null;
    return {
      app: 'memosaver',
      version: 1,
      exported_at: Date.now(),
      project,
      memories
    };
  }

  /** Import memory records from an export document. Returns created ids. */
  importMemories(doc: MemoryExportDocument | MemoryExportInput): { imported: number; skipped: number; ids: string[] } {
    const input = doc as MemoryExportInput;
    if (!input || input.app !== 'memosaver' || !Array.isArray(input.memories)) {
      throw new InvalidInputError('invalid memory export document');
    }
    // Re-create the originating project (by path) before inserting memories so
    // foreign keys remain valid.
    if (input.project?.path) {
      this.ensureProjectByPath(input.project.path);
    }
    const importedIds: string[] = [];
    let skipped = 0;
    for (const m of input.memories) {
      if (!m || !m.project_id || !m.content) {
        skipped += 1;
        continue;
      }
      const type: MemoryType = VALID_MEMORY_TYPES.has((m.type ?? 'FACT') as MemoryType)
        ? (m.type as MemoryType)
        : 'FACT';
      let projectId = m.project_id;
      if (this.projects.get(projectId) == null && input.project?.path) {
        projectId = this.ensureProjectByPath(input.project.path).id;
      }
      const saved = this.engine.save({
        projectId,
        sessionId: m.session_id,
        type,
        content: m.content,
        importance: m.importance,
        metadata: m.metadata
      });
      if (saved) importedIds.push(saved.id);
      else skipped += 1;
    }
    return { imported: importedIds.length, skipped, ids: importedIds };
  }

  /** Timeline of a session: checkpoints + memories, ascending by time. */
  sessionTimeline(sessionId: string): SessionTimeline {
    const session = this.sessions.get(sessionId);
    if (!session) throw new NotFoundError(`session not found: ${sessionId}`);
    const checkpoints = this.checkpoints.listBySession(sessionId);
    const memories = this.memories.list({ session_id: sessionId, project_id: session.project_id, limit: 100000 });
    const events: TimelineEvent[] = [
      ...checkpoints.map((c) => ({
        at: c.created_at,
        kind: 'checkpoint' as const,
        checkpoint: c
      })),
      ...memories.map((m) => ({ at: m.created_at, kind: 'memory' as const, memory: m }))
    ];
    events.sort((a, b) => a.at - b.at);
    return { session, checkpoints, memories, events };
  }

  private emptyResume(project: Project): ResumeContext {
    return {
      project_id: project.id,
      session_id: null,
      project_name: project.name,
      resume_available: false,
      sections: [],
      context: '',
      generated_at: Date.now()
    };
  }
}