import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CharacterAssetService } from '../src/domain/service.mjs';
import { CharacterAssetError } from '../src/errors.mjs';
import { JsonStore } from '../src/storage/json-store.mjs';

const TRANSPARENT_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PNG_DATA_URL = `data:image/png;base64,${TRANSPARENT_PNG_BASE64}`;
const BASE_DIRECTIONS = ['S', 'SW', 'W', 'NW', 'N'];

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'character-asset-base-views-'));
  const store = new JsonStore(root);
  const service = new CharacterAssetService(store);
  const project = await service.createProject({ name: 'Base View Demo' });
  await service.createCharacterSpec({
    project_id: project.project_id,
    character_id: 'char_base_001',
    name: 'Novice Hero',
    style_profile: 'ro_like_chibi_v1',
    proportion_profile: 'chibi_small_v1',
    visual: {
      gender_presentation: 'male',
      silhouette: 'small_heroic',
      palette: { primary: '#7C5A3C', secondary: '#D9C6A3', accent: '#A42D2D' },
      prompt_notes: 'short brown hair, cream tunic, brown boots'
    },
    views_required: BASE_DIRECTIONS,
    rig_preset: 'biped_chibi_v1',
    motion_preset: 'ro_like_motion_v1'
  });
  return { root, store, service };
}

test('prepares deterministic ChatGPT Web prompt specs for the five canonical base views', async () => {
  const { root, service } = await setup();

  const generation = await service.prepareBaseViews({ character_id: 'char_base_001' });

  assert.match(generation.generation_id, /^gen_[A-Za-z0-9_-]+$/);
  assert.equal(generation.character_id, 'char_base_001');
  assert.equal(generation.status, 'prepared');
  assert.equal(generation.generator, 'chatgpt-web');
  assert.equal(generation.prompt_template_version, 'chatgpt_base_views_v1');
  assert.deepEqual(generation.views.map((view) => view.direction), BASE_DIRECTIONS);
  assert.equal(generation.character_lock.name, 'Novice Hero');
  assert.equal(generation.character_lock.style_profile, 'ro_like_chibi_v1');
  assert.ok(generation.views.every((view) => view.prompt.includes('transparent background')));
  assert.match(generation.views.find((view) => view.direction === 'W').prompt, /profile facing screen-left/i);

  const persisted = JSON.parse(await readFile(
    join(root, 'characters', 'char_base_001', 'base_view_generations', `${generation.generation_id}.json`),
    'utf8'
  ));
  assert.deepEqual(persisted, generation);
});

test('prepare rejects derived directions and views missing from the character spec', async () => {
  const { service } = await setup();

  await assert.rejects(
    service.prepareBaseViews({ character_id: 'char_base_001', views: ['E'] }),
    (error) => error instanceof CharacterAssetError && error.code === 'INVALID_ARGUMENT'
  );
});

test('ingests a ChatGPT Web PNG with generation provenance and protects existing directions', async () => {
  const { root, service } = await setup();
  const generation = await service.prepareBaseViews({ character_id: 'char_base_001' });

  const first = await service.ingestBaseView({
    character_id: 'char_base_001',
    generation_id: generation.generation_id,
    direction: 'S',
    image_data_url: PNG_DATA_URL,
    provider: 'chatgpt-web',
    model: 'chatgpt-images'
  });

  assert.match(first.image_asset_id, /^img_[A-Za-z0-9_-]+$/);
  assert.equal(first.direction, 'S');
  assert.equal(first.status, 'ready');
  assert.equal(first.width, 1);
  assert.equal(first.height, 1);
  assert.equal(first.transparent_background, true);
  assert.equal(first.provenance.provider, 'chatgpt-web');
  assert.equal(first.provenance.model, 'chatgpt-images');
  assert.equal(first.provenance.generation_id, generation.generation_id);
  assert.equal(first.provenance.prompt_template_version, 'chatgpt_base_views_v1');

  const bytes = await readFile(join(root, 'characters', 'char_base_001', 'base_views', 'S.png'));
  assert.deepEqual(bytes, Buffer.from(TRANSPARENT_PNG_BASE64, 'base64'));

  await assert.rejects(
    service.ingestBaseView({
      character_id: 'char_base_001', generation_id: generation.generation_id,
      direction: 'S', image_data_url: PNG_DATA_URL
    }),
    (error) => error instanceof CharacterAssetError && error.code === 'CONFLICT'
  );

  const replacement = await service.ingestBaseView({
    character_id: 'char_base_001', generation_id: generation.generation_id,
    direction: 'S', image_data_url: PNG_DATA_URL, replace: true
  });
  assert.notEqual(replacement.image_asset_id, first.image_asset_id);
});

test('ingest rejects directions that are not part of the prepared generation', async () => {
  const { service } = await setup();
  const generation = await service.prepareBaseViews({ character_id: 'char_base_001', views: ['S'] });

  await assert.rejects(
    service.ingestBaseView({
      character_id: 'char_base_001', generation_id: generation.generation_id,
      direction: 'SW', image_data_url: PNG_DATA_URL
    }),
    (error) => error instanceof CharacterAssetError && error.code === 'INVALID_ARGUMENT'
  );
});

test('lists ingested base views in canonical direction order', async () => {
  const { service } = await setup();
  const generation = await service.prepareBaseViews({ character_id: 'char_base_001' });

  for (const direction of ['W', 'S', 'NW']) {
    await service.ingestBaseView({
      character_id: 'char_base_001', generation_id: generation.generation_id,
      direction, image_data_url: PNG_DATA_URL
    });
  }

  const result = await service.getBaseViews('char_base_001');
  assert.equal(result.character_id, 'char_base_001');
  assert.deepEqual(result.views.map((view) => view.direction), ['S', 'W', 'NW']);
});

test('validates missing views as errors and non-target source size as warnings', async () => {
  const { service } = await setup();
  const generation = await service.prepareBaseViews({ character_id: 'char_base_001' });

  await service.ingestBaseView({
    character_id: 'char_base_001', generation_id: generation.generation_id,
    direction: 'S', image_data_url: PNG_DATA_URL
  });

  const incomplete = await service.validateBaseViews({ character_id: 'char_base_001' });
  assert.equal(incomplete.valid, false);
  assert.ok(incomplete.errors.some((message) => message.includes('SW')));
  assert.ok(incomplete.warnings.some((message) => message.includes('512x512')));

  for (const direction of ['SW', 'W', 'NW', 'N']) {
    await service.ingestBaseView({
      character_id: 'char_base_001', generation_id: generation.generation_id,
      direction, image_data_url: PNG_DATA_URL
    });
  }

  const complete = await service.validateBaseViews({ character_id: 'char_base_001' });
  assert.equal(complete.valid, true);
  assert.deepEqual(complete.errors, []);
  assert.equal(complete.views_checked, 5);
  assert.ok(complete.warnings.length >= 5);
});

test('ingest rejects malformed or non-PNG data URLs', async () => {
  const { service } = await setup();
  const generation = await service.prepareBaseViews({ character_id: 'char_base_001', views: ['S'] });

  await assert.rejects(
    service.ingestBaseView({
      character_id: 'char_base_001', generation_id: generation.generation_id,
      direction: 'S', image_data_url: 'data:image/jpeg;base64,AAAA'
    }),
    (error) => error instanceof CharacterAssetError && error.code === 'INVALID_ARGUMENT'
  );
});
