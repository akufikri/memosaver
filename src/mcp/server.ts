import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createApp, type AppCore } from '../app.js';
import { registerTools } from './tools.js';

export async function startMcpServer(): Promise<void> {
  const app: AppCore = createApp();
  const server = new McpServer({ name: 'memosaver', version: '0.1.0' }, { capabilities: { tools: {} } });

  registerTools(server, app.service);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  app.logger.info('mcp server listening on stdio');

  await waitForClose();
}

function waitForClose(): Promise<void> {
  return new Promise(() => {
    const shutdown = (): void => {
      process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}