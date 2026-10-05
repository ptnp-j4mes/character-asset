import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CharacterAssetError } from '../src/errors.mjs';
import { CharacterAssetService } from '../src/domain/service.mjs';
import { JsonStore } from '../src/storage/json-store.mjs';

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'character-asset-'));
  const store = new JsonStore(root);
  return { root, store, service: new CharacterAssetService(store) };
}

const baseSpec = (project_id, character_id = 'char_novice_001') => ({
  project_id,
  character_id,
  name: 'Novice',
  style_profile: 'ro_like_chibi_v1',
  proportion_profile: 'chibi_small_v1',
  views_required: ['S', 'SW', 'W', 'NW', 'N'],
  rig_preset: 'biped_chibi_v1',
  motion_preset: 'ro_like_motion_v1'
});

test('creates and persists a project with canonical fields', async () => {
  const { root, service } = await setup();
  const project = await service.createProject({ name: ' Demo ', description: '2.5D' });

  assert.match(project.project_id, /^proj_[A-Za-z0-9_-]+$/);
  assert.equal(project.name, 'Demo');
  assert.equal(project.description, '2.5D');
  assert.equal(project.schema_version, '1.0.0');
  assert.ok(Date.parse(project.created_at));
  assert.equal(project.created_at, project.updated_at);

  const stored = JSON.parse(await readFile(join(root, 'projects', `${project.project_id}.json`), 'utf8'));
  assert.deepEqual(stored, project);
});

test('rejects character creation for an unknown project without writing state', async () => {
  const { root, service } = await setup();

  await assert.rejects(
    service.createCharacterSpec(baseSpec('proj_missing')),
    (error) => error instanceof CharacterAssetError && error.code === 'NOT_FOUND'
  );

  await assert.rejects(readFile(join(root, 'characters', 'char_novice_001', 'spec.json'), 'utf8'));
});

test('creates canonical character spec defaults and refuses duplicate character ids', async () => {
  const { service } = await setup();
  const project = await service.createProject({ name: 'Demo' });
  const spec = await service.createCharacterSpec(baseSpec(project.project_id));

  assert.match(spec.spec_id, /^spec_[A-Za-z0-9_-]+$/);
  assert.equal(spec.character_id, 'char_novice_001');
  assert.deepEqual(spec.visual, {});
  assert.deepEqual(spec.equipment_slots, []);
  assert.deepEqual(spec.output_constraints, {
    canvas_width: 512,
    canvas_height: 512,
    transparent_background: true,
    padding_px: 16
  });
  assert.equal(spec.status, 'draft');
  assert.equal(spec.schema_version, '1.0.0');
  assert.equal(spec.asset_version, 1);

  await assert.rejects(
    service.createCharacterSpec(baseSpec(project.project_id)),
    (error) => error instanceof CharacterAssetError && error.code === 'CONFLICT'
  );
});

test('reloads a character spec through a fresh service instance', async () => {
  const { root, service } = await setup();
  const project = await service.createProject({ name: 'Demo' });
  const created = await service.createCharacterSpec(baseSpec(project.project_id));

  const reloaded = new CharacterAssetService(new JsonStore(root));
  assert.deepEqual(await reloaded.getCharacterSpec(created.character_id), created);
});

test('creates the biped chibi rig with expected bones and sockets', async () => {
  const { service } = await setup();
  const project = await service.createProject({ name: 'Demo' });
  await service.createCharacterSpec(baseSpec(project.project_id));

  const rig = await service.createRig({
    character_id: 'char_novice_001',
    rig_preset: 'biped_chibi_v1',
    auto_bind: true
  });

  assert.equal(rig.character_id, 'char_novice_001');
  assert.equal(rig.preset, 'biped_chibi_v1');
  assert.equal(rig.version, 1);
  assert.equal(rig.status, 'draft');
  assert.deepEqual(rig.bindings, []);
  assert.deepEqual(
    rig.bones.map((bone) => bone.name),
    [
      'root', 'pelvis', 'spine', 'chest', 'neck', 'head',
      'upper_arm_l', 'forearm_l', 'hand_l',
      'upper_arm_r', 'forearm_r', 'hand_r',
      'thigh_l', 'calf_l', 'foot_l',
      'thigh_r', 'calf_r', 'foot_r'
    ]
  );
  assert.deepEqual(
    rig.sockets.map((socket) => socket.name),
    ['head_socket', 'weapon_socket_r', 'shield_socket_l', 'back_socket', 'fx_socket']
  );
});

test('rejects unknown characters and unsupported rig presets', async () => {
  const { service } = await setup();

  await assert.rejects(
    service.createRig({ character_id: 'char_missing', rig_preset: 'biped_chibi_v1' }),
    (error) => error instanceof CharacterAssetError && error.code === 'NOT_FOUND'
  );

  const project = await service.createProject({ name: 'Demo' });
  await service.createCharacterSpec(baseSpec(project.project_id));
  await assert.rejects(
    service.createRig({ character_id: 'char_novice_001', rig_preset: 'dragon_v1' }),
    (error) => error instanceof CharacterAssetError && error.code === 'UNSUPPORTED_OPERATION'
  );
});

test('recreating a rig increments the persisted version', async () => {
  const { root, service } = await setup();
  const project = await service.createProject({ name: 'Demo' });
  await service.createCharacterSpec(baseSpec(project.project_id));

  const first = await service.createRig({ character_id: 'char_novice_001', rig_preset: 'biped_chibi_v1' });
  const second = await service.createRig({ character_id: 'char_novice_001', rig_preset: 'biped_chibi_v1' });

  assert.equal(first.version, 1);
  assert.equal(second.version, 2);
  const stored = JSON.parse(await readFile(join(root, 'characters', 'char_novice_001', 'rig.json'), 'utf8'));
  assert.equal(stored.version, 2);
});
