import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CharacterAssetService } from '../src/domain/service.mjs';
import { CharacterAssetError } from '../src/errors.mjs';
import { encodePngRgba } from '../src/media/png-raster.mjs';
import { JsonStore } from '../src/storage/json-store.mjs';

function pngDataUrl(width = 128, height = 128, mask = null) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const selected = mask ? mask(x, y) : (x >= 24 && x < 104 && y >= 8 && y < 120);
      rgba[i] = 180;
      rgba[i + 1] = 120;
      rgba[i + 2] = 80;
      rgba[i + 3] = selected ? 255 : 0;
    }
  }
  return `data:image/png;base64,${encodePngRgba({ width, height, rgba }).toString('base64')}`;
}

async function setup({ imageBridge = null } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'character-parts-v1-'));
  const store = new JsonStore(root);
  const service = new CharacterAssetService(store, { imageBridge });
  const project = await service.createProject({ name: 'Parts Demo' });
  await service.createCharacterSpec({
    project_id: project.project_id,
    character_id: 'char_parts_001',
    name: 'Parts Hero',
    style_profile: 'ro_like_chibi_v1',
    proportion_profile: 'chibi_small_v1',
    views_required: ['S', 'SW', 'W', 'NW', 'N'],
    rig_preset: 'humanoid_2p5d_basic',
    motion_preset: 'ro_like_motion_v1',
    output_constraints: {
      canvas_width: 128,
      canvas_height: 128,
      transparent_background: true,
      padding_px: 8
    }
  });
  const generation = await service.prepareBaseViews({ character_id: 'char_parts_001', views: ['S'] });
  await service.ingestBaseView({
    character_id: 'char_parts_001',
    generation_id: generation.generation_id,
    direction: 'S',
    image_data_url: pngDataUrl()
  });
  return { root, store, service, generation };
}

test('auto-segment persists all 17 deterministic draft parts and warns on 128x128 authoring input', async () => {
  const { root, service } = await setup();
  const segmentation = await service.autoSegmentParts({
    character_id: 'char_parts_001',
    source_direction: 'S',
    part_template: 'biped_chibi_parts_v1',
    mode: 'hybrid'
  });

  assert.equal(segmentation.parts_created, 17);
  assert.equal(segmentation.draft_count, 17);
  assert.equal(segmentation.approved_count, 0);
  assert.equal(segmentation.review_required, true);
  assert.ok(segmentation.warnings.some((message) => message.includes('512x512')));
  assert.deepEqual(
    segmentation.parts.map((part) => part.name),
    [
      'hair_back', 'head', 'hair_front', 'torso', 'pelvis',
      'upper_arm_l', 'forearm_l', 'hand_l',
      'upper_arm_r', 'forearm_r', 'hand_r',
      'thigh_l', 'calf_l', 'foot_l',
      'thigh_r', 'calf_r', 'foot_r'
    ]
  );
  assert.ok(segmentation.parts.every((part) => part.status === 'draft' && part.approved === false));

  const head = segmentation.parts.find((part) => part.name === 'head');
  const dir = join(root, 'characters', 'char_parts_001', 'parts', 'S', 'head');
  assert.equal(JSON.parse(await readFile(join(dir, 'part.json'), 'utf8')).part_id, head.part_id);
  assert.ok((await readFile(join(dir, 'mask.png'))).length > 0);
  assert.ok((await readFile(join(dir, 'cutout.png'))).length > 0);

  const listed = await service.listParts({ character_id: 'char_parts_001', direction: 'S' });
  assert.deepEqual(listed.parts.map((part) => part.name), segmentation.parts.map((part) => part.name));
});

test('mask replacement regenerates artifacts and clears approval', async () => {
  const { service } = await setup();
  const segmentation = await service.autoSegmentParts({
    character_id: 'char_parts_001',
    source_direction: 'S',
    part_template: 'biped_chibi_parts_v1'
  });
  const head = segmentation.parts.find((part) => part.name === 'head');

  const approved = await service.approvePart({ part_id: head.part_id });
  assert.equal(approved.approved, true);

  const updated = await service.updatePartMask({
    part_id: head.part_id,
    mask_data_url: pngDataUrl(128, 128, (x, y) => x >= 48 && x < 80 && y >= 20 && y < 52)
  });
  assert.equal(updated.approved, false);
  assert.equal(updated.status, 'draft');
  assert.notEqual(updated.image_asset_id, head.image_asset_id);
  assert.notEqual(updated.mask_asset_id, head.mask_asset_id);
  assert.deepEqual(updated.bounds, { x: 48, y: 20, width: 32, height: 32 });
});

