import { detectProject } from '../project/project-detector.js';
import type { Database } from '../storage/database.js';

/** Semantic component kinds supported by the Archify architecture renderer. */
export type ArchifyComponentType = 'frontend' | 'backend' | 'database' | 'cloud' | 'security' | 'messagebus' | 'external';

export interface ArchifyComponent {
  id: string;
  type: ArchifyComponentType;
  label: string;
  sublabel?: string;
  tag?: string;
  size: [number, number];
  row: number;
  col: number;
}

export type ArchifySide = 'top' | 'bottom' | 'left' | 'right';

export interface ArchifyConnection {
  id: string;
  from: string;
  to: string;
  label?: string;
  labelAt?: [number, number];
  variant?: 'default' | 'emphasis' | 'security' | 'dashed';
  fromSide?: ArchifySide;
  toSide?: ArchifySide;
  via?: [number, number][];
}

export interface ArchifySpec {
  schema_version: 1;
  diagram_type: 'architecture';
  meta: { title: string; quality_profile: 'standard' };
  layout: {
    mode: 'grid';
    origin: [number, number];
    cols: number;
    cellW: number;
    cellH: number;
    gapX: number;
    gapY: number;
  };
  components: ArchifyComponent[];
  connections: ArchifyConnection[];
  boundaries: { kind: 'region'; label: string; wraps: string[] }[];
  cards: { dot: string; title: string; items: string[] }[];
}

export interface SessionSnapshot {
  id: string;
  agent: string;
  status: string;
  goal: string | null;
  next_action: string | null;
  memories: number;
  checkpoint: { goal: string | null; next_action: string | null } | null;
}

export interface MemoryGroupSnapshot {
  type: string;
  count: number;
  example: string;
}

export interface ProjectGraphSnapshot {
  project: { id: string; name: string; path: string };
  sessions: SessionSnapshot[];
  groups: MemoryGroupSnapshot[];
  total_memories: number;
}

export interface OverviewProjectSnapshot {
  id: string;
  name: string;
  path: string;
  sessions: number;
  memories: number;
  agent: string | null;
  status: string | null;
}

export interface WorkspaceSnapshot {
  projects: OverviewProjectSnapshot[];
  /** 1-based page of the project list */
  page: number;
  page_size: number;
  totals: { projects: number; sessions: number; memories: number };
}

/** One row of the grid per band: agents/sessions on top, memory clusters below. */
const CELL_W = 200;
const CELL_H = 80;
const GAP_X = 120;
const GAP_Y = 140;
const ORIGIN_X = 40;
const ORIGIN_Y = 80;
const MAX_SESSIONS = 3;
const MAX_GROUPS = 6;
/**
 * One agent node plus N project nodes must stay inside MAX_COMPONENTS. The
 * workspace overview wraps projects into a compact grid instead of one long
 * band: a wide single row shrinks every label to unreadable size when the
 * viewer fits the diagram to the window.
 */
const MAX_PROJECTS_PER_PAGE = 12;
export const DEFAULT_PROJECTS_PER_PAGE = 12;
const WORKSPACE_COLS = 6;
const WORKSPACE_CELL_W = 220;
const WORKSPACE_CELL_H = 88;
const WORKSPACE_GAP_X = 30;
const WORKSPACE_GAP_Y = 150;
const MAX_COMPONENTS = 12;
/** Sublabels must stay inside one grid cell or the layout validator rejects them. */
const SUBLABEL_MAX = 34;

const LABEL_HEIGHT = 14;

function cellX(col: number): number {
  return ORIGIN_X + col * (CELL_W + GAP_X);
}

function cellY(row: number): number {
  return ORIGIN_Y + row * (CELL_H + GAP_Y);
}

/** Horizontal center of a grid cell. */
function cellCenterX(col: number): number {
  return cellX(col) + CELL_W / 2;
}

/** Midpoint between two cell centers, used to place relationship labels. */
function midpointX(leftCol: number, rightCol: number): number {
  return (cellCenterX(leftCol) + cellCenterX(rightCol)) / 2;
}

/** Vertical middle of the empty band between two component rows. */
function bandMidY(topRow: number, bottomRow: number): number {
  return (cellY(topRow) + CELL_H + cellY(bottomRow)) / 2;
}

