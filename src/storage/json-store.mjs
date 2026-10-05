import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export class JsonStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  projectPath(projectId) {
    return join(this.rootDir, 'projects', `${projectId}.json`);
  }

  specPath(characterId) {
    return join(this.rootDir, 'characters', characterId, 'spec.json');
  }

  rigPath(characterId) {
    return join(this.rootDir, 'characters', characterId, 'rig.json');
  }

  baseViewGenerationPath(characterId, generationId) {
    return join(this.rootDir, 'characters', characterId, 'base_view_generations', `${generationId}.json`);
  }

  baseViewMetaPath(characterId, direction) {
    return join(this.rootDir, 'characters', characterId, 'base_views', `${direction}.json`);
  }

  baseViewImagePath(characterId, direction) {
    return join(this.rootDir, 'characters', characterId, 'base_views', `${direction}.png`);
  }

  async read(path) {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
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

  getBaseViewGeneration(characterId, generationId) {
    return this.read(this.baseViewGenerationPath(characterId, generationId));
  }

  saveBaseViewGeneration(generation) {
    return this.write(this.baseViewGenerationPath(generation.character_id, generation.generation_id), generation);
  }

  getBaseView(characterId, direction) {
    return this.read(this.baseViewMetaPath(characterId, direction));
  }

  async getBaseViewImage(characterId, direction) {
    try {
      return await readFile(this.baseViewImagePath(characterId, direction));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async saveBaseView(characterId, direction, metadata, bytes) {
    await this.writeBuffer(this.baseViewImagePath(characterId, direction), bytes);
    await this.write(this.baseViewMetaPath(characterId, direction), metadata);
    return metadata;
  }

  async listBaseViews(characterId) {
    const dir = join(this.rootDir, 'characters', characterId, 'base_views');
    let names;
    try {
      names = await readdir(dir);
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    const views = [];
    for (const name of names.filter((name) => name.endsWith('.json'))) {
      const value = await this.read(join(dir, name));
      if (value) views.push(value);
    }
    return views;
  }

}
