import { randomUUID } from 'node:crypto';

import { CharacterAssetError } from '../errors.mjs';
import { createBipedChibiRig, SUPPORTED_RIG_PRESETS } from './rig-presets.mjs';
import {
  BIPED_CHIBI_PARTS,
  PART_ORDER,
  PART_TEMPLATE_ID,
  occlusionFor,
  partDefinition,
  resolvePartTemplate
} from './part-templates.mjs';
import { decodePngDataUrl } from '../media/png.mjs';
import {
  alphaBounds,
  applyAlphaMask,
  decodePngRgba,
  encodeMaskPng,
  maskAlphaFromRgba,
  maskBounds
} from '../media/png-raster.mjs';

const ID_PATTERNS = {
  project: /^proj_[A-Za-z0-9_-]+$/,
  character: /^char_[A-Za-z0-9_-]+$/,
  generation: /^gen_[A-Za-z0-9_-]+$/,
  rig: /^rig_[A-Za-z0-9_-]+$/,
  part: /^part_[A-Za-z0-9_-]+$/
};

const DIRECTIONS = new Set(['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE']);
const DIRECTION_ORDER = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'];
const BASE_DIRECTIONS = ['S', 'SW', 'W', 'NW', 'N'];
const BASE_DIRECTION_SET = new Set(BASE_DIRECTIONS);
const DIRECTION_PROMPTS = {
  S: 'front view facing the camera',
  SW: 'three-quarter front view facing screen-left',
  W: 'side profile facing screen-left',
  NW: 'three-quarter back view facing screen-left',
  N: 'back view facing away from the camera'
};
const PROMPT_TEMPLATE_VERSION = 'chatgpt_base_views_v1';
const SLOTS = new Set(['head', 'weapon', 'shield', 'back', 'fx', 'custom']);
const PART_CATEGORIES = new Set(['body_part', 'hair', 'equipment', 'shadow', 'fx', 'custom']);
const RECOMMENDED_AUTHORING_SIZE = 512;

function id(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

function now() {
  return new Date().toISOString();
}

function invalid(message, details) {
  throw new CharacterAssetError('INVALID_ARGUMENT', message, details);
}

function validationFailed(message, details) {
  throw new CharacterAssetError('VALIDATION_FAILED', message, details);
}

function requireString(value, field, { maxLength } = {}) {
  if (typeof value !== 'string' || !value.trim()) invalid(`${field} must be a non-empty string`, { field });
  const result = value.trim();
  if (maxLength && result.length > maxLength) invalid(`${field} exceeds maximum length`, { field, maxLength });
  return result;
}

function requireId(value, field, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) invalid(`${field} has an invalid format`, { field });
  return value;
}

function uniqueEnumArray(value, field, allowed, { minItems = 0 } = {}) {
  if (!Array.isArray(value) || value.length < minItems) invalid(`${field} must be an array`, { field });
  if (new Set(value).size !== value.length || value.some((item) => !allowed.has(item))) {
    invalid(`${field} contains invalid or duplicate values`, { field });
  }
  return [...value];
}

function requireDirection(value, { canonical = false, field = 'direction' } = {}) {
  const result = requireString(value, field);
  const allowed = canonical ? BASE_DIRECTION_SET : DIRECTIONS;
  if (!allowed.has(result)) invalid(`${field} is not a supported direction`, { field, direction: result });
  return result;
}

function requirePartName(value) {
  const name = requireString(value, 'name', { maxLength: 120 });
  if (!/^[A-Za-z0-9_-]+$/.test(name)) invalid('name may contain only letters, numbers, underscores and hyphens', { field: 'name' });
  return name;
}

function pivotValue(value, fallback) {
  if (value === undefined) return structuredClone(fallback);
  if (!value || typeof value !== 'object' || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    invalid('pivot must contain numeric x and y', { field: 'pivot' });
  }
  return { x: value.x, y: value.y };
}

function authoringMetadata(spec, width, height) {
  return {
    source_width: width,
    source_height: height,
    runtime_width: spec.output_constraints.canvas_width,
    runtime_height: spec.output_constraints.canvas_height,
    authoring_recommended_width: RECOMMENDED_AUTHORING_SIZE,
    authoring_recommended_height: RECOMMENDED_AUTHORING_SIZE
  };
}

