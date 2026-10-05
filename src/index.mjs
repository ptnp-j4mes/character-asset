import { createHttpServer } from './http/server.mjs';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8787);
const dataDir = process.env.DATA_DIR || './data';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

const server = createHttpServer({ dataDir });
server.listen(port, host, () => {
  console.log(`Character-Asset MCP Server V1 listening on http://${host}:${port}`);
  console.log(`MCP endpoint: http://${host}:${port}/mcp`);
});

function shutdown() {
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
