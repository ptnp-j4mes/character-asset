import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import {
  chooseGenerationSize,
  createOpenAIImageBridgeServer,
  removeEdgeConnectedMagenta
} from '../examples/openai-image-bridge/server.mjs';
import { decodePngRgba, encodePngRgba } from '../src/media/png-raster.mjs';

function sampleMagentaPng() {
  const width = 64;
  const height = 64;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const subject = x >= 20 && x < 44 && y >= 10 && y < 54;
      rgba[i] = subject ? 80 : 255;
      rgba[i + 1] = subject ? 120 : 0;
      rgba[i + 2] = subject ? 170 : 255;
      rgba[i + 3] = 255;
    }
  }
  return encodePngRgba({ width, height, rgba });
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

test('generation size uses runtime size only when GPT Image 2 accepts it', () => {
  assert.equal(chooseGenerationSize({ canvas_width: 1024, canvas_height: 1024 }), '1024x1024');
  assert.equal(chooseGenerationSize({ canvas_width: 128, canvas_height: 128 }), '1024x1024');
  assert.equal(chooseGenerationSize({ canvas_width: 1536, canvas_height: 1024 }), '1536x1024');
});

test('edge-connected magenta becomes alpha while subject remains opaque', () => {
  const decoded = decodePngRgba(sampleMagentaPng());
  const keyed = removeEdgeConnectedMagenta(decoded);
  assert.ok(keyed.removed_pixels > 0);
  assert.equal(keyed.rgba[(0 * keyed.width + 0) * 4 + 3], 0);
  assert.equal(keyed.rgba[(20 * keyed.width + 30) * 4 + 3], 255);
});

test('bridge calls OpenAI image generations and returns transparent PNG data URL', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({
      data: [{ b64_json: sampleMagentaPng().toString('base64') }]
    }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-request-id': 'req_test_bridge' }
    });
  };

  const server = createOpenAIImageBridgeServer({
    apiKey: 'test-key',
    bridgeToken: 'bridge-secret',
    fetchImpl
  });
  const base = await listen(server);
  try {
    const response = await fetch(`${base}/generate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer bridge-secret'
      },
      body: JSON.stringify({
        prompt: 'Create a swordsman',
        direction: 'S',
        generation_id: 'gen_test',
        output_constraints: { canvas_width: 128, canvas_height: 128 }
      })
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.match(payload.image_data_url, /^data:image\/png;base64,/);
    assert.equal(payload.provider, 'openai');
    assert.equal(payload.model, 'gpt-image-2');
    assert.equal(payload.metadata.generated_size, '1024x1024');
    assert.equal(payload.metadata.background_method, 'edge-connected-magenta-chroma-key');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.openai.com/v1/images/generations');
    const requestBody = JSON.parse(calls[0].options.body);
    assert.equal(requestBody.model, 'gpt-image-2');
    assert.equal(requestBody.output_format, 'png');
    assert.ok(requestBody.prompt.includes('#FF00FF'));

    const png = Buffer.from(payload.image_data_url.split(',')[1], 'base64');
    const decoded = decodePngRgba(png);
    assert.equal(decoded.rgba[3], 0);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('bridge rejects incorrect bearer token before calling provider', async () => {
  let called = false;
  const server = createOpenAIImageBridgeServer({
    apiKey: 'test-key',
    bridgeToken: 'bridge-secret',
    fetchImpl: async () => {
      called = true;
      throw new Error('should not be called');
    }
  });
  const base = await listen(server);
  try {
    const response = await fetch(`${base}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' },
      body: JSON.stringify({ prompt: 'test' })
    });
    assert.equal(response.status, 401);
    assert.equal(called, false);
  } finally {
    server.close();
    await once(server, 'close');
  }
});