function regionMask(source, sourceBounds, region) {
  const alpha = Buffer.alloc(source.width * source.height);
  const left = sourceBounds.x + region.x * sourceBounds.width;
  const top = sourceBounds.y + region.y * sourceBounds.height;
  const width = Math.max(1, region.w * sourceBounds.width);
  const height = Math.max(1, region.h * sourceBounds.height);
  const cx = left + width / 2;
  const cy = top + height / 2;
  let count = 0;

  for (let y = Math.max(0, Math.floor(top)); y < Math.min(source.height, Math.ceil(top + height)); y += 1) {
    for (let x = Math.max(0, Math.floor(left)); x < Math.min(source.width, Math.ceil(left + width)); x += 1) {
      const sourceAlpha = source.rgba[(y * source.width + x) * 4 + 3];
      if (!sourceAlpha) continue;
      const nx = (x + 0.5 - cx) / (width / 2);
      const ny = (y + 0.5 - cy) / (height / 2);
      const inside = region.shape === 'ellipse'
        ? (nx * nx + ny * ny) <= 1
        : x >= left && x < left + width && y >= top && y < top + height;
      if (!inside) continue;
      alpha[y * source.width + x] = sourceAlpha;
      count += 1;
    }
  }

  let fallback = false;
  if (count === 0) {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let y = sourceBounds.y; y < sourceBounds.y + sourceBounds.height; y += 1) {
      for (let x = sourceBounds.x; x < sourceBounds.x + sourceBounds.width; x += 1) {
        const sourceAlpha = source.rgba[(y * source.width + x) * 4 + 3];
        if (!sourceAlpha) continue;
        const distance = ((x - cx) ** 2) + ((y - cy) ** 2);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = y * source.width + x;
        }
      }
    }
    if (bestIndex >= 0) {
      alpha[bestIndex] = source.rgba[bestIndex * 4 + 3];
      fallback = true;
    }
  }

  return { alpha, bounds: maskBounds(source.width, source.height, alpha), fallback };
}

function directionSort(a, b) {
  const directionDelta = DIRECTION_ORDER.indexOf(a.direction) - DIRECTION_ORDER.indexOf(b.direction);
  if (directionDelta !== 0) return directionDelta;
  return (PART_ORDER.get(a.name) ?? 999) - (PART_ORDER.get(b.name) ?? 999) || a.name.localeCompare(b.name);
}

function emptyOffset() {
  return { x: 0, y: 0, rotation: 0, scale_x: 1, scale_y: 1 };
}

export class CharacterAssetService {
  constructor(store) {
    this.store = store;
  }

  async createProject(input) {
    const createdAt = now();
    const project = {
      project_id: id('proj'),
      name: requireString(input?.name, 'name', { maxLength: 120 }),
      ...(input?.description === undefined ? {} : { description: String(input.description).trim() }),
      schema_version: '1.0.0',
      created_at: createdAt,
      updated_at: createdAt
    };
    if (project.description?.length > 2000) invalid('description exceeds maximum length', { field: 'description', maxLength: 2000 });
    await this.store.saveProject(project);
    return project;
  }