/**
 * Two waypoints that make a relationship leave its source downwards, cross the
 * empty band horizontally and enter the target from above.
 */
function horizontalRun(fromCol: number, toCol: number, y: number): [number, number][] {
  return [
    [cellCenterX(fromCol), y],
    [cellCenterX(toCol), y]
  ];
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Load the memory graph of one project. `selector` is a project id or a path;
 * omitted selects the most recently updated project. Returns null when no
 * project matches.
 */
export function loadProjectGraph(db: Database, selector?: string): ProjectGraphSnapshot | null {
  const project = selector ? findProject(db, selector) : latestProject(db);
  if (!project) return null;

  const sessionRows = db.raw
    .prepare(
      `SELECT id, agent, status, goal, next_action
       FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT ?`
    )
    .all(project.id, MAX_SESSIONS) as Array<Record<string, unknown>>;

  const memoriesBySession = new Map<string, number>();
  const countRows = db.raw
    .prepare(
      `SELECT session_id, COUNT(*) AS count FROM memories
       WHERE project_id = ? AND session_id IS NOT NULL GROUP BY session_id`
    )
    .all(project.id) as Array<Record<string, unknown>>;
  for (const row of countRows) {
    memoriesBySession.set(String(row.session_id), Number(row.count));
  }

  const sessions: SessionSnapshot[] = sessionRows.map((row) => {
    const id = String(row.id);
    const checkpoint = db.raw
      .prepare('SELECT goal, next_action FROM checkpoints WHERE session_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(id) as Record<string, unknown> | undefined;
    return {
      id,
      agent: String(row.agent),
      status: String(row.status),
      goal: row.goal == null ? null : String(row.goal),
      next_action: row.next_action == null ? null : String(row.next_action),
      memories: memoriesBySession.get(id) ?? 0,
      checkpoint: checkpoint
        ? {
            goal: checkpoint.goal == null ? null : String(checkpoint.goal),
            next_action: checkpoint.next_action == null ? null : String(checkpoint.next_action)
          }
        : null
    };
  });

  const groupRows = db.raw
    .prepare(
      `SELECT type, COUNT(*) AS count FROM memories
       WHERE project_id = ? GROUP BY type ORDER BY count DESC, type ASC LIMIT ?`
    )
    .all(project.id, MAX_GROUPS) as Array<Record<string, unknown>>;

  const exampleStatement = db.raw.prepare(
    `SELECT content FROM memories WHERE project_id = ? AND type = ?
     ORDER BY importance DESC, created_at DESC LIMIT 1`
  );

  const groups: MemoryGroupSnapshot[] = groupRows.map((row) => {
    const type = String(row.type);
    const example = exampleStatement.get(project.id, type) as Record<string, unknown> | undefined;
    return {
      type,
      count: Number(row.count),
      example: example?.content == null ? '' : clip(String(example.content), SUBLABEL_MAX)
    };
  });

  const total = db.raw
    .prepare('SELECT COUNT(*) AS count FROM memories WHERE project_id = ?')
    .get(project.id) as Record<string, unknown>;

  return {
    project: { id: project.id, name: project.name, path: project.path },
    sessions,
    groups,
    total_memories: Number(total.count)
  };
}

export interface ProjectRow {
  id: string;
  name: string;
  path: string;
}

function toProjectRow(row: Record<string, unknown> | undefined): ProjectRow | null {
  if (!row) return null;
  return { id: String(row.id), name: String(row.name), path: String(row.path) };
}

/**
 * Resolve a project by id, path, or name. A name that matches several projects
 * resolves to the most recently updated one.
 */
function findProject(db: Database, selector: string): ProjectRow | null {
  const byId = toProjectRow(
    db.raw.prepare('SELECT id, name, path FROM projects WHERE id = ?').get(selector) as
      | Record<string, unknown>
      | undefined
  );
  if (byId) return byId;

  const detected = detectProject(selector);
  const byPath = toProjectRow(
    db.raw
      .prepare('SELECT id, name, path FROM projects WHERE path = ? OR path_hash = ?')
      .get(detected.path, detected.id) as Record<string, unknown> | undefined
  );
  if (byPath) return byPath;

  return toProjectRow(
    db.raw
      .prepare('SELECT id, name, path FROM projects WHERE name = ? COLLATE NOCASE ORDER BY updated_at DESC LIMIT 1')
      .get(selector) as Record<string, unknown> | undefined
  );
}

function latestProject(db: Database): ProjectRow | null {
  return toProjectRow(
    db.raw.prepare('SELECT id, name, path FROM projects ORDER BY updated_at DESC LIMIT 1').get() as
      | Record<string, unknown>
      | undefined
  );
}

/**
 * Translate a project snapshot into an Archify architecture specification.
 *
 * Layout: agents and the latest checkpoint on the top band, sessions in the
 * middle band, memory clusters at the bottom. Every relationship therefore runs
 * through an empty band, which is what the renderer's flow validator requires
 * (an edge may never cross an unrelated node).
 */
export function buildArchifySpec(snapshot: ProjectGraphSnapshot): ArchifySpec {
  const components: ArchifyComponent[] = [];
  const connections: ArchifyConnection[] = [];
  const size: [number, number] = [CELL_W, CELL_H];

  const agents = [...new Set(snapshot.sessions.map((s) => s.agent))];
  const hasSessions = snapshot.sessions.length > 0;
  const latest = snapshot.sessions[0];
  const hasCheckpoint = hasSessions && latest?.checkpoint != null;

  if (hasSessions) {
    components.push({
      id: 'agent',
      type: 'external',
      label: 'Agent',
      sublabel: clip(agents.join(', ') || 'unknown', SUBLABEL_MAX),
      size,
      row: 0,
      col: 0
    });
  }

  if (hasCheckpoint) {
    components.push({
      id: 'checkpoint',
      type: 'messagebus',
      label: 'Checkpoint',
      sublabel: clip(latest?.checkpoint?.goal ?? latest?.goal ?? 'latest state', SUBLABEL_MAX),
      size,
      row: 0,
      col: 1
    });
  }

  snapshot.sessions.forEach((session, index) => {
    components.push({
      id: `session_${index}`,
      type: 'backend',
      label: `Session ${index === 0 ? 'latest' : `#${index + 1}`}`,
      sublabel: clip(`${session.agent} · ${session.status}`, SUBLABEL_MAX),
      tag: session.memories > 0 ? `${session.memories} memories` : undefined,
      size,
      row: 1,
      col: index
    });
    connections.push({
      id: `agent_session_${index}`,
      from: 'agent',
      to: `session_${index}`,
      label: index === 0 ? 'session_start' : undefined,
      labelAt:
        index === 0
          ? [cellCenterX(0) + 14, bandMidY(0, 1) - LABEL_HEIGHT / 2]
          : [midpointX(0, index) - 24, bandMidY(0, 1) - LABEL_HEIGHT / 2],
      fromSide: 'bottom',
      toSide: 'top',
      via: index === 0 ? undefined : horizontalRun(0, index, bandMidY(0, 1)),
      variant: index === 0 ? 'emphasis' : 'dashed'
    });
  });

  if (hasCheckpoint) {
    connections.push({
      id: 'session_checkpoint',
      from: 'session_0',
      to: 'checkpoint',
      label: 'checkpoint',
      labelAt: [midpointX(0, 1) - 30, bandMidY(0, 1) - LABEL_HEIGHT / 2],
      fromSide: 'top',
      toSide: 'bottom',
      via: horizontalRun(0, 1, bandMidY(0, 1))
    });
  }

  if (!hasSessions && components.length === 0) {
    components.push({
      id: 'project',
      type: 'backend',
      label: clip(snapshot.project.name, 28),
      sublabel: 'no sessions recorded yet',
      size,
      row: 0,
      col: 0
    });
  }

  snapshot.groups.forEach((group, index) => {
    components.push({
      id: `group_${index}`,
      type: 'database',
      label: `${group.type} ×${group.count}`,
      sublabel: group.example || undefined,
      size,
      row: 2,
      col: index
    });
    if (hasSessions) {
      connections.push({
        id: `session_group_${index}`,
        from: 'session_0',
        to: `group_${index}`,
        label: 'memory',
        labelAt:
          index === 0
            ? [cellCenterX(0) + 14, bandMidY(1, 2) - LABEL_HEIGHT / 2]
            : [midpointX(0, index) - 22, bandMidY(1, 2) - LABEL_HEIGHT / 2],
        fromSide: 'bottom',
        toSide: 'top',
        via: index === 0 ? undefined : horizontalRun(0, index, bandMidY(1, 2))
      });
    }
  });

  const cards: ArchifySpec['cards'] = [
    {
      dot: 'cyan',
      title: 'Scope',
      items: [
        `${snapshot.sessions.length} session(s) · ${snapshot.total_memories} memories`,
        clip(snapshot.project.path, 60)
      ]
    }
  ];
  if (snapshot.groups.length > 0) {
    cards.push({
      dot: 'emerald',
      title: 'Memory mix',
      items: snapshot.groups.slice(0, 3).map((group) => `${group.type} ×${group.count}`)
    });
  }
  const continuity = [latest?.checkpoint?.next_action ?? latest?.next_action, latest?.checkpoint?.goal ?? latest?.goal]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  if (continuity.length > 0) {
    cards.push({ dot: 'rose', title: 'Continuity', items: continuity.map((value) => clip(value, 64)) });
  }

  return assembleSpec({
    title: `MemoSaver Memory Graph — ${clip(snapshot.project.name, 40)}`,
    components,
    connections,
    boundaryLabel: `Project: ${clip(snapshot.project.name, 40)}`,
    cards
  });
}

/**
 * Shared spec envelope: caps the component list, drops relationships whose
 * endpoints were dropped, and derives the grid column count from the cells used.
 */
function assembleSpec(options: {
  title: string;
  components: ArchifyComponent[];
  connections: ArchifyConnection[];
  boundaryLabel: string;
  cards: ArchifySpec['cards'];
  geometry?: { cellW: number; cellH: number; gapX: number; gapY: number };
}): ArchifySpec {
  const kept = options.components.slice(0, MAX_COMPONENTS);
  const keptIds = new Set(kept.map((component) => component.id));
  const geometry = options.geometry ?? { cellW: CELL_W, cellH: CELL_H, gapX: GAP_X, gapY: GAP_Y };
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: options.title, quality_profile: 'standard' },
    layout: {
      mode: 'grid',
      origin: [ORIGIN_X, ORIGIN_Y],
      cols: kept.reduce((max, component) => Math.max(max, component.col + 1), 1),
      cellW: geometry.cellW,
      cellH: geometry.cellH,
      gapX: geometry.gapX,
      gapY: geometry.gapY
    },
    components: kept,
    connections: options.connections.filter((c) => keptIds.has(c.from) && keptIds.has(c.to)),
    boundaries: [{ kind: 'region', label: options.boundaryLabel, wraps: kept.map((c) => c.id) }],
    cards: options.cards
  };
}

