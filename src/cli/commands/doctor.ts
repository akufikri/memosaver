import type { Command } from 'commander';
import { accessSync, existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { Database } from '../../storage/database.js';
import { currentSchemaVersion } from '../../storage/migrations.js';
import { loadConfig } from '../../util/config.js';

type CheckResult = { ok: boolean; label: string; detail?: string };

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Run diagnostics on MemoSaver installation, storage and MCP wiring')
    .action(() => {
      const results: CheckResult[] = [];
      const config = loadConfig();

      results.push(check('Storage directory', () => {
        if (!existsSync(config.homeDir)) throw new Error(`missing ${config.homeDir}`);
        accessSync(config.homeDir, 2); // writable
        return `${config.homeDir}`;
      }));

      results.push(check('Database', () => {
        const db = Database.open(config.dbPath);
        try {
          const size = statSync(config.dbPath).size;
          return `open, ${(size / 1024).toFixed(1)} KB, schema v${currentSchemaVersion(db)}`;
        } finally {
          db.close();
        }
      }));

      results.push(check('SQLite FTS', () => {
        const db = Database.open(config.dbPath);
        try {
          const table = db.raw
            .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memories_fts'`)
            .get();
          if (!table) throw new Error('memories_fts table missing');
          db.raw.prepare(`SELECT rowid FROM memories_fts WHERE memories_fts MATCH ? LIMIT 1`).get('x');
          return 'FTS5 enabled';
        } finally {
          db.close();
        }
      }));

      results.push(check('Configuration', () => {
        const configPath = resolve(config.homeDir, 'config.json');
        if (existsSync(configPath)) {
          readFileSync(configPath, 'utf8');
          return `parsed config.json`;
        }
        return 'using defaults (no config.json)';
      }));

      results.push(check('Agent config', () => {
        const findings: string[] = [];
        const claudeConfig = resolve(homedir(), '.claude.json');
        if (existsSync(claudeConfig)) {
          const raw = JSON.parse(readFileSync(claudeConfig, 'utf8')) as Record<string, unknown>;
          const servers = (raw.mcpServers as Record<string, unknown>) ?? {};
          if (servers['memosaver']) findings.push('claude-code: memosaver configured');
          else findings.push('claude-code: NOT configured (no mcpServers.memosaver)');
        } else {
          findings.push('claude-code: config not found');
        }
        const opencodeGlobal = resolve(homedir(), '.config', 'opencode', 'opencode.json');
        if (existsSync(opencodeGlobal)) findings.push('opencode: config exists');
        return findings.join('; ');
      }));

      results.push(check('Agent instructions', () => {
        const findings: string[] = [];
        const claudeMd = resolve(homedir(), '.claude', 'CLAUDE.md');
        if (existsSync(claudeMd)) {
          const content = readFileSync(claudeMd, 'utf8');
          if (content.includes('MemoSaver MCP')) {
            findings.push(`claude-code: instructions present in CLAUDE.md (${(content.match(/MemoSaver MCP/g) ?? []).length} refs)`);
            const hasSessionStart = /session_start/.test(content);
            const hasRecall = /memory_recall/.test(content);
            findings.push(`claude-code: session_start=${hasSessionStart ? 'ok' : 'MISSING'}, memory_recall=${hasRecall ? 'ok' : 'MISSING'}`);
          } else {
            findings.push('claude-code: MemoSaver instructions MISSING from ~/.claude/CLAUDE.md (run: memosaver install)');
          }
          return findings.join('; ');
        }
        return 'no ~/.claude/CLAUDE.md (run: memosaver install)';
      }));

      results.push(check('Project detection', () => {
        const cwd = process.cwd();
        accessSync(cwd);
        return `resolves ${cwd}`;
      }));

      results.push(check('Agent runtime', () => {
        const nodeVersion = process.versions.node;
        const major = Number(nodeVersion.split('.')[0]);
        if (major < 22) throw new Error(`requires Node >= 22, found ${nodeVersion}`);
        return `node ${nodeVersion}`;
      }));

      printResults(results);
    });
}

function check(label: string, fn: () => string): CheckResult {
  try {
    return { ok: true, label, detail: fn() };
  } catch (err) {
    return { ok: false, label, detail: err instanceof Error ? err.message : String(err) };
  }
}

function printResults(results: CheckResult[]): void {
  console.log('MemoSaver Doctor');
  console.log('');
  for (const result of results) {
    if (result.ok) {
      console.log(`  ✓ ${result.label}${safeWhile(result.detail)}`);
    } else {
      console.log(`  ✗ ${result.label}: ${result.detail}`);
      console.log(`    Fix: see message above or run 'memosaver status' for details.`);
    }
  }
  console.log('');
  const failed = results.filter((r) => !r.ok).length;
  if (failed > 0) {
    console.log(`${failed} problem(s) found.`);
    process.exitCode = 1;
  } else {
    console.log('All checks passed.');
  }
}

function safeWhile(detail: string | undefined): string {
  return detail ? ` (${detail})` : '';
}