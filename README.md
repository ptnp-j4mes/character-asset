# Character-Asset

Character-Asset is a spec-first foundation for reusable 2.5D characters with 8-direction movement, bone rigs, and a ChatGPT Web-first image workflow.

## Runnable MCP Server V1

Executable tools in 0.3.0:

- `project.create`
- `character.create_spec`
- `character.get_spec`
- `character.generate_base_views` (when an image bridge is configured)
- `character.prepare_base_views`
- `character.ingest_base_view`
- `character.get_base_views`
- `character.validate_base_views`
- `parts.auto_segment`
- `parts.list` / `parts.get` / `parts.update_mask` / `parts.create_manual` / `parts.approve`
- `rig.create` / `rig.get` / `rig.auto_bind_parts` / `rig.validate`

Run with `npm test` and `npm start`.

Defaults:

- Server: `http://127.0.0.1:8787`
- Health: `GET /health`
- MCP: `POST /mcp`
- Storage: `./data`

## ChatGPT Web-first base-view workflow

1. `character.prepare_base_views` creates locked prompts for S/SW/W/NW/N.
2. ChatGPT Web/native image generation creates each requested image.
3. `character.ingest_base_view` stores each PNG data URL with generation provenance.
4. `character.get_base_views` reads the stored views.
5. `character.validate_base_views` checks missing views, PNG alpha capability, and source canvas size.

The default workflow remains ChatGPT Web-first and does not require an image API key. An optional HTTP image-generation bridge can be enabled with `CHARACTER_ASSET_IMAGE_BRIDGE_URL`; `character.generate_base_views` sends each locked prompt to that bridge and persists the returned PNG. The bridge must return a JSON object containing `image_data_url` as a PNG data URL, with optional `provider` and `model` fields.

### OpenAI image bridge example

A runnable Node 22 example lives at `examples/openai-image-bridge/server.mjs`. It calls the OpenAI Image API with `gpt-image-2`, requests a magenta chroma-key background, removes the edge-connected magenta pixels locally, and returns a transparent PNG data URL to Character-Asset. Small runtime canvases such as 128×128 are generated at 1024×1024 so the authoring master remains useful for segmentation.

```sh
export OPENAI_API_KEY=...
export BRIDGE_TOKEN=local-bridge-secret
npm run bridge:openai

# In a second shell, start Character-Asset with the bridge enabled.
export CHARACTER_ASSET_IMAGE_BRIDGE_URL=http://127.0.0.1:8790/generate
export CHARACTER_ASSET_IMAGE_BRIDGE_TOKEN=local-bridge-secret
npm start
```

Optional bridge settings: `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_SIZE`, `OPENAI_IMAGE_QUALITY`, `OPENAI_IMAGE_API_URL`, `BRIDGE_HOST`, and `BRIDGE_PORT`.

PNG files are stored at `data/characters/<character_id>/base_views/<direction>.png`. Prompt-generation records are stored under `base_view_generations/`.

## REST routes implemented in V1

- `POST /projects`
- `POST /characters/specs`
- `GET /characters/{character_id}/spec`
- `POST /characters/{character_id}/base-views:generate` (optional image bridge)
- `POST /characters/{character_id}/base-views:prepare`
- `POST /characters/{character_id}/base-views/{direction}:ingest`
- `GET /characters/{character_id}/base-views`
- `POST /characters/{character_id}/base-views:validate`
- `POST /characters/{character_id}/parts:auto-segment`
- `GET /characters/{character_id}/parts`
- `GET /characters/{character_id}/parts/{part_id}`
- `PUT /characters/{character_id}/parts/{part_id}/mask`
- `POST /characters/{character_id}/parts:manual`
- `POST /characters/{character_id}/parts/{part_id}:approve`
- `GET /characters/{character_id}/parts/{part_id}/cutout`
- `GET /characters/{character_id}/parts/{part_id}/mask`
- `POST /characters/{character_id}/rig`
- `GET /characters/{character_id}/rig`
- `POST /characters/{character_id}/rig:auto-bind`
- `POST /characters/{character_id}/rig:validate`

## Standards and contracts

- OpenAPI: 3.2.1
- OpenAPI Schema dialect: https://spec.openapis.org/oas/3.2/dialect/2026-02-26
- MCP protocol target: 2026-07-28
- MCP tool input/output schemas: JSON Schema Draft 2020-12

After base-view validation, the V1 workflow continues through `parts.auto_segment`, human mask review/approval, `rig.create`, `rig.auto_bind_parts`, and `rig.validate`. Low-resolution sources remain reviewable but emit an authoring-resolution warning.
