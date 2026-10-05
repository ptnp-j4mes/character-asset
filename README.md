# Character-Asset

Character-Asset is a spec-first foundation for reusable 2.5D characters with 8-direction movement, bone rigs, and a ChatGPT Web-first image workflow.

## Runnable MCP Server V1

Executable tools in 0.3.0:

- `project.create`
- `character.create_spec`
- `character.get_spec`
- `character.prepare_base_views`
- `character.begin_image_handoff` / `character.get_image_handoff`
- `character.ingest_base_view`
- `character.get_base_views`
- `character.validate_base_views`
- `parts.auto_segment`
- `parts.list` / `parts.get` / `parts.update_mask` / `parts.create_manual`
- `parts.inspect_occlusion` / `parts.prepare_repair` / `parts.replace_repaired_image`
- `parts.set_joint_padding` / `parts.set_z_order` / `parts.mark_repaired` / `parts.validate_rig_readiness` / `parts.approve`
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

The workflow is ChatGPT Web-first and does not require an image API key. `character.begin_image_handoff` opens a local browser-companion session. The unpacked browser extension in `browser-extension/` adds a Send to Character-Asset control to large images in ChatGPT Web and transfers the PNG to the local Character-Asset server, which ingests it with `chatgpt-web-companion` provenance. `character.get_image_handoff` lets ChatGPT read progress and the next expected direction.

### ChatGPT Web Companion setup

1. Start Character-Asset locally with `npm start` (default `http://127.0.0.1:8787`).
2. In Chrome/Edge, open Extensions, enable Developer mode, choose **Load unpacked**, and select the repository `browser-extension/` folder.
3. From ChatGPT, call `character.begin_image_handoff` after the character spec is ready. The tool returns the locked generation prompts plus a handoff id.
4. Generate the requested view with ChatGPT native image generation. Hover the generated image and click **Send to Character-Asset**.
5. The extension sends the image to the active handoff's `next_direction`; ChatGPT can call `character.get_image_handoff` to read progress and continue with the next view.

No OpenAI API key is required for this path. The extension only talks to ChatGPT Web and the local Character-Asset server.

PNG files are stored at `data/characters/<character_id>/base_views/<direction>.png`. Prompt-generation records are stored under `base_view_generations/`.

## REST routes implemented in V1

- `POST /projects`
- `POST /characters/specs`
- `GET /characters/{character_id}/spec`
- `POST /characters/{character_id}/image-handoffs`
- `GET /image-handoffs/{handoff_id}`
- `POST /characters/{character_id}/base-views:prepare`
- `POST /characters/{character_id}/base-views/{direction}:ingest`
- `GET /characters/{character_id}/base-views`
- `POST /characters/{character_id}/base-views:validate`
- `POST /characters/{character_id}/parts:auto-segment`
- `GET /characters/{character_id}/parts`
- `GET /characters/{character_id}/parts/{part_id}`
- `PUT /characters/{character_id}/parts/{part_id}/mask`
- `POST /characters/{character_id}/parts:manual`
- `POST /characters/{character_id}/parts:inspect-occlusion`
- `POST /characters/{character_id}/parts/{part_id}:prepare-repair`
- `PUT /characters/{character_id}/parts/{part_id}/repaired`
- `PUT /characters/{character_id}/parts/{part_id}/joint-padding`
- `PUT /characters/{character_id}/parts/{part_id}/z-order`
- `POST /characters/{character_id}/parts/{part_id}:mark-repaired`
- `POST /characters/{character_id}/parts:validate-rig-readiness`
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

After base-view validation, the V1 workflow continues through `parts.auto_segment`, semantic review, Phase 2.5 occlusion repair and joint-overlap validation, approval, `rig.create`, `rig.auto_bind_parts`, and `rig.validate`. Low-resolution sources remain reviewable but emit an authoring-resolution warning.
