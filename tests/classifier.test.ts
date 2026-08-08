import { describe, expect, it } from 'vitest';
import { classify, isLowValue } from '../src/memory/classifier.js';
import { scoreImportance } from '../src/memory/scorer.js';

describe('memory classifier', () => {
  it('classifies decisions', () => {
    expect(classify('We decided to use PostgreSQL because JSONB is required.').type).toBe('DECISION');
  });

  it('classifies errors and solutions', () => {
    expect(classify('JWT verification failed because the secret was loaded from the wrong env var.').type).toBe(
      'ERROR'
    );
    expect(classify('We fixed the bug. The root cause was an incorrect variable lookup.').type).toBe(
      'SOLUTION'
    );
  });

  it('classifies architecture', () => {
    expect(classify('The service layer pattern keeps controllers thin.').type).toBe('ARCHITECTURE');
  });

  it('classifies progress', () => {
    expect(classify('Login and register are done, refresh token rotation is still pending.').type).toBe(
      'PROGRESS'
    );
  });

  it('respects explicit hint override', () => {
    expect(classify('anything', 'PREFERENCE').type).toBe('PREFERENCE');
  });

  it('filters transient activity', () => {
    expect(isLowValue("I'll inspect the file.")).toBe(true);
    expect(isLowValue("Let's run tests.")).toBe(true);
    expect(isLowValue('ok')).toBe(true);
    expect(
      isLowValue('We decided to adopt refresh token rotation for all auth flows.')
    ).toBe(false);
  });
});

describe('memory importance scorer', () => {
  it('scores architecture decisions high', () => {
    const score = scoreImportance('We decided to use PostgreSQL because JSONB is required.', 'ARCHITECTURE');
    expect(score).toBeGreaterThan(0.8);
  });

  it('scores transient actions low', () => {
    const score = scoreImportance('opened package.json', 'CONTEXT');
    expect(score).toBeLessThan(0.6);
  });

  it('clamps to 0..1', () => {
    const score = scoreImportance('critical important must crucial error production outage', 'ERROR');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});