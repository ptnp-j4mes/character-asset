# Character Parts Stage V1 Design

## Goal

Insert a real riggable-parts stage between base-view validation and rig creation so Character-Asset can turn directional character references into editable 2.5D cutout parts before bone binding.

## Current State

The current UI composes five static 128x128 references from two source layers per direction: body + hair. The runtime flow is currently:

```
character.prepare_base_views
-> character.ingest_base_view
-> character.validate_base_views
-> rig.create
```

This skips the semantic-part stage required for skeletal 2.5D animation. The MCP catalog already describes `parts.auto_segment`, `parts.list`, `parts.get`, `parts.update_mask`, `parts.approve`, `parts.create_manual`, and `rig.auto_bind_parts`, but those tools are not executable yet.

## Design Decisions

### 1. Base views are references, not final rig assets

The S/SW/W/NW/N images define identity, costume, silhouette, direction, scale, and camera alignment. They are preserved as immutable source references.

The UI must label the current stage as **Reference** rather than implying the displayed composite is already a final 2.5D asset.

### 2. Parts are direction-specific

Each canonical direction owns its own part set because silhouette and occlusion change by direction.

```
parts/
  S/
  SW/
  W/
  NW/
  N/
```

Derived directions remain outside this V1. Later, SE/E/NE can mirror SW/W/NW after approved directional parts exist.

### 3. Standard biped chibi part template

V1 uses `biped_chibi_parts_v1` with these semantic parts:

```
hair_back
head
hair_front
torso
pelvis
upper_arm_l
forearm_l
hand_l
upper_arm_r
forearm_r
hand_r
thigh_l
calf_l
foot_l
thigh_r
calf_r
foot_r
```

The template intentionally excludes equipment. Weapons, shields, hats, back items, and effects remain socket-attached assets.

### 4. Template-assisted segmentation, not fake AI certainty

`parts.auto_segment` creates **draft** parts using the known direction, the chibi rig preset, alpha bounds, and normalized body-region seeds. Existing source layers such as body and hair may be used as high-confidence seeds.

The operation must return confidence and review status per part. It must not mark generated masks as approved automatically.

At 128x128, elbow/wrist/knee boundaries are often ambiguous. V1 therefore requires human review and supports correction through `parts.update_mask` and `parts.create_manual`.

A future segmentation-model adapter may replace the draft-mask algorithm without changing the MCP contract.

### 5. Authoring resolution and runtime resolution are separate concepts

V1 keeps compatibility with the current 128x128 references, but the data model gains explicit authoring metadata:

- `source_width/source_height`: actual reference dimensions.
- `runtime_width/runtime_height`: game output target.
- `authoring_recommended_width/height`: 512x512 minimum for future generated masters.

The UI must warn when semantic segmentation is being attempted on a source below 512x512. It must not silently upscale and call that additional detail.

Future ChatGPT image generation should target a 512x512 or 1024x1024 authoring master, then render/downsample runtime output to 128x128.

## Part Asset Model

Each part record contains:

```json
{
  "part_id": "part_...",
  "character_id": "char_...",
  "direction": "S",
  "name": "upper_arm_l",
  "template": "biped_chibi_parts_v1",
  "status": "draft",
  "confidence": 0.74,
  "source": {
    "type": "base_view",
    "direction": "S"
  },
  "bounds": { "x": 0, "y": 0, "width": 0, "height": 0 },
  "pivot": { "x": 0.5, "y": 0.2 },
  "bone_hint": "upper_arm_l",
  "occlusion": {
    "needs_completion": false,
    "reason": null
  },
  "created_at": "..."
}
```

PNG cutouts and masks are stored under:

```
data/characters/<character_id>/parts/<direction>/<part_name>/
  part.json
  cutout.png
  mask.png
```

## MCP Runtime Tools

### `parts.auto_segment`

Input:

```json
{
  "character_id": "char_...",
  "source_direction": "S",
  "part_template": "biped_chibi_parts_v1",
  "mode": "hybrid"
}
```

Behavior:

1. Require a stored or source-backed base view for the direction.
2. Create draft semantic masks and cutouts.
3. Record confidence and occlusion-review flags.
4. Persist all draft part records.
5. Return summary counts and review requirements.

### `parts.list`

Returns all parts for a character, optionally filtered by direction.