/**
 * Load one page of the project list (most recently updated first). The page size
 * is capped by what a single validated diagram can hold; `totals` always counts
 * every project, session and memory in the database.
 */
export function loadWorkspace(
  db: Database,
  options: { page?: number; limit?: number } = {}
): WorkspaceSnapshot {
  const requestedPage = Math.max(1, Math.trunc(options.page ?? 1) || 1);
  const requested = Math.trunc(options.limit ?? DEFAULT_PROJECTS_PER_PAGE) || DEFAULT_PROJECTS_PER_PAGE;
  const pageSize = Math.min(Math.max(requested, 1), MAX_PROJECTS_PER_PAGE);

  const totalsRow = db.raw
    .prepare(
      `SELECT (SELECT COUNT(*) FROM projects) AS projects,
              (SELECT COUNT(*) FROM sessions) AS sessions,
              (SELECT COUNT(*) FROM memories) AS memories`
    )
    .get() as Record<string, unknown>;

  const totals = {
    projects: Number(totalsRow.projects),
    sessions: Number(totalsRow.sessions),
    memories: Number(totalsRow.memories)
  };
  // An out-of-range page is clamped, never rendered as an empty workspace.
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(totals.projects / pageSize)));
  const offset = (page - 1) * pageSize;

  const rows = db.raw
    .prepare(
      `SELECT p.id, p.name, p.path,
         (SELECT COUNT(*) FROM sessions s WHERE s.project_id = p.id) AS sessions,
         (SELECT COUNT(*) FROM memories m WHERE m.project_id = p.id) AS memories,
         (SELECT s.agent FROM sessions s WHERE s.project_id = p.id ORDER BY s.started_at DESC LIMIT 1) AS agent,
         (SELECT s.status FROM sessions s WHERE s.project_id = p.id ORDER BY s.started_at DESC LIMIT 1) AS status
       FROM projects p ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`
    )
    .all(pageSize, offset) as Array<Record<string, unknown>>;

  const projects: OverviewProjectSnapshot[] = rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    path: String(row.path),
    sessions: Number(row.sessions),
    memories: Number(row.memories),
    agent: row.agent == null ? null : String(row.agent),
    status: row.status == null ? null : String(row.status)
  }));

  return { projects, page, page_size: pageSize, totals };
}

