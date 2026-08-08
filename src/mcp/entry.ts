import { startMcpServer } from './server.js';

startMcpServer().catch((err: unknown) => {
  console.error(`memosaver-mcp failed to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});