import { createServer } from 'node:http';

import { decodePngRgba, encodePngRgba } from '../../src/media/png-raster.mjs';

const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_OPENAI_URL = 'https://api.openai.com/v1/images/generations';
const DEFAULT_MODEL = 'gpt-image-2';
const DEFAULT_SIZE = '1024x1024';
const DEFAULT_QUALITY = 'medium';

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body is too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function parseSize(value) {
  const match = /^(\d+)x(\d+)$/.exec(value ?? '');
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

export function isGptImage2CompatibleSize(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return false;
  if (width < 1 || height < 1 || width > 3840 || height > 3840) return false;
  if (width % 16 !== 0 || height % 16 !== 0) return false;
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (long / short > 3) return false;
  const pixels = width * height;
  return pixels >= 655_360 && pixels <= 8_294_400;
}

export function chooseGenerationSize(outputConstraints, configuredSize = null) {
  if (configuredSize) {
    const parsed = parseSize(configuredSize);
    if (!parsed || !isGptImage2CompatibleSize(parsed.width, parsed.height)) {
      throw new Error('OPENAI_IMAGE_SIZE must be a GPT Image 2 compatible WxH size');
    }
    return configuredSize;
  }

  const width = Number(outputConstraints?.canvas_width);
  const height = Number(outputConstraints?.canvas_height);
  if (isGptImage2CompatibleSize(width, height)) return `${width}x${height}`;
  return DEFAULT_SIZE;
}

function isMagenta(r, g, b, threshold) {
  return r >= threshold.redMin
    && b >= threshold.blueMin
    && g <= threshold.greenMax
    && Math.abs(r - b) <= threshold.redBlueDelta;
}

export function removeEdgeConnectedMagenta(image, {
  redMin = 170,
  blueMin = 170,
  greenMax = 125,
  redBlueDelta = 100
} = {}) {
  const { width, height } = image;
  const rgba = Buffer.from(image.rgba);
  const threshold = { redMin, blueMin, greenMax, redBlueDelta };
  const visited = new Uint8Array(width * height);
  const queue = new Uint32Array(width * height);
  let head = 0;
  let tail = 0;

  function enqueue(x, y) {
    const index = y * width + x;
    if (visited[index]) return;
    const base = index * 4;
    if (!isMagenta(rgba[base], rgba[base + 1], rgba[base + 2], threshold)) return;
    visited[index] = 1;
    queue[tail++] = index;
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    rgba[index * 4 + 3] = 0;
    if (x > 0) enqueue(x - 1, y);
    if (x + 1 < width) enqueue(x + 1, y);
    if (y > 0) enqueue(x, y - 1);
    if (y + 1 < height) enqueue(x, y + 1);
  }

  return { width, height, rgba, removed_pixels: tail };
}

function bridgePrompt(prompt) {
  return [
    prompt,
    'IMPORTANT OUTPUT BACKGROUND OVERRIDE:',
    'Render the subject on a perfectly flat solid chroma-key magenta background (#FF00FF).',
    'Do not use magenta, pink, purple, or fuchsia anywhere on the character, clothing, equipment, shadows, or effects.',
    'Keep a clean hard separation between the character silhouette and the magenta background.',
    'Do not add a floor, cast shadow, frame, text, scenery, gradient, glow, or background object.'
  ].join(' ');
}

function bearerToken(req) {
  const value = req.headers.authorization;
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) return null;
  return value.slice('Bearer '.length);
}

export function createOpenAIImageBridgeServer({
  apiKey = process.env.OPENAI_API_KEY,
  apiUrl = process.env.OPENAI_IMAGE_API_URL || DEFAULT_OPENAI_URL,
  model = process.env.OPENAI_IMAGE_MODEL || DEFAULT_MODEL,
  configuredSize = process.env.OPENAI_IMAGE_SIZE || null,
  quality = process.env.OPENAI_IMAGE_QUALITY || DEFAULT_QUALITY,
  bridgeToken = process.env.BRIDGE_TOKEN || null,
  fetchImpl = fetch
} = {}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required');

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');

      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, { status: 'ok', provider: 'openai', model });
        return;
      }

      if (req.method !== 'POST' || url.pathname !== '/generate') {
        sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Use POST /generate' } });
        return;
      }

      if (bridgeToken && bearerToken(req) !== bridgeToken) {
        sendJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Invalid bridge bearer token' } });
        return;
      }

      const input = await readJson(req);
      if (typeof input.prompt !== 'string' || !input.prompt.trim()) {
        sendJson(res, 400, { error: { code: 'INVALID_ARGUMENT', message: 'prompt is required' } });
        return;
      }

      const size = chooseGenerationSize(input.output_constraints, configuredSize);
      const upstream = await fetchImpl(apiUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model,
          prompt: bridgePrompt(input.prompt),
          size,
          quality,
          output_format: 'png',
          moderation: 'auto'
        })
      });

      const payload = await upstream.json().catch(() => null);
      if (!upstream.ok) {
        sendJson(res, 502, {
          error: {
            code: 'OPENAI_IMAGE_ERROR',
            message: payload?.error?.message ?? `OpenAI image request failed with HTTP ${upstream.status}`,
            upstream_status: upstream.status,
            upstream_code: payload?.error?.code ?? null,
            request_id: upstream.headers.get('x-request-id')
          }
        });
        return;
      }

      const base64 = payload?.data?.[0]?.b64_json;
      if (typeof base64 !== 'string' || !base64) {
        sendJson(res, 502, {
          error: { code: 'INVALID_OPENAI_RESPONSE', message: 'OpenAI response did not contain data[0].b64_json' }
        });
        return;
      }

      const sourceBytes = Buffer.from(base64, 'base64');
      const decoded = decodePngRgba(sourceBytes);
      const keyed = removeEdgeConnectedMagenta(decoded);
      if (keyed.removed_pixels === 0) {
        sendJson(res, 422, {
          error: {
            code: 'CHROMA_KEY_NOT_FOUND',
            message: 'Generated image did not contain an edge-connected magenta background. Regenerate the view.'
          }
        });
        return;
      }

      const png = encodePngRgba(keyed);
      sendJson(res, 200, {
        image_data_url: `data:image/png;base64,${png.toString('base64')}`,
        provider: 'openai',
        model,
        metadata: {
          direction: input.direction ?? null,
          generation_id: input.generation_id ?? null,
          requested_runtime_canvas: input.output_constraints ?? null,
          generated_size: size,
          quality,
          background_method: 'edge-connected-magenta-chroma-key',
          removed_background_pixels: keyed.removed_pixels,
          upstream_request_id: upstream.headers.get('x-request-id')
        }
      });
    } catch (error) {
      sendJson(res, 500, {
        error: {
          code: 'BRIDGE_ERROR',
          message: error?.message ?? 'Image bridge failed'
        }
      });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const host = process.env.BRIDGE_HOST || '127.0.0.1';
  const port = Number(process.env.BRIDGE_PORT || 8790);
  const server = createOpenAIImageBridgeServer();
  server.listen(port, host, () => {
    console.log(`Character-Asset OpenAI image bridge listening on http://${host}:${port}`);
    console.log(`Bridge endpoint: http://${host}:${port}/generate`);
  });
}
