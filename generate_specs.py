import json
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VERSION = '0.3.0'
(ROOT/'openapi').mkdir(parents=True, exist_ok=True)
(ROOT/'mcp').mkdir(parents=True, exist_ok=True)
(ROOT/'schemas').mkdir(parents=True, exist_ok=True)
(ROOT/'examples').mkdir(parents=True, exist_ok=True)

SCHEMA = 'https://json-schema.org/draft/2020-12/schema'
OAS_DIALECT = 'https://spec.openapis.org/oas/3.2/dialect/2026-02-26'
DIRECTIONS = ['S','SW','W','NW','N','NE','E','SE']
BASE_VIEWS = ['S','SW','W','NW','N']
ANIMATIONS = ['idle','walk','run','attack_1','hit','die','custom']
SLOTS = ['head','weapon','shield','back','fx','custom']
STATUSES = ['draft','processing','ready','approved','failed','archived']
JOB_STATUSES = ['queued','running','completed','failed','canceled']


def obj(properties=None, required=None, additional=False, **kw):
    x = {'type':'object','properties':properties or {},'additionalProperties':additional}
    if required: x['required'] = required
    x.update(kw)
    return x

def arr(items, **kw):
    x = {'type':'array','items':items}
    x.update(kw)
    return x

def enum(values, **kw):
    x = {'type':'string','enum':values}
    x.update(kw)
    return x

def string(**kw):
    x={'type':'string'}; x.update(kw); return x

def integer(**kw):
    x={'type':'integer'}; x.update(kw); return x

def number(**kw):
    x={'type':'number'}; x.update(kw); return x

def boolean(**kw):
    x={'type':'boolean'}; x.update(kw); return x

vec2 = obj({'x':number(),'y':number()}, ['x','y'])
transform2d = obj({
    'x': number(default=0), 'y': number(default=0), 'rotation': number(default=0),
    'scale_x': number(default=1), 'scale_y': number(default=1)
})
color_palette = obj({
    'primary': string(pattern='^#[0-9A-Fa-f]{6}$'),
    'secondary': string(pattern='^#[0-9A-Fa-f]{6}$'),
    'accent': string(pattern='^#[0-9A-Fa-f]{6}$'),
}, additional=True)

schemas = {}
schemas['Error'] = obj({
    'code': string(), 'message': string(), 'details': obj(additional=True)
}, ['code','message'])
schemas['ErrorEnvelope'] = obj({'error': {'$ref':'#/$defs/Error'}}, ['error'])
schemas['Project'] = obj({
    'project_id': string(pattern='^proj_[A-Za-z0-9_-]+$'),
    'name': string(minLength=1, maxLength=120),
    'description': string(maxLength=2000),
    'schema_version': string(default='1.0.0'),
    'created_at': string(format='date-time'),
    'updated_at': string(format='date-time')
}, ['project_id','name','schema_version','created_at','updated_at'])

schemas['CharacterSpec'] = obj({
    'spec_id': string(pattern='^spec_[A-Za-z0-9_-]+$'),
    'character_id': string(pattern='^char_[A-Za-z0-9_-]+$'),
    'project_id': string(pattern='^proj_[A-Za-z0-9_-]+$'),
    'name': string(minLength=1, maxLength=120),
    'style_profile': string(minLength=1),
    'proportion_profile': string(minLength=1),
    'visual': obj({
        'gender_presentation': string(), 'age_style': string(), 'silhouette': string(),
        'palette': color_palette,
        'prompt_notes': string(maxLength=4000)
    }, additional=False),
    'views_required': arr(enum(DIRECTIONS), minItems=1, uniqueItems=True),
    'equipment_slots': arr(enum(SLOTS), uniqueItems=True),
    'rig_preset': string(minLength=1),
    'motion_preset': string(minLength=1),
    'output_constraints': obj({
        'canvas_width': integer(minimum=64, maximum=4096, default=512),
        'canvas_height': integer(minimum=64, maximum=4096, default=512),
        'transparent_background': boolean(default=True),
        'padding_px': integer(minimum=0, maximum=512, default=16)
    }, additional=False),
    'status': enum(STATUSES, default='draft'),
    'schema_version': string(default='1.0.0'),
    'asset_version': integer(minimum=1, default=1),
    'created_at': string(format='date-time'),
    'updated_at': string(format='date-time')
}, ['spec_id','character_id','project_id','name','style_profile','proportion_profile','views_required','rig_preset','motion_preset','schema_version','asset_version'])

schemas['BaseView'] = obj({
    'direction': enum(DIRECTIONS),
    'image_asset_id': string(),
    'source_direction': enum(DIRECTIONS),
    'mirrored': boolean(default=False),
    'status': enum(STATUSES),
    'width': integer(minimum=1), 'height': integer(minimum=1),
    'transparent_background': boolean(),
    'provenance': obj({
        'provider': string(), 'model': string(), 'seed': integer(),
        'prompt_template_version': string(), 'generation_id': string()
    }, additional=True)
}, ['direction','image_asset_id','status'])

schemas['BaseViewGeneration'] = obj({
    'generation_id': string(pattern='^gen_[A-Za-z0-9_-]+$'),
    'character_id': string(pattern='^char_[A-Za-z0-9_-]+$'),
    'status': enum(['prepared']),
    'generator': enum(['chatgpt-web']),
    'prompt_template_version': string(),
    'character_lock': obj({
        'spec_id': string(), 'asset_version': integer(minimum=1),
        'name': string(), 'style_profile': string(), 'proportion_profile': string(),
        'visual': obj(additional=True), 'output_constraints': obj(additional=True)
    }, ['spec_id','asset_version','name','style_profile','proportion_profile','visual','output_constraints']),
    'views': arr(obj({'direction':enum(BASE_VIEWS),'prompt':string(minLength=1)}, ['direction','prompt'])),
    'created_at': string(format='date-time')
}, ['generation_id','character_id','status','generator','prompt_template_version','character_lock','views','created_at'])

schemas['BaseViewValidation'] = obj({
    'valid': boolean(), 'score': integer(minimum=0, maximum=100),
    'views_checked': integer(minimum=0),
    'required_views': arr(enum(BASE_VIEWS)),
    'warnings': arr(string()), 'errors': arr(string())
}, ['valid','score','views_checked','required_views','warnings','errors'])

schemas['PartAsset'] = obj({
    'part_id': string(), 'character_id': string(), 'direction': enum(DIRECTIONS),
    'name': string(), 'category': enum(['body_part','hair','equipment','shadow','fx','custom']),
    'image_asset_id': string(), 'mask_asset_id': string(),
    'pivot': vec2, 'default_draw_layer': integer(),
    'approved': boolean(default=False), 'status': enum(STATUSES)
}, ['part_id','character_id','direction','name','category','image_asset_id','pivot','status'])

schemas['Bone'] = obj({
    'name': string(), 'parent': {'type':['string','null']}, 'position': vec2,
    'length': number(minimum=0), 'rotation': number(default=0),
    'rotation_limits': obj({'min':number(),'max':number()}, additional=False)
}, ['name','parent','position'])

schemas['Socket'] = obj({
    'name': string(), 'bone_name': string(), 'slot_type': enum(SLOTS),
    'offset': transform2d
}, ['name','bone_name','slot_type','offset'])

schemas['Binding'] = obj({
    'part_id': string(), 'bone_name': string(), 'pivot': vec2,
    'offset': transform2d, 'weight_mode': enum(['rigid','weighted'], default='rigid')
}, ['part_id','bone_name','pivot','offset'])

