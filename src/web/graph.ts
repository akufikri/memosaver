import type { Database } from '../storage/database.js';

export interface GraphNode {
  id: string;
  label: string;
  kind: 'project' | 'session' | 'memory' | 'checkpoint';
  type?: string;
  importance?: number;
  status?: string;
  agent?: string;
  created_at?: number;
  size: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: 'contains' | 'similar';
  weight: number;
}

export interface MemoryGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Build a connected network from the persisted memory store:
 *  - vertical edges: project -> session -> memory/checkpoint (contains)
 *  - horizontal edges: memories sharing meaningful keywords (similar)
 * This mirrors the "memory as a connected network" visualisation.
 */
export function buildGraph(db: Database, projectId?: string): MemoryGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();

  const projects = db.raw
    .prepare('SELECT id, name, path, created_at FROM projects')
    .all() as unknown as Array<{ id: string; name: string; path: string; created_at: number }>;

  const sessions = db.raw
    .prepare('SELECT id, project_id, agent, status, started_at FROM sessions')
    .all() as unknown as Array<{ id: string; project_id: string; agent: string; status: string; started_at: number }>;

  const memories = db.raw
    .prepare('SELECT id, project_id, session_id, content, type, importance, created_at FROM memories')
    .all() as unknown as Array<{
    id: string;
    project_id: string;
    session_id: string | null;
    content: string;
    type: string;
    importance: number;
    created_at: number;
  }>;

  const checkpoints = db.raw
    .prepare('SELECT id, session_id, goal, created_at FROM checkpoints')
    .all() as unknown as Array<{ id: string; session_id: string; goal: string | null; created_at: number }>;

  const projectIdSet = projectId ? new Set([projectId]) : new Set(projects.map((p) => p.id));
  const allowedProject = (id: string | null | undefined): boolean =>
    id == null || projectIdSet.has(id);

  const availableProjects = projects.filter((p) => projectIdSet.has(p.id));
  const availableSessions = sessions.filter((s) => allowedProject(s.project_id));
  const availableMemories = memories.filter((m) => allowedProject(m.project_id));
  const availableCheckpoints = checkpoints.filter((c) =>
    availableSessions.some((s) => s.id === c.session_id)
  );

  const addNode = (node: GraphNode): void => {
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodes.push(node);
  };

  const addEdge = (edge: GraphEdge): void => {
    edges.push(edge);
  };

  for (const project of availableProjects) {
    addNode({
      id: `project:${project.id}`,
      label: project.name,
      kind: 'project',
      size: 30
    });
  }

  for (const session of availableSessions) {
    addNode({
      id: `session:${session.id}`,
      label: `Session ${session.agent ?? 'agent'}`,
      kind: 'session',
      status: session.status,
      agent: session.agent,
      size: 16
    });
    addEdge({ source: `project:${session.project_id}`, target: `session:${session.id}`, kind: 'contains', weight: 1 });
  }

  for (const memory of availableMemories) {
    addNode({
      id: `memory:${memory.id}`,
      label: memory.content,
      kind: 'memory',
      type: memory.type,
      importance: memory.importance,
      size: 10
    });
    if (memory.project_id && projectIdSet.has(memory.project_id)) {
      addEdge({
        source: `project:${memory.project_id}`,
        target: `memory:${memory.id}`,
        kind: 'contains',
        weight: 1
      });
    }
    if (memory.session_id) {
      addEdge({
        source: `session:${memory.session_id}`,
        target: `memory:${memory.id}`,
        kind: 'contains',
        weight: 1
      });
    }
  }

  for (const checkpoint of availableCheckpoints) {
    addNode({
      id: `checkpoint:${checkpoint.id}`,
      label: checkpoint.goal ?? 'Checkpoint',
      kind: 'checkpoint',
      size: 14
    });
    addEdge({
      source: `session:${checkpoint.session_id}`,
      target: `checkpoint:${checkpoint.id}`,
      kind: 'contains',
      weight: 1
    });
  }

  const similarityEdges = addSimilarityEdges(availableMemories);
  for (const edge of similarityEdges) {
    addEdge(edge);
  }

  return { nodes, edges };
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'for', 'to', 'in', 'on', 'with', 'by', 'at', 'is',
  'are', 'was', 'were', 'be', 'been', 'from', 'as', 'that', 'this', 'it', 'its', 'has', 'have',
  'had', 'not', 'no', 'yes', 'if', 'then', 'than', 'so', 'we', 'you', 'they', 'them', 'their',
  'project', 'using', 'yang', 'dan', 'ini', 'untuk', 'dengan', 'dari', 'di', 'ke', 'pada', 'akan',
  'sudah', 'belum', 'menggunakan', 'data', 'user', 'the', 'app', 'set', 'setup', 'new', 'use'
]);

function tokenize(content: string): string[] {
  const tokens = content
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  const unique = new Set(tokens);
  return [...unique];
}

function addSimilarityEdges(
  memories: Array<{ id: string; content: string }>
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const tokens = memories.map((m) => new Set(tokenize(m.content)));
  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      const a = tokens[i]!;
      const b = tokens[j]!;
      if (a.size === 0 || b.size === 0) continue;
      let shared = 0;
      for (const token of a) {
        if (b.has(token)) shared++;
      }
      if (shared === 0) continue;
      const union = new Set([...a, ...b]);
      const weight = shared / union.size;
      if (weight < 0.15) continue;
      edges.push({
        source: `memory:${memories[i]!.id}`,
        target: `memory:${memories[j]!.id}`,
        kind: 'similar',
        weight: Math.round(weight * 100)
      });
    }
  }
  return edges;
}