/**
 * Workspace overview: a compact grid of project nodes. Relationships are
 * deliberately omitted — the agent and session status live in each node's tag,
 * and a grid keeps the diagram wide-but-short so the viewer renders it at a
 * readable size instead of shrinking one long band to nothing.
 */
export function buildWorkspaceSpec(snapshot: WorkspaceSnapshot): ArchifySpec {
  const size: [number, number] = [WORKSPACE_CELL_W, WORKSPACE_CELL_H];
  const geometry = {
    cellW: WORKSPACE_CELL_W,
    cellH: WORKSPACE_CELL_H,
    gapX: WORKSPACE_GAP_X,
    gapY: WORKSPACE_GAP_Y
  };
  const components: ArchifyComponent[] = [];

  if (snapshot.projects.length === 0) {
    components.push({
      id: 'workspace',
      type: 'backend',
      label: 'Workspace',
      sublabel: 'no projects yet',
      size,
      row: 0,
      col: 0
    });
    return assembleSpec({
      title: 'MemoSaver Workspace',
      components,
      connections: [],
      boundaryLabel: 'Workspace',
      cards: [{ dot: 'cyan', title: 'Scope', items: ['No projects recorded yet', 'Run a session or save a memory'] }],
      geometry
    });
  }

  snapshot.projects.forEach((project, index) => {
    components.push({
      id: `project_${index}`,
      type: 'backend',
      label: clip(project.name, 24),
      sublabel: clip(`${project.sessions} sessions · ${project.memories} memories`, 30),
      tag: project.status ? `${project.agent ?? 'agent'} · ${project.status}` : undefined,
      size,
      row: Math.floor(index / WORKSPACE_COLS),
      col: index % WORKSPACE_COLS
    });
  });

  const busiest = [...snapshot.projects].sort((a, b) => b.memories - a.memories).slice(0, 3);
  const agents = [
    ...new Set(snapshot.projects.map((project) => project.agent).filter((agent): agent is string => agent != null))
  ];
  const first = (snapshot.page - 1) * snapshot.page_size + 1;
  const last = first + snapshot.projects.length - 1;
  const pages = Math.max(1, Math.ceil(snapshot.totals.projects / snapshot.page_size));
  const paged = snapshot.totals.projects > snapshot.projects.length;

  return assembleSpec({
    title: paged
      ? `MemoSaver Workspace — projects ${first}–${last} of ${snapshot.totals.projects}`
      : `MemoSaver Workspace — ${snapshot.projects.length} project(s)`,
    components,
    connections: [],
    boundaryLabel: 'Workspace',
    geometry,
    cards: [
      {
        dot: 'cyan',
        title: 'Scope',
        items: [
          `${snapshot.totals.projects} projects · ${snapshot.totals.sessions} sessions · ${snapshot.totals.memories} memories`,
          paged
            ? `Showing projects ${first}–${last} · page ${snapshot.page}/${pages} (add ?page=${Math.min(snapshot.page + 1, pages)})`
            : `Showing all ${snapshot.projects.length} projects`,
          `Agents: ${clip(agents.join(', ') || 'none', 60)}`
        ]
      },
      {
        dot: 'emerald',
        title: 'Busiest projects',
        items: busiest.map((project) => `${clip(project.name, 24)} · ${project.memories} memories`)
      }
    ]
  });
}
