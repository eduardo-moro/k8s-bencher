import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigFiles, AppDetail } from './configFiles.js';
import { NotFoundError, ConflictError } from './errors.js';

let repoRoot: string;
let configFiles: ConfigFiles;

const sampleDetail: AppDetail = {
  name: 'myapp',
  container: 'myapp',
  resources: { memory: ['128Mi', '256Mi'], cpu: ['100m', '250m'] },
  load: { vus: 10, stages: [{ duration: '10s', target: 10 }] },
  manifestContent: 'kind: Deployment\nmetadata:\n  name: myapp\n',
  scriptContent: "import http from 'k6/http';\nexport default function () { http.get('http://myapp'); }\n",
};

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'perftest-api-test-'));
  await fs.mkdir(path.join(repoRoot, 'configs'), { recursive: true });
  await fs.mkdir(path.join(repoRoot, 'manifests'), { recursive: true });
  await fs.mkdir(path.join(repoRoot, 'loadtest'), { recursive: true });
  await fs.mkdir(path.join(repoRoot, 'templates'), { recursive: true });
  configFiles = new ConfigFiles(repoRoot);
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

describe('ConfigFiles', () => {
  it('listApps returns [] when configs/ is empty', async () => {
    expect(await configFiles.listApps()).toEqual([]);
  });

  it('createApp writes config/manifest/script with matching names, listApps and getApp reflect it', async () => {
    await configFiles.createApp(sampleDetail);

    const summaries = await configFiles.listApps();
    expect(summaries).toEqual([
      { name: 'myapp', container: 'myapp', resources: sampleDetail.resources },
    ]);

    const detail = await configFiles.getApp('myapp');
    expect(detail).toEqual(sampleDetail);

    const manifestOnDisk = await fs.readFile(path.join(repoRoot, 'manifests/myapp.yaml'), 'utf8');
    expect(manifestOnDisk).toBe(sampleDetail.manifestContent);
    const scriptOnDisk = await fs.readFile(path.join(repoRoot, 'loadtest/myapp.js'), 'utf8');
    expect(scriptOnDisk).toBe(sampleDetail.scriptContent);
  });

  it('createApp throws ConflictError if the app already exists', async () => {
    await configFiles.createApp(sampleDetail);
    await expect(configFiles.createApp(sampleDetail)).rejects.toThrow(ConflictError);
  });

  it('getApp throws NotFoundError for a missing app', async () => {
    await expect(configFiles.getApp('nope')).rejects.toThrow(NotFoundError);
  });

  it('updateApp updates only the fields provided, leaves the rest untouched', async () => {
    await configFiles.createApp(sampleDetail);

    const updated = await configFiles.updateApp('myapp', {
      resources: { memory: ['512Mi'], cpu: ['500m'] },
    });

    expect(updated.resources).toEqual({ memory: ['512Mi'], cpu: ['500m'] });
    expect(updated.container).toBe('myapp');
    expect(updated.manifestContent).toBe(sampleDetail.manifestContent);
  });

  it('updateApp writes new manifestContent/scriptContent when provided', async () => {
    await configFiles.createApp(sampleDetail);

    const updated = await configFiles.updateApp('myapp', {
      manifestContent: 'kind: Deployment\nmetadata:\n  name: myapp-v2\n',
    });

    expect(updated.manifestContent).toBe('kind: Deployment\nmetadata:\n  name: myapp-v2\n');
    expect(updated.scriptContent).toBe(sampleDetail.scriptContent);
  });

  it('deleteApp removes all three files', async () => {
    await configFiles.createApp(sampleDetail);
    await configFiles.deleteApp('myapp');

    await expect(configFiles.getApp('myapp')).rejects.toThrow(NotFoundError);
    await expect(fs.access(path.join(repoRoot, 'manifests/myapp.yaml'))).rejects.toThrow();
    await expect(fs.access(path.join(repoRoot, 'loadtest/myapp.js'))).rejects.toThrow();
  });

  it('deleteApp throws NotFoundError for a missing app', async () => {
    await expect(configFiles.deleteApp('nope')).rejects.toThrow(NotFoundError);
  });

  it('getTemplateExample reads from templates/', async () => {
    await fs.writeFile(
      path.join(repoRoot, 'templates/config.example.yaml'),
      'name: httpbin-example\nmanifest: manifests/httpbin.yaml\ncontainer: httpbin\nscript: loadtest/httpbin.js\nresources:\n  memory: [128Mi]\n  cpu: [100m]\nload:\n  vus: 15\n  stages:\n    - {duration: 10s, target: 15}\n'
    );
    await fs.writeFile(path.join(repoRoot, 'templates/manifest.example.yaml'), 'kind: Deployment\n');
    await fs.writeFile(path.join(repoRoot, 'templates/loadtest.example.js'), "export default function(){}\n");

    const template = await configFiles.getTemplateExample();
    expect(template.name).toBe('httpbin-example');
    expect(template.container).toBe('httpbin');
    expect(template.manifestContent).toBe('kind: Deployment\n');
    expect(template.scriptContent).toBe('export default function(){}\n');
  });

  it('reads templates from a separate engineRoot when provided', async () => {
    const engineRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'perftest-api-test-engine-'));
    await fs.mkdir(path.join(engineRoot, 'templates'), { recursive: true });
    await fs.writeFile(
      path.join(engineRoot, 'templates/config.example.yaml'),
      'name: httpbin-example\nmanifest: manifests/httpbin.yaml\ncontainer: httpbin\nscript: loadtest/httpbin.js\nresources:\n  memory: [128Mi]\n  cpu: [100m]\nload:\n  vus: 15\n  stages:\n    - {duration: 10s, target: 15}\n'
    );
    await fs.writeFile(path.join(engineRoot, 'templates/manifest.example.yaml'), 'kind: Deployment\n');
    await fs.writeFile(path.join(engineRoot, 'templates/loadtest.example.js'), 'export default function(){}\n');

    const splitConfigFiles = new ConfigFiles(repoRoot, engineRoot);
    const template = await splitConfigFiles.getTemplateExample();
    expect(template.name).toBe('httpbin-example');

    await fs.rm(engineRoot, { recursive: true, force: true });
  });
});