test('approval fails when a required artifact is missing', async () => {
  const { root, service } = await setup();
  const segmentation = await service.autoSegmentParts({
    character_id: 'char_parts_001',
    source_direction: 'S',
    part_template: 'biped_chibi_parts_v1'
  });
  const head = segmentation.parts.find((part) => part.name === 'head');
  await rm(join(root, 'characters', 'char_parts_001', 'parts', 'S', 'head', 'mask.png'));

  await assert.rejects(
    service.approvePart({ part_id: head.part_id }),
    (error) => error instanceof CharacterAssetError && error.code === 'VALIDATION_FAILED'
  );
});

test('manual replacement uses explicit mask and requires replace for an existing semantic name', async () => {
  const { service } = await setup();
  await service.autoSegmentParts({
    character_id: 'char_parts_001',
    source_direction: 'S',
    part_template: 'biped_chibi_parts_v1'
  });

  await assert.rejects(
    service.createManualPart({
      character_id: 'char_parts_001',
      direction: 'S',
      name: 'head',
      mask_data_url: pngDataUrl()
    }),
    (error) => error instanceof CharacterAssetError && error.code === 'CONFLICT'
  );

  const part = await service.createManualPart({
    character_id: 'char_parts_001',
    direction: 'S',
    name: 'head',
    mask_data_url: pngDataUrl(128, 128, (x, y) => x >= 40 && x < 88 && y >= 12 && y < 60),
    replace: true
  });
  assert.equal(part.source.type, 'manual_mask');
  assert.equal(part.status, 'draft');
  assert.equal(part.approved, false);
});

test('humanoid compatibility rig auto-binds approved parts only and validates', async () => {
  const { service } = await setup();
  const segmentation = await service.autoSegmentParts({
    character_id: 'char_parts_001',
    source_direction: 'S',
    part_template: 'biped_chibi_parts_v1'
  });
  const head = segmentation.parts.find((part) => part.name === 'head');
  await service.approvePart({ part_id: head.part_id });

  const rig = await service.createRig({
    character_id: 'char_parts_001',
    rig_preset: 'humanoid_2p5d_basic',
    auto_bind: false
  });
  assert.equal(rig.preset, 'humanoid_2p5d_basic');

  const bound = await service.autoBindParts({ character_id: 'char_parts_001' });
  assert.deepEqual(bound.bound_part_ids, [head.part_id]);
  assert.equal(bound.rig.bindings.length, 1);
  assert.equal(bound.rig.bindings[0].bone_name, 'head');
  assert.equal(bound.unbound_part_ids.length, 16);

  const validation = await service.validateRig({ character_id: 'char_parts_001' });
  assert.equal(validation.valid, true);
  assert.ok(!validation.errors.length);
});

test('configured image bridge generates locked canonical views and ingests returned PNGs', async () => {
  const calls = [];
  const imageBridge = {
    async generate(input) {
      calls.push(input);
      return {
        image_data_url: pngDataUrl(128, 128),
        provider: 'test-bridge',
        model: 'mock-image-v1'
      };
    }
  };
  const root = await mkdtemp(join(tmpdir(), 'character-image-bridge-'));
  const service = new CharacterAssetService(new JsonStore(root), { imageBridge });
  const project = await service.createProject({ name: 'Bridge Demo' });
  await service.createCharacterSpec({
    project_id: project.project_id,
    character_id: 'char_bridge_001',
    name: 'Bridge Hero',
    style_profile: '2.5d',
    proportion_profile: 'chibi',
    views_required: ['S', 'SW'],
    rig_preset: 'biped_chibi_v1',
    motion_preset: 'walk'
  });

  const generated = await service.generateBaseViews({
    character_id: 'char_bridge_001',
    views: ['S', 'SW']
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.direction), ['S', 'SW']);
  assert.equal(generated.generation.generator, 'image-bridge');
  assert.equal(generated.views.length, 2);
  assert.ok(generated.views.every((view) => view.provenance.provider === 'test-bridge'));
});