schemas['Rig'] = obj({
    'rig_id': string(pattern='^rig_[A-Za-z0-9_-]+$'),
    'character_id': string(), 'preset': string(),
    'bones': arr({'$ref':'#/$defs/Bone'}),
    'sockets': arr({'$ref':'#/$defs/Socket'}),
    'bindings': arr({'$ref':'#/$defs/Binding'}),
    'status': enum(STATUSES), 'version': integer(minimum=1)
}, ['rig_id','character_id','preset','bones','sockets','bindings','status','version'])

schemas['DirectionProfile'] = obj({
    'character_id': string(), 'direction': enum(DIRECTIONS),
    'mirror_source': {'oneOf':[enum(DIRECTIONS), {'type':'null'}]},
    'bone_offsets': obj(additional=transform2d),
    'socket_offsets': obj(additional=transform2d),
    'draw_order': arr(string(), uniqueItems=True),
    'scale_overrides': obj(additional=obj({'scale_x':number(),'scale_y':number()}, additional=False)),
    'approved': boolean(default=False)
}, ['character_id','direction','bone_offsets','socket_offsets','draw_order'])

schemas['Keyframe'] = obj({
    'time': number(minimum=0), 'x': number(), 'y': number(), 'rotation': number(),
    'scale_x': number(), 'scale_y': number(),
    'easing': enum(['linear','ease_in','ease_out','ease_in_out','step'])
}, ['time'])

schemas['AnimationTrack'] = obj({
    'bone_name': string(), 'keyframes': arr({'$ref':'#/$defs/Keyframe'}, minItems=1)
}, ['bone_name','keyframes'])

schemas['AnimationEvent'] = obj({
    'time': number(minimum=0), 'event_name': string(), 'payload': obj(additional=True)
}, ['time','event_name'])

schemas['AnimationClip'] = obj({
    'animation_id': string(pattern='^anim_[A-Za-z0-9_-]+$'),
    'character_id': string(), 'name': enum(ANIMATIONS),
    'duration_sec': number(exclusiveMinimum=0), 'loop': boolean(),
    'tracks': arr({'$ref':'#/$defs/AnimationTrack'}),
    'events': arr({'$ref':'#/$defs/AnimationEvent'}),
    'directions': arr(enum(DIRECTIONS), uniqueItems=True),
    'version': integer(minimum=1), 'status': enum(STATUSES)
}, ['animation_id','character_id','name','duration_sec','loop','tracks','events','directions','version','status'])

schemas['EquipmentItem'] = obj({
    'item_id': string(), 'name': string(), 'slot': enum(SLOTS),
    'image_asset_id': string(), 'style_profile': string(),
    'direction_assets': obj(additional=string()),
    'metadata': obj(additional=True), 'status': enum(STATUSES)
}, ['item_id','name','slot','status'])

schemas['Attachment'] = obj({
    'character_id': string(), 'slot': enum(SLOTS), 'item_id': string(), 'socket_name': string(),
    'direction_offsets': obj(additional=transform2d)
}, ['character_id','slot','item_id','socket_name'])

schemas['QCCheck'] = obj({
    'name': string(), 'status': enum(['pass','warning','fail']),
    'warnings': arr(string()), 'errors': arr(string()), 'details': obj(additional=True)
}, ['name','status','warnings','errors'])

schemas['QCResult'] = obj({
    'valid': boolean(), 'score': integer(minimum=0, maximum=100),
    'checks': arr({'$ref':'#/$defs/QCCheck'})
}, ['valid','score','checks'])

schemas['Job'] = obj({
    'job_id': string(pattern='^job_[A-Za-z0-9_-]+$'), 'status': enum(JOB_STATUSES),
    'progress': integer(minimum=0, maximum=100), 'operation': string(),
    'resource_type': string(), 'resource_id': string(),
    'created_at': string(format='date-time'), 'updated_at': string(format='date-time'),
    'logs': arr(string()), 'error': {'oneOf':[{'$ref':'#/$defs/Error'},{'type':'null'}]}
}, ['job_id','status','operation','created_at','updated_at'])

schemas['ExportPackage'] = obj({
    'package_id': string(pattern='^pkg_[A-Za-z0-9_-]+$'), 'character_id': string(),
    'format': enum(['character-asset-v1','runtime-bundle-v1','spritesheet-bundle-v1']),
    'status': enum(['building','ready','failed']),
    'download_url': string(format='uri'),
    'included_files': arr(string()), 'checksum_sha256': string(pattern='^[A-Fa-f0-9]{64}$')
}, ['package_id','character_id','format','status'])

# Write standalone shared JSON Schemas.
standalone_map = {
    'project.schema.json':'Project',
    'character-spec.schema.json':'CharacterSpec',
    'base-view.schema.json':'BaseView',
    'base-view-generation.schema.json':'BaseViewGeneration',
    'base-view-validation.schema.json':'BaseViewValidation',
    'part-asset.schema.json':'PartAsset',
    'rig.schema.json':'Rig',
    'direction-profile.schema.json':'DirectionProfile',
    'animation-clip.schema.json':'AnimationClip',
    'equipment-item.schema.json':'EquipmentItem',
    'job.schema.json':'Job',
    'export-package.schema.json':'ExportPackage',
    'qc-result.schema.json':'QCResult'
}
for filename, root_name in standalone_map.items():
    defs = deepcopy(schemas)
    root = deepcopy(defs.pop(root_name))
    doc = {'$schema':SCHEMA, '$id':f'https://character-asset.local/schemas/{filename}', 'title':root_name, **root, '$defs':defs}
    (ROOT/'schemas'/filename).write_text(json.dumps(doc, indent=2, ensure_ascii=False)+"\n")

# MCP helpers: each schema is self-contained with local refs only.
def inline_schema(root_schema, needed=None):
    doc = deepcopy(root_schema)

    def refs_in(node):
        found = set()
        if isinstance(node, dict):
            r = node.get('$ref')
            if isinstance(r, str) and r.startswith('#/$defs/'):
                found.add(r.split('/', 3)[-1])
            for v in node.values():
                found.update(refs_in(v))
        elif isinstance(node, list):
            for v in node:
                found.update(refs_in(v))
        return found

    pending = list(refs_in(doc))
    required = {}
    while pending:
        name = pending.pop()
        if name in required:
            continue
        if name not in schemas:
            raise KeyError(f'Unknown local schema ref: {name}')
        definition = deepcopy(schemas[name])
        required[name] = definition
        pending.extend(refs_in(definition) - set(required))
    if required:
        doc['$defs'] = required
    return doc

def result(schema, required=None):
    if isinstance(schema, dict) and schema.get('type') == 'object':
        return inline_schema(schema)
    return inline_schema(schema)

def tool(name, title, desc, input_schema, output_schema, read=False, destructive=False, idempotent=False, open_world=False):
    assert input_schema.get('type') == 'object', f'{name}: input root must be object'
    return {
        'name': name,
        'title': title,
        'description': desc,
        'inputSchema': inline_schema(input_schema),
        'outputSchema': inline_schema(output_schema),
        'annotations': {
            'readOnlyHint': read,
            'destructiveHint': destructive,
            'idempotentHint': idempotent,
            'openWorldHint': open_world
        }
    }

