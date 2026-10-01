import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { MemoSaverError } from '../util/errors.js';
import type { ArchifySpec } from './archify-spec.js';

const execFileAsync = promisify(execFile);
const __dirname = fileURLToPath(new URL('.', import.meta.url));

/** Raised when the vendored Archify renderer refuses to produce an artifact. */
export class ArchifyRenderError extends MemoSaverError {
  constructor(
    message: string,
    readonly diagnostics: string
  ) {
    super('ARCHIFY_RENDER_ERROR', message);
    this.name = 'ArchifyRenderError';
  }
}

export interface RenderOptions {
  timeoutMs?: number;
}

/** Vendored renderer entry, from dist/web/vendor or the repo-root vendor tree. */
export function resolveRendererEntry(): string {
  const candidates = [
    resolve(__dirname, 'vendor/archify/bin/archify.mjs'),
    resolve(__dirname, '../../vendor/archify/bin/archify.mjs')
  ];
  const entry = candidates.find((candidate) => existsSync(candidate));
  if (!entry) {
    throw new ArchifyRenderError('archify renderer not found — run: pnpm build', '');
  }
  return entry;
}

function withoutLabels(spec: ArchifySpec): ArchifySpec {
  return {
    ...spec,
    connections: spec.connections.map((connection) => ({
      id: connection.id,
      from: connection.from,
      to: connection.to,
      variant: connection.variant
    }))
  };
}

function withoutConnections(spec: ArchifySpec): ArchifySpec {
  return { ...spec, connections: [] };
}

export interface RenderedArtifact {
  html: string;
  /** which specification actually rendered; anything but `full` is a degradation */
  variant: 'full' | 'labels-dropped' | 'connections-dropped';
}

/**
 * Render a specification to a self-contained HTML artifact with the vendored
 * Archify renderer. The renderer validates its own layout, so a failed pass is
 * retried with a reduced specification (no labels, then no relationships)
 * before giving up: the served page must never be a half-broken diagram.
 */
export async function renderArchifyArtifact(
  spec: ArchifySpec,
  options: RenderOptions = {}
): Promise<RenderedArtifact> {
  const entry = resolveRendererEntry();
  const variants: { label: RenderedArtifact['variant']; spec: ArchifySpec }[] = [
    { label: 'full', spec },
    { label: 'labels-dropped', spec: withoutLabels(spec) },
    { label: 'connections-dropped', spec: withoutConnections(spec) }
  ];

  let diagnostics = '';
  for (const variant of variants) {
    const dir = mkdtempSync(join(tmpdir(), 'memosaver-archify-'));
    const specPath = join(dir, 'spec.json');
    const outPath = join(dir, 'diagram.html');
    try {
      writeFileSync(specPath, JSON.stringify(variant.spec, null, 2), 'utf8');
      await execFileAsync(process.execPath, [entry, 'render', 'architecture', specPath, outPath], {
        timeout: options.timeoutMs ?? 20000,
        maxBuffer: 16 * 1024 * 1024
      });
      return { html: readFileSync(outPath, 'utf8'), variant: variant.label };
    } catch (err) {
      diagnostics = `${variant.label}: ${describeFailure(err)}`;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  throw new ArchifyRenderError(
    `archify could not render the memory graph: ${diagnostics.slice(0, 300)}`,
    diagnostics
  );
}

/** Convenience wrapper for callers that only need the artifact HTML. */
export async function renderArchifyHtml(spec: ArchifySpec, options: RenderOptions = {}): Promise<string> {
  return (await renderArchifyArtifact(spec, options)).html;
}

function describeFailure(err: unknown): string {
  if (err && typeof err === 'object') {
    if ('stderr' in err && typeof err.stderr === 'string' && err.stderr.trim().length > 0) {
      return err.stderr.trim().slice(0, 4000);
    }
    if ('stdout' in err && typeof err.stdout === 'string' && err.stdout.trim().length > 0) {
      return err.stdout.trim().slice(0, 4000);
    }
  }
  return err instanceof Error ? err.message : String(err);
}
