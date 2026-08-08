import { describe, expect, it } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from '../src/mcp/tools.js';
import { createTestApp } from './helpers.js';
import { contentOf } from './helpers.js';

const PROJECT = '/tmp/memosaver-test-mcp';

async function connectClient(): Promise<{ client: Client; close: () => Promise<void> }> {
  const app = createTestApp();
  const server = new McpServer({ name: 'memosaver-test', version: '0.0.1' }, { capabilities: { tools: {} } });
  registerTools(server, app.service);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.1' }, { capabilities: {} });
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    }
  };
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await client.callTool({ name, arguments: args });
  return contentOf(res as { content: { type: string; text?: string }[] });
}

describe('MCP server', () => {
  it('exposes tools list', async () => {
    const { client, close } = await connectClient();
    const { tools } = await client.listTools();
    const names = tools!.map((t) => t.name);
    expect(names).toContain('session_start');
    expect(names).toContain('session_checkpoint');
    expect(names).toContain('session_end');
    expect(names).toContain('memory_insert');
    expect(names).toContain('memory_search');
    expect(names).toContain('memory_recall');
    expect(names).toContain('memory_delete');
    expect(names).toContain('memory_capture');
    expect(names).toContain('activity_log');
    await close();
  });

  it('session_start returns a session and resume context', async () => {
    const { client, close } = await connectClient();
    const result = await call(client, 'session_start', {
      project_path: PROJECT,
      agent: 'claude-code'
    }) as { project: { id: string }; session: { id: string }; resume: { resume_available: boolean } };
    expect(result.session.id).toMatch(/^session_/);
    expect(result.resume.resume_available).toBe(false);
    await close();
  });

  it('full workflow: start -> checkpoint -> recall -> search -> delete', async () => {
    const { client, close } = await connectClient();
    const started = await call(client, 'session_start', { project_path: PROJECT, agent: 'opencode' }) as {
      session: { id: string };
      project: { id: string };
    };
    const sessionId = started.session.id;
    const projectId = started.project.id;

    const cp = await call(client, 'session_checkpoint', {
      session_id: sessionId,
      goal: 'implement payment webhook',
      completed: 'payment model',
      pending: 'signature verification',
      next_action: 'fix HMAC comparison'
    });
    expect((cp as { id: string }).id).toMatch(/^checkpoint_/);

    const inserted = await call(client, 'memory_insert', {
      project_id: projectId,
      type: 'ERROR',
      content: 'Webhook signature failed because HMAC used hex instead of base64.'
    });
    expect(inserted).not.toBeNull();

    const recalled = await call(client, 'memory_recall', { project_id: projectId }) as { length: number };
    expect(recalled.length).toBeGreaterThan(0);

    const searched = await call(client, 'memory_search', {
      project_id: projectId,
      query: 'HMAC signature'
    }) as unknown[];
    expect(searched.length).toBeGreaterThan(0);

    const deleted = await call(client, 'memory_delete', { memory_id: (inserted as { id: string }).id });
    expect((deleted as { deleted: boolean }).deleted).toBe(true);

    const ended = await call(client, 'session_end', { session_id: sessionId });
    expect((ended as { ended: unknown }).status).toBe('completed');
    await close();
  });

  it('returns an error result for bad input instead of crashing', async () => {
    const { client, close } = await connectClient();
    const res = await client.callTool({ name: 'memory_search', arguments: { query: '' } });
    expect((res as { isError?: boolean }).isError).toBe(true);
    await close();
  });
});