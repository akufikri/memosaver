export type SessionStatus = 'active' | 'completed' | 'interrupted';

export type MemoryType =
  | 'FACT'
  | 'DECISION'
  | 'ARCHITECTURE'
  | 'TASK'
  | 'PROGRESS'
  | 'ERROR'
  | 'SOLUTION'
  | 'CONTEXT'
  | 'PREFERENCE'
  | 'CHECKPOINT';

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

export interface Project {
  id: string;
  name: string;
  path: string;
  path_hash: string;
  created_at: number;
  updated_at: number;
  last_session_id: string | null;
}

export interface Session {
  id: string;
  project_id: string;
  agent: string;
  started_at: number;
  ended_at: number | null;
  status: SessionStatus;
  summary: string | null;
  goal: string | null;
  current_task: string | null;
  next_action: string | null;
}

export interface Memory {
  id: string;
  project_id: string;
  session_id: string | null;
  type: MemoryType;
  content: string;
  importance: number;
  metadata: Record<string, unknown>;
  created_at: number;
  updated_at: number;
}

export interface Checkpoint {
  id: string;
  session_id: string;
  goal: string | null;
  current_state: string | null;
  completed: string | null;
  pending: string | null;
  blockers: string | null;
  next_action: string | null;
  created_at: number;
}

export interface MemoryCandidate {
  type: MemoryType;
  content: string;
  importance: number;
  metadata?: Record<string, unknown>;
}

export interface ResumeContext {
  project_id: string;
  session_id: string | null;
  project_name: string;
  resume_available: boolean;
  context: string;
  sections: ResumeSection[];
  generated_at: number;
}

export interface ResumeSection {
  title: string;
  body: string;
  source: 'project' | 'session' | 'checkpoint' | 'memory' | 'history';
}

export interface EventActivity {
  /** free-form text produced by the agent (message, tool result, decision, error...) */
  text: string;
  /** optional explicit classification hint */
  type?: MemoryType;
  /** session id if the event belongs to a session */
  session_id?: string;
  timestamp?: number;
}

export interface CaptureResult {
  captured: number;
  ignored: number;
  memories: Memory[];
}