id_project = string(pattern='^proj_[A-Za-z0-9_-]+$')
id_char = string(pattern='^char_[A-Za-z0-9_-]+$')
id_rig = string(pattern='^rig_[A-Za-z0-9_-]+$')
id_anim = string(pattern='^anim_[A-Za-z0-9_-]+$')
id_job = string(pattern='^job_[A-Za-z0-9_-]+$')
validation_out = obj({'valid':boolean(),'warnings':arr(string()),'errors':arr(string())}, ['valid','warnings','errors'])
ack_out = obj({'ok':boolean(),'resource_id':string(),'message':string()}, ['ok'])
job_out = obj({'job':{'$ref':'#/$defs/Job'}}, ['job'])

TOOLS=[]
add=TOOLS.append

# Project
add(tool('project.create','Create project','Create a Character-Asset project.', obj({'name':string(minLength=1,maxLength=120),'description':string(maxLength=2000)}, ['name']), obj({'project':{'$ref':'#/$defs/Project'}}, ['project']), idempotent=False))
add(tool('project.get','Get project','Read one project.', obj({'project_id':id_project}, ['project_id']), obj({'project':{'$ref':'#/$defs/Project'}}, ['project']), read=True, idempotent=True))
add(tool('project.list','List projects','List accessible Character-Asset projects.', obj({'limit':integer(minimum=1,maximum=200,default=50),'cursor':string()}, []), obj({'projects':arr({'$ref':'#/$defs/Project'}),'next_cursor':{'type':['string','null']}}, ['projects']), read=True, idempotent=True))
add(tool('project.update','Update project','Update project metadata.', obj({'project_id':id_project,'name':string(minLength=1,maxLength=120),'description':string(maxLength=2000)}, ['project_id']), obj({'project':{'$ref':'#/$defs/Project'}}, ['project']), idempotent=True))

# Character spec
create_spec_input = obj({
    'project_id':id_project, 'character_id':id_char, 'name':string(minLength=1,maxLength=120),
    'style_profile':string(minLength=1), 'proportion_profile':string(minLength=1),
    'visual':deepcopy(schemas['CharacterSpec']['properties']['visual']),
    'views_required':arr(enum(DIRECTIONS),minItems=1,uniqueItems=True),
    'equipment_slots':arr(enum(SLOTS),uniqueItems=True), 'rig_preset':string(minLength=1),
    'motion_preset':string(minLength=1),
    'output_constraints':deepcopy(schemas['CharacterSpec']['properties']['output_constraints'])
}, ['project_id','character_id','name','style_profile','proportion_profile','views_required','rig_preset','motion_preset'])
add(tool('character.create_spec','Create character spec','Create the canonical structured character specification.', create_spec_input, obj({'spec':{'$ref':'#/$defs/CharacterSpec'}}, ['spec'])))
add(tool('character.get_spec','Get character spec','Read the current character specification.', obj({'character_id':id_char}, ['character_id']), obj({'spec':{'$ref':'#/$defs/CharacterSpec'}}, ['spec']), read=True, idempotent=True))
add(tool('character.update_spec','Update character spec','Patch editable fields in a character specification.', obj({'character_id':id_char,'patch':obj(additional=True),'expected_asset_version':integer(minimum=1)}, ['character_id','patch']), obj({'spec':{'$ref':'#/$defs/CharacterSpec'}}, ['spec']), idempotent=True))
add(tool('character.validate_spec','Validate character spec','Validate a character spec before generation.', obj({'character_id':id_char}, ['character_id']), validation_out, read=True, idempotent=True))

# Profiles
for n,title,kind in [
    ('profile.list_style_profiles','List style profiles','style'),
    ('profile.list_rig_presets','List rig presets','rig'),
    ('profile.list_motion_presets','List motion presets','motion')]:
    add(tool(n,title,f'List available {kind} profiles/presets.', obj({}, []), obj({'profiles':arr(obj({'id':string(),'version':string(),'name':string(),'description':string()}, ['id','version','name']))}, ['profiles']), read=True, idempotent=True))

# Generation
prepare_base_views_input = obj({'character_id':id_char,'views':arr(enum(BASE_VIEWS),minItems=1,uniqueItems=True)}, ['character_id'])
ingest_base_view_input = obj({
    'character_id':id_char,
    'generation_id':string(pattern='^gen_[A-Za-z0-9_-]+$'),
    'direction':enum(BASE_VIEWS),
    'image_data_url':string(pattern='^data:image/png;base64,'),
    'provider':string(default='chatgpt-web'),
    'model':string(),
    'replace':boolean(default=False)
}, ['character_id','generation_id','direction','image_data_url'])
add(tool('character.generate_base_views','Generate base views','Generate canonical 2.5D character base views from a server-side image provider. Planned automation path; not executable in the current ChatGPT Web-first runtime.', obj({'character_id':id_char,'views':arr(enum(DIRECTIONS),minItems=1,uniqueItems=True),'regenerate':boolean(default=False),'seed':integer()}, ['character_id','views']), job_out))
add(tool('character.prepare_base_views','Prepare base views for ChatGPT Web','Build and persist locked prompts for ChatGPT Web/native image generation without calling an image provider from the server.', prepare_base_views_input, obj({'generation':{'$ref':'#/$defs/BaseViewGeneration'}}, ['generation'])))
add(tool('character.ingest_base_view','Ingest ChatGPT Web base view','Persist one PNG produced by ChatGPT Web/native image generation and attach generation provenance.', ingest_base_view_input, obj({'view':{'$ref':'#/$defs/BaseView'}}, ['view'])))
add(tool('character.get_base_views','Get base views','Read generated or ingested base-view assets.', obj({'character_id':id_char}, ['character_id']), obj({'character_id':id_char,'views':arr({'$ref':'#/$defs/BaseView'})}, ['character_id','views']), read=True, idempotent=True))
add(tool('character.validate_base_views','Validate base views','Check required canonical views, PNG alpha capability, and source canvas size before segmentation.', obj({'character_id':id_char}, ['character_id']), obj({'validation':{'$ref':'#/$defs/BaseViewValidation'}}, ['validation']), read=True, idempotent=True))
mirror_pair = obj({'target':enum(DIRECTIONS),'source':enum(DIRECTIONS)}, ['target','source'])
add(tool('character.generate_mirrored_views','Generate mirrored views','Create direction views by horizontal mirroring from approved sources.', obj({'character_id':id_char,'mirror_pairs':arr(mirror_pair,minItems=1)}, ['character_id','mirror_pairs']), job_out))
add(tool('character.regenerate_view','Regenerate one view','Regenerate one character direction while preserving the same spec.', obj({'character_id':id_char,'direction':enum(DIRECTIONS),'seed':integer(),'reason':string(maxLength=1000)}, ['character_id','direction']), job_out))

