import { realpathSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { InvalidInputError } from '../util/errors.js';
import { hashPath } from '../util/id.js';

export interface DetectedProject {
  /** normalized absolute path */
  path: string;
  /** deterministic project id derived from normalized path */
  id: string;
  /** path hash (equals id, kept explicit for clarity) */
  path_hash: string;
  /** directory name, used as human-readable project name */
  name: string;
}

/**
 * Resolve a user-supplied path to a normalized absolute path.
 * Uses fs.realpath when the directory exists so symlinked or `..` paths
 * normalize to the same project.
 */
export function normalizeProjectPath(rawPath: string): string {
  if (!rawPath || rawPath.trim().length === 0) {
    throw new InvalidInputError('project_path must be a non-empty string');
  }
  const absolute = resolve(rawPath.trim());
  try {
    return realpathSync(absolute);
  } catch {
    // path may not exist yet; still produce a stable absolute path
    return absolute;
  }
}

export function projectNameFromPath(path: string): string {
  return basename(path) || path;
}

export function detectProject(rawPath: string): DetectedProject {
  const path = normalizeProjectPath(rawPath);
  const pathHash = hashPath(path);
  return {
    path,
    id: pathHash,
    path_hash: pathHash,
    name: projectNameFromPath(path)
  };
}