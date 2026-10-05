import { readFileSync } from 'node:fs';

const CORE_TOOL_NAMES = [
  'project.create',
  'character.create_spec',
  'character.get_spec',
  'character.prepare_base_views',
  'character.begin_image_handoff',
  'character.get_image_handoff',
  'character.ingest_base_view',
  'character.get_base_views',
  'character.validate_base_views',
  'parts.auto_segment',
  'parts.list',
  'parts.get',
  'parts.update_mask',
  'parts.create_manual',
  'parts.inspect_occlusion',
  'parts.prepare_repair',
  'parts.replace_repaired_image',
  'parts.set_joint_padding',
  'parts.set_z_order',
  'parts.mark_repaired',
  'parts.validate_rig_readiness',
  'parts.approve',
  'rig.create',
  'rig.get',
  'rig.auto_bind_parts',
  'rig.validate'
];

const catalogUrl = new URL('../../mcp/character-asset.mcp-tools.json', import.meta.url);
const catalog = JSON.parse(readFileSync(catalogUrl, 'utf8'));
const byName = new Map(catalog.tools.map((tool) => [tool.name, tool]));

export const coreTools = CORE_TOOL_NAMES.map((name) => {
  const tool = byName.get(name);
  if (!tool) throw new Error(`Missing generated MCP tool definition: ${name}`);
  return structuredClone(tool);
});
