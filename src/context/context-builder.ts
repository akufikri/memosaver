import type { Checkpoint, Memory, Project, ResumeContext, ResumeSection, Session } from '../types.js';

export interface ContextBuildOptions {
  maxTokens?: number;
  maxMemories?: number;
  currentAgent?: string;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class ContextBuilder {
  build(
    project: Project,
    session: Session | null,
    checkpoint: Checkpoint | null,
    memories: Memory[],
    options: ContextBuildOptions = {}
  ): ResumeContext {
    const maxTokens = options.maxTokens ?? 4000;
    const maxMemories = options.maxMemories ?? 25;

    const sections: ResumeSection[] = [];
    sections.push(projectSection(project));
    if (session) sections.push(sessionSection(session, options.currentAgent));
    if (checkpoint) sections.push(checkpointSection(checkpoint));

    const pending = memories.filter((m) => m.type === 'TASK');
    if (pending.length > 0) {
      sections.push(memoryListSection('PENDING TASKS', pending.slice(0, 6), 'memory'));
    }

    const decisions = memories.filter(
      (m) => m.type === 'DECISION' || m.type === 'ARCHITECTURE' || m.type === 'PREFERENCE'
    );
    if (decisions.length > 0) {
      sections.push(memoryListSection('IMPORTANT DECISIONS', decisions.slice(0, 8), 'memory'));
    }

    const blockers = memories.filter((m) => m.type === 'ERROR').slice(0, 3);
    if (blockers.length > 0) {
      sections.push(memoryListSection('LAST BLOCKERS', blockers, 'memory'));
    }

    const alreadyUsed = new Set<string>(pending.map((m) => m.id));
    decisions.forEach((m) => alreadyUsed.add(m.id));
    blockers.forEach((m) => alreadyUsed.add(m.id));

    const remaining = memories
      .filter((m) => !alreadyUsed.has(m.id))
      .filter((m) => m.importance >= 0.6)
      .slice(0, Math.max(0, maxMemories - 8));
    if (remaining.length > 0) {
      sections.push(memoryListSection('KEY CONTEXT', remaining, 'history'));
    }

    const kept = trimToBudget(sections, maxTokens);
    return {
      project_id: project.id,
      session_id: session?.id ?? null,
      project_name: project.name,
      resume_available: Boolean(session) || memories.length > 0,
      context: render(kept),
      sections: kept,
      generated_at: Date.now()
    };
  }
}

function projectSection(project: Project): ResumeSection {
  return {
    title: 'PROJECT CONTEXT',
    body: [
      `Project: ${project.name}`,
      `Path: ${project.path}`,
      `Last updated: ${new Date(project.updated_at).toISOString()}`
    ].join('\n'),
    source: 'project'
  };
}

function sessionSection(session: Session, currentAgent?: string): ResumeSection {
  const toolSwitch = currentAgent && currentAgent !== session.agent;
  const title = toolSwitch
    ? `LAST SESSION [${session.agent} → ${currentAgent}]`
    : 'LAST SESSION';
  const lines = [
    `Session: ${session.id}`,
    `Agent: ${session.agent}`,
    `Started: ${new Date(session.started_at).toISOString()}`
  ];
  if (session.ended_at) lines.push(`Ended: ${new Date(session.ended_at).toISOString()}`);
  if (toolSwitch) lines.push(`Continuing as: ${currentAgent}`);
  if (session.goal) lines.push(`Goal: ${session.goal}`);
  if (session.current_task) lines.push(`Current task: ${session.current_task}`);
  if (session.summary) lines.push(`Summary: ${session.summary}`);
  if (session.next_action) lines.push(`Next action: ${session.next_action}`);
  return { title, body: lines.join('\n'), source: 'session' };
}

function checkpointSection(checkpoint: Checkpoint): ResumeSection {
  const lines: string[] = [];
  if (checkpoint.goal) lines.push(`Goal: ${checkpoint.goal}`);
  if (checkpoint.current_state) lines.push(`Current state: ${checkpoint.current_state}`);
  if (checkpoint.completed) lines.push(`Completed: ${checkpoint.completed}`);
  if (checkpoint.pending) lines.push(`Pending: ${checkpoint.pending}`);
  if (checkpoint.blockers) lines.push(`Blockers: ${checkpoint.blockers}`);
  if (checkpoint.next_action) lines.push(`Next action: ${checkpoint.next_action}`);
  lines.push(`Checkpoint created: ${new Date(checkpoint.created_at).toISOString()}`);
  return { title: 'LATEST CHECKPOINT', body: lines.join('\n'), source: 'checkpoint' };
}

function memoryListSection(title: string, memories: Memory[], source: ResumeSection['source']): ResumeSection {
  const body = memories.map((m) => `- ${m.content} [imp ${m.importance.toFixed(2)}]`).join('\n');
  return { title, body, source };
}

function trimToBudget(sections: ResumeSection[], maxTokens: number): ResumeSection[] {
  const kept: ResumeSection[] = [];
  let budget = maxTokens;
  for (const section of sections) {
    const rendered = renderSection(section);
    const tokens = estimateTokens(rendered);
    if (tokens > budget) break;
    kept.push(section);
    budget -= tokens;
  }
  return kept;
}

export function renderSection(section: ResumeSection): string {
  const divider = '='.repeat(section.title.length);
  return [`${section.title}`, divider, section.body, ''].join('\n');
}

function render(sections: ResumeSection[]): string {
  return sections.map(renderSection).join('\n').trim();
}