  async listProjects() {
    const [projects, characterIds] = await Promise.all([
      this.store.listProjects(),
      this.store.listCharacterIds()
    ]);
    const specs = await Promise.all(characterIds.map((characterId) => this.store.getCharacterSpec(characterId)));
    return projects.filter(Boolean).map((project) => ({
      ...project,
      characters: specs.filter((spec) => spec?.project_id === project.project_id).map(({ character_id, name, updated_at }) => ({
        character_id,
        name,
        updated_at
      }))
    })).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async createCharacterSpec(input) {
    const projectId = requireId(input?.project_id, 'project_id', ID_PATTERNS.project);
    const characterId = requireId(input?.character_id, 'character_id', ID_PATTERNS.character);
    if (!(await this.store.getProject(projectId))) {
      throw new CharacterAssetError('NOT_FOUND', `Project ${projectId} was not found`, { project_id: projectId });
    }
    if (await this.store.getCharacterSpec(characterId)) {
      throw new CharacterAssetError('CONFLICT', `Character ${characterId} already exists`, { character_id: characterId });
    }

    const views = uniqueEnumArray(input?.views_required, 'views_required', DIRECTIONS, { minItems: 1 });
    const slots = input?.equipment_slots === undefined
      ? []
      : uniqueEnumArray(input.equipment_slots, 'equipment_slots', SLOTS);
    const output = input?.output_constraints ?? {};
    const createdAt = now();
    const spec = {
      spec_id: id('spec'),
      character_id: characterId,
      project_id: projectId,
      name: requireString(input?.name, 'name', { maxLength: 120 }),
      style_profile: requireString(input?.style_profile, 'style_profile'),
      proportion_profile: requireString(input?.proportion_profile, 'proportion_profile'),
      visual: input?.visual ? structuredClone(input.visual) : {},
      views_required: views,
      equipment_slots: slots,
      rig_preset: requireString(input?.rig_preset, 'rig_preset'),
      motion_preset: requireString(input?.motion_preset, 'motion_preset'),
      output_constraints: {
        canvas_width: output.canvas_width ?? 512,
        canvas_height: output.canvas_height ?? 512,
        transparent_background: output.transparent_background ?? true,
        padding_px: output.padding_px ?? 16
      },
      status: 'draft',
      schema_version: '1.0.0',
      asset_version: 1,
      created_at: createdAt,
      updated_at: createdAt
    };
    await this.store.saveCharacterSpec(spec);
    return spec;
  }

  async getCharacterSpec(characterId) {
    requireId(characterId, 'character_id', ID_PATTERNS.character);
    const spec = await this.store.getCharacterSpec(characterId);
    if (!spec) throw new CharacterAssetError('NOT_FOUND', `Character ${characterId} was not found`, { character_id: characterId });
    return spec;
  }

  async prepareBaseViews(input) {
    const characterId = requireId(input?.character_id, 'character_id', ID_PATTERNS.character);
    const spec = await this.getCharacterSpec(characterId);
    const views = input?.views === undefined
      ? BASE_DIRECTIONS.filter((direction) => spec.views_required.includes(direction))
      : uniqueEnumArray(input.views, 'views', BASE_DIRECTION_SET, { minItems: 1 });
    if (views.length === 0) invalid('Character spec does not request any canonical base views', { field: 'views_required' });
    for (const direction of views) {
      if (!spec.views_required.includes(direction)) {
        invalid(`View ${direction} is not included in character views_required`, { field: 'views', direction });
      }
    }

    const visual = structuredClone(spec.visual ?? {});
    const generation = {
      generation_id: id('gen'),
      character_id: characterId,
      status: 'prepared',
      generator: 'chatgpt-web',
      prompt_template_version: PROMPT_TEMPLATE_VERSION,
      character_lock: {
        spec_id: spec.spec_id,
        asset_version: spec.asset_version,
        name: spec.name,
        style_profile: spec.style_profile,
        proportion_profile: spec.proportion_profile,
        visual,
        output_constraints: structuredClone(spec.output_constraints)
      },
      views: views.map((direction) => ({
        direction,
        prompt: this.#baseViewPrompt(spec, direction)
      })),
      created_at: now()
    };
    await this.store.saveBaseViewGeneration(generation);
    return generation;
  }

  #baseViewPrompt(spec, direction) {
    const visual = spec.visual ?? {};
    const details = [
      visual.gender_presentation && `gender presentation: ${visual.gender_presentation}`,
      visual.age_style && `age style: ${visual.age_style}`,
      visual.silhouette && `silhouette: ${visual.silhouette}`,
      visual.palette && `palette: ${JSON.stringify(visual.palette)}`,
      visual.prompt_notes && `identity details: ${visual.prompt_notes}`
    ].filter(Boolean).join('; ');
    return [
      'Create one full-body 2.5D chibi fantasy RPG character reference for Character-Asset.',
      `Keep the same character identity across every direction: ${spec.name}.`,
      `Style profile: ${spec.style_profile}; proportion profile: ${spec.proportion_profile}.`,
      details,
      `View direction ${direction}: ${DIRECTION_PROMPTS[direction]}.`,
      'Neutral standing pose, arms slightly separated from the torso, feet fully visible, consistent scale and camera height.',
      'Use a transparent background, no text, no frame, no extra characters, no weapon or loose props unless identity details explicitly require them.'
    ].filter(Boolean).join(' ');
  }

  async beginImageHandoff(input) {
    const characterId = requireId(input?.character_id, 'character_id', ID_PATTERNS.character);
    await this.getCharacterSpec(characterId);

    let generation;
    if (input?.generation_id) {
      const generationId = requireId(input.generation_id, 'generation_id', ID_PATTERNS.generation);
      generation = await this.store.getBaseViewGeneration(characterId, generationId);
      if (!generation) throw new CharacterAssetError('NOT_FOUND', `Generation ${generationId} was not found`, { generation_id: generationId });
    } else {
      generation = await this.prepareBaseViews({ character_id: characterId, ...(input?.views ? { views: input.views } : {}) });
    }

    const requestedViews = generation.views.map((view) => view.direction);
    const stored = await this.store.listBaseViews(characterId);
    const receivedViews = requestedViews.filter((direction) => stored.some((view) => view.direction === direction));
    const timestamp = now();
    const handoff = {
      handoff_id: id('handoff'),
      character_id: characterId,
      generation_id: generation.generation_id,
      source: 'chatgpt-web-companion',
      status: receivedViews.length === requestedViews.length ? 'completed' : 'active',
      requested_views: requestedViews,
      received_views: receivedViews,
      next_direction: requestedViews.find((direction) => !receivedViews.includes(direction)) ?? null,
      created_at: timestamp,
      updated_at: timestamp
    };
    await this.store.saveHandoff(handoff);
    return { handoff, generation };
  }