# Parts
add(tool('parts.auto_segment','Auto segment parts','Segment a base view into riggable body parts.', obj({'character_id':id_char,'source_direction':enum(BASE_VIEWS),'part_template':string(default='biped_chibi_v1'),'mode':enum(['auto','hybrid'],default='hybrid')}, ['character_id','source_direction','part_template']), job_out))
add(tool('parts.list','List parts','List segmented parts for a character and optional direction.', obj({'character_id':id_char,'direction':enum(DIRECTIONS),'approved_only':boolean(default=False)}, ['character_id']), obj({'parts':arr({'$ref':'#/$defs/PartAsset'})}, ['parts']), read=True, idempotent=True))
add(tool('parts.get','Get part','Read one segmented part.', obj({'part_id':string()}, ['part_id']), obj({'part':{'$ref':'#/$defs/PartAsset'}}, ['part']), read=True, idempotent=True))
mask_schema = obj({'format':enum(['polygon','rle','asset_ref']),'polygon':arr(vec2),'mask_asset_id':string()}, ['format'])
add(tool('parts.update_mask','Update part mask','Replace the segmentation mask for a part.', obj({'part_id':string(),'mask':mask_schema}, ['part_id','mask']), obj({'part':{'$ref':'#/$defs/PartAsset'}}, ['part']), idempotent=True))
add(tool('parts.approve','Approve part','Mark a segmented part as approved for rig binding.', obj({'part_id':string(),'approved':boolean(default=True)}, ['part_id']), obj({'part':{'$ref':'#/$defs/PartAsset'}}, ['part']), idempotent=True))
add(tool('parts.delete','Delete part','Delete one segmented part.', obj({'part_id':string()}, ['part_id']), ack_out, destructive=True, idempotent=True))
add(tool('parts.create_manual','Create manual part','Create a riggable part from an existing cutout or explicit region.', obj({'character_id':id_char,'direction':enum(DIRECTIONS),'name':string(),'category':enum(['body_part','hair','equipment','shadow','fx','custom']),'image_asset_id':string(),'pivot':vec2}, ['character_id','direction','name','category','image_asset_id','pivot']), obj({'part':{'$ref':'#/$defs/PartAsset'}}, ['part'])))

# Rig
add(tool('rig.create','Create rig','Create a character rig from a preset and optionally auto-bind approved parts.', obj({'character_id':id_char,'rig_preset':string(),'auto_bind':boolean(default=True)}, ['character_id','rig_preset']), obj({'rig':{'$ref':'#/$defs/Rig'}}, ['rig'])))
add(tool('rig.get','Get rig','Read the current character rig.', obj({'character_id':id_char}, ['character_id']), obj({'rig':{'$ref':'#/$defs/Rig'}}, ['rig']), read=True, idempotent=True))
add(tool('rig.list_bones','List bones','List bones in a rig.', obj({'rig_id':id_rig}, ['rig_id']), obj({'bones':arr({'$ref':'#/$defs/Bone'})}, ['bones']), read=True, idempotent=True))
add(tool('rig.update_bone','Update bone','Patch one bone in the rig.', obj({'rig_id':id_rig,'bone_name':string(),'patch':obj({'parent':{'type':['string','null']},'position':vec2,'length':number(minimum=0),'rotation':number(),'rotation_limits':obj({'min':number(),'max':number()}, additional=False)}, additional=False)}, ['rig_id','bone_name','patch']), obj({'rig':{'$ref':'#/$defs/Rig'}}, ['rig']), idempotent=True))
add(tool('rig.auto_bind_parts','Auto bind parts','Bind approved character parts to matching preset bones.', obj({'rig_id':id_rig,'overwrite_existing':boolean(default=False)}, ['rig_id']), obj({'rig':{'$ref':'#/$defs/Rig'},'bound_part_ids':arr(string()),'unbound_part_ids':arr(string())}, ['rig','bound_part_ids','unbound_part_ids']), idempotent=True))
add(tool('rig.update_binding','Update binding','Set or replace the bone binding for a part.', obj({'rig_id':id_rig,'part_id':string(),'bone_name':string(),'pivot':vec2,'offset':transform2d,'weight_mode':enum(['rigid','weighted'],default='rigid')}, ['rig_id','part_id','bone_name']), obj({'rig':{'$ref':'#/$defs/Rig'}}, ['rig']), idempotent=True))
add(tool('rig.add_socket','Add socket','Add an equipment or effect socket to a bone.', obj({'rig_id':id_rig,'socket_name':string(),'bone_name':string(),'offset':transform2d,'slot_type':enum(SLOTS)}, ['rig_id','socket_name','bone_name','slot_type']), obj({'rig':{'$ref':'#/$defs/Rig'}}, ['rig'])))
add(tool('rig.update_socket','Update socket','Patch an existing rig socket.', obj({'rig_id':id_rig,'socket_name':string(),'patch':obj({'bone_name':string(),'offset':transform2d,'slot_type':enum(SLOTS)}, additional=False)}, ['rig_id','socket_name','patch']), obj({'rig':{'$ref':'#/$defs/Rig'}}, ['rig']), idempotent=True))
add(tool('rig.validate','Validate rig','Validate bone hierarchy, bindings and sockets.', obj({'rig_id':id_rig}, ['rig_id']), validation_out, read=True, idempotent=True))

# Directions
add(tool('direction.create_profiles','Create direction profiles','Create 8-direction pose/layer profiles with optional mirror rules.', obj({'character_id':id_char,'directions':arr(enum(DIRECTIONS),minItems=1,uniqueItems=True),'mirror_rules':arr(mirror_pair)}, ['character_id','directions']), obj({'profiles':arr({'$ref':'#/$defs/DirectionProfile'})}, ['profiles'])))
add(tool('direction.get_profile','Get direction profile','Read one direction profile.', obj({'character_id':id_char,'direction':enum(DIRECTIONS)}, ['character_id','direction']), obj({'profile':{'$ref':'#/$defs/DirectionProfile'}}, ['profile']), read=True, idempotent=True))
add(tool('direction.update_profile','Update direction profile','Patch bone offsets, socket offsets, draw order or scale overrides for a direction.', obj({'character_id':id_char,'direction':enum(DIRECTIONS),'patch':obj({'bone_offsets':obj(additional=transform2d),'socket_offsets':obj(additional=transform2d),'draw_order':arr(string(),uniqueItems=True),'scale_overrides':obj(additional=obj({'scale_x':number(),'scale_y':number()}, additional=False)),'approved':boolean()}, additional=False)}, ['character_id','direction','patch']), obj({'profile':{'$ref':'#/$defs/DirectionProfile'}}, ['profile']), idempotent=True))
add(tool('direction.copy_profile','Copy direction profile','Copy or mirror one direction profile into another.', obj({'character_id':id_char,'source':enum(DIRECTIONS),'target':enum(DIRECTIONS),'mirror_horizontal':boolean(default=False)}, ['character_id','source','target']), obj({'profile':{'$ref':'#/$defs/DirectionProfile'}}, ['profile']), idempotent=True))
add(tool('direction.auto_generate_draw_order','Auto-generate draw order','Generate a suggested part draw order for a direction.', obj({'character_id':id_char,'direction':enum(DIRECTIONS),'apply':boolean(default=False)}, ['character_id','direction']), obj({'direction':enum(DIRECTIONS),'draw_order':arr(string()),'applied':boolean()}, ['direction','draw_order','applied']), idempotent=True))
add(tool('direction.validate','Validate directions','Validate completeness and consistency of direction profiles.', obj({'character_id':id_char,'directions':arr(enum(DIRECTIONS),uniqueItems=True)}, ['character_id']), validation_out, read=True, idempotent=True))

