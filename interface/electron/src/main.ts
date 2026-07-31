import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import { readSettings, writeSettings, Settings } from './settings.js';
import { runRequirementsCheck } from './requirements.js';

const PORT = 8026;
// In development this file runs from interface/electron/dist/main.js, so
// the repo root is four directories up. In a packaged build, electron-builder
// places bundled engine/API/frontend files under process.resourcesPath
// (see Task 13's extraResources config) instead - both cases are handled
// here so `npm start` in this folder works against the real repo during
// development without needing a full package first.
const isPackaged = app.isPackaged;
const engineRoot = isPackaged
  ? path.join(process.resourcesPath, 'engine')
  : path.resolve(__dirname, '..', '..', '..');
const apiEntry = isPackaged
  ? path.join(process.resourcesPath, 'api', 'server.js')
  : path.resolve(__dirname, '..', '..', 'API', 'dist', 'server.js');

let mainWindow: BrowserWindow | null = null;
let apiProcess: ChildProcess | null = null;

function userDataDir(): string {
  return app.getPath('userData');
}

function startApiProcess(dataRoot: string): void {
  if (apiProcess) {
    apiProcess.kill();
    apiProcess = null;
  }
  apiProcess = spawn(process.execPath, [apiEntry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(PORT),
      ENGINE_ROOT: engineRoot,
      DATA_ROOT: dataRoot,
    },
  });
  apiProcess.stdout?.on('data', (chunk) => console.log(`[api] ${chunk}`));
  apiProcess.stderr?.on('data', (chunk) => console.error(`[api] ${chunk}`));
  // An unhandled 'error' on a ChildProcess (e.g. the spawn itself failing)
  // would otherwise throw inside Electron's main process and can take the
  // whole app down - waitForApiHealth's own timeout already surfaces a
  // user-visible error page, so this only needs to keep the crash contained.
  apiProcess.on('error', (err) => console.error('[api] failed to start:', err));
}

function waitForApiHealth(retries = 30): Promise<void> {
  return new Promise((resolve, reject) => {
    const attempt = (remaining: number) => {
      fetch(`http://localhost:${PORT}/health`)
        .then(() => resolve())
        .catch(() => {
          if (remaining <= 0) {
            reject(new Error('A API não respondeu a tempo'));
            return;
          }
          setTimeout(() => attempt(remaining - 1), 500);
        });
    };
    attempt(retries);
  });
}

function loadBootstrap(): void {
  mainWindow!.loadFile(path.join(__dirname, '..', 'renderer', 'bootstrap.html'));
}

async function loadMainApp(): Promise<void> {
  try {
    await waitForApiHealth();
    mainWindow!.loadURL(`http://localhost:${PORT}`);
  } catch (err) {
    mainWindow!.loadURL(
      `data:text/html,<pre style="color:red;font-family:monospace;padding:2rem">${encodeURIComponent(
        String(err)
      )}</pre>`
    );
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle('pick-data-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('save-data-root', async (_event, dataRoot: string) => {
    const settings: Settings = { dataRoot };
    writeSettings(userDataDir(), settings);
  });

  ipcMain.handle('get-data-root', async () => {
    return readSettings(userDataDir())?.dataRoot ?? '';
  });

  ipcMain.handle('set-data-root', async (_event, dataRoot: string) => {
    writeSettings(userDataDir(), { dataRoot });
    startApiProcess(dataRoot);
    await waitForApiHealth();
  });

  ipcMain.handle('run-requirements-check', async () => {
    const result = await runRequirementsCheck(engineRoot);
    if (result.ready) {
      const settings = readSettings(userDataDir());
      if (settings) {
        startApiProcess(settings.dataRoot);
        await loadMainApp();
      }
    }
    return result;
  });
}

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  registerIpcHandlers();

  const settings = readSettings(userDataDir());
  if (settings) {
    startApiProcess(settings.dataRoot);
    void loadMainApp();
  } else {
    loadBootstrap();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      app.whenReady();
    }
  });
});

app.on('window-all-closed', () => {
  if (apiProcess) apiProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (apiProcess) apiProcess.kill();
});
