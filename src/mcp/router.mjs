import { CharacterAssetError } from '../errors.mjs';
import { coreTools } from '../contracts/tool-catalog.mjs';

export const MCP_PROTOCOL_VERSION = '2026-07-28';
const SERVER_INFO = { name: 'Character-Asset', version: '0.3.0' };
const META_PROTOCOL = 'io.modelcontextprotocol/protocolVersion';

const handlers = {
  'project.create': async (service, args) => ({ project: await service.createProject(args) }),
  'character.create_spec': async (service, args) => ({ spec: await service.createCharacterSpec(args) }),
  'character.get_spec': async (service, args) => ({ spec: await service.getCharacterSpec(args?.character_id) }),
  'character.prepare_base_views': async (service, args) => ({ generation: await service.prepareBaseViews(args) }),
  'character.begin_image_handoff': async (service, args) => service.beginImageHandoff(args),
  'character.get_image_handoff': async (service, args) => ({ handoff: await service.getImageHandoff(args?.handoff_id) }),
  'character.ingest_base_view': async (service, args) => ({ view: await service.ingestBaseView(args) }),
  'character.get_base_views': async (service, args) => service.getBaseViews(args?.character_id),
  'character.validate_base_views': async (service, args) => ({ validation: await service.validateBaseViews(args) }),
  'parts.auto_segment': async (service, args) => ({ segmentation: await service.autoSegmentParts(args) }),
  'parts.list': async (service, args) => service.listParts(args),
  'parts.get': async (service, args) => service.getPart(args?.part_id),
  'parts.update_mask': async (service, args) => ({ part: await service.updatePartMask(args) }),
  'parts.create_manual': async (service, args) => ({ part: await service.createManualPart(args) }),
  'parts.approve': async (service, args) => ({ part: await service.approvePart(args) }),
  'rig.create': async (service, args) => ({ rig: await service.createRig(args) }),
  'rig.get': async (service, args) => ({ rig: await service.getRig(args?.character_id) }),
  'rig.auto_bind_parts': async (service, args) => service.autoBindParts(args),
  'rig.validate': async (service, args) => service.validateRig(args)
};

function resultMeta() {
  return {
    'io.modelcontextprotocol/serverInfo': SERVER_INFO,
    'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION
  };
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result: { ...result, _meta: resultMeta() } };
}

function rpcError(id, code, message, data = undefined) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) }
  };
}

function checkProtocol(message) {
  const requested = message?.params?._meta?.[META_PROTOCOL];
  if (requested !== MCP_PROTOCOL_VERSION) {
    return rpcError(message?.id, -32022, 'Unsupported protocol version', {
      supported: [MCP_PROTOCOL_VERSION],
      requested: requested ?? null
    });
  }
  return null;
}

function callResult(payload, isError = false) {
  return {
    resultType: 'complete',
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    ...(isError ? { isError: true } : { structuredContent: payload })
  };
}

export function createCharacterAssetMcpRouter(service) {
  return {
    tools: coreTools,

    async dispatch(message) {
      if (!message || message.jsonrpc !== '2.0' || message.id === undefined || typeof message.method !== 'string') {
        return rpcError(message?.id, -32600, 'Invalid Request');
      }

      const protocolError = checkProtocol(message);
      if (protocolError) return protocolError;

      if (message.method === 'server/discover') {
        return rpcResult(message.id, {
          resultType: 'complete',
          supportedVersions: [MCP_PROTOCOL_VERSION],
          capabilities: { tools: { listChanged: false } },
          instructions: 'Use Character-Asset tools to create structured 2.5D character specs, prepare ChatGPT Web image handoffs, validate base references, extract and approve semantic parts, then create and bind rigs.',
          ttlMs: 300000,
          cacheScope: 'public'
        });
      }

      if (message.method === 'tools/list') {
        return rpcResult(message.id, {
          resultType: 'complete',
          tools: coreTools,
          ttlMs: 300000,
          cacheScope: 'public'
        });
      }

      if (message.method !== 'tools/call') {
        return rpcError(message.id, -32601, 'Method not found', { method: message.method });
      }

      const name = message.params?.name;
      if (typeof name !== 'string' || !(name in handlers)) {
        return rpcError(message.id, -32602, 'Invalid params', { reason: 'Unknown tool', name: name ?? null });
      }

      try {
        const payload = await handlers[name](service, message.params?.arguments ?? {});
        return rpcResult(message.id, callResult(payload));
      } catch (error) {
        if (error instanceof CharacterAssetError) {
          return rpcResult(message.id, callResult({ error: error.toJSON() }, true));
        }
        return rpcError(message.id, -32603, 'Internal error');
      }
    }
  };
}