# Animation
add(tool('animation.create_clip','Create animation clip','Create an empty animation clip.', obj({'character_id':id_char,'name':enum(ANIMATIONS),'duration_sec':number(exclusiveMinimum=0),'loop':boolean()}, ['character_id','name','duration_sec','loop']), obj({'clip':{'$ref':'#/$defs/AnimationClip'}}, ['clip'])))
add(tool('animation.apply_preset','Apply animation preset','Create or overwrite standard clips from a motion preset.', obj({'character_id':id_char,'preset_name':string(),'animations':arr(enum(ANIMATIONS),minItems=1,uniqueItems=True),'overwrite':boolean(default=False)}, ['character_id','preset_name','animations']), obj({'clips':arr({'$ref':'#/$defs/AnimationClip'})}, ['clips']), idempotent=True))
add(tool('animation.get_clip','Get animation clip','Read one animation clip.', obj({'animation_id':id_anim}, ['animation_id']), obj({'clip':{'$ref':'#/$defs/AnimationClip'}}, ['clip']), read=True, idempotent=True))
add(tool('animation.update_track','Update animation track','Replace a bone keyframe track in an animation clip.', obj({'animation_id':id_anim,'bone_name':string(),'track':arr({'$ref':'#/$defs/Keyframe'},minItems=1)}, ['animation_id','bone_name','track']), obj({'clip':{'$ref':'#/$defs/AnimationClip'}}, ['clip']), idempotent=True))
add(tool('animation.set_event_markers','Set animation events','Replace animation event markers such as hit, footstep or FX events.', obj({'animation_id':id_anim,'events':arr({'$ref':'#/$defs/AnimationEvent'})}, ['animation_id','events']), obj({'clip':{'$ref':'#/$defs/AnimationClip'}}, ['clip']), idempotent=True))
add(tool('animation.assign_direction_profiles','Assign animation directions','Set the directions supported by an animation clip.', obj({'animation_id':id_anim,'directions':arr(enum(DIRECTIONS),minItems=1,uniqueItems=True)}, ['animation_id','directions']), obj({'clip':{'$ref':'#/$defs/AnimationClip'}}, ['clip']), idempotent=True))
add(tool('animation.validate','Validate animation','Validate keyframe timing, bone references and direction coverage.', obj({'animation_id':id_anim}, ['animation_id']), validation_out, read=True, idempotent=True))
add(tool('animation.duplicate','Duplicate animation','Clone an animation clip with a new name/id.', obj({'animation_id':id_anim,'new_name':enum(ANIMATIONS)}, ['animation_id','new_name']), obj({'clip':{'$ref':'#/$defs/AnimationClip'}}, ['clip'])))
add(tool('animation.delete','Delete animation','Delete an animation clip.', obj({'animation_id':id_anim}, ['animation_id']), ack_out, destructive=True, idempotent=True))

# Equipment
add(tool('equipment.attach_item','Attach equipment','Attach an equipment item to a character socket.', obj({'character_id':id_char,'slot':enum(SLOTS),'item_id':string(),'socket_name':string()}, ['character_id','slot','item_id','socket_name']), obj({'attachment':{'$ref':'#/$defs/Attachment'}}, ['attachment']), idempotent=True))
add(tool('equipment.detach_item','Detach equipment','Detach the item currently attached to a slot.', obj({'character_id':id_char,'slot':enum(SLOTS)}, ['character_id','slot']), ack_out, destructive=True, idempotent=True))
add(tool('equipment.list_items','List equipment items','List reusable equipment assets.', obj({'slot':enum(SLOTS),'style_profile':string(),'limit':integer(minimum=1,maximum=200,default=50)}, []), obj({'items':arr({'$ref':'#/$defs/EquipmentItem'})}, ['items']), read=True, idempotent=True))
add(tool('equipment.create_item_spec','Create equipment item spec','Create metadata for a reusable equipment item before image generation.', obj({'item_id':string(),'name':string(),'slot':enum(SLOTS),'style_profile':string(),'metadata':obj(additional=True)}, ['item_id','name','slot','style_profile']), obj({'item':{'$ref':'#/$defs/EquipmentItem'}}, ['item'])))
add(tool('equipment.generate_item_image','Generate equipment image','Generate equipment art according to the item spec and requested views.', obj({'item_id':string(),'views':arr(enum(DIRECTIONS),minItems=1,uniqueItems=True),'seed':integer()}, ['item_id','views']), job_out))
add(tool('equipment.validate_attachment','Validate equipment attachment','Validate socket, direction offsets and layer ordering for attached equipment.', obj({'character_id':id_char,'slot':enum(SLOTS)}, ['character_id','slot']), validation_out, read=True, idempotent=True))

# Preview / validation
add(tool('preview.render_pose','Render pose preview','Render a still image for a direction and optional animation time.', obj({'character_id':id_char,'direction':enum(DIRECTIONS),'animation_id':id_anim,'time_sec':number(minimum=0),'include_equipment':boolean(default=True),'format':enum(['png','webp'],default='png')}, ['character_id','direction']), job_out))
add(tool('preview.render_animation','Render animation preview','Render one animation/direction preview.', obj({'character_id':id_char,'animation_id':id_anim,'direction':enum(DIRECTIONS),'format':enum(['gif','webp','mp4','spritesheet']),'fps':integer(minimum=1,maximum=120,default=12),'include_equipment':boolean(default=True)}, ['character_id','animation_id','direction','format']), job_out))
add(tool('preview.render_all_directions','Render all directions','Render a contact sheet or animation preview for all eight directions.', obj({'character_id':id_char,'animation_id':id_anim,'format':enum(['contact_sheet','gif','webp','mp4']),'fps':integer(minimum=1,maximum=120,default=12),'include_equipment':boolean(default=True)}, ['character_id','animation_id','format']), job_out))
add(tool('validation.run_character_qc','Run character QC','Run end-to-end readiness checks for the character package.', obj({'character_id':id_char,'checks':arr(enum(['spec','parts','rig','direction_profiles','animations','equipment','export_readiness']),uniqueItems=True)}, ['character_id']), obj({'result':{'$ref':'#/$defs/QCResult'}}, ['result']), read=True, idempotent=True))

# Export / jobs
add(tool('export.character_package','Export character package','Build a distributable Character-Asset package.', obj({'character_id':id_char,'format':enum(['character-asset-v1','runtime-bundle-v1','spritesheet-bundle-v1']),'include_previews':boolean(default=True),'include_source_parts':boolean(default=True),'include_mirrored_views':boolean(default=True)}, ['character_id','format']), job_out))
add(tool('export.get_package','Get export package','Read metadata for an export package.', obj({'package_id':string(pattern='^pkg_[A-Za-z0-9_-]+$')}, ['package_id']), obj({'package':{'$ref':'#/$defs/ExportPackage'}}, ['package']), read=True, idempotent=True))
add(tool('job.get','Get job','Read background job status.', obj({'job_id':id_job}, ['job_id']), job_out, read=True, idempotent=True))
add(tool('job.list','List jobs','List recent jobs with optional filters.', obj({'status':enum(JOB_STATUSES),'operation':string(),'resource_id':string(),'limit':integer(minimum=1,maximum=200,default=50)}, []), obj({'jobs':arr({'$ref':'#/$defs/Job'})}, ['jobs']), read=True, idempotent=True))
add(tool('job.cancel','Cancel job','Cancel a queued or running job.', obj({'job_id':id_job}, ['job_id']), job_out, destructive=True, idempotent=True))

mcp_catalog = {
    'project': 'Character-Asset',
    'serverName': 'character-asset',
    'serverVersion': VERSION,
    'protocolRevision': '2026-07-28',
    'jsonSchemaDialect': SCHEMA,
    'tools': TOOLS
}
(ROOT/'mcp'/'character-asset.mcp-tools.json').write_text(json.dumps(mcp_catalog, indent=2, ensure_ascii=False)+"\n")

# A literal tools/list result payload for testing clients.
tools_list_result = {'tools': TOOLS}
(ROOT/'mcp'/'tools-list.result.json').write_text(json.dumps(tools_list_result, indent=2, ensure_ascii=False)+"\n")

