import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CharacterAssetService } from '../src/domain/service.mjs';
import { createCharacterAssetMcpRouter } from '../src/mcp/router.mjs';
import { JsonStore } from '../src/storage/json-store.mjs';

const PROTOCOL = '2026-07-28';
const meta = () => ({
  'io.modelcontextprotocol/protocolVersion': PROTOCOL,
  'io.modelcontextprotocol/clientInfo': { name: 'character-asset-test', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {}
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'character-asset-mcp-'));
  const service = new CharacterAssetService(new JsonStore(root));
  return { service, router: createCharacterAssetMcpRouter(service) };
}

function request(id, method, params = {}) {
  return { jsonrpc: '2.0', id, method, params: { ...params, _meta: meta() } };
}

test('server/discover advertises the modern protocol and tools capability', async () => {
  const { router } = await setup();
  const response = await router.dispatch(request(1, 'server/discover'));

  assert.equal(response.jsonrpc, '2.0');
  assert.equal(response.id, 1);
  assert.equal(response.result.resultType, 'complete');
  assert.deepEqual(response.result.supportedVersions, [PROTOCOL]);
  assert.deepEqual(response.result.capabilities, { tools: { listChanged: false } });
  assert.equal(response.result.cacheScope, 'public');
});

test('tools/list returns the executable V1 tools in deterministic order with generated schemas', async () => {
  const { router } = await setup();
  const response = await router.dispatch(request(2, 'tools/list'));

  assert.equal(response.result.resultType, 'complete');
  assert.equal(response.result.cacheScope, 'public');
  assert.equal(response.result.ttlMs, 300000);
  assert.deepEqual(response.result.tools.map((tool) => tool.name), [
    'project.create',
    'character.create_spec',
    'character.get_spec',
    'character.prepare_base_views',
    'character.begin_image_handoff',
    'character.get_image_handoff',
    'character.ingest_base_view',
    'character.get_base_views',
    'character.validate_base_views',
    'parts.auto_segment',
    'parts.list',
    'parts.get',
    'parts.update_mask',
    'parts.create_manual',
    'parts.inspect_occlusion',
    'parts.prepare_repair',
    'parts.replace_repaired_image',
    'parts.set_joint_padding',
    'parts.set_z_order',
    'parts.mark_repaired',
    'parts.validate_rig_readiness',
    'parts.approve',
    'rig.create',
    'rig.get',
    'rig.auto_bind_parts',
    'rig.validate'
  ]);
  for (const tool of response.result.tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.ok(tool.outputSchema);
  }
});

test('tools/call executes the full V1 project -> spec -> get -> rig flow with structured content', async () => {
  const { router } = await setup();

  const projectCall = await router.dispatch(request(3, 'tools/call', {
    name: 'project.create',
    arguments: { name: 'MCP Demo' }
  }));
  assert.equal(projectCall.result.resultType, 'complete');
  assert.equal(projectCall.result.isError, undefined);
  const project = projectCall.result.structuredContent.project;
  assert.match(project.project_id, /^proj_/);

  const specArgs = {
    project_id: project.project_id,
    character_id: 'char_mcp_001',
    name: 'MCP Novice',
    style_profile: 'ro_like_chibi_v1',
    proportion_profile: 'chibi_small_v1',
    views_required: ['S', 'SW', 'W', 'NW', 'N'],
    rig_preset: 'biped_chibi_v1',
    motion_preset: 'ro_like_motion_v1'
  };
  const createSpecCall = await router.dispatch(request(4, 'tools/call', {
    name: 'character.create_spec',
    arguments: specArgs
  }));
  assert.equal(createSpecCall.result.structuredContent.spec.character_id, 'char_mcp_001');

  const getSpecCall = await router.dispatch(request(5, 'tools/call', {
    name: 'character.get_spec',
    arguments: { character_id: 'char_mcp_001' }
  }));
  assert.deepEqual(getSpecCall.result.structuredContent.spec, createSpecCall.result.structuredContent.spec);

  const rigCall = await router.dispatch(request(6, 'tools/call', {
    name: 'rig.create',
    arguments: { character_id: 'char_mcp_001', rig_preset: 'biped_chibi_v1', auto_bind: true }
  }));
  assert.equal(rigCall.result.structuredContent.rig.preset, 'biped_chibi_v1');
  assert.equal(rigCall.result.structuredContent.rig.version, 1);
  assert.match(rigCall.result.content[0].text, /"rig"/);
});