### `parts.get`

Returns metadata for one part and local image endpoints for its cutout and mask.

### `parts.update_mask`

Replaces the mask for one draft part, regenerates its cutout, and resets approval to draft.

### `parts.create_manual`

Creates or replaces a part from an explicit mask/data URL. This is the escape hatch when automatic separation is wrong.

### `parts.approve`

Marks one reviewed part as approved. Approval requires a non-empty mask and cutout.

### `rig.auto_bind_parts`

Binds approved parts to matching `bone_hint` values in the current `biped_chibi_v1` rig. Draft/unapproved parts are skipped and reported.

## Workflow

The V1 workflow becomes:

```
character.prepare_base_views
-> character.ingest_base_view
-> character.validate_base_views
-> parts.auto_segment
-> parts.list
-> parts.update_mask / parts.create_manual (when needed)
-> parts.approve
-> rig.create
-> rig.auto_bind_parts
-> rig.validate
```

`character.validate_base_views` must recommend `parts.auto_segment`, not `rig.create`.

## Web UI

The existing hybrid artist + inspector layout remains.

### Base Views screen

Add a stage selector:

```
Reference | Parts | Rig
```

Reference preserves the current directional reference display.

Each direction card shows part readiness:

```
S (South)
Reference ready
Parts 0 / 17 approved
[Extract Parts]
```

### Parts screen

For the selected direction show:

- composite reference on the left/center;
- overlay toggle for semantic masks;
- grid/list of 17 standard parts;
- status: Missing / Draft / Review / Approved;
- confidence;
- bounds and pivot;
- buttons: Edit Mask, Replace Manual, Approve.

The right Inspector continues to show:

- MCP tool;
- request;
- response;
- REST equivalent;
- status;
- duration;
- errors;
- provenance;
- next recommended tool.

### Rig screen

Rig actions remain disabled until at least one approved part exists. Auto Bind shows which approved parts were bound and which bones remain unmatched.

## REST Endpoints

Add runtime REST equivalents:

```
POST /characters/{id}/parts:auto-segment
GET  /characters/{id}/parts
GET  /characters/{id}/parts/{part_id}
PUT  /characters/{id}/parts/{part_id}/mask
POST /characters/{id}/parts:manual
POST /characters/{id}/parts/{part_id}:approve
GET  /characters/{id}/parts/{part_id}/cutout
GET  /characters/{id}/parts/{part_id}/mask
POST /characters/{id}/rig:auto-bind
GET  /characters/{id}/rig
POST /characters/{id}/rig:validate
```

## Error Handling

Use existing stable CharacterAssetError envelopes.

Required failures include:

- missing character or direction reference -> `NOT_FOUND`;
- unsupported part template -> `UNSUPPORTED_OPERATION`;
- invalid mask PNG/data URL -> `INVALID_ARGUMENT`;
- approval without a valid cutout/mask -> `VALIDATION_FAILED`;
- auto-bind with no rig -> `NOT_FOUND`;
- duplicate part replacement without explicit replace -> `CONFLICT`.

Low-resolution source is a warning, not a hard failure.

## Testing

Backend tests must cover:

1. auto-segment creates deterministic draft records for all 17 template parts;
2. 128x128 source produces a low-resolution warning;
3. list/get ordering is deterministic;
4. mask replacement regenerates cutout metadata and clears approval;
5. approve requires valid part artifacts;
6. auto-bind only binds approved parts;
7. REST and MCP expose the same behavior;
8. existing base-view and rig tests remain green.

Web tests/build must cover:

- Parts stage appears after base-view validation;
- Validate no longer recommends direct Rig creation;
- per-direction part readiness is visible;
- inspector records parts tool requests/responses;
- production build succeeds.

## Non-goals for V1

- No provider-side semantic segmentation API.
- No automatic hidden-pixel inpainting/occlusion completion yet; only flagging and manual replacement.
- No mesh deformation or skin weighting.
- No animation editor changes.
- No derived-direction mirroring.
- No claim that 128x128 references are sufficient production authoring masters.

## Success Criteria

The feature is complete when a user can take one canonical directional reference, create persisted draft semantic parts, review/replace/approve those parts in the Web UI, create a rig, auto-bind approved parts, and inspect every MCP request/response in the existing right-side Inspector without bypassing the Parts stage.
