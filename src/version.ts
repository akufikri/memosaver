import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Version reported by the CLI (`memosaver --version`) and the MCP server
 * handshake. Read from package.json so it cannot drift from the published
 * package; resolves from both src/ (tsx, vitest) and dist/.
 */
const pkg: unknown = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')
);

if (typeof pkg !== 'object' || pkg === null || !('version' in pkg) || typeof pkg.version !== 'string') {
  throw new Error('package.json is missing a version string');
}

export const VERSION: string = pkg.version;
