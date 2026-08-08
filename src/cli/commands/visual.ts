import type { Command } from 'commander';
import { startVisualServer } from '../../web/server.js';
import { loadConfig, ensureHomeDir } from '../../util/config.js';
import { Database } from '../../storage/database.js';
import { migrate } from '../../storage/migrations.js';

export function registerVisualCommand(program: Command): void {
  program
    .command('visual')
    .description('Serve the memory network visualisation and open it in the browser (http://localhost:8888/visual)')
    .option('-p, --port <port>', 'port to bind', '8888')
    .option('-h, --host <host>', 'host to bind', '127.0.0.1')
    .option('-o, --open', 'open the browser automatically (default)')
    .option('--no-open', 'do not open the browser')
    .action((opts: { port: string; host: string; open: boolean }) => {
      const config = loadConfig();
      ensureHomeDir(config);
      const db = Database.open(config.dbPath);
      migrate(db);
      const server = startVisualServer({
        host: opts.host,
        port: Number(opts.port),
        db,
        open: opts.open
      });
      server.on('close', () => db.close());
    });
}