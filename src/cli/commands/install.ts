import type { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The stdio MCP server entry shipped next to this CLI. */
export function resolveMcpEntry(): string {
  return resolve(__dirname, '../../mcp/entry.js');
}

export const CLAUDE_MEMO_MARKER = '## \u{1F9E0} MemoSaver MCP — Persistent Project Memory (WAJIB)';

export const CLAUDE_INSTRUCTIONS = `

---

## Communication style

Respond terse. Drop filler words (just/really/basically), articles (a/an/the), pleasantries. Fragments OK. Technical terms exact. This reduces token usage without losing precision.

---

## \u{1F9E0} MemoSaver MCP — Persistent Project Memory (WAJIB)

MemoSaver adalah MCP server local-first untuk memory progress, keputusan, error/solusi, dan session continuity lintas session/lintas agent.

> **Tujuan:** jangan mulai session dari nol. Knowledge proyek tersimpan di \`~/.memosaver/\` (SQLite), bukan hanya di file memory bawaan Claude Code.

### Aturan pemakaian — ikuti SELALU

1. **Saat mulai bekerja di sebuah project** (setelah \`cd\` ke folder project):
   - Panggil \`session_start\` dengan \`project_path\` = cwd. Contoh: \`session_start(project_path="/absolut/path/project", agent="claude-code")\`.
   - Tool ini menutup session lama yang interrupted, menyiapkan session baru, dan **mengembalikan resume context** jika project punya memory sebelumnya.
   - Jika \`session_start\` tidak tersedia (MCP belum terpasang): lanjut tanpa menyimpan. JANGAN pura-pura menyimpan.

2. **Selama bekerja**, simpan informasi penting secara eksplisit:
   - \`memory_insert(project_path, content, type="DECISION|ARCHITECTURE|ERROR|SOLUTION|TASK|FACT", importance)\`
   - atau \`activity_log(project_path, text, flush=true)\` untuk capture otomatis.
   - Prioritas simpan: keputusan arsitektur, dependency stack, konvensi, error+solusi, task yang belum selesai.

3. **Checkpoint berkala** (min. sekali per milestone):
   - \`session_checkpoint(session_id, goal, completed, pending, blockers, next_action)\`

4. **Saat selesai bekerja / akan close session**:
   - \`session_end(session_id, status="completed", summary="ringkasan kerja")\`

5. **Saat user RESUME / kembali ke project dari sesi lalu** ("lanjutkan", "kita kerjakan apa", "where did we stop"):
   - Panggil \`session_start\` dulu (dapat resume context), lalu bila perlu \`memory_recall(project_path)\`.
   - Gunakan resume context sebagai dasar, jangan hanya mengandalkan memory file bawaan.

### Penanganan error
- Jika MemoSaver MCP error/tidak tersedia: kerja normal tanpa memakainya, tanpa spam.
- Jangan simpan secret/API key ke dalam memory.
`;

export function ensureClaudeInstructions(): { added: boolean; path: string } {
  const claudeMd = resolve(homedir(), '.claude', 'CLAUDE.md');
  if (existsSync(claudeMd) && readFileSync(claudeMd, 'utf8').includes(CLAUDE_MEMO_MARKER)) {
    return { added: false, path: claudeMd };
  }
  mkdirSync(dirname(claudeMd), { recursive: true });
  const existing = existsSync(claudeMd) ? readFileSync(claudeMd, 'utf8') : '';
  writeFileSync(claudeMd, `${existing.replace(/\s*$/, '')}\n${CLAUDE_INSTRUCTIONS}\n`, 'utf8');
  return { added: true, path: claudeMd };
}

export function claudeMcpEntry(claudeConfig: Record<string, unknown>): unknown {
  return (claudeConfig.mcpServers as Record<string, unknown> | undefined)?.['memosaver'] ?? null;
}

export function registerInstallCommand(program: Command): void {
  program
    .command('install')
    .description('Register MemoSaver as an MCP server and wire agent instructions')
    .option('-s, --scope <scope>', 'claude-code scope: user (global) or local (project)', 'user')
    .option('--no-claude', 'skip Claude Code CLI registration')
    .option('--no-opencode', 'skip OpenCode registration')
    .option('--no-instructions', 'skip injecting instructions into ~/.claude/CLAUDE.md')
    .option('--claude-desktop', 'register in Claude Desktop app')
    .option('--antigravity', 'print MCP config snippet for Google Antigravity')
    .option('--codex', 'print MCP config snippet for OpenAI Codex')
    .option('--kilo', 'print MCP config snippet for Kilo.ai')
    .action((opts: {
      scope: string; claude: boolean; opencode: boolean; instructions: boolean;
      claudeDesktop: boolean; antigravity: boolean; codex: boolean; kilo: boolean;
    }) => {
      const entry = resolveMcpEntry();
      console.log(`MemoSaver MCP entry: ${entry}`);
      if (!existsSync(entry)) {
        console.error(`ERROR: entry not found — run 'pnpm build' first: ${entry}`);
        process.exitCode = 1;
        return;
      }

      if (opts.claude) installClaudeCode(entry, opts.scope);
      if (opts.opencode) installOpenCode(entry);
      if (opts.claudeDesktop) installClaudeDesktop(entry);
      if (opts.antigravity) printMcpSnippet('Antigravity', entry);
      if (opts.codex) printMcpSnippet('OpenAI Codex', entry);
      if (opts.kilo) printMcpSnippet('Kilo.ai', entry);
      if (opts.instructions) installClaudeInstructions();

      console.log('\nDone. Restart your agent to pick up the new MCP server.');
      console.log('Verify with: memosaver doctor');
    });
}

function installClaudeCode(entry: string, scope: string): void {
  const claudeJson = resolve(homedir(), '.claude.json');
  let config: Record<string, unknown> = {};
  if (existsSync(claudeJson)) {
    try {
      config = JSON.parse(readFileSync(claudeJson, 'utf8')) as Record<string, unknown>;
    } catch (err) {
      console.error(`ERROR: cannot parse ${claudeJson}: ${(err as Error).message}`);
      process.exitCode = 1;
      return;
    }
  }
  const servers = (config.mcpServers as Record<string, unknown>) ?? {};
  if (servers['memosaver']) {
    console.log(`claude-code: memosaver already configured in mcpServers (${scope} scope).`);
    return;
  }
  servers['memosaver'] = { type: 'stdio', command: 'node', args: [entry] };
  config.mcpServers = servers;
  mkdirSync(dirname(claudeJson), { recursive: true });
  writeFileSync(claudeJson, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  console.log(`claude-code: added memosaver to ${claudeJson} (${scope} scope).`);
}

function installOpenCode(entry: string): void {
  const configDir = resolve(homedir(), '.config', 'opencode');
  const configPath = resolve(configDir, 'opencode.json');
  const altPath = resolve(configDir, 'opencode.jsonc');
  const target = existsSync(altPath) ? altPath : configPath;
  let config: Record<string, unknown> = {};
  if (existsSync(target)) {
    try {
      const text = readFileSync(target, 'utf8');
      config = JSON.parse(
        target.endsWith('.jsonc') ? stripJsonc(text) : text,
      ) as Record<string, unknown>;
    } catch (err) {
      console.error(`ERROR: cannot parse ${target}: ${(err as Error).message}`);
      process.exitCode = 1;
      return;
    }
  }
  const mcp = (config.mcp as Record<string, unknown>) ?? {};
  if (mcp['memosaver']) {
    console.log(`opencode: memosaver already configured in ${target}.`);
    return;
  }
  mcp['memosaver'] = { type: 'local', enabled: true, command: ['node', entry] };
  config.mcp = mcp;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  console.log(`opencode: added memosaver to ${target}.`);
}

function installClaudeInstructions(): void {
  const result = ensureClaudeInstructions();
  if (result.added) console.log(`claude-code: injected MemoSaver usage instructions into ${result.path}`);
  else console.log(`claude-code: instructions already present in ${result.path}`);
}

function installClaudeDesktop(entry: string): void {
  const platform = process.platform;
  let configPath: string;
  if (platform === 'win32') {
    configPath = resolve(process.env['APPDATA'] ?? homedir(), 'Claude', 'claude_desktop_config.json');
  } else if (platform === 'darwin') {
    configPath = resolve(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  } else {
    configPath = resolve(homedir(), '.config', 'Claude', 'claude_desktop_config.json');
  }
  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    } catch (err) {
      console.error(`ERROR: cannot parse ${configPath}: ${(err as Error).message}`);
      process.exitCode = 1;
      return;
    }
  }
  const servers = (config.mcpServers as Record<string, unknown>) ?? {};
  if (servers['memosaver']) {
    console.log(`claude-desktop: memosaver already configured in ${configPath}.`);
    return;
  }
  servers['memosaver'] = { command: 'node', args: [entry] };
  config.mcpServers = servers;
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  console.log(`claude-desktop: added memosaver to ${configPath}.`);
  console.log('Restart Claude Desktop to pick up the new MCP server.');
}

function printMcpSnippet(toolName: string, entry: string): void {
  console.log(`\n${toolName} — add this MCP config to your tool's settings:\n`);
  console.log(JSON.stringify({
    memosaver: { type: 'stdio', command: 'node', args: [entry] }
  }, null, 2));
  console.log(`\nFor tools expecting a different format, the server binary is:\n  node ${entry}`);
}

/** Strip JSONC comments and trailing commas while respecting string literals. */
function stripJsonc(text: string): string {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += text[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if ((ch === ',' && text[i + 1] === '}') || (ch === ',' && text[i + 1] === ']')) {
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}
