import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Database } from '../storage/database.js';
import {
  buildArchifySpec,
  buildWorkspaceSpec,
  DEFAULT_PROJECTS_PER_PAGE,
  loadProjectGraph,
  loadWorkspace,
  type ArchifySpec
} from './archify-spec.js';
import { ArchifyRenderError, renderArchifyArtifact } from './archify-render.js';

export interface VisualServerOptions {
  host?: string;
  port?: number;
  db: Database;
  /** open the browser automatically once the server is listening */
  open?: boolean;
  /** project id, path or name to diagram; defaults to the workspace overview */
  project?: string;
  /** workspace overview page size (capped by the renderer layout) */
  limit?: number;
  /** workspace overview page (1-based) */
  page?: number;
}

const CACHE_LIMIT = 8;

/**
 * Minimal zero-dependency HTTP server exposing the memory graph as an Archify
 * architecture diagram (self-contained HTML, rendered from the live database):
 *  - GET /            -> project index + link into the diagram
 *  - GET /visual      -> rendered diagram; every project overview by default, one
 *                        project with ?project=<id|path>
 *  - GET /api/spec    -> the generated Archify specification as JSON
 */
export function startVisualServer(options: VisualServerOptions): Server {
  const { db, host = '127.0.0.1', port = 8888, open = false, project: initialSelector } = options;
  const cache = new Map<string, string>();

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${host}:${port}`);
    const route = url.pathname;
    const selector = url.searchParams.get('project') ?? initialSelector ?? undefined;
    const paging = {
      page: toPositiveInt(url.searchParams.get('page'), options.page ?? 1) ?? 1,
      limit: toPositiveInt(url.searchParams.get('limit'), options.limit)
    };

    if (route === '/visual') {
      void serveDiagram(db, res, selector, paging, cache);
      return;
    }

    if (route === '/api/spec') {
      const spec = specFor(db, selector, paging);
      if (!spec) {
        send(res, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'project not found' }));
        return;
      }
      send(res, 200, 'application/json; charset=utf-8', JSON.stringify(spec, null, 2));
      return;
    }

    if (route === '/' || route === '') {
      send(res, 200, 'text/html; charset=utf-8', renderIndex(db, selector));
      return;
    }

    send(res, 404, 'text/plain; charset=utf-8', 'Not found');
  });

  let attempt = 0;
  let opened = false;
  function startListen(p: number): void {
    attempt++;
    server.listen(p, host, () => {
      const target = `http://${host}:${p}/visual${initialSelector ? `?project=${encodeURIComponent(initialSelector)}` : ''}`;
      console.log(`MemoSaver visual running at ${target}`);
      if (open && !opened) {
        opened = true;
        openBrowser(target);
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

export interface WorkspacePaging {
  page: number;
  limit?: number;
}

/**
 * Diagram specification for a request: one project when `selector` is given,
 * otherwise a page of the workspace overview.
 */
function specFor(db: Database, selector: string | undefined, paging: WorkspacePaging): ArchifySpec | null {
  if (!selector) return buildWorkspaceSpec(loadWorkspace(db, paging));
  const snapshot = loadProjectGraph(db, selector);
  return snapshot ? buildArchifySpec(snapshot) : null;
}

async function serveDiagram(
  db: Database,
  res: ServerResponse,
  selector: string | undefined,
  paging: WorkspacePaging,
  cache: Map<string, string>
): Promise<void> {
  const spec = specFor(db, selector, paging);
  if (!spec) {
    send(res, 404, 'text/html; charset=utf-8', page('No project found', `Nothing stored for "${selector ?? ''}". Run a session first, or pass ?project=<id|path>.`));
    return;
  }

  const key = createHash('sha256').update(JSON.stringify(spec)).digest('hex');
  const cached = cache.get(key);
  if (cached) {
    send(res, 200, 'text/html; charset=utf-8', cached);
    return;
  }

  try {
    const artifact = await renderArchifyArtifact(spec);
    if (artifact.variant !== 'full') {
      console.warn(`visual: archify rendered a reduced diagram (${artifact.variant}); inspect /api/spec`);
    }
    cache.set(key, artifact.html);
    if (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    send(res, 200, 'text/html; charset=utf-8', artifact.html);
  } catch (err) {
    const diagnostics = err instanceof ArchifyRenderError ? err.diagnostics : String(err);
    send(
      res,
      500,
      'text/html; charset=utf-8',
      page('Diagram rendering failed', `The Archify renderer rejected the generated specification.<pre>${escapeHtml(diagnostics)}</pre>`)
    );
  }
}

function toPositiveInt(raw: string | null, fallback: number | undefined): number | undefined {
  if (raw == null || raw.trim().length === 0) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function renderIndex(db: Database, selector: string | undefined): string {
  const projects = db.raw
    .prepare(
      `SELECT p.id, p.name, p.path, COUNT(m.id) AS memories
       FROM projects p LEFT JOIN memories m ON m.project_id = p.id
       GROUP BY p.id ORDER BY p.updated_at DESC LIMIT 200`
    )
    .all() as Array<Record<string, unknown>>;

  if (projects.length === 0) {
    return page('MemoSaver Memory Graph', 'No projects yet. Start a session with <code>session_start</code> or save a memory first.');
  }

  const totalRow = db.raw.prepare('SELECT COUNT(*) AS count FROM projects').get() as Record<string, unknown>;
  const total = Number(totalRow.count);

  const rows = projects
    .map((row) => {
      const id = String(row.id);
      const active = selector === id ? ' style="font-weight:600"' : '';
      return `<li${active}><a href="/visual?project=${encodeURIComponent(id)}">${escapeHtml(String(row.name))}</a> — ${Number(row.memories)} memories<br><small>${escapeHtml(String(row.path))}</small></li>`;
    })
    .join('\n');

  const truncated =
    projects.length < total ? `<p><small>Listing ${projects.length} of ${total} projects.</small></p>` : '';

  const pageSize = DEFAULT_PROJECTS_PER_PAGE;
  const pages = Math.ceil(total / pageSize);
  const pager =
    pages > 1
      ? `<p><small>Workspace pages: ${Array.from({ length: pages }, (_, i) => `<a href="/visual?page=${i + 1}">${i + 1}</a>`).join(' · ')}</small></p>`
      : '';

  return page(
    'MemoSaver Memory Graph',
    `<p>Archify architecture diagrams rendered from the live database.</p>
<p><a href="/visual">Workspace overview — the most recently updated projects</a> · <a href="/api/spec">/api/spec</a></p>
${pager}
<p>Per project (${total} total):</p><ul>${rows}</ul>${truncated}`
  );
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:0;padding:32px;background:#0d1117;color:#eef1f8}
a{color:#7fb3ff}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}pre{white-space:pre-wrap;background:#161b22;padding:16px;border-radius:8px;max-height:60vh;overflow:auto}
small{color:#8b949e}</style></head>
<body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;
}

function send(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, { 'content-type': contentType });
  res.end(body);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
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
