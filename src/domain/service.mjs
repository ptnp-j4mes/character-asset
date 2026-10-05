import { randomUUID } from 'node:crypto';

import { CharacterAssetError } from '../errors.mjs';
import { createBipedChibiRig } from './rig-presets.mjs';
import { decodePngDataUrl } from '../media/png.mjs';

const ID_PATTERNS = {
  project: /^proj_[A-Za-z0-9_-]+$/,
  character: /^char_[A-Za-z0-9_-]+$/
};

const DIRECTIONS = new Set(['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE']);
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

function id(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

function now() {
  return new Date().toISOString();
}

function invalid(message, details) {
  throw new CharacterAssetError('INVALID_ARGUMENT', message, details);
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

  async ingestBaseView(input) {
    const characterId = requireId(input?.character_id, 'character_id', ID_PATTERNS.character);
    await this.getCharacterSpec(characterId);
    const generationId = requireString(input?.generation_id, 'generation_id');
    if (!/^gen_[A-Za-z0-9_-]+$/.test(generationId)) invalid('generation_id has an invalid format', { field: 'generation_id' });
    const generation = await this.store.getBaseViewGeneration(characterId, generationId);
    if (!generation) {
      throw new CharacterAssetError('NOT_FOUND', `Generation ${generationId} was not found`, { generation_id: generationId });
    }

    const direction = requireString(input?.direction, 'direction');
    if (!BASE_DIRECTION_SET.has(direction) || !generation.views.some((view) => view.direction === direction)) {
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
    if (!BASE_DIRECTION_SET.has(direction)) invalid('direction must be a canonical base view', { field: 'direction' });
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
    }

    return {
      valid: errors.length === 0,
      score: Math.max(0, 100 - (errors.length * 20) - (warnings.length * 2)),
      views_checked: views.length,
      required_views: expected,
      warnings,
      errors
    };
  }

  async createRig(input) {
    const characterId = requireId(input?.character_id, 'character_id', ID_PATTERNS.character);
    await this.getCharacterSpec(characterId);
    const preset = requireString(input?.rig_preset, 'rig_preset');
    if (preset !== 'biped_chibi_v1') {
      throw new CharacterAssetError('UNSUPPORTED_OPERATION', `Rig preset ${preset} is not implemented in V1`, { rig_preset: preset });
    }

    const existing = await this.store.getRig(characterId);
    const rig = createBipedChibiRig(
      characterId,
      (existing?.version ?? 0) + 1,
      existing?.rig_id ?? id('rig')
    );
    await this.store.saveRig(rig);
    return rig;
  }
}
