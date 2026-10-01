import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createApp, type AppCore } from '../app.js';
import { VERSION } from '../version.js';
import { registerTools } from './tools.js';

export async function startMcpServer(): Promise<void> {
  const app: AppCore = createApp();
  const server = new McpServer({ name: 'memosaver', version: VERSION }, { capabilities: { tools: {} } });

  registerTools(server, app.service);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  app.logger.info('mcp server listening on stdio');

  await waitForClose(app);
}

function waitForClose(app: AppCore): Promise<void> {
  return new Promise(() => {
    const shutdown = (): void => {
      app.service.engine.flushAll()
        .catch((err: unknown) => {
          app.logger.warn('shutdown buffer flush failed', { error: String(err) });
        })
        .finally(() => process.exit(0));
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}