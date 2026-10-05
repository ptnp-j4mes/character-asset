export const PART_TEMPLATE_ID = 'biped_chibi_parts_v1';
export const PART_TEMPLATE_ALIASES = new Set([PART_TEMPLATE_ID, 'biped_chibi_v1']);

const part = (name, region, pivot, boneHint, defaultDrawLayer, confidence, category = 'body_part') => ({
  name,
  region,
  pivot,
  boneHint,
  defaultDrawLayer,
  confidence,
  category
});

export const BIPED_CHIBI_PARTS = [
  part('hair_back',   { x: 0.18, y: 0.00, w: 0.64, h: 0.23, shape: 'ellipse' }, { x: 0.50, y: 0.78 }, 'head', 1, 0.76, 'hair'),
  part('head',        { x: 0.27, y: 0.05, w: 0.46, h: 0.26, shape: 'ellipse' }, { x: 0.50, y: 0.62 }, 'head', 4, 0.88),
  part('hair_front',  { x: 0.22, y: 0.01, w: 0.56, h: 0.20, shape: 'ellipse' }, { x: 0.50, y: 0.82 }, 'head', 6, 0.79, 'hair'),
  part('torso',       { x: 0.29, y: 0.27, w: 0.42, h: 0.30, shape: 'ellipse' }, { x: 0.50, y: 0.30 }, 'chest', 3, 0.90),
  part('pelvis',      { x: 0.34, y: 0.52, w: 0.32, h: 0.15, shape: 'ellipse' }, { x: 0.50, y: 0.45 }, 'pelvis', 3, 0.84),
  part('upper_arm_l', { x: 0.13, y: 0.29, w: 0.23, h: 0.24, shape: 'ellipse' }, { x: 0.78, y: 0.22 }, 'upper_arm_l', 2, 0.72),
  part('forearm_l',   { x: 0.08, y: 0.43, w: 0.22, h: 0.22, shape: 'ellipse' }, { x: 0.76, y: 0.18 }, 'forearm_l', 2, 0.67),
  part('hand_l',      { x: 0.05, y: 0.57, w: 0.18, h: 0.14, shape: 'ellipse' }, { x: 0.70, y: 0.20 }, 'hand_l', 5, 0.62),
  part('upper_arm_r', { x: 0.64, y: 0.29, w: 0.23, h: 0.24, shape: 'ellipse' }, { x: 0.22, y: 0.22 }, 'upper_arm_r', 2, 0.72),
  part('forearm_r',   { x: 0.70, y: 0.43, w: 0.22, h: 0.22, shape: 'ellipse' }, { x: 0.24, y: 0.18 }, 'forearm_r', 2, 0.67),
  part('hand_r',      { x: 0.77, y: 0.57, w: 0.18, h: 0.14, shape: 'ellipse' }, { x: 0.30, y: 0.20 }, 'hand_r', 5, 0.62),
  part('thigh_l',     { x: 0.28, y: 0.61, w: 0.23, h: 0.20, shape: 'ellipse' }, { x: 0.55, y: 0.14 }, 'thigh_l', 2, 0.75),
  part('calf_l',      { x: 0.25, y: 0.75, w: 0.21, h: 0.18, shape: 'ellipse' }, { x: 0.55, y: 0.14 }, 'calf_l', 2, 0.70),
  part('foot_l',      { x: 0.20, y: 0.88, w: 0.27, h: 0.12, shape: 'ellipse' }, { x: 0.58, y: 0.20 }, 'foot_l', 3, 0.78),
  part('thigh_r',     { x: 0.49, y: 0.61, w: 0.23, h: 0.20, shape: 'ellipse' }, { x: 0.45, y: 0.14 }, 'thigh_r', 2, 0.75),
  part('calf_r',      { x: 0.54, y: 0.75, w: 0.21, h: 0.18, shape: 'ellipse' }, { x: 0.45, y: 0.14 }, 'calf_r', 2, 0.70),
  part('foot_r',      { x: 0.53, y: 0.88, w: 0.27, h: 0.12, shape: 'ellipse' }, { x: 0.42, y: 0.20 }, 'foot_r', 3, 0.78)
];

export const PART_ORDER = new Map(BIPED_CHIBI_PARTS.map((value, index) => [value.name, index]));

export function resolvePartTemplate(value) {
  if (!PART_TEMPLATE_ALIASES.has(value)) return null;
  return { id: PART_TEMPLATE_ID, parts: BIPED_CHIBI_PARTS };
}

export function partDefinition(name) {
  return BIPED_CHIBI_PARTS.find((value) => value.name === name) ?? null;
}

export function occlusionFor(direction, name) {
  if (direction === 'W' && /_(r)$/.test(name)) {
    return { needs_completion: true, reason: 'far-side limb is substantially occluded in the side reference' };
  }
  if ((direction === 'SW' || direction === 'NW') && /_(r)$/.test(name)) {
    return { needs_completion: true, reason: 'far-side limb is partially occluded in the three-quarter reference' };
  }
  if (direction === 'N' && name === 'hair_front') {
    return { needs_completion: true, reason: 'front hair detail is hidden in the back reference' };
  }
  return { needs_completion: false, reason: null };
}
