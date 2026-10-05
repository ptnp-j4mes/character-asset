const offset = (x = 0, y = 0, rotation = 0, scale_x = 1, scale_y = 1) => ({
  x, y, rotation, scale_x, scale_y
});

const bone = (name, parent, x, y, length = 0) => ({
  name,
  parent,
  position: { x, y },
  length,
  rotation: 0
});

export function createBipedChibiRig(characterId, version, rigId) {
  const bones = [
    bone('root', null, 0, 0),
    bone('pelvis', 'root', 0, -10, 24),
    bone('spine', 'pelvis', 0, -22, 30),
    bone('chest', 'spine', 0, -28, 26),
    bone('neck', 'chest', 0, -18, 10),
    bone('head', 'neck', 0, -18, 34),
    bone('upper_arm_l', 'chest', -18, -12, 28),
    bone('forearm_l', 'upper_arm_l', -26, 4, 24),
    bone('hand_l', 'forearm_l', -22, 5, 10),
    bone('upper_arm_r', 'chest', 18, -12, 28),
    bone('forearm_r', 'upper_arm_r', 26, 4, 24),
    bone('hand_r', 'forearm_r', 22, 5, 10),
    bone('thigh_l', 'pelvis', -10, 2, 34),
    bone('calf_l', 'thigh_l', -4, 32, 32),
    bone('foot_l', 'calf_l', 0, 30, 16),
    bone('thigh_r', 'pelvis', 10, 2, 34),
    bone('calf_r', 'thigh_r', 4, 32, 32),
    bone('foot_r', 'calf_r', 0, 30, 16)
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
    preset: 'biped_chibi_v1',
    bones,
    sockets,
    bindings: [],
    status: 'draft',
    version
  };
}
