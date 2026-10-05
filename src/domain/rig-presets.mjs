const offset = (x = 0, y = 0, rotation = 0, scale_x = 1, scale_y = 1) => ({
  x, y, rotation, scale_x, scale_y
});

const bone = (name, parent, x, y, length = 0, rotation_limits = undefined) => ({
  name,
  parent,
  position: { x, y },
  length,
  rotation: 0,
  ...(rotation_limits ? { rotation_limits } : {})
});

export const SUPPORTED_RIG_PRESETS = new Set(['biped_chibi_v1', 'humanoid_2p5d_basic']);

export function createBipedChibiRig(characterId, version, rigId, requestedPreset = 'biped_chibi_v1') {
  const bones = [
    bone('root', null, 0, 0),
    bone('pelvis', 'root', 0, -10, 24, { min: -20, max: 20 }),
    bone('spine', 'pelvis', 0, -22, 30, { min: -18, max: 18 }),
    bone('chest', 'spine', 0, -28, 26, { min: -15, max: 15 }),
    bone('neck', 'chest', 0, -18, 10, { min: -25, max: 25 }),
    bone('head', 'neck', 0, -18, 34, { min: -35, max: 35 }),
    bone('upper_arm_l', 'chest', -18, -12, 28, { min: -115, max: 95 }),
    bone('forearm_l', 'upper_arm_l', -26, 4, 24, { min: -8, max: 145 }),
    bone('hand_l', 'forearm_l', -22, 5, 10, { min: -45, max: 45 }),
    bone('upper_arm_r', 'chest', 18, -12, 28, { min: -95, max: 115 }),
    bone('forearm_r', 'upper_arm_r', 26, 4, 24, { min: -145, max: 8 }),
    bone('hand_r', 'forearm_r', 22, 5, 10, { min: -45, max: 45 }),
    bone('thigh_l', 'pelvis', -10, 2, 34, { min: -65, max: 55 }),
    bone('calf_l', 'thigh_l', -4, 32, 32, { min: -5, max: 130 }),
    bone('foot_l', 'calf_l', 0, 30, 16, { min: -40, max: 40 }),
    bone('thigh_r', 'pelvis', 10, 2, 34, { min: -55, max: 65 }),
    bone('calf_r', 'thigh_r', 4, 32, 32, { min: -130, max: 5 }),
    bone('foot_r', 'calf_r', 0, 30, 16, { min: -40, max: 40 })
  ];

  const sockets = [
    { name: 'head_socket', bone_name: 'head', slot_type: 'head', offset: offset(0, -28) },
    { name: 'weapon_socket_r', bone_name: 'hand_r', slot_type: 'weapon', offset: offset(8, 0) },
    { name: 'shield_socket_l', bone_name: 'hand_l', slot_type: 'shield', offset: offset(-8, 0) },
    { name: 'back_socket', bone_name: 'chest', slot_type: 'back', offset: offset(0, -4) },
    { name: 'fx_socket', bone_name: 'root', slot_type: 'fx', offset: offset(0, 0) }
  ];

  return {
    rig_id: rigId,
    character_id: characterId,
    preset: requestedPreset,
    bones,
    sockets,
    bindings: [],
    status: 'draft',
    version
  };
}
