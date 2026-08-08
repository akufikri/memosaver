import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from '../storage/database.js';
import { buildGraph } from './graph.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const HTML = readFileSync(resolve(__dirname, 'visual.html'), 'utf8');
const APP_JS = readFileSync(resolve(__dirname, 'visual.js'), 'utf8');

export interface VisualServerOptions {
  host?: string;
  port?: number;
  db: Database;
  /** open the browser automatically once the server is listening */
  open?: boolean;
}

/**
 * Minimal zero-dependency HTTP server exposing the memory graph:
 *  - GET /        -> API listing + link to the visual
 *  - GET /visual  -> interactive force-directed network view
 *  - GET /api/graph -> JSON graph (nodes + edges)
 */
export function startVisualServer(options: VisualServerOptions): ReturnType<typeof createServer> {
  const { db, host = '127.0.0.1', port = 8888, open = false } = options;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${host}:${port}`);
    const route = url.pathname;

    if (route === '/visual') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(HTML);
      return;
    }

    if (route === '/visual.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(APP_JS);
      return;
    }

    if (route.startsWith('/vendor/')) {
      const file = resolve(__dirname, route.replace(/^\/+/, ''));
      if (!existsSync(file) || !file.startsWith(resolve(__dirname, 'vendor'))) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('vendor file not found — run: pnpm build');
        return;
      }
      const mime = extname(file) === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
      res.writeHead(200, { 'content-type': mime });
      res.end(readFileSync(file));
      return;
    }

    if (route === '/api/graph') {
      const projectId = url.searchParams.get('project');
      const graph = buildGraph(db, projectId ?? undefined);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(graph));
      return;
    }

    if (route === '/api/projects') {
      const projects = db.raw
        .prepare('SELECT id, name, path FROM projects ORDER BY name')
        .all() as unknown as Array<{ id: string; name: string; path: string }>;
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(projects));
      return;
    }

    if (route === '/' || route === '') {
      const graph = buildGraph(db);
      const summary = summarize(graph.nodes.length, graph.edges.length);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<html><head><title>MemoSaver Visual</title></head><body style="font-family:system-ui">
<h1>MemoSaver Visual</h1><p>${summary}</p>
<p><a href="/visual">Open interactive network →</a></p>
<p><a href="/api/graph">API: /api/graph</a></p>
</body></html>`
      );
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

    let attempt = 0;
  let opened = false;
  function startListen(p: number): void {
    attempt++;
    server.listen(p, host, () => {
      console.log(`MemoSaver visual running at http://${host}:${p}/visual`);
      if (open && !opened) {
        opened = true;
        openBrowser(`http://${host}:${p}/visual`);
      }
    });
  }

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && attempt < 20) {
      startListen(port + attempt);
    } else {
      console.error(`visual server error: ${err.message}`);
      server.close();
    }
  });

  startListen(port);

  return server;
}

function summarize(nodes: number, edges: number): string {
  return `${nodes} nodes, ${edges} edges in the memory graph.`;
}

function openBrowser(url: string): void {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
      spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // opening the browser is best-effort
  }
}
