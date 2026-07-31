import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  pickDataFolder: () => ipcRenderer.invoke('pick-data-folder'),
  saveDataRoot: (path: string) => ipcRenderer.invoke('save-data-root', path),
  getDataRoot: () => ipcRenderer.invoke('get-data-root'),
  setDataRoot: (path: string) => ipcRenderer.invoke('set-data-root', path),
  runRequirementsCheck: () => ipcRenderer.invoke('run-requirements-check'),
});
