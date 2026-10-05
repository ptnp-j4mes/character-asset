# Character-Asset MCP Server V1 Design

## Goal

Turn the existing Character-Asset OpenAPI/MCP contracts into a runnable local server that ChatGPT/Codex-compatible MCP clients can call. V1 implements the first four write/read operations needed to prove the architecture: `project.create`, `character.create_spec`, `character.get_spec`, and `rig.create`.

## Runtime and protocol

- Node.js 22+ ESM.
- MCP protocol revision 2026-07-28. The V1 wire boundary is implemented with Node stdlib because the SDK registry packages were unavailable in the build environment; domain interfaces remain transport-neutral so an SDK adapter can replace it later.
- Remote transport: Streamable HTTP at `POST /mcp`.
- REST compatibility endpoints follow the existing OpenAPI operation paths.
- No authentication in V1; server binds to `127.0.0.1` by default.
- Local JSON-file storage under `data/` is the canonical V1 persistence layer.

## Architecture

`src/domain/service.mjs` owns business behavior and is transport-agnostic. `src/storage/json-store.mjs` persists projects, character specs, and rigs. `src/mcp/router.mjs` dispatches the four MCP tools against the domain service. `src/http/server.mjs` mounts Streamable HTTP and the four REST routes against the same domain service, so web UI and agents share one implementation.

## Data behavior

### project.create

Creates `proj_<uuid-without-dashes>`, sets `schema_version=1.0.0`, and ISO UTC `created_at`/`updated_at`. Name is required and trimmed. Duplicate IDs are avoided by generated UUIDs.

### character.create_spec

Requires an existing project. Stores exactly one canonical spec per `character_id`; creating the same `character_id` again returns conflict. Generates `spec_<uuid-without-dashes>`, fills defaults (`equipment_slots=[]`, `visual={}`, output canvas 512x512 transparent with 16px padding), `status=draft`, `schema_version=1.0.0`, `asset_version=1`, and timestamps.

### character.get_spec

Returns the stored canonical spec or not-found.

### rig.create

Requires an existing character spec. V1 supports `biped_chibi_v1`. It builds a deterministic biped skeleton with root/pelvis/spine/chest/neck/head, left/right arms and legs, plus `head_socket`, `weapon_socket_r`, `shield_socket_l`, `back_socket`, and `fx_socket`. Bindings are empty until segmentation/part tools are implemented. Re-creating a rig replaces the existing rig and increments its version.

## Errors

Domain errors use stable codes: `INVALID_ARGUMENT`, `NOT_FOUND`, `CONFLICT`, `UNSUPPORTED_OPERATION`. MCP returns `isError: true` with machine-readable JSON text. REST maps invalid argument to 400, not-found to 404, conflict to 409, unsupported operation to 422, and unexpected failures to 500.

## Scope limits

V1 intentionally does not generate images, segment parts, auto-bind parts, animate, queue long-running jobs, authenticate remote users, or expose a database. Those layers remain in the existing 61-tool contract and are added after this server foundation is proven.
