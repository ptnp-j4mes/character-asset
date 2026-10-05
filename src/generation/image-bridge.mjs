import { CharacterAssetError } from '../errors.mjs';

export class HttpImageGenerationBridge {
  constructor({ endpoint, token = null, fetchImpl = fetch, timeoutMs = 120000 } = {}) {
    if (!endpoint) throw new TypeError('endpoint is required');
    this.endpoint = endpoint;
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async generate(request) {
    let response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {})
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      throw new CharacterAssetError('INTERNAL_ERROR', 'Image-generation bridge could not be reached', {
        endpoint: this.endpoint,
        cause: error?.message ?? String(error)
      });
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new CharacterAssetError('INTERNAL_ERROR', 'Image-generation bridge returned invalid JSON', {
        endpoint: this.endpoint,
        status: response.status
      });
    }
    if (!response.ok) {
      throw new CharacterAssetError('INTERNAL_ERROR', 'Image-generation bridge returned an error', {
        endpoint: this.endpoint,
        status: response.status,
        response: payload
      });
    }
    if (typeof payload?.image_data_url !== 'string' || !payload.image_data_url.startsWith('data:image/png;base64,')) {
      throw new CharacterAssetError('INTERNAL_ERROR', 'Image-generation bridge must return image_data_url as a PNG data URL', {
        endpoint: this.endpoint,
        status: response.status
      });
    }
    return payload;
  }
}

export function imageBridgeFromEnv(env = process.env) {
  const endpoint = env.CHARACTER_ASSET_IMAGE_BRIDGE_URL?.trim();
  if (!endpoint) return null;
  return new HttpImageGenerationBridge({
    endpoint,
    token: env.CHARACTER_ASSET_IMAGE_BRIDGE_TOKEN?.trim() || null,
    timeoutMs: Number(env.CHARACTER_ASSET_IMAGE_BRIDGE_TIMEOUT_MS || 120000)
  });
}
