import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = resolve(__dirname, '../dist/mcp/entry.js');

const transport = new StdioClientTransport({
  command: 'node',
  args: [entry],
  env: { ...process.env, MEMOSAVER_HOME: '/tmp/memosaver-live' },
  stderr: 'inherit'
});
const client = new Client({ name: 'live-demo', version: '1' }, { capabilities: {} });
await client.connect(transport);

const PROJECT = process.cwd();

async function call(name, args) {
  const res = await client.callTool({ name, arguments: args });
  return JSON.parse(res.content[0].text);
}

let out = await call('session_start', { project_path: PROJECT, agent: 'opencode' });
const sid = out.session.id;
console.log('\n== SESSION START ==');
console.log(`project : ${out.project.name}`);
console.log(`session : ${sid}`);
console.log(`resume  : ${out.resume.resume_available}`);

// Kerja nyata: capture decision, solusi, arsitektur, error
console.log('\n== CAPTURING MEMORIES (activity_log) ==');
await call('activity_log', { project_id: pid(out), session_id: sid,
  text: 'Decided to store MemoSaver data in SQLite with built-in node:sqlite, zero native deps.' });
await call('activity_log', { project_id: pid(out), session_id: sid,
  text: 'Solved FTS5: external content table with triggers keeps BM25 search in sync.' });
await call('activity_log', { project_id: pid(out), session_id: sid,
  text: 'Architecture convention: strict layering MCP adapter -> service -> domain -> repositories.' });
await call('activity_log', { project_id: pid(out), session_id: sid,
  text: 'Fixed test failure by awaiting async processEvents in memory-engine tests.' });
await call('activity_log', { project_id: pid(out), session_id: sid,
  text: 'Finished the memory engine buffering implementation.', flush: true });

console.log('== CHECKPOINT ==');
await call('session_checkpoint', { session_id: sid,
  goal: 'finish MemoSaver MVP dan dokumentasi',
  completed: 'M1-M6 green, 57 tests, acceptance passed',
  pending: 'uji nyata di project lain, setup MCP agent',
  next_action: 'test resume context dan wire ke Claude Code' });

console.log('== END SESSION ==');
const ended = await call('session_end', { session_id: sid });
console.log(`status: ${ended.status}`);

console.log('\n===== 7 HARI LAGI... REOPEN ====\n');
const resumed = await call('session_start', { project_path: PROJECT, agent: 'opencode' });
console.log(resumed.resume.context);
console.log('\n===== HYBRID SEARCH "sqlite fts bm25" =====');
const hits = await call('memory_search_hybrid', { project_id: pid(resumed), query: 'sqlite fts bm25 search' });
for (const h of hits) console.log(`  [${h.score.toFixed(2)}] ${h.memory.type} ${h.memory.content}`);

await call('session_end', { session_id: resumed.session.id, status: 'completed' });
await client.close();
console.log('\nLIVE DEMO DONE');

function pid(r) { return r.resume.project_id || r.project.id; }