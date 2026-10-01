#!/usr/bin/env node
import { Command } from 'commander';
import { createApp, type AppCore } from '../app.js';
import { VERSION } from '../version.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerInstallCommand } from './commands/install.js';
import { registerMemoryCommands } from './commands/memory.js';
import { registerProjectCommands } from './commands/project.js';
import { registerSessionCommands } from './commands/session.js';
import { registerStatusCommand } from './commands/status.js';
import { registerVisualCommand } from './commands/visual.js';
import { startMcpServer } from '../mcp/server.js';

let _app: AppCore | null = null;
function getApp(): AppCore {
  if (!_app) _app = createApp();
  return _app;
}

export function run(): void {
  const program = new Command();
  program
    .name('memosaver')
    .description('Local-first persistent memory and session continuity for AI agents')
    .version(VERSION);

  registerStatusCommand(program, getApp);
  registerProjectCommands(program, getApp);
  registerSessionCommands(program, getApp);
  registerMemoryCommands(program, getApp);
  registerDoctorCommand(program);
  registerInstallCommand(program);
  registerVisualCommand(program);

  program
    .command('mcp')
    .description('Run the MCP server over stdio (debug helper; normally invoked via the memosaver-mcp bin)')
    .action(async () => {
      await startMcpServer();
    });

  program.parse(process.argv);
}

run();