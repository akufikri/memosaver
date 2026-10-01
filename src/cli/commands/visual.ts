import type { Command } from 'commander';
import { startVisualServer } from '../../web/server.js';
import { loadConfig, ensureHomeDir } from '../../util/config.js';
import { Database } from '../../storage/database.js';
import { migrate } from '../../storage/migrations.js';

export function registerVisualCommand(program: Command): void {
  program
    .command('visual')
    .description('Serve the memory graph as an Archify architecture diagram and open it (http://localhost:8888/visual)')
    .option('-p, --port <port>', 'port to bind', '8888')
    .option('-h, --host <host>', 'host to bind', '127.0.0.1')
    .option('--project <id|path|name>', 'project to diagram (default: workspace overview)')
    .option('--limit <n>', 'projects per workspace page (1-12)', '12')
    .option('--page <n>', 'workspace page (1-based)', '1')
    .option('-o, --open', 'open the browser automatically (default)')
    .option('--no-open', 'do not open the browser')
    .action((opts: { port: string; host: string; open: boolean; project?: string; limit: string; page: string }) => {
      const config = loadConfig();
      ensureHomeDir(config);
      const db = Database.open(config.dbPath);
      migrate(db);
      const server = startVisualServer({
        host: opts.host,
        port: Number(opts.port),
        db,
        open: opts.open,
        project: opts.project,
        limit: Number(opts.limit),
        page: Number(opts.page)
      });
      server.on('close', () => db.close());
    });
}