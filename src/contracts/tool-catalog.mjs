import { readFileSync } from 'node:fs';

const CORE_TOOL_NAMES = [
  'project.create',
  'character.create_spec',
  'character.get_spec',
  'character.prepare_base_views',
  'character.ingest_base_view',
  'character.get_base_views',
  'character.validate_base_views',
  'rig.create'
];

const catalogUrl = new URL('../../mcp/character-asset.mcp-tools.json', import.meta.url);
const catalog = JSON.parse(readFileSync(catalogUrl, 'utf8'));
const byName = new Map(catalog.tools.map((tool) => [tool.name, tool]));

export const coreTools = CORE_TOOL_NAMES.map((name) => {
  const tool = byName.get(name);
  if (!tool) throw new Error(`Missing generated MCP tool definition: ${name}`);
  return structuredClone(tool);
});
