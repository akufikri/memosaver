import type { Command } from 'commander';
import type { AppCore } from '../../app.js';

export function registerSessionCommands(program: Command, getApp: () => AppCore): void {
  program
    .command('sessions')
    .description('List sessions, optionally filtered by project path')
    .argument('[project_path]', 'project directory path')
    .option('-l, --limit <n>', 'max rows', '50')
    .action((projectPath: string | undefined, opts: { limit: string }) => {
      const app = getApp();
      const limit = Number(opts.limit);
      const pid = projectPath ? app.service.getProjectByPath(projectPath)?.id : undefined;
      const sessions = app.service.listSessions(pid, Number.isFinite(limit) ? limit : 50);
      if (sessions.length === 0) {
        console.log('No sessions found.');
        return;
      }
      for (const session of sessions) {
        const started = new Date(session.started_at).toISOString();
const ended = session.ended_at ? new Date(session.ended_at).toISOString() : '-';
        console.log(
          `${session.id}  ${session.status.padEnd(10)} agent=${session.agent}  ${session.project_id}`
        );
        console.log(`    started ${started}  ended ${ended}`);
      }
    });

  program
    .command('session')
    .description('Inspect or manage one session')
    .argument('<session_id>', 'session id')
    .option('--end', 'end the session (status completed)')
    .option('--interrupt', 'end the session as interrupted')
    .option('--timeline', 'print checkpoints and memories in chronological order')
    .action((sessionId: string, opts: { end?: boolean; interrupt?: boolean; timeline?: boolean }) => {
      const app = getApp();
      if (opts.end || opts.interrupt) {
        const ended = app.service.endSession(sessionId, {
          status: opts.end ? 'completed' : 'interrupted'
        });
        if (!ended) {
          exitError(`session not found: ${sessionId}`);
          return;
        }
        console.log(`session ${sessionId} ended (${ended.status}).`);
        return;
      }
      if (opts.timeline) {
        try {
          const timeline = app.service.sessionTimeline(sessionId);
          printTimeline(timeline);
          return;
        } catch (err) {
          exitError((err as Error).message);
          return;
        }
      }
      const session = app.service.getSession(sessionId);
      if (!session) {
        exitError(`session not found: ${sessionId}`);
        return;
      }
      printSession(session);
    });
}

function printTimeline(timeline: import('../../service/memosaver-service.js').SessionTimeline): void {
  const { session } = timeline;
  console.log(`Session: ${session.id}  (${session.status})`);
  if (session.goal) console.log(`  goal: ${session.goal}`);
  if (timeline.events.length === 0) {
    console.log('  (no checkpoints or memories recorded)');
    return;
  }
  for (const event of timeline.events) {
    const at = new Date(event.at).toISOString();
    if (event.kind === 'checkpoint') {
      const c = event.checkpoint;
      console.log(`  [${at}] CHECKPOINT`);
      if (c.completed) console.log(`      completed: ${c.completed}`);
      if (c.pending) console.log(`      pending:   ${c.pending}`);
      if (c.next_action) console.log(`      next:      ${c.next_action}`);
    } else {
      const m = event.memory;
      console.log(`  [${at}] ${m.type} imp=${m.importance.toFixed(2)} ${m.content}`);
    }
  }
}

function printSession(session: import('../../types.js').Session): void {
  console.log(`Session: ${session.id}`);
  console.log(`  project: ${session.project_id}`);
  console.log(`  agent:   ${session.agent}`);
  console.log(`  status:  ${session.status}`);
  console.log(`  started: ${new Date(session.started_at).toISOString()}`);
  console.log(`  ended:   ${session.ended_at ? new Date(session.ended_at).toISOString() : '-'}`);
  if (session.goal) console.log(`  goal:   ${session.goal}`);
  if (session.current_task) console.log(`  current:${session.current_task}`);
  if (session.next_action) console.log(`  next:   ${session.next_action}`);
  if (session.summary) console.log(`  summary:${session.summary}`);
}

function exitError(message: string): void {
  console.error(message);
  process.exitCode = 1;
}