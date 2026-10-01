// Copies the vendored Archify runtime (repo-root `vendor/archify`) into the build
// output so that `dist/web/vendor/archify/bin/archify.mjs` can be spawned as a
// subprocess at runtime. Dependency-free and idempotent: the previous vendor copy
// is dropped first, so repeated builds always yield exactly the vendored tree.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const vendorSrc = resolve(root, 'vendor', 'archify');
const vendorDir = resolve(root, 'dist', 'web', 'vendor');
const vendorDest = resolve(vendorDir, 'archify');

rmSync(vendorDir, { recursive: true, force: true });
mkdirSync(vendorDest, { recursive: true });
cpSync(vendorSrc, vendorDest, { recursive: true, force: true });
console.log('copied vendor/archify -> dist/web/vendor/archify');
