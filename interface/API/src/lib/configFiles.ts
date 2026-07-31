import { promises as fs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { NotFoundError, ConflictError } from './errors.js';

export interface StageConfig {
  duration: string;
  target: number;
}

export interface ResourcesConfig {
  memory: string[];
  cpu: string[];
}

export interface LoadConfig {
  vus: number;
  stages: StageConfig[];
}

export interface AppConfig {
  name: string;
  container: string;
  resources: ResourcesConfig;
  load: LoadConfig;
}

export interface AppDetail extends AppConfig {
  manifestContent: string;
  scriptContent: string;
}

export interface AppSummary {
  name: string;
  container: string;
  resources: ResourcesConfig;
}

interface RawConfigYaml {
  name: string;
  manifest: string;
  container: string;
  script: string;
  resources: ResourcesConfig;
  load: LoadConfig;
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, content, 'utf8');
  await fs.rename(tempPath, filePath);
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(
    () => true,
    () => false
  );
}

export class ConfigFiles {
  private engineRoot: string;

  constructor(private dataRoot: string, engineRoot?: string) {
    this.engineRoot = engineRoot ?? dataRoot;
  }

  private configPath(name: string): string {
    return path.join(this.dataRoot, 'configs', `${name}.yaml`);
  }

  async listApps(): Promise<AppSummary[]> {
    const configsDir = path.join(this.dataRoot, 'configs');
    let entries: string[];
    try {
      entries = await fs.readdir(configsDir);
    } catch {
      return [];
    }

    const summaries: AppSummary[] = [];
    for (const file of entries.filter((f) => f.endsWith('.yaml'))) {
      const raw = await fs.readFile(path.join(configsDir, file), 'utf8');
      const parsed = YAML.parse(raw) as RawConfigYaml;
      summaries.push({
        name: file.replace(/\.yaml$/, ''),
        container: parsed.container,
        resources: parsed.resources,
      });
    }
    return summaries;
  }

  async getApp(name: string): Promise<AppDetail> {
    const configFile = this.configPath(name);
    if (!(await fileExists(configFile))) {
      throw new NotFoundError(`App '${name}' not found`);
    }

    const raw = await fs.readFile(configFile, 'utf8');
    const parsed = YAML.parse(raw) as RawConfigYaml;
    const manifestContent = await fs.readFile(path.join(this.dataRoot, parsed.manifest), 'utf8');
    const scriptContent = await fs.readFile(path.join(this.dataRoot, parsed.script), 'utf8');

    return {
      name: parsed.name,
      container: parsed.container,
      resources: parsed.resources,
      load: parsed.load,
      manifestContent,
      scriptContent,
    };
  }

  async createApp(detail: AppDetail): Promise<void> {
    const configFile = this.configPath(detail.name);
    if (await fileExists(configFile)) {
      throw new ConflictError(`App '${detail.name}' already exists`);
    }

    const manifestRelPath = `manifests/${detail.name}.yaml`;
    const scriptRelPath = `loadtest/${detail.name}.js`;

    const rawConfig: RawConfigYaml = {
      name: detail.name,
      manifest: manifestRelPath,
      container: detail.container,
      script: scriptRelPath,
      resources: detail.resources,
      load: detail.load,
    };

    await fs.mkdir(path.join(this.dataRoot, 'manifests'), { recursive: true });
    await fs.mkdir(path.join(this.dataRoot, 'loadtest'), { recursive: true });
    await fs.mkdir(path.join(this.dataRoot, 'configs'), { recursive: true });

    await atomicWrite(path.join(this.dataRoot, manifestRelPath), detail.manifestContent);
    await atomicWrite(path.join(this.dataRoot, scriptRelPath), detail.scriptContent);
    await atomicWrite(configFile, YAML.stringify(rawConfig));
  }

  async updateApp(name: string, partial: Partial<AppDetail>): Promise<AppDetail> {
    const configFile = this.configPath(name);
    if (!(await fileExists(configFile))) {
      throw new NotFoundError(`App '${name}' not found`);
    }

    const raw = await fs.readFile(configFile, 'utf8');
    const parsed = YAML.parse(raw) as RawConfigYaml;

    if (partial.manifestContent !== undefined) {
      await atomicWrite(path.join(this.dataRoot, parsed.manifest), partial.manifestContent);
    }
    if (partial.scriptContent !== undefined) {
      await atomicWrite(path.join(this.dataRoot, parsed.script), partial.scriptContent);
    }

    const updatedRaw: RawConfigYaml = {
      ...parsed,
      container: partial.container ?? parsed.container,
      resources: partial.resources ?? parsed.resources,
      load: partial.load ?? parsed.load,
    };
    await atomicWrite(configFile, YAML.stringify(updatedRaw));

    return this.getApp(name);
  }

  async deleteApp(name: string): Promise<void> {
    const configFile = this.configPath(name);
    if (!(await fileExists(configFile))) {
      throw new NotFoundError(`App '${name}' not found`);
    }

    const raw = await fs.readFile(configFile, 'utf8');
    const parsed = YAML.parse(raw) as RawConfigYaml;

    await fs.rm(path.join(this.dataRoot, parsed.manifest), { force: true });
    await fs.rm(path.join(this.dataRoot, parsed.script), { force: true });
    await fs.rm(configFile, { force: true });
  }

  async getTemplateExample(): Promise<AppDetail> {
    const templatesDir = path.join(this.engineRoot, 'templates');
    const raw = await fs.readFile(path.join(templatesDir, 'config.example.yaml'), 'utf8');
    const parsed = YAML.parse(raw) as RawConfigYaml;
    const manifestContent = await fs.readFile(path.join(templatesDir, 'manifest.example.yaml'), 'utf8');
    const scriptContent = await fs.readFile(path.join(templatesDir, 'loadtest.example.js'), 'utf8');

    return {
      name: parsed.name,
      container: parsed.container,
      resources: parsed.resources,
      load: parsed.load,
      manifestContent,
      scriptContent,
    };
  }
}
