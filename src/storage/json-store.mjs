import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export class JsonStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  async appendMcpLog(entry) {
    const path = join(this.rootDir, 'logs', 'mcp.jsonl');
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  projectPath(projectId) {
    return join(this.rootDir, 'projects', `${projectId}.json`);
  }

  characterDir(characterId) {
    return join(this.rootDir, 'characters', characterId);
  }

  specPath(characterId) {
    return join(this.characterDir(characterId), 'spec.json');
  }

  rigPath(characterId) {
    return join(this.characterDir(characterId), 'rig.json');
  }

  baseViewGenerationPath(characterId, generationId) {
    return join(this.characterDir(characterId), 'base_view_generations', `${generationId}.json`);
  }

  baseViewMetaPath(characterId, direction) {
    return join(this.characterDir(characterId), 'base_views', `${direction}.json`);
  }

  baseViewImagePath(characterId, direction) {
    return join(this.characterDir(characterId), 'base_views', `${direction}.png`);
  }

  partDir(characterId, direction, partName) {
    return join(this.characterDir(characterId), 'parts', direction, partName);
  }

  partMetaPath(characterId, direction, partName) {
    return join(this.partDir(characterId, direction, partName), 'part.json');
  }

  partArtifactPath(characterId, direction, partName, kind) {
    return join(this.partDir(characterId, direction, partName), kind === 'mask' ? 'mask.png' : 'cutout.png');
  }

  async read(path) {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async readBuffer(path) {
    try {
      return await readFile(path);
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async write(path, value) {
    await mkdir(dirname(path), { recursive: true });
    const tempPath = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await rename(tempPath, path);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
    return value;
  }

  async writeBuffer(path, value) {
    await mkdir(dirname(path), { recursive: true });
    const tempPath = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(tempPath, value);
      await rename(tempPath, path);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  getProject(projectId) {
    return this.read(this.projectPath(projectId));
  }

  saveProject(project) {
    return this.write(this.projectPath(project.project_id), project);
  }

  getCharacterSpec(characterId) {
    return this.read(this.specPath(characterId));
  }

  saveCharacterSpec(spec) {
    return this.write(this.specPath(spec.character_id), spec);
  }

  getRig(characterId) {
    return this.read(this.rigPath(characterId));
  }

  saveRig(rig) {
    return this.write(this.rigPath(rig.character_id), rig);
  }

  async findRigById(rigId) {
    for (const characterId of await this.listCharacterIds()) {
      const rig = await this.getRig(characterId);
      if (rig?.rig_id === rigId) return rig;
    }
    return null;
  }

  getBaseViewGeneration(characterId, generationId) {
    return this.read(this.baseViewGenerationPath(characterId, generationId));
  }

  saveBaseViewGeneration(generation) {
    return this.write(this.baseViewGenerationPath(generation.character_id, generation.generation_id), generation);
  }

  getBaseView(characterId, direction) {
    return this.read(this.baseViewMetaPath(characterId, direction));
  }

  getBaseViewImage(characterId, direction) {
    return this.readBuffer(this.baseViewImagePath(characterId, direction));
  }

  async saveBaseView(characterId, direction, metadata, bytes) {
    await this.writeBuffer(this.baseViewImagePath(characterId, direction), bytes);
    await this.write(this.baseViewMetaPath(characterId, direction), metadata);
    return metadata;
  }

  async listBaseViews(characterId) {
    const dir = join(this.characterDir(characterId), 'base_views');
    let names;
    try {
      names = await readdir(dir);
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    const views = [];
    for (const name of names.filter((value) => value.endsWith('.json'))) {
      const value = await this.read(join(dir, name));
      if (value) views.push(value);
    }
    return views;
  }

  getPartByName(characterId, direction, partName) {
    return this.read(this.partMetaPath(characterId, direction, partName));
  }

  async savePart(part, cutoutBytes, maskBytes) {
    const { character_id: characterId, direction, name } = part;
    await this.writeBuffer(this.partArtifactPath(characterId, direction, name, 'cutout'), cutoutBytes);
    await this.writeBuffer(this.partArtifactPath(characterId, direction, name, 'mask'), maskBytes);
    await this.write(this.partMetaPath(characterId, direction, name), part);
    return part;
  }

  async savePartMetadata(part) {
    return this.write(this.partMetaPath(part.character_id, part.direction, part.name), part);
  }

  getPartArtifact(part, kind) {
    return this.readBuffer(this.partArtifactPath(part.character_id, part.direction, part.name, kind));
  }

  async listParts(characterId, direction = null) {
    const root = join(this.characterDir(characterId), 'parts');
    let directions;
    try {
      directions = direction ? [direction] : await readdir(root);
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }

    const parts = [];
    for (const directionName of directions) {
      const directionDir = join(root, directionName);
      let names;
      try {
        names = await readdir(directionDir);
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      for (const name of names) {
        const value = await this.read(join(directionDir, name, 'part.json'));
        if (value) parts.push(value);
      }
    }
    return parts;
  }

  async findPart(partId) {
    for (const characterId of await this.listCharacterIds()) {
      const parts = await this.listParts(characterId);
      const part = parts.find((value) => value.part_id === partId);
      if (part) return part;
    }
    return null;
  }

  async listCharacterIds() {
    const root = join(this.rootDir, 'characters');
    try {
      return await readdir(root);
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }
}
