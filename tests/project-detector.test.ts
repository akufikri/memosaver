import { describe, expect, it } from 'vitest';
import { detectProject, normalizeProjectPath } from '../src/project/project-detector.js';

describe('project detector', () => {
  it('produces deterministic ids from the same path', () => {
    const a = detectProject('/tmp/memosaver-test-project-a');
    const b = detectProject('/tmp/memosaver-test-project-a/../memosaver-test-project-a');
    expect(a.id).toBe(b.id);
    expect(a.path).toContain('/tmp/memosaver-test-project-a');
    expect(a.name).toBe('memosaver-test-project-a');
  });

  it('matches trd: path -> sha256(normalized_path)', () => {
    const detected = detectProject('/Users/user/dev/project-a');
    expect(detected.path_hash).toBe(detected.id);
    expect(typeof detected.id).toBe('string');
    expect(detected.id).toHaveLength(64); // sha256 hex
  });

  it('rejects empty paths', () => {
    expect(() => normalizeProjectPath('   ')).toThrow();
  });

  it('normalizes relative paths to absolute', () => {
    const p = normalizeProjectPath('.');
    expect(p.startsWith('/')).toBe(true);
  });
});