# Character-Asset MCP Server V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable Character-Asset MCP/REST server implementing project creation, character spec creation/read, and biped rig creation.

**Architecture:** Keep business logic in a transport-neutral domain service backed by an atomic JSON file store. Both MCP Streamable HTTP and REST routes call the same service. Register MCP schemas from the existing generated catalog so the wire contract stays aligned with the spec package.

**Tech Stack:** Node.js 22 ESM, Node built-in HTTP/JSON APIs, Node built-in `node:test`. The MCP wire boundary targets revision 2026-07-28 directly because SDK installation was unavailable in the build environment.

**Spec:** `docs/superpowers/specs/2026-10-05-character-asset-mcp-server-v1-design.md`

## Global Constraints

- Bind localhost by default (`127.0.0.1`).
- Reuse existing Character-Asset MCP/OpenAPI contracts rather than redefining public operation names.
- JSON-file persistence only for V1.
- No auth, image generation, segmentation, animation, or job queue in V1.
- Tests must use temporary storage and must not write into repository `data/`.

## Review Focus

- Creating a character for an unknown project must fail without writing partial state.
- Duplicate `character_id` creation must return conflict rather than overwrite the spec.
- Rig creation for an unknown character or unsupported preset must return a stable domain error.
- Rig recreation must increment version while preserving the same character identity.
- Concurrent/partial JSON writes must not leave a corrupt persisted file; writes use temp-file + rename.

---

### Task 1: Persistent domain service

**Files:**
- Create: `package.json`
- Create: `src/errors.mjs`
- Create: `src/storage/json-store.mjs`
- Create: `src/domain/rig-presets.mjs`
- Create: `src/domain/service.mjs`
- Test: `test/domain.test.mjs`

**Interfaces:**
- Produces: `JsonStore(rootDir)`, `CharacterAssetService(store)`, and methods `createProject`, `createCharacterSpec`, `getCharacterSpec`, `createRig`.

- [ ] **Step 1: Write failing domain tests** for project creation, unknown project rejection, duplicate character conflict, canonical spec defaults, biped rig shape, unsupported preset, rig version increment, and persistence reload.
- [ ] **Step 2: Run `node --test test/domain.test.mjs`** and confirm failures are due to missing implementation.
- [ ] **Step 3: Implement minimal store, errors, rig preset, and service** to satisfy the tests.
- [ ] **Step 4: Run `node --test test/domain.test.mjs`** and confirm all pass.
- [ ] **Step 5: Commit** `feat: add persistent character asset domain service`.

### Task 2: MCP server and transport-independent tool registration

**Files:**
- Create: `src/contracts/tool-catalog.mjs`
- Create: `src/mcp/router.mjs`
- Test: `test/mcp.test.mjs`

**Interfaces:**
- Consumes: `CharacterAssetService` from Task 1.
- Produces: `createCharacterAssetMcpRouter(service)` dispatching the four public tool names using existing input/output schemas.

- [ ] **Step 1: Write failing MCP tests** that dispatch MCP JSON-RPC messages, list the four tools, create a project, create/read a character spec, and create a rig with structured output.
- [ ] **Step 2: Run `node --test test/mcp.test.mjs`** and confirm failure before implementation.
- [ ] **Step 3: Implement catalog loading and MCP routing** with structured tool results.
- [ ] **Step 4: Run `node --test test/mcp.test.mjs`** and confirm all pass.
- [ ] **Step 5: Commit** `feat: expose core character asset MCP tools`.

### Task 3: Streamable HTTP + REST server

**Files:**
- Create: `src/http/rest.mjs`
- Create: `src/http/server.mjs`
- Create: `src/index.mjs`
- Test: `test/http.test.mjs`
- Modify: `README.md`
- Modify: `manifest.json`

**Interfaces:**
- Consumes: domain service and MCP factory from Tasks 1-2.
- Produces: `createHttpServer({ dataDir, host, port })` and CLI `npm start`.

- [ ] **Step 1: Write failing HTTP tests** for health, four REST operations/status mapping, and MCP discover/list/call via `/mcp`.
- [ ] **Step 2: Run `node --test test/http.test.mjs`** and confirm failure before implementation.
- [ ] **Step 3: Implement plain Node HTTP REST routing and mount the MCP router** with protocol-header and local-origin guards.
- [ ] **Step 4: Update README/manifest with server commands and V1 implementation status.**
- [ ] **Step 5: Run `npm test`** and confirm the full suite passes.
- [ ] **Step 6: Commit** `feat: add Character-Asset MCP and REST server`.
