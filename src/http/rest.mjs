import { CharacterAssetError } from '../errors.mjs';

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_IMAGE_BODY_BYTES = 16 * 1024 * 1024;

export async function readJsonBody(req, { maxBytes = MAX_BODY_BYTES } = {}) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new CharacterAssetError('INVALID_ARGUMENT', `Request body exceeds ${Math.ceil(maxBytes / (1024 * 1024))} MiB limit`);
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new CharacterAssetError('INVALID_ARGUMENT', 'Request body must be valid JSON');
  }
}

export function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendPng(res, bytes) {
  res.writeHead(200, {
    'content-type': 'image/png',
    'content-length': bytes.length,
    'cache-control': 'no-store'
  });
  res.end(bytes);
}

export function errorStatus(error) {
  if (!(error instanceof CharacterAssetError)) return 500;
  return {
    INVALID_ARGUMENT: 400,
    NOT_FOUND: 404,
    CONFLICT: 409,
    UNSUPPORTED_OPERATION: 422
  }[error.code] ?? 500;
}

export function sendRestError(res, error) {
  const status = errorStatus(error);
  const normalized = error instanceof CharacterAssetError
    ? error.toJSON()
    : { code: 'INTERNAL_ERROR', message: 'Internal server error' };
  sendJson(res, status, { error: normalized });
}

export async function handleRest(req, res, url, service) {
  if (req.method === 'POST' && url.pathname === '/projects') {
    sendJson(res, 201, { project: await service.createProject(await readJsonBody(req)) });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/characters/specs') {
    sendJson(res, 201, { spec: await service.createCharacterSpec(await readJsonBody(req)) });
    return true;
  }

  const specMatch = url.pathname.match(/^\/characters\/([^/]+)\/spec$/);
  if (req.method === 'GET' && specMatch) {
    sendJson(res, 200, { spec: await service.getCharacterSpec(decodeURIComponent(specMatch[1])) });
    return true;
  }

  const prepareBaseViewsMatch = url.pathname.match(/^\/characters\/([^/]+)\/base-views:prepare$/);
  if (req.method === 'POST' && prepareBaseViewsMatch) {
    const body = await readJsonBody(req);
    sendJson(res, 201, {
      generation: await service.prepareBaseViews({ ...body, character_id: decodeURIComponent(prepareBaseViewsMatch[1]) })
    });
    return true;
  }

  const ingestBaseViewMatch = url.pathname.match(/^\/characters\/([^/]+)\/base-views\/([^/]+):ingest$/);
  if (req.method === 'POST' && ingestBaseViewMatch) {
    const body = await readJsonBody(req, { maxBytes: MAX_IMAGE_BODY_BYTES });
    sendJson(res, 201, {
      view: await service.ingestBaseView({
        ...body,
        character_id: decodeURIComponent(ingestBaseViewMatch[1]),
        direction: decodeURIComponent(ingestBaseViewMatch[2])
      })
    });
    return true;
  }

  const baseViewImageMatch = url.pathname.match(/^\/characters\/([^/]+)\/base-views\/([^/]+)\/image$/);
  if (req.method === 'GET' && baseViewImageMatch) {
    const image = await service.getBaseViewImage(
      decodeURIComponent(baseViewImageMatch[1]),
      decodeURIComponent(baseViewImageMatch[2])
    );
    sendPng(res, image);
    return true;
  }

  const baseViewsMatch = url.pathname.match(/^\/characters\/([^/]+)\/base-views$/);
  if (req.method === 'GET' && baseViewsMatch) {
    sendJson(res, 200, await service.getBaseViews(decodeURIComponent(baseViewsMatch[1])));
    return true;
  }

  const validateBaseViewsMatch = url.pathname.match(/^\/characters\/([^/]+)\/base-views:validate$/);
  if (req.method === 'POST' && validateBaseViewsMatch) {
    await readJsonBody(req);
    sendJson(res, 200, {
      validation: await service.validateBaseViews({ character_id: decodeURIComponent(validateBaseViewsMatch[1]) })
    });
    return true;
  }

  const rigMatch = url.pathname.match(/^\/characters\/([^/]+)\/rig$/);
  if (req.method === 'POST' && rigMatch) {
    const body = await readJsonBody(req);
    sendJson(res, 201, {
      rig: await service.createRig({ ...body, character_id: decodeURIComponent(rigMatch[1]) })
    });
    return true;
  }

  return false;
}
