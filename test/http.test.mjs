import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createHttpServer } from '../src/http/server.mjs';

const PROTOCOL = '2026-07-28';
const meta = () => ({
  'io.modelcontextprotocol/protocolVersion': PROTOCOL,
  'io.modelcontextprotocol/clientInfo': { name: 'http-test', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {}
});

async function setup(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'character-asset-http-'));
  const server = createHttpServer({ dataDir });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  return { base: `http://127.0.0.1:${address.port}` };
}

async function json(response) {
  return { status: response.status, body: await response.json() };
}

function mcpBody(id, method, params = {}) {
  return { jsonrpc: '2.0', id, method, params: { ...params, _meta: meta() } };
}

async function mcpFetch(base, body, extraHeaders = {}) {
  const headers = {
    'content-type': 'application/json',
    'mcp-protocol-version': PROTOCOL,
    'mcp-method': body.method,
    ...extraHeaders
  };
  if (body.method === 'tools/call') headers['mcp-name'] = body.params.name;
  return fetch(`${base}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) });
}

test('health endpoint reports Character-Asset V1', async (t) => {
  const { base } = await setup(t);
  const response = await json(await fetch(`${base}/health`));
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'ok', project: 'Character-Asset', version: '0.3.0' });
});

test('REST routes share the domain service for project, spec, get, and rig', async (t) => {
  const { base } = await setup(t);
  const projectResponse = await json(await fetch(`${base}/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'REST Demo' })
  }));
  assert.equal(projectResponse.status, 201);
  const project = projectResponse.body.project;

  const specInput = {
    project_id: project.project_id,
    character_id: 'char_rest_001',
    name: 'REST Novice',
    style_profile: 'ro_like_chibi_v1',
    proportion_profile: 'chibi_small_v1',
    views_required: ['S', 'SW', 'W', 'NW', 'N'],
    rig_preset: 'biped_chibi_v1',
    motion_preset: 'ro_like_motion_v1'
  };
  const specResponse = await json(await fetch(`${base}/characters/specs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(specInput)
  }));
  assert.equal(specResponse.status, 201);
  assert.equal(specResponse.body.spec.character_id, 'char_rest_001');

  const getResponse = await json(await fetch(`${base}/characters/char_rest_001/spec`));
  assert.equal(getResponse.status, 200);
  assert.deepEqual(getResponse.body.spec, specResponse.body.spec);

  const rigResponse = await json(await fetch(`${base}/characters/char_rest_001/rig`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rig_preset: 'biped_chibi_v1', auto_bind: true })
  }));
  assert.equal(rigResponse.status, 201);
  assert.equal(rigResponse.body.rig.version, 1);
});

test('REST maps domain errors to stable HTTP error envelopes', async (t) => {
  const { base } = await setup(t);
  const response = await json(await fetch(`${base}/characters/specs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      project_id: 'proj_missing',
      character_id: 'char_no_project',
      name: 'Missing',
      style_profile: 'ro_like_chibi_v1',
      proportion_profile: 'chibi_small_v1',
      views_required: ['S'],
      rig_preset: 'biped_chibi_v1',
      motion_preset: 'ro_like_motion_v1'
    })
  }));

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'NOT_FOUND');
});

test('MCP endpoint serves discover, tools/list, and tools/call over stateless HTTP', async (t) => {
  const { base } = await setup(t);
  const discover = await json(await mcpFetch(base, mcpBody(1, 'server/discover')));
  assert.equal(discover.status, 200);
  assert.deepEqual(discover.body.result.supportedVersions, [PROTOCOL]);

  const list = await json(await mcpFetch(base, mcpBody(2, 'tools/list')));
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.result.tools.map((tool) => tool.name), [
    'project.create',
    'character.create_spec',
    'character.get_spec',
    'character.generate_base_views',
    'character.prepare_base_views',
    'character.ingest_base_view',
    'character.get_base_views',
    'character.validate_base_views',
    'parts.auto_segment',
    'parts.list',
    'parts.get',
    'parts.update_mask',
    'parts.create_manual',
    'parts.approve',
    'rig.create',
    'rig.get',
    'rig.auto_bind_parts',
    'rig.validate'
  ]);

  const call = await json(await mcpFetch(base, mcpBody(3, 'tools/call', {
    name: 'project.create',
    arguments: { name: 'MCP HTTP Demo' }
  })));
  assert.equal(call.status, 200);
  assert.match(call.body.result.structuredContent.project.project_id, /^proj_/);
});

test('MCP endpoint rejects missing or mismatched standard headers', async (t) => {
  const { base } = await setup(t);
  const body = mcpBody(4, 'tools/list');
  const response = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'mcp-protocol-version': PROTOCOL,
      'mcp-method': 'tools/call'
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, -32020);
});

test('local server rejects cross-origin MCP requests', async (t) => {
  const { base } = await setup(t);
  const body = mcpBody(5, 'tools/list');
  const response = await mcpFetch(base, body, { origin: 'https://evil.example' });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.error.code, -32021);
});

test('REST supports prepare -> ingest -> get -> validate for ChatGPT Web base views', async (t) => {
  const { base } = await setup(t);
  const project = (await json(await fetch(`${base}/projects`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'REST Base Views' })
  }))).body.project;

  await fetch(`${base}/characters/specs`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      project_id: project.project_id,
      character_id: 'char_http_base_001',
      name: 'REST Base Hero',
      style_profile: 'ro_like_chibi_v1',
      proportion_profile: 'chibi_small_v1',
      views_required: ['S', 'SW', 'W', 'NW', 'N'],
      rig_preset: 'biped_chibi_v1',
      motion_preset: 'ro_like_motion_v1'
    })
  });

  const prepared = await json(await fetch(`${base}/characters/char_http_base_001/base-views:prepare`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ views: ['S'] })
  }));
  assert.equal(prepared.status, 201);
  const generationId = prepared.body.generation.generation_id;

  const ingested = await json(await fetch(`${base}/characters/char_http_base_001/base-views/S:ingest`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      generation_id: generationId,
      image_data_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    })
  }));
  assert.equal(ingested.status, 201);
  assert.equal(ingested.body.view.direction, 'S');

  const listed = await json(await fetch(`${base}/characters/char_http_base_001/base-views`));
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.views.map((view) => view.direction), ['S']);

  const validated = await json(await fetch(`${base}/characters/char_http_base_001/base-views:validate`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
  }));
  assert.equal(validated.status, 200);
  assert.equal(validated.body.validation.valid, false);

  const segmented = await json(await fetch(`${base}/characters/char_http_base_001/parts:auto-segment`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      source_direction: 'S',
      part_template: 'biped_chibi_parts_v1',
      mode: 'hybrid'
    })
  }));
  assert.equal(segmented.status, 201);
  assert.equal(segmented.body.segmentation.parts_created, 17);
  assert.equal(segmented.body.segmentation.review_required, true);

  const parts = await json(await fetch(`${base}/characters/char_http_base_001/parts?direction=S`));
  assert.equal(parts.status, 200);
  assert.equal(parts.body.parts.length, 17);
  assert.ok(parts.body.parts.every((part) => part.status === 'draft'));
});
