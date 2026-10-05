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
    UNSUPPORTED_OPERATION: 422,
    VALIDATION_FAILED: 422,
    INTERNAL_ERROR: 500
  }[error.code] ?? 500;
}

export function sendRestError(res, error) {
  const status = errorStatus(error);
  const normalized = error instanceof CharacterAssetError
    ? error.toJSON()
    : { code: 'INTERNAL_ERROR', message: 'Internal server error' };
  sendJson(res, status, { error: normalized });
}

function boolQuery(value) {
  if (value === null) return false;
  return value === 'true' || value === '1';
}

function ensurePartCharacter(part, characterId) {
  if (part?.character_id !== characterId) {
    throw new CharacterAssetError('NOT_FOUND', `Part does not belong to character ${characterId}`, { character_id: characterId });
  }
}

export async function handleRest(req, res, url, service) {

  if (req.method === 'GET' && url.pathname === '/companion/handoffs/active') {
    sendJson(res, 200, { handoff: await service.getActiveImageHandoff() });
    return true;
  }

  const companionHandoffMatch = url.pathname.match(/^\/companion\/handoffs\/([^/]+)$/);
  if (req.method === 'GET' && companionHandoffMatch) {
    sendJson(res, 200, { handoff: await service.getImageHandoff(decodeURIComponent(companionHandoffMatch[1])) });
    return true;
  }

  const companionImageMatch = url.pathname.match(/^\/companion\/handoffs\/([^/]+)\/images\/([^/]+)$/);
  if (req.method === 'POST' && companionImageMatch) {
    const body = await readJsonBody(req, { maxBytes: MAX_IMAGE_BODY_BYTES });
    sendJson(res, 201, await service.ingestCompanionImage({
      ...body,
      handoff_id: decodeURIComponent(companionImageMatch[1]),
      direction: decodeURIComponent(companionImageMatch[2])
    }));
    return true;
  }
  if (req.method === 'GET' && url.pathname === '/projects') {
    sendJson(res, 200, { projects: await service.listProjects() });
    return true;
  }

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

  const beginHandoffMatch = url.pathname.match(/^\/characters\/([^/]+)\/image-handoffs$/);
  if (req.method === 'POST' && beginHandoffMatch) {
    const body = await readJsonBody(req);
    sendJson(res, 201, await service.beginImageHandoff({
      ...body,
      character_id: decodeURIComponent(beginHandoffMatch[1])
    }));
    return true;
  }

  const getHandoffMatch = url.pathname.match(/^\/image-handoffs\/([^/]+)$/);
  if (req.method === 'GET' && getHandoffMatch) {
    sendJson(res, 200, { handoff: await service.getImageHandoff(decodeURIComponent(getHandoffMatch[1])) });
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

  const autoSegmentMatch = url.pathname.match(/^\/characters\/([^/]+)\/parts:auto-segment$/);
  if (req.method === 'POST' && autoSegmentMatch) {
    const body = await readJsonBody(req);
    sendJson(res, 201, {
      segmentation: await service.autoSegmentParts({
        ...body,
        character_id: decodeURIComponent(autoSegmentMatch[1])
      })
    });
    return true;
  }

  const listPartsMatch = url.pathname.match(/^\/characters\/([^/]+)\/parts$/);
  if (req.method === 'GET' && listPartsMatch) {
    sendJson(res, 200, await service.listParts({
      character_id: decodeURIComponent(listPartsMatch[1]),
      ...(url.searchParams.get('direction') ? { direction: url.searchParams.get('direction') } : {}),
      approved_only: boolQuery(url.searchParams.get('approved_only'))
    }));
    return true;
  }

  const manualPartMatch = url.pathname.match(/^\/characters\/([^/]+)\/parts:manual$/);
  if (req.method === 'POST' && manualPartMatch) {
    const body = await readJsonBody(req, { maxBytes: MAX_IMAGE_BODY_BYTES });
    sendJson(res, 201, {
      part: await service.createManualPart({
        ...body,
        character_id: decodeURIComponent(manualPartMatch[1])
      })
    });
    return true;
  }

  const partArtifactMatch = url.pathname.match(/^\/characters\/([^/]+)\/parts\/([^/]+)\/(cutout|mask)$/);
  if (req.method === 'GET' && partArtifactMatch) {
    const image = await service.getPartArtifact(
      decodeURIComponent(partArtifactMatch[1]),
      decodeURIComponent(partArtifactMatch[2]),
      partArtifactMatch[3]
    );
    sendPng(res, image);
    return true;
  }

  const updatePartMaskMatch = url.pathname.match(/^\/characters\/([^/]+)\/parts\/([^/]+)\/mask$/);
  if (req.method === 'PUT' && updatePartMaskMatch) {
    const characterId = decodeURIComponent(updatePartMaskMatch[1]);
    const partId = decodeURIComponent(updatePartMaskMatch[2]);
    const current = await service.getPart(partId);
    ensurePartCharacter(current.part, characterId);
    const body = await readJsonBody(req, { maxBytes: MAX_IMAGE_BODY_BYTES });
    sendJson(res, 200, { part: await service.updatePartMask({ ...body, part_id: partId }) });
    return true;
  }

  const approvePartMatch = url.pathname.match(/^\/characters\/([^/]+)\/parts\/([^/]+):approve$/);
  if (req.method === 'POST' && approvePartMatch) {
    const characterId = decodeURIComponent(approvePartMatch[1]);
    const partId = decodeURIComponent(approvePartMatch[2]);
    const current = await service.getPart(partId);
    ensurePartCharacter(current.part, characterId);
    const body = await readJsonBody(req);
    sendJson(res, 200, { part: await service.approvePart({ ...body, part_id: partId }) });
    return true;
  }

  const getPartMatch = url.pathname.match(/^\/characters\/([^/]+)\/parts\/([^/]+)$/);
  if (req.method === 'GET' && getPartMatch) {
    const characterId = decodeURIComponent(getPartMatch[1]);
    const part = await service.getPart(decodeURIComponent(getPartMatch[2]));
    ensurePartCharacter(part.part, characterId);
    sendJson(res, 200, part);
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

  if (req.method === 'GET' && rigMatch) {
    sendJson(res, 200, { rig: await service.getRig(decodeURIComponent(rigMatch[1])) });
    return true;
  }

  const autoBindMatch = url.pathname.match(/^\/characters\/([^/]+)\/rig:auto-bind$/);
  if (req.method === 'POST' && autoBindMatch) {
    const body = await readJsonBody(req);
    sendJson(res, 200, await service.autoBindParts({
      ...body,
      character_id: decodeURIComponent(autoBindMatch[1])
    }));
    return true;
  }

  const validateRigMatch = url.pathname.match(/^\/characters\/([^/]+)\/rig:validate$/);
  if (req.method === 'POST' && validateRigMatch) {
    await readJsonBody(req);
    sendJson(res, 200, await service.validateRig({
      character_id: decodeURIComponent(validateRigMatch[1])
    }));
    return true;
  }

  return false;
}
