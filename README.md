# Character-Asset

Character-Asset is a spec-first foundation for reusable 2.5D characters with 8-direction movement, bone rigs, and a ChatGPT Web-first image workflow.

## Runnable MCP Server V1

Executable tools in 0.3.0:

- `project.create`
- `character.create_spec`
- `character.get_spec`
- `character.prepare_base_views`
- `character.ingest_base_view`
- `character.get_base_views`
- `character.validate_base_views`
- `rig.create`

Run with `npm test` and `npm start`.

Defaults:

- Server: `http://127.0.0.1:8787`
- Health: `GET /health`
- MCP: `POST /mcp`
- Storage: `./data`

## Asset Ledger UI

The artist workspace lives in `web/` and sends workflow calls through the existing MCP endpoint. Start the API with `PORT=8788 npm start`, then start the UI from `web/` with `npm run dev -- --host 0.0.0.0 --port 5173`. The UI proxies `/api` requests to the local API.

## ChatGPT Web-first base-view workflow

1. `character.prepare_base_views` creates locked prompts for S/SW/W/NW/N.
2. ChatGPT Web/native image generation creates each requested image.
3. `character.ingest_base_view` stores each PNG data URL with generation provenance.
4. `character.get_base_views` reads the stored views.
5. `character.validate_base_views` checks missing views, PNG alpha capability, and source canvas size.

The server does not call an image provider and does not require an image API key in this mode. Native ChatGPT image generation happens in the host. Automatic transfer of generated image bytes into MCP depends on host/file integration; the current transport accepts a PNG `image_data_url`, which a web editor or MCP App file bridge can provide.

PNG files are stored at `data/characters/<character_id>/base_views/<direction>.png`. Prompt-generation records are stored under `base_view_generations/`.

## REST routes implemented in V1

- `POST /projects`
- `POST /characters/specs`
- `GET /characters/{character_id}/spec`
- `POST /characters/{character_id}/base-views:prepare`
- `POST /characters/{character_id}/base-views/{direction}:ingest`
- `GET /characters/{character_id}/base-views`
- `GET /characters/{character_id}/base-views/{direction}/image` (stored PNG bytes for the local editor)
- `POST /characters/{character_id}/base-views:validate`
- `POST /characters/{character_id}/rig`

## Standards and contracts

- OpenAPI: 3.2.1
- OpenAPI Schema dialect: https://spec.openapis.org/oas/3.2/dialect/2026-02-26
- MCP protocol target: 2026-07-28
- MCP tool input/output schemas: JSON Schema Draft 2020-12

The full catalog also keeps `character.generate_base_views` as a planned server-side/provider automation path. It is not executable in the current ChatGPT Web-first runtime.
