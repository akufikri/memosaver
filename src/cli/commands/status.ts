import type { Command } from 'commander';
import type { AppCore } from '../../app.js';

export function registerStatusCommand(program: Command, getApp: () => AppCore): void {
  program
    .command('status')
    .description('Show overall MemoSaver status')
    .action(() => {
      const app = getApp();
      const status = app.service.status();
      console.log(`MemoSaver status`);
      console.log(`  Storage:    ${app.config.homeDir}`);
      console.log(`  Database:   ${app.config.dbPath}`);
      console.log(`  Projects:   ${status.projects}`);
      console.log(`  Sessions:   ${status.sessions} (${status.active_sessions} active)`);
      console.log(`  Memories:   ${status.memories}`);
    });
}