test('domain failures are returned as tool results with isError true', async () => {
  const { router } = await setup();
  const response = await router.dispatch(request(7, 'tools/call', {
    name: 'character.create_spec',
    arguments: {
      project_id: 'proj_missing',
      character_id: 'char_missing_project',
      name: 'No Project',
      style_profile: 'ro_like_chibi_v1',
      proportion_profile: 'chibi_small_v1',
      views_required: ['S'],
      rig_preset: 'biped_chibi_v1',
      motion_preset: 'ro_like_motion_v1'
    }
  }));

  assert.equal(response.result.isError, true);
  const payload = JSON.parse(response.result.content[0].text);
  assert.equal(payload.error.code, 'NOT_FOUND');
});

test('unknown tools and unsupported protocol versions use JSON-RPC errors', async () => {
  const { router } = await setup();
  const unknown = await router.dispatch(request(8, 'tools/call', { name: 'missing.tool', arguments: {} }));
  assert.equal(unknown.error.code, -32602);

  const badVersion = request(9, 'tools/list');
  badVersion.params._meta['io.modelcontextprotocol/protocolVersion'] = '1900-01-01';
  const mismatch = await router.dispatch(badVersion);
  assert.equal(mismatch.error.code, -32022);
  assert.deepEqual(mismatch.error.data.supported, [PROTOCOL]);
});

test('MCP tools prepare, ingest, list, and validate ChatGPT Web base views', async () => {
  const { router } = await setup();
  const projectCall = await router.dispatch(request(20, 'tools/call', {
    name: 'project.create', arguments: { name: 'Base View MCP' }
  }));
  const projectId = projectCall.result.structuredContent.project.project_id;
  await router.dispatch(request(21, 'tools/call', {
    name: 'character.create_spec',
    arguments: {
      project_id: projectId,
      character_id: 'char_mcp_base_001',
      name: 'MCP Base Hero',
      style_profile: 'ro_like_chibi_v1',
      proportion_profile: 'chibi_small_v1',
      views_required: ['S', 'SW', 'W', 'NW', 'N'],
      rig_preset: 'biped_chibi_v1',
      motion_preset: 'ro_like_motion_v1'
    }
  }));

  const prepare = await router.dispatch(request(22, 'tools/call', {
    name: 'character.prepare_base_views', arguments: { character_id: 'char_mcp_base_001', views: ['S'] }
  }));
  const generation = prepare.result.structuredContent.generation;
  assert.equal(generation.generator, 'chatgpt-web');
  assert.deepEqual(generation.views.map((view) => view.direction), ['S']);

  const ingest = await router.dispatch(request(23, 'tools/call', {
    name: 'character.ingest_base_view',
    arguments: {
      character_id: 'char_mcp_base_001',
      generation_id: generation.generation_id,
      direction: 'S',
      image_data_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    }
  }));
  assert.equal(ingest.result.structuredContent.view.direction, 'S');

  const list = await router.dispatch(request(24, 'tools/call', {
    name: 'character.get_base_views', arguments: { character_id: 'char_mcp_base_001' }
  }));
  assert.deepEqual(list.result.structuredContent.views.map((view) => view.direction), ['S']);

  const validate = await router.dispatch(request(25, 'tools/call', {
    name: 'character.validate_base_views', arguments: { character_id: 'char_mcp_base_001' }
  }));
  assert.equal(validate.result.structuredContent.validation.valid, false);
  assert.ok(validate.result.structuredContent.validation.errors.some((message) => message.includes('SW')));

  const segmented = await router.dispatch(request(26, 'tools/call', {
    name: 'parts.auto_segment', arguments: {
      character_id: 'char_mcp_base_001', source_direction: 'S', part_template: 'biped_chibi_parts_v1', mode: 'hybrid'
    }
  }));
  assert.equal(segmented.result.structuredContent.segmentation.parts_created, 17);

  const parts = await router.dispatch(request(27, 'tools/call', {
    name: 'parts.list', arguments: { character_id: 'char_mcp_base_001', direction: 'S' }
  }));
  assert.equal(parts.result.structuredContent.parts.length, 17);
  assert.ok(parts.result.structuredContent.parts.every((part) => part.approved === false));
});
