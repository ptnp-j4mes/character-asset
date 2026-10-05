import { createServer } from 'node:http';

import { CharacterAssetService } from '../domain/service.mjs';
import { CharacterAssetError } from '../errors.mjs';
import { imageBridgeFromEnv } from '../generation/image-bridge.mjs';
import { MCP_PROTOCOL_VERSION, createCharacterAssetMcpRouter } from '../mcp/router.mjs';
import { JsonStore } from '../storage/json-store.mjs';
import { errorStatus, handleRest, readJsonBody, sendJson, sendRestError } from './rest.mjs';

const HEADER_ERROR = -32020;
const LARGE_MCP_TOOLS = new Set([
  'character.ingest_base_view',
  'parts.update_mask',
  'parts.create_manual'
]);

function rpcError(id, code, message, data = undefined) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) }
  };
}

function headerValue(req, name) {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function validateMcpHeaders(req, message) {
  const protocol = headerValue(req, 'mcp-protocol-version');
  const method = headerValue(req, 'mcp-method');
  const name = headerValue(req, 'mcp-name');
  const metaProtocol = message?.params?._meta?.['io.modelcontextprotocol/protocolVersion'];

  if (protocol !== MCP_PROTOCOL_VERSION || protocol !== metaProtocol) {
    return rpcError(message?.id, HEADER_ERROR, 'MCP-Protocol-Version header mismatch', {
      expected: MCP_PROTOCOL_VERSION,
      header: protocol ?? null,
      metadata: metaProtocol ?? null
    });
  }
  if (method !== message?.method) {
    return rpcError(message?.id, HEADER_ERROR, 'Mcp-Method header mismatch', {
      header: method ?? null,
      body: message?.method ?? null
    });
  }
  if (message?.method === 'tools/call' && name !== message?.params?.name) {
    return rpcError(message?.id, HEADER_ERROR, 'Mcp-Name header mismatch', {
      header: name ?? null,
      body: message?.params?.name ?? null
    });
  }
  return null;
}

function isLocalOrigin(origin) {
  if (!origin) return true;
  try {
    const hostname = new URL(origin).hostname;
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1';
  } catch {
    return false;
  }
}

function mcpStatus(payload) {
  const code = payload?.error?.code;
  if (code === -32601) return 404;
  if (code === HEADER_ERROR || code === -32022 || code === -32700 || code === -32600 || code === -32602) return 400;
  if (code === -32603) return 500;
  return 200;
}

async function handleMcp(req, res, router, store) {
  let requestBody = null;
  let rawBody = null;
  const reply = async (status, responseBody) => {
    try {
      await store.appendMcpLog({
        timestamp: new Date().toISOString(),
        request: {
          method: req.method,
          path: req.url,
          headers: Object.fromEntries(['mcp-protocol-version', 'mcp-method', 'mcp-name', 'origin'].map((name) => [name, headerValue(req, name) ?? null])),
          body: requestBody ?? rawBody
        },
        response: { status, body: responseBody }
      });
    } catch (error) {
      console.error('Failed to write MCP request log', error);
    }
    sendJson(res, status, responseBody);
  };

  if (!isLocalOrigin(headerValue(req, 'origin'))) {
    await reply(403, rpcError(null, -32021, 'Cross-origin MCP request rejected'));
    return;
  }

  if (req.method !== 'POST') {
    await reply(405, rpcError(null, -32600, 'MCP endpoint accepts POST only'));
    return;
  }

  let message;
  try {
    const maxBytes = LARGE_MCP_TOOLS.has(headerValue(req, 'mcp-name')) ? 16 * 1024 * 1024 : 1024 * 1024;
    message = await readJsonBody(req, { maxBytes, onRawBody: (value) => { rawBody = value; } });
    requestBody = message;
  } catch (error) {
    if (error instanceof CharacterAssetError) {
      if (error.message === 'Request body must be valid JSON') {
        await reply(400, rpcError(null, -32700, 'Parse error'));
      } else {
        await reply(errorStatus(error), { error: error.toJSON() });
      }
      return;
    }
    throw error;
  }

  const headerError = validateMcpHeaders(req, message);
  if (headerError) {
    await reply(400, headerError);
    return;
  }

  const payload = await router.dispatch(message);
  await reply(mcpStatus(payload), payload);
}

export function createHttpServer({ dataDir = './data', imageBridge = imageBridgeFromEnv() } = {}) {
  const store = new JsonStore(dataDir);
  const service = new CharacterAssetService(store, { imageBridge });
  const router = createCharacterAssetMcpRouter(service);

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');

      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, { status: 'ok', project: 'Character-Asset', version: '0.3.0' });
        return;
      }

      if (url.pathname === '/mcp') {
        await handleMcp(req, res, router, store);
        return;
      }

      if (await handleRest(req, res, url, service)) return;
      sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Route not found' } });
    } catch (error) {
      sendRestError(res, error);
    }
  });
}