# Example JSON-RPC envelope for tools/list (request id is illustrative).
jsonrpc_example = {'jsonrpc':'2.0','id':1,'result':tools_list_result}
(ROOT/'examples'/'mcp-tools-list.response.json').write_text(json.dumps(jsonrpc_example, indent=2, ensure_ascii=False)+"\n")

# OpenAPI components use shared schemas rewritten from local $defs refs -> components/schemas.
def oasify(x):
    if isinstance(x, dict):
        y={}
        for k,v in x.items():
            if k == '$ref' and isinstance(v,str) and v.startswith('#/$defs/'):
                y[k] = v.replace('#/$defs/','#/components/schemas/')
            else:
                y[k]=oasify(v)
        return y
    if isinstance(x,list): return [oasify(v) for v in x]
    return x

oas_components = {k:oasify(v) for k,v in schemas.items()}

# Common response builders.
def ref(name): return {'$ref':f'#/components/schemas/{name}'}
def rb(schema):
    return {'required':True,'content':{'application/json':{'schema':schema}}}
def resp(desc, schema=None, code='200'):
    r={'description':desc}
    if schema is not None: r['content']={'application/json':{'schema':schema}}
    return {code:r, '400':{'description':'Invalid request','content':{'application/json':{'schema':ref('ErrorEnvelope')}}}, '404':{'description':'Resource not found','content':{'application/json':{'schema':ref('ErrorEnvelope')}}}, '409':{'description':'Conflict','content':{'application/json':{'schema':ref('ErrorEnvelope')}}}, '500':{'description':'Internal error','content':{'application/json':{'schema':ref('ErrorEnvelope')}}}}

def op(operation_id, summary, tag, method='post', request_schema=None, response_schema=None, path_params=None, query_params=None, response_code='200'):
    o={'operationId':operation_id,'summary':summary,'tags':[tag]}
    params=[]
    for p in path_params or []:
        params.append({'name':p,'in':'path','required':True,'schema':string()})
    for name,schema in query_params or []:
        params.append({'name':name,'in':'query','required':False,'schema':schema})
    if params: o['parameters']=params
    if request_schema is not None: o['requestBody']=rb(request_schema)
    o['responses']=resp('Success', response_schema or obj({'ok':boolean()}, ['ok']), response_code)
    return {method:o}

paths={}
def add_path(path, block):
    if path in paths: paths[path].update(block)
    else: paths[path]=block

# Project paths
add_path('/projects', op('project.create','Create project','Projects','post', obj({'name':string(),'description':string()}, ['name']), obj({'project':ref('Project')}, ['project']), response_code='201'))
add_path('/projects', op('project.list','List projects','Projects','get', None, obj({'projects':arr(ref('Project')),'next_cursor':{'type':['string','null']}}, ['projects']), query_params=[('limit',integer(minimum=1,maximum=200)),('cursor',string())]))
add_path('/projects/{project_id}', op('project.get','Get project','Projects','get', None, obj({'project':ref('Project')}, ['project']), path_params=['project_id']))
add_path('/projects/{project_id}', op('project.update','Update project','Projects','patch', obj({'name':string(),'description':string()}), obj({'project':ref('Project')}, ['project']), path_params=['project_id']))

