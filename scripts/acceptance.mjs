import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = resolve(__dirname, '../dist/mcp/entry.js');
const home = process.env.MEMOSAVER_ACCEPT_HOME ?? '/tmp/memosaver-acceptance';
const projectPath = '/tmp/memosaver-acceptance/project';

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`ok: ${msg}`);
  }
}

const transport = new StdioClientTransport({
  command: 'node',
  args: [entry],
  env: { ...process.env, MEMOSAVER_HOME: home },
  stderr: 'inherit'
});
const client = new Client({ name: 'accept', version: '1' }, { capabilities: {} });
await client.connect(transport);

let res = await client.callTool({ name: 'session_start', arguments: { project_path: projectPath, agent: 'claude-code' } });
let out = JSON.parse(res.content[0].text);
assert(out.project.path === projectPath, 'project detected');
assert(out.resume.resume_available === false, 'first session: no resume');
const sessionId = out.session.id;
const projectId = out.resume.project_id || out.project.id;

await client.callTool({
  name: 'memory_capture',
  arguments: { project_id: projectId, session_id: sessionId, type: 'DECISION',
    text: 'We decided to implement authentication in a separate auth module using JWT.' }
});
await client.callTool({
  name: 'activity_log',
  arguments: { project_id: projectId, session_id: sessionId,
    text: 'Added login and register routes behind AuthService.' }
});
await client.callTool({
  name: 'session_checkpoint',
  arguments: { session_id: sessionId, goal: 'implement authentication',
    completed: 'auth module with login and register', pending: 'logout and refresh-token rotation',
    blockers: 'none', next_action: 'implement logout endpoint' }
});
res = await client.callTool({ name: 'session_end', arguments: { session_id: sessionId } });
out = JSON.parse(res.content[0].text);
assert(out.status === 'completed', 'session ended completed');

let res2 = await client.callTool({ name: 'session_start', arguments: { project_path: projectPath, agent: 'opencode' } });
out = JSON.parse(res2.content[0].text);
assert(out.resume.resume_available === true, 'resume available');
assert(out.resume.context.includes('authentication'), 'resume references authentication');
assert(out.resume.context.toLowerCase().includes('next'), 'resume contains next step');
console.log('------ RESUME CONTEXT ------');
console.log(out.resume.context);
console.log('----------------------------');

let search = await client.callTool({ name: 'memory_search', arguments: { project_id: projectId, query: 'JWT module' } });
assert(JSON.parse(search.content[0].text).length > 0, 'memory_search returns hits');

let hybrid = await client.callTool({ name: 'memory_search_hybrid', arguments: { project_id: projectId, query: 'authentication jwt block' } });
assert(JSON.parse(hybrid.content[0].text).length > 0, 'memory_search_hybrid returns hits');

let timeline = await client.callTool({ name: 'session_timeline', arguments: { session_id: sessionId } });
const timelineOut = JSON.parse(timeline.content[0].text);
assert(timelineOut.session.id === sessionId, 'session_timeline resolves session');
assert(timelineOut.events.length > 0, 'session_timeline has events');

let exportRes = await client.callTool({ name: 'memory_export', arguments: { project_id: projectId } });
const exportDoc = JSON.parse(exportRes.content[0].text);
assert(exportDoc.memories.length > 0, 'memory_export returns memories');

let importRes = await client.callTool({ name: 'memory_import', arguments: { document: exportDoc } });
const importOut = JSON.parse(importRes.content[0].text);
assert(importOut.imported > 0, 'memory_import round-trips');

await client.close();
if (process.exitCode) {
  console.error('ACCEPTANCE FAILED');
} else {
  console.log('ACCEPTANCE PASSED');
}