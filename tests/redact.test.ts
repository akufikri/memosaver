import { describe, expect, it } from 'vitest';
import { redact } from '../src/util/logger.js';

describe('logger redaction', () => {
  it('redacts api keys', () => {
    expect(redact('api_key=sk-1234567890abcdef used')).not.toContain('sk-1234567890abcdef');
  });

  it('redacts passwords and tokens', () => {
    const out = redact('password=supersecret token=abc123def456');
    expect(out).not.toContain('supersecret');
    expect(out).not.toContain('abc123def456');
    expect(out).toContain('[REDACTED]');
  });

  it('leaves normal text untouched', () => {
    const text = 'session started for project x';
    expect(redact(text)).toBe(text);
  });
});