# Map MCP tools to REST actions for the remaining operations. This is explicit so operationIds match tool names.
rest = [
('/characters/specs','post','character.create_spec','Create character spec','Character',create_spec_input,obj({'spec':ref('CharacterSpec')},['spec']),[]),
('/characters/{character_id}/spec','get','character.get_spec','Get character spec','Character',None,obj({'spec':ref('CharacterSpec')},['spec']),['character_id']),
('/characters/{character_id}/spec','patch','character.update_spec','Update character spec','Character',obj({'patch':obj(additional=True),'expected_asset_version':integer(minimum=1)},['patch']),obj({'spec':ref('CharacterSpec')},['spec']),['character_id']),
('/characters/{character_id}/spec:validate','post','character.validate_spec','Validate character spec','Character',obj({},[]),validation_out,['character_id']),
('/profiles/styles','get','profile.list_style_profiles','List style profiles','Profiles',None,obj({'profiles':arr(obj({'id':string(),'version':string(),'name':string(),'description':string()},['id','version','name']))},['profiles']),[]),
('/profiles/rigs','get','profile.list_rig_presets','List rig presets','Profiles',None,obj({'profiles':arr(obj({'id':string(),'version':string(),'name':string(),'description':string()},['id','version','name']))},['profiles']),[]),
('/profiles/motions','get','profile.list_motion_presets','List motion presets','Profiles',None,obj({'profiles':arr(obj({'id':string(),'version':string(),'name':string(),'description':string()},['id','version','name']))},['profiles']),[]),
('/characters/{character_id}/base-views:generate','post','character.generate_base_views','Generate base views','Generation',obj({'views':arr(enum(DIRECTIONS),minItems=1,uniqueItems=True),'regenerate':boolean(),'seed':integer()},['views']),obj({'job':ref('Job')},['job']),['character_id']),
('/characters/{character_id}/base-views:prepare','post','character.prepare_base_views','Prepare base views for ChatGPT Web','Generation',obj({'views':arr(enum(BASE_VIEWS),minItems=1,uniqueItems=True)},[]),obj({'generation':ref('BaseViewGeneration')},['generation']),['character_id']),
('/characters/{character_id}/base-views/{direction}:ingest','post','character.ingest_base_view','Ingest ChatGPT Web base view','Generation',obj({'generation_id':string(pattern='^gen_[A-Za-z0-9_-]+$'),'image_data_url':string(pattern='^data:image/png;base64,'),'provider':string(),'model':string(),'replace':boolean()},['generation_id','image_data_url']),obj({'view':ref('BaseView')},['view']),['character_id','direction']),
('/characters/{character_id}/base-views','get','character.get_base_views','Get base views','Generation',None,obj({'character_id':string(),'views':arr(ref('BaseView'))},['character_id','views']),['character_id']),
('/characters/{character_id}/base-views:validate','post','character.validate_base_views','Validate base views','Generation',obj({},[]),obj({'validation':ref('BaseViewValidation')},['validation']),['character_id']),
('/characters/{character_id}/base-views:mirror','post','character.generate_mirrored_views','Generate mirrored views','Generation',obj({'mirror_pairs':arr(mirror_pair,minItems=1)},['mirror_pairs']),obj({'job':ref('Job')},['job']),['character_id']),
('/characters/{character_id}/base-views/{direction}:regenerate','post','character.regenerate_view','Regenerate one view','Generation',obj({'seed':integer(),'reason':string()},[]),obj({'job':ref('Job')},['job']),['character_id','direction']),
('/characters/{character_id}/parts:auto-segment','post','parts.auto_segment','Auto segment parts','Parts',obj({'source_direction':enum(BASE_VIEWS),'part_template':string(),'mode':enum(['auto','hybrid'])},['source_direction','part_template']),obj({'job':ref('Job')},['job']),['character_id']),
('/characters/{character_id}/parts','get','parts.list','List parts','Parts',None,obj({'parts':arr(ref('PartAsset'))},['parts']),['character_id']),
('/parts/{part_id}','get','parts.get','Get part','Parts',None,obj({'part':ref('PartAsset')},['part']),['part_id']),
('/parts/{part_id}/mask','put','parts.update_mask','Update part mask','Parts',obj({'mask':mask_schema},['mask']),obj({'part':ref('PartAsset')},['part']),['part_id']),
('/parts/{part_id}/approval','put','parts.approve','Approve part','Parts',obj({'approved':boolean()},['approved']),obj({'part':ref('PartAsset')},['part']),['part_id']),
('/parts/{part_id}','delete','parts.delete','Delete part','Parts',None,ack_out,['part_id']),
('/characters/{character_id}/parts','post','parts.create_manual','Create manual part','Parts',obj({'direction':enum(DIRECTIONS),'name':string(),'category':enum(['body_part','hair','equipment','shadow','fx','custom']),'image_asset_id':string(),'pivot':vec2},['direction','name','category','image_asset_id','pivot']),obj({'part':ref('PartAsset')},['part']),['character_id']),
('/characters/{character_id}/rig','post','rig.create','Create rig','Rig',obj({'rig_preset':string(),'auto_bind':boolean()},['rig_preset']),obj({'rig':ref('Rig')},['rig']),['character_id']),
('/characters/{character_id}/rig','get','rig.get','Get rig','Rig',None,obj({'rig':ref('Rig')},['rig']),['character_id']),
('/rigs/{rig_id}/bones','get','rig.list_bones','List bones','Rig',None,obj({'bones':arr(ref('Bone'))},['bones']),['rig_id']),
('/rigs/{rig_id}/bones/{bone_name}','patch','rig.update_bone','Update bone','Rig',obj({'patch':obj(additional=True)},['patch']),obj({'rig':ref('Rig')},['rig']),['rig_id','bone_name']),
('/rigs/{rig_id}:auto-bind','post','rig.auto_bind_parts','Auto bind parts','Rig',obj({'overwrite_existing':boolean()},[]),obj({'rig':ref('Rig'),'bound_part_ids':arr(string()),'unbound_part_ids':arr(string())},['rig','bound_part_ids','unbound_part_ids']),['rig_id']),
('/rigs/{rig_id}/bindings/{part_id}','put','rig.update_binding','Update binding','Rig',obj({'bone_name':string(),'pivot':vec2,'offset':transform2d,'weight_mode':enum(['rigid','weighted'])},['bone_name']),obj({'rig':ref('Rig')},['rig']),['rig_id','part_id']),
('/rigs/{rig_id}/sockets','post','rig.add_socket','Add socket','Rig',obj({'socket_name':string(),'bone_name':string(),'offset':transform2d,'slot_type':enum(SLOTS)},['socket_name','bone_name','slot_type']),obj({'rig':ref('Rig')},['rig']),['rig_id']),
('/rigs/{rig_id}/sockets/{socket_name}','patch','rig.update_socket','Update socket','Rig',obj({'patch':obj(additional=True)},['patch']),obj({'rig':ref('Rig')},['rig']),['rig_id','socket_name']),
('/rigs/{rig_id}:validate','post','rig.validate','Validate rig','Rig',obj({},[]),validation_out,['rig_id']),
('/characters/{character_id}/directions','post','direction.create_profiles','Create direction profiles','Directions',obj({'directions':arr(enum(DIRECTIONS),minItems=1,uniqueItems=True),'mirror_rules':arr(mirror_pair)},['directions']),obj({'profiles':arr(ref('DirectionProfile'))},['profiles']),['character_id']),
('/characters/{character_id}/directions/{direction}','get','direction.get_profile','Get direction profile','Directions',None,obj({'profile':ref('DirectionProfile')},['profile']),['character_id','direction']),
('/characters/{character_id}/directions/{direction}','patch','direction.update_profile','Update direction profile','Directions',obj({'patch':obj(additional=True)},['patch']),obj({'profile':ref('DirectionProfile')},['profile']),['character_id','direction']),
('/characters/{character_id}/directions/{target}:copy','post','direction.copy_profile','Copy direction profile','Directions',obj({'source':enum(DIRECTIONS),'mirror_horizontal':boolean()},['source']),obj({'profile':ref('DirectionProfile')},['profile']),['character_id','target']),
('/characters/{character_id}/directions/{direction}:draw-order','post','direction.auto_generate_draw_order','Auto-generate draw order','Directions',obj({'apply':boolean()},[]),obj({'direction':enum(DIRECTIONS),'draw_order':arr(string()),'applied':boolean()},['direction','draw_order','applied']),['character_id','direction']),
('/characters/{character_id}/directions:validate','post','direction.validate','Validate directions','Directions',obj({'directions':arr(enum(DIRECTIONS),uniqueItems=True)},[]),validation_out,['character_id']),
('/characters/{character_id}/animations','post','animation.create_clip','Create animation clip','Animation',obj({'name':enum(ANIMATIONS),'duration_sec':number(exclusiveMinimum=0),'loop':boolean()},['name','duration_sec','loop']),obj({'clip':ref('AnimationClip')},['clip']),['character_id']),
('/characters/{character_id}/animations:apply-preset','post','animation.apply_preset','Apply animation preset','Animation',obj({'preset_name':string(),'animations':arr(enum(ANIMATIONS),minItems=1,uniqueItems=True),'overwrite':boolean()},['preset_name','animations']),obj({'clips':arr(ref('AnimationClip'))},['clips']),['character_id']),
('/animations/{animation_id}','get','animation.get_clip','Get animation clip','Animation',None,obj({'clip':ref('AnimationClip')},['clip']),['animation_id']),
('/animations/{animation_id}/tracks/{bone_name}','put','animation.update_track','Update animation track','Animation',obj({'track':arr(ref('Keyframe'),minItems=1)},['track']),obj({'clip':ref('AnimationClip')},['clip']),['animation_id','bone_name']),
('/animations/{animation_id}/events','put','animation.set_event_markers','Set animation events','Animation',obj({'events':arr(ref('AnimationEvent'))},['events']),obj({'clip':ref('AnimationClip')},['clip']),['animation_id']),
('/animations/{animation_id}/directions','put','animation.assign_direction_profiles','Assign animation directions','Animation',obj({'directions':arr(enum(DIRECTIONS),minItems=1,uniqueItems=True)},['directions']),obj({'clip':ref('AnimationClip')},['clip']),['animation_id']),
('/animations/{animation_id}:validate','post','animation.validate','Validate animation','Animation',obj({},[]),validation_out,['animation_id']),
('/animations/{animation_id}:duplicate','post','animation.duplicate','Duplicate animation','Animation',obj({'new_name':enum(ANIMATIONS)},['new_name']),obj({'clip':ref('AnimationClip')},['clip']),['animation_id']),
('/animations/{animation_id}','delete','animation.delete','Delete animation','Animation',None,ack_out,['animation_id']),
('/characters/{character_id}/equipment:attach','post','equipment.attach_item','Attach equipment','Equipment',obj({'slot':enum(SLOTS),'item_id':string(),'socket_name':string()},['slot','item_id','socket_name']),obj({'attachment':ref('Attachment')},['attachment']),['character_id']),
('/characters/{character_id}/equipment/{slot}','delete','equipment.detach_item','Detach equipment','Equipment',None,ack_out,['character_id','slot']),
('/equipment','get','equipment.list_items','List equipment items','Equipment',None,obj({'items':arr(ref('EquipmentItem'))},['items']),[]),
('/equipment','post','equipment.create_item_spec','Create equipment item spec','Equipment',obj({'item_id':string(),'name':string(),'slot':enum(SLOTS),'style_profile':string(),'metadata':obj(additional=True)},['item_id','name','slot','style_profile']),obj({'item':ref('EquipmentItem')},['item']),[]),
('/equipment/{item_id}:generate','post','equipment.generate_item_image','Generate equipment image','Equipment',obj({'views':arr(enum(DIRECTIONS),minItems=1,uniqueItems=True),'seed':integer()},['views']),obj({'job':ref('Job')},['job']),['item_id']),
('/characters/{character_id}/equipment/{slot}:validate','post','equipment.validate_attachment','Validate equipment attachment','Equipment',obj({},[]),validation_out,['character_id','slot']),
('/characters/{character_id}/preview:pose','post','preview.render_pose','Render pose preview','Preview',obj({'direction':enum(DIRECTIONS),'animation_id':string(),'time_sec':number(minimum=0),'include_equipment':boolean(),'format':enum(['png','webp'])},['direction']),obj({'job':ref('Job')},['job']),['character_id']),
('/characters/{character_id}/preview:animation','post','preview.render_animation','Render animation preview','Preview',obj({'animation_id':string(),'direction':enum(DIRECTIONS),'format':enum(['gif','webp','mp4','spritesheet']),'fps':integer(minimum=1,maximum=120),'include_equipment':boolean()},['animation_id','direction','format']),obj({'job':ref('Job')},['job']),['character_id']),
('/characters/{character_id}/preview:all-directions','post','preview.render_all_directions','Render all directions','Preview',obj({'animation_id':string(),'format':enum(['contact_sheet','gif','webp','mp4']),'fps':integer(minimum=1,maximum=120),'include_equipment':boolean()},['animation_id','format']),obj({'job':ref('Job')},['job']),['character_id']),
('/characters/{character_id}:qc','post','validation.run_character_qc','Run character QC','Validation',obj({'checks':arr(enum(['spec','parts','rig','direction_profiles','animations','equipment','export_readiness']),uniqueItems=True)},[]),obj({'result':ref('QCResult')},['result']),['character_id']),
('/characters/{character_id}:export','post','export.character_package','Export character package','Export',obj({'format':enum(['character-asset-v1','runtime-bundle-v1','spritesheet-bundle-v1']),'include_previews':boolean(),'include_source_parts':boolean(),'include_mirrored_views':boolean()},['format']),obj({'job':ref('Job')},['job']),['character_id']),
('/exports/{package_id}','get','export.get_package','Get export package','Export',None,obj({'package':ref('ExportPackage')},['package']),['package_id']),
('/jobs/{job_id}','get','job.get','Get job','Jobs',None,obj({'job':ref('Job')},['job']),['job_id']),
('/jobs','get','job.list','List jobs','Jobs',None,obj({'jobs':arr(ref('Job'))},['jobs']),[]),
('/jobs/{job_id}:cancel','post','job.cancel','Cancel job','Jobs',obj({},[]),obj({'job':ref('Job')},['job']),['job_id'])
]

for path,method,opid,summary,tag,reqs,ress,params in rest:
    add_path(path, op(opid,summary,tag,method,reqs,ress,path_params=params))

# Tighten the canonical direction path parameter for ChatGPT Web ingestion.
for parameter in paths['/characters/{character_id}/base-views/{direction}:ingest']['post'].get('parameters', []):
    if parameter['name'] == 'direction':
        parameter['schema'] = enum(BASE_VIEWS)

# Query filters that are represented as MCP arguments but travel in the URL for REST.
paths['/characters/{character_id}/parts']['get'].setdefault('parameters', []).extend([
    {'name':'direction','in':'query','required':False,'schema':enum(DIRECTIONS)},
    {'name':'approved_only','in':'query','required':False,'schema':boolean(default=False)}
])
paths['/equipment']['get'].setdefault('parameters', []).extend([
    {'name':'slot','in':'query','required':False,'schema':enum(SLOTS)},
    {'name':'style_profile','in':'query','required':False,'schema':string()},
    {'name':'limit','in':'query','required':False,'schema':integer(minimum=1,maximum=200,default=50)}
])
paths['/jobs']['get'].setdefault('parameters', []).extend([
    {'name':'status','in':'query','required':False,'schema':enum(JOB_STATUSES)},
    {'name':'operation','in':'query','required':False,'schema':string()},
    {'name':'resource_id','in':'query','required':False,'schema':string()},
    {'name':'limit','in':'query','required':False,'schema':integer(minimum=1,maximum=200,default=50)}
])

openapi = {
    'openapi':'3.2.1',
    '$self':'https://character-asset.local/openapi/character-asset.openapi.json',
    'jsonSchemaDialect':OAS_DIALECT,
    'info':{
        'title':'Character-Asset API',
        'version':VERSION,
        'description':'REST API for spec-driven 2.5D character generation, segmentation, rigging, 8-direction profiles, animation, equipment, preview, QC and export.'
    },
    'servers':[{'url':'http://localhost:8787','description':'Local development'}],
    'tags':[{'name':n} for n in ['Projects','Character','Profiles','Generation','Parts','Rig','Directions','Animation','Equipment','Preview','Validation','Export','Jobs']],
    'paths':paths,
    'components':{
        'schemas':oas_components,
        'securitySchemes':{
            'bearerAuth':{'type':'http','scheme':'bearer','bearerFormat':'JWT'}
        }
    },
    'security':[]
}
(ROOT/'openapi'/'character-asset.openapi.json').write_text(json.dumps(openapi, indent=2, ensure_ascii=False)+"\n")

# Manifest describing the contract set.
manifest={
    'project':'Character-Asset','version':VERSION,
    'standards':{
        'openapi':'3.2.1','openapiDialect':OAS_DIALECT,
        'mcpProtocolRevision':'2026-07-28','jsonSchema':'2020-12'
    },
    'counts':{'mcpTools':len(TOOLS),'openapiPaths':len(paths),'sharedSchemas':len(standalone_map)},
    'files':{
        'openapi':'openapi/character-asset.openapi.json',
        'mcpCatalog':'mcp/character-asset.mcp-tools.json',
        'mcpToolsListResult':'mcp/tools-list.result.json',
        'schemas':sorted(standalone_map.keys())
    },
    'implementation':{
        'runtime':'node>=22',
        'serverEntry':'src/index.mjs',
        'defaultAddress':'http://127.0.0.1:8787',
        'mcpEndpoint':'/mcp',
        'transport':'stateless-http-json-rpc',
        'storage':'atomic-json-files',
        'implementedTools':[
            'project.create','character.create_spec','character.get_spec',
            'character.prepare_base_views','character.ingest_base_view',
            'character.get_base_views','character.validate_base_views','rig.create'
        ]
    }
}
(ROOT/'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False)+"\n")

readme=f'''# Character-Asset

Character-Asset is a spec-first foundation for reusable 2.5D characters with 8-direction movement, bone rigs, and a ChatGPT Web-first image workflow.

## Runnable MCP Server V1

Executable tools in {VERSION}:

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
- `GET /characters/{{character_id}}/spec`
- `POST /characters/{{character_id}}/base-views:prepare`
- `POST /characters/{{character_id}}/base-views/{{direction}}:ingest`
- `GET /characters/{{character_id}}/base-views`
- `POST /characters/{{character_id}}/base-views:validate`
- `POST /characters/{{character_id}}/rig`

## Standards and contracts

- OpenAPI: 3.2.1
- OpenAPI Schema dialect: {OAS_DIALECT}
- MCP protocol target: 2026-07-28
- MCP tool input/output schemas: JSON Schema Draft 2020-12

The full catalog also keeps `character.generate_base_views` as a planned server-side/provider automation path. It is not executable in the current ChatGPT Web-first runtime.
'''
(ROOT/'README.md').write_text(readme)

print(json.dumps(manifest, indent=2))