  async getImageHandoff(handoffId) {
    if (typeof handoffId !== 'string' || !/^handoff_[A-Za-z0-9_-]+$/.test(handoffId)) invalid('handoff_id has an invalid format', { field: 'handoff_id' });
    const handoff = await this.store.findHandoff(handoffId);
    if (!handoff) throw new CharacterAssetError('NOT_FOUND', `Handoff ${handoffId} was not found`, { handoff_id: handoffId });
    return this.#refreshHandoff(handoff);
  }

  async getActiveImageHandoff() {
    const active = await this.store.listActiveHandoffs();
    if (!active.length) return null;
    return this.#refreshHandoff(active[0]);
  }

  async #refreshHandoff(handoff) {
    const views = await this.store.listBaseViews(handoff.character_id);
    const receivedViews = handoff.requested_views.filter((direction) => views.some((view) => view.direction === direction));
    const updated = {
      ...handoff,
      received_views: receivedViews,
      next_direction: handoff.requested_views.find((direction) => !receivedViews.includes(direction)) ?? null,
      status: receivedViews.length === handoff.requested_views.length ? 'completed' : 'active',
      updated_at: now()
    };
    await this.store.saveHandoff(updated);
    return updated;
  }

  async ingestCompanionImage(input) {
    const handoff = await this.getImageHandoff(input?.handoff_id);
    if (handoff.status === 'completed') {
      throw new CharacterAssetError('CONFLICT', `Handoff ${handoff.handoff_id} is already complete`, { handoff_id: handoff.handoff_id });
    }
    const direction = requireDirection(input?.direction ?? handoff.next_direction, { canonical: true });
    if (!handoff.requested_views.includes(direction)) invalid(`Direction ${direction} is not part of this handoff`, { direction });
    const view = await this.ingestBaseView({
      character_id: handoff.character_id,
      generation_id: handoff.generation_id,
      direction,
      image_data_url: input?.image_data_url,
      provider: 'chatgpt-web-companion',
      replace: input?.replace === true
    });
    return { view, handoff: await this.getImageHandoff(handoff.handoff_id) };
  }

  async ingestBaseView(input) {
    const characterId = requireId(input?.character_id, 'character_id', ID_PATTERNS.character);
    await this.getCharacterSpec(characterId);
    const generationId = requireId(input?.generation_id, 'generation_id', ID_PATTERNS.generation);
    const generation = await this.store.getBaseViewGeneration(characterId, generationId);
    if (!generation) {
      throw new CharacterAssetError('NOT_FOUND', `Generation ${generationId} was not found`, { generation_id: generationId });
    }

    const direction = requireDirection(input?.direction, { canonical: true });
    if (!generation.views.some((view) => view.direction === direction)) {
      invalid(`Direction ${direction} is not part of generation ${generationId}`, { field: 'direction', direction });
    }
    const existing = await this.store.getBaseView(characterId, direction);
    if (existing && input?.replace !== true) {
      throw new CharacterAssetError('CONFLICT', `Base view ${direction} already exists`, { character_id: characterId, direction });
    }

    let png;
    try {
      png = decodePngDataUrl(input?.image_data_url);
    } catch (error) {
      invalid(error.message, { field: 'image_data_url' });
    }
    const metadata = {
      direction,
      image_asset_id: id('img'),
      source_direction: direction,
      mirrored: false,
      status: 'ready',
      width: png.width,
      height: png.height,
      transparent_background: png.hasAlpha,
      provenance: {
        provider: input?.provider === undefined ? 'chatgpt-web' : requireString(input.provider, 'provider'),
        ...(input?.model === undefined ? {} : { model: requireString(input.model, 'model') }),
        prompt_template_version: generation.prompt_template_version,
        generation_id: generationId,
        ingested_at: now()
      }
    };
    return this.store.saveBaseView(characterId, direction, metadata, png.bytes);
  }

  async getBaseViews(characterId) {
    requireId(characterId, 'character_id', ID_PATTERNS.character);
    await this.getCharacterSpec(characterId);
    const views = await this.store.listBaseViews(characterId);
    const order = new Map(BASE_DIRECTIONS.map((direction, index) => [direction, index]));
    views.sort((a, b) => (order.get(a.direction) ?? 99) - (order.get(b.direction) ?? 99));
    return { character_id: characterId, views };
  }

  async getBaseViewImage(characterId, direction) {
    requireId(characterId, 'character_id', ID_PATTERNS.character);
    await this.getCharacterSpec(characterId);
    requireDirection(direction, { canonical: true });
    if (!(await this.store.getBaseView(characterId, direction))) {
      throw new CharacterAssetError('NOT_FOUND', `Base view ${direction} was not found`, { character_id: characterId, direction });
    }
    const image = await this.store.getBaseViewImage(characterId, direction);
    if (!image) throw new CharacterAssetError('NOT_FOUND', `Base view image ${direction} was not found`, { character_id: characterId, direction });
    return image;
  }

  async validateBaseViews(input) {
    const characterId = requireId(input?.character_id, 'character_id', ID_PATTERNS.character);
    const spec = await this.getCharacterSpec(characterId);
    const { views } = await this.getBaseViews(characterId);
    const expected = BASE_DIRECTIONS.filter((direction) => spec.views_required.includes(direction));
    const byDirection = new Map(views.map((view) => [view.direction, view]));
    const errors = [];
    const warnings = [];

    for (const direction of expected) {
      const view = byDirection.get(direction);
      if (!view) {
        errors.push(`Missing required base view ${direction}`);
        continue;
      }
      const target = spec.output_constraints;
      if (view.width !== target.canvas_width || view.height !== target.canvas_height) {
        warnings.push(`Base view ${direction} is ${view.width}x${view.height}; target runtime canvas is ${target.canvas_width}x${target.canvas_height} and will need normalization`);
      }
      if (target.transparent_background && !view.transparent_background) {
        warnings.push(`Base view ${direction} does not expose PNG alpha; transparent background requires review`);
      }
      if (view.width < RECOMMENDED_AUTHORING_SIZE || view.height < RECOMMENDED_AUTHORING_SIZE) {
        warnings.push(`Base view ${direction} is below the recommended ${RECOMMENDED_AUTHORING_SIZE}x${RECOMMENDED_AUTHORING_SIZE} authoring resolution for semantic part extraction`);
      }
    }

    return {
      valid: errors.length === 0,
      score: Math.max(0, 100 - (errors.length * 20) - (warnings.length * 2)),
      views_checked: views.length,
      required_views: expected,
      warnings,
      errors,
      next_tool: errors.length === 0 ? 'parts.auto_segment' : 'character.ingest_base_view'
    };
  }

  async autoSegmentParts(input) {
    const characterId = requireId(input?.character_id, 'character_id', ID_PATTERNS.character);
    const spec = await this.getCharacterSpec(characterId);
    const direction = requireDirection(input?.source_direction, { canonical: true, field: 'source_direction' });
    const templateName = input?.part_template ?? PART_TEMPLATE_ID;
    const template = resolvePartTemplate(templateName);
    if (!template) {
      throw new CharacterAssetError('UNSUPPORTED_OPERATION', `Part template ${templateName} is not implemented in V1`, { part_template: templateName });
    }
    const mode = input?.mode ?? 'hybrid';
    if (!['auto', 'hybrid'].includes(mode)) invalid('mode must be auto or hybrid', { field: 'mode' });

    const baseView = await this.store.getBaseView(characterId, direction);
    const bytes = await this.store.getBaseViewImage(characterId, direction);
    if (!baseView || !bytes) {
      throw new CharacterAssetError('NOT_FOUND', `Base view ${direction} is required before part extraction`, { character_id: characterId, direction });
    }
    const existing = await this.store.listParts(characterId, direction);
    if (existing.length) {
      throw new CharacterAssetError('CONFLICT', `Parts already exist for direction ${direction}`, {
        character_id: characterId,
        direction,
        existing_parts: existing.length
      });
    }

    let source;
    try {
      source = decodePngRgba(bytes);
    } catch (error) {
      invalid(error.message, { direction, source: 'base_view' });
    }
    const sourceBounds = alphaBounds(source) ?? { x: 0, y: 0, width: source.width, height: source.height };
    const warnings = [];
    if (source.width < RECOMMENDED_AUTHORING_SIZE || source.height < RECOMMENDED_AUTHORING_SIZE) {
      warnings.push(`Source ${direction} is ${source.width}x${source.height}; semantic separation is review-only below ${RECOMMENDED_AUTHORING_SIZE}x${RECOMMENDED_AUTHORING_SIZE}`);
    }
    if (!alphaBounds(source)) warnings.push(`Source ${direction} has no non-transparent alpha pixels; region seeds use the full canvas`);

    const created = [];
    for (const definition of template.parts) {
      const segmented = regionMask(source, sourceBounds, definition.region);
      const occlusion = occlusionFor(direction, definition.name);
      if (segmented.fallback) {
        occlusion.needs_completion = true;
        occlusion.reason = occlusion.reason ?? 'template seed contained no source pixels and used a nearest-pixel fallback';
      }
      const timestamp = now();
      const part = {
        part_id: id('part'),
        character_id: characterId,
        direction,
        name: definition.name,
        template: template.id,
        category: definition.category,
        image_asset_id: id('img'),
        mask_asset_id: id('mask'),
        status: 'draft',
        approved: false,
        confidence: segmented.fallback ? Math.min(definition.confidence, 0.4) : definition.confidence,
        source: { type: 'base_view', direction },
        bounds: segmented.bounds ?? { x: 0, y: 0, width: 0, height: 0 },
        pivot: structuredClone(definition.pivot),
        bone_hint: definition.boneHint,
        default_draw_layer: definition.defaultDrawLayer,
        occlusion,
        authoring: authoringMetadata(spec, source.width, source.height),
        created_at: timestamp,
        updated_at: timestamp
      };
      const maskPng = encodeMaskPng(source.width, source.height, segmented.alpha);
      const cutoutPng = applyAlphaMask(source, segmented.alpha);
      await this.store.savePart(part, cutoutPng, maskPng);
      created.push(part);
    }

    created.sort(directionSort);
    return {
      character_id: characterId,
      direction,
      template: template.id,
      mode,
      parts_created: created.length,
      draft_count: created.length,
      approved_count: 0,
      review_required: true,
      warnings,
      parts: created,
      next_tool: 'parts.list'
    };
  }

  async listParts(input) {
    const characterId = requireId(input?.character_id, 'character_id', ID_PATTERNS.character);
    await this.getCharacterSpec(characterId);
    const direction = input?.direction === undefined ? null : requireDirection(input.direction);
    let parts = await this.store.listParts(characterId, direction);
    if (input?.approved_only === true) parts = parts.filter((part) => part.approved === true);
    parts.sort(directionSort);
    return { parts };
  }

  async #requirePart(partId) {
    requireId(partId, 'part_id', ID_PATTERNS.part);
    const part = await this.store.findPart(partId);
    if (!part) throw new CharacterAssetError('NOT_FOUND', `Part ${partId} was not found`, { part_id: partId });
    return part;
  }

  async getPart(partId) {
    const part = await this.#requirePart(partId);
    const characterId = encodeURIComponent(part.character_id);
    const encodedPart = encodeURIComponent(part.part_id);
    return {
      part,
      cutout_url: `/characters/${characterId}/parts/${encodedPart}/cutout`,
      mask_url: `/characters/${characterId}/parts/${encodedPart}/mask`
    };
  }

  async getPartArtifact(characterId, partId, kind) {
    requireId(characterId, 'character_id', ID_PATTERNS.character);
    const part = await this.#requirePart(partId);
    if (part.character_id !== characterId) {
      throw new CharacterAssetError('NOT_FOUND', `Part ${partId} does not belong to character ${characterId}`, { character_id: characterId, part_id: partId });
    }
    const bytes = await this.store.getPartArtifact(part, kind);
    if (!bytes) throw new CharacterAssetError('NOT_FOUND', `${kind} artifact for part ${partId} was not found`, { part_id: partId, artifact: kind });
    return bytes;
  }

  async #maskArtifacts(part, maskDataUrl) {
    const baseBytes = await this.store.getBaseViewImage(part.character_id, part.direction);
    if (!baseBytes) {
      throw new CharacterAssetError('NOT_FOUND', `Base view ${part.direction} is required to rebuild part ${part.name}`, {
        character_id: part.character_id,
        direction: part.direction
      });
    }

    let maskPng;
    try {
      maskPng = decodePngDataUrl(maskDataUrl);
    } catch (error) {
      invalid(error.message.replaceAll('image_data_url', 'mask_data_url'), { field: 'mask_data_url' });
    }

    let source;
    let mask;
    try {
      source = decodePngRgba(baseBytes);
      mask = decodePngRgba(maskPng.bytes);
    } catch (error) {
      invalid(error.message, { field: 'mask_data_url' });
    }
    if (mask.width !== source.width || mask.height !== source.height) {
      invalid('Mask dimensions must match the source base view', {
        field: 'mask_data_url',
        expected: { width: source.width, height: source.height },
        actual: { width: mask.width, height: mask.height }
      });
    }
    const alpha = maskAlphaFromRgba(mask);
    const bounds = maskBounds(mask.width, mask.height, alpha);
    if (!bounds) invalid('Mask PNG must contain at least one selected pixel', { field: 'mask_data_url' });
    return {
      maskBytes: encodeMaskPng(mask.width, mask.height, alpha),
      cutoutBytes: applyAlphaMask(source, alpha),
      bounds,
      source
    };
  }

  async updatePartMask(input) {
    const part = await this.#requirePart(input?.part_id);
    const artifacts = await this.#maskArtifacts(part, input?.mask_data_url);
    const updated = {
      ...part,
      image_asset_id: id('img'),
      mask_asset_id: id('mask'),
      bounds: artifacts.bounds,
      confidence: Math.max(part.confidence ?? 0, 0.95),
      approved: false,
      status: 'draft',
      updated_at: now()
    };
    await this.store.savePart(updated, artifacts.cutoutBytes, artifacts.maskBytes);
    return updated;
  }

  async createManualPart(input) {
    const characterId = requireId(input?.character_id, 'character_id', ID_PATTERNS.character);
    const spec = await this.getCharacterSpec(characterId);
    const direction = requireDirection(input?.direction, { canonical: true });
    const name = requirePartName(input?.name);
    const existing = await this.store.getPartByName(characterId, direction, name);
    if (existing && input?.replace !== true) {
      throw new CharacterAssetError('CONFLICT', `Part ${name} already exists for direction ${direction}`, {
        character_id: characterId,
        direction,
        name
      });
    }

    const definition = partDefinition(name);
    const category = input?.category ?? definition?.category ?? 'custom';
    if (!PART_CATEGORIES.has(category)) invalid('category is not supported', { field: 'category' });
    const skeleton = existing ?? {
      part_id: id('part'),
      character_id: characterId,
      direction,
      name,
      template: PART_TEMPLATE_ID,
      category,
      pivot: pivotValue(input?.pivot, definition?.pivot ?? { x: 0.5, y: 0.5 }),
      bone_hint: input?.bone_hint ?? definition?.boneHint ?? name,
      default_draw_layer: definition?.defaultDrawLayer ?? 0,
      created_at: now()
    };
    const artifacts = await this.#maskArtifacts(skeleton, input?.mask_data_url);
    const part = {
      ...skeleton,
      category,
      image_asset_id: id('img'),
      mask_asset_id: id('mask'),
      status: 'draft',
      approved: false,
      confidence: 1,
      source: { type: 'manual_mask', direction },
      bounds: artifacts.bounds,
      pivot: pivotValue(input?.pivot, skeleton.pivot),
      bone_hint: input?.bone_hint ?? skeleton.bone_hint,
      occlusion: { needs_completion: false, reason: null },
      authoring: authoringMetadata(spec, artifacts.source.width, artifacts.source.height),
      updated_at: now()
    };
    await this.store.savePart(part, artifacts.cutoutBytes, artifacts.maskBytes);
    return part;
  }

  async approvePart(input) {
    const part = await this.#requirePart(input?.part_id);
    if (input?.approved === false) {
      const updated = { ...part, approved: false, status: 'draft', updated_at: now() };
      await this.store.savePartMetadata(updated);
      return updated;
    }

    const maskBytes = await this.store.getPartArtifact(part, 'mask');
    const cutoutBytes = await this.store.getPartArtifact(part, 'cutout');
    if (!maskBytes || !cutoutBytes) {
      validationFailed('Part approval requires both a mask and cutout artifact', { part_id: part.part_id });
    }
    try {
      const mask = decodePngRgba(maskBytes);
      if (!maskBounds(mask.width, mask.height, maskAlphaFromRgba(mask))) {
        validationFailed('Part approval requires a non-empty mask', { part_id: part.part_id });
      }
      decodePngRgba(cutoutBytes);
    } catch (error) {
      if (error instanceof CharacterAssetError) throw error;
      validationFailed('Part approval requires valid PNG mask and cutout artifacts', { part_id: part.part_id });
    }

    const updated = { ...part, approved: true, status: 'approved', updated_at: now() };
    await this.store.savePartMetadata(updated);
    return updated;
  }

  async createRig(input) {
    const characterId = requireId(input?.character_id, 'character_id', ID_PATTERNS.character);
    await this.getCharacterSpec(characterId);
    const preset = requireString(input?.rig_preset, 'rig_preset');
    if (!SUPPORTED_RIG_PRESETS.has(preset)) {
      throw new CharacterAssetError('UNSUPPORTED_OPERATION', `Rig preset ${preset} is not implemented in V1`, { rig_preset: preset });
    }

    const existing = await this.store.getRig(characterId);
    const rig = createBipedChibiRig(
      characterId,
      (existing?.version ?? 0) + 1,
      existing?.rig_id ?? id('rig'),
      preset
    );

    if (input?.auto_bind === true) {
      const approved = (await this.store.listParts(characterId)).filter((part) => part.approved === true);
      const boneNames = new Set(rig.bones.map((bone) => bone.name));
      rig.bindings = approved
        .filter((part) => boneNames.has(part.bone_hint))
        .map((part) => this.#bindingForPart(part));
      if (rig.bindings.length) rig.status = 'ready';
    }

    await this.store.saveRig(rig);
    return rig;
  }

  async getRig(characterId) {
    requireId(characterId, 'character_id', ID_PATTERNS.character);
    await this.getCharacterSpec(characterId);
    const rig = await this.store.getRig(characterId);
    if (!rig) throw new CharacterAssetError('NOT_FOUND', `Rig for character ${characterId} was not found`, { character_id: characterId });
    return rig;
  }

  #bindingForPart(part) {
    return {
      part_id: part.part_id,
      bone_name: part.bone_hint,
      pivot: structuredClone(part.pivot),
      offset: emptyOffset(),
      weight_mode: 'rigid'
    };
  }

  async #resolveRig(input) {
    if (input?.character_id) return this.getRig(input.character_id);
    if (input?.rig_id) {
      const rigId = requireId(input.rig_id, 'rig_id', ID_PATTERNS.rig);
      const rig = await this.store.findRigById(rigId);
      if (!rig) throw new CharacterAssetError('NOT_FOUND', `Rig ${rigId} was not found`, { rig_id: rigId });
      return rig;
    }
    invalid('character_id or rig_id is required', { fields: ['character_id', 'rig_id'] });
  }

  async autoBindParts(input) {
    const rig = await this.#resolveRig(input);
    const parts = await this.store.listParts(rig.character_id);
    const boneNames = new Set(rig.bones.map((bone) => bone.name));
    const byPart = new Map(rig.bindings.map((binding) => [binding.part_id, binding]));
    const boundPartIds = [];
    const unboundPartIds = [];
    const skippedPartIds = [];
    let changed = false;

    for (const part of parts.sort(directionSort)) {
      if (!part.approved) {
        unboundPartIds.push(part.part_id);
        continue;
      }
      if (!part.bone_hint || !boneNames.has(part.bone_hint)) {
        unboundPartIds.push(part.part_id);
        continue;
      }
      if (byPart.has(part.part_id) && input?.overwrite_existing !== true) {
        skippedPartIds.push(part.part_id);
        continue;
      }
      byPart.set(part.part_id, this.#bindingForPart(part));
      boundPartIds.push(part.part_id);
      changed = true;
    }

    const nextRig = {
      ...rig,
      bindings: [...byPart.values()],
      status: byPart.size ? 'ready' : rig.status,
      version: changed ? rig.version + 1 : rig.version
    };
    if (changed) await this.store.saveRig(nextRig);
    const boundBones = new Set(nextRig.bindings.map((binding) => binding.bone_name));
    const bindableBones = BIPED_CHIBI_PARTS.map((part) => part.boneHint).filter((name, index, values) => values.indexOf(name) === index);
    return {
      rig: nextRig,
      bound_part_ids: boundPartIds,
      unbound_part_ids: unboundPartIds,
      skipped_part_ids: skippedPartIds,
      unmatched_bones: bindableBones.filter((name) => boneNames.has(name) && !boundBones.has(name))
    };
  }

  async validateRig(input) {
    const rig = await this.#resolveRig(input);
    const warnings = [];
    const errors = [];
    const names = rig.bones.map((bone) => bone.name);
    const boneNames = new Set(names);
    if (boneNames.size !== names.length) errors.push('Rig contains duplicate bone names');

    for (const bone of rig.bones) {
      if (bone.parent !== null && !boneNames.has(bone.parent)) errors.push(`Bone ${bone.name} references missing parent ${bone.parent}`);
      const seen = new Set([bone.name]);
      let current = bone;
      while (current?.parent) {
        if (seen.has(current.parent)) {
          errors.push(`Bone hierarchy cycle detected at ${bone.name}`);
          break;
        }
        seen.add(current.parent);
        current = rig.bones.find((candidate) => candidate.name === current.parent);
      }
    }
    for (const socket of rig.sockets) {
      if (!boneNames.has(socket.bone_name)) errors.push(`Socket ${socket.name} references missing bone ${socket.bone_name}`);
    }

    const parts = await this.store.listParts(rig.character_id);
    const byId = new Map(parts.map((part) => [part.part_id, part]));
    for (const binding of rig.bindings) {
      if (!boneNames.has(binding.bone_name)) errors.push(`Binding ${binding.part_id} references missing bone ${binding.bone_name}`);
      const part = byId.get(binding.part_id);
      if (!part) errors.push(`Binding references missing part ${binding.part_id}`);
      else if (!part.approved) warnings.push(`Binding ${binding.part_id} points to an unapproved part`);
    }
    const approved = parts.filter((part) => part.approved);
    const bound = new Set(rig.bindings.map((binding) => binding.part_id));
    for (const part of approved) {
      if (!bound.has(part.part_id)) warnings.push(`Approved part ${part.name} (${part.direction}) is not bound`);
    }
    if (!rig.bindings.length) warnings.push('Rig has no part bindings yet');

    return { valid: errors.length === 0, warnings, errors };
  }
}
