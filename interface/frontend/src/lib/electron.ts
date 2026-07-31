export interface ElectronAPI {
  pickDataFolder: () => Promise<string | null>;
  getDataRoot: () => Promise<string>;
  setDataRoot: (path: string) => Promise<void>;
  // Used only by the standalone (untyped) bootstrap renderer
  // (interface/electron/renderer/bootstrap.js), not by this React app -
  // declared here anyway so this type describes the full preload bridge,
  // not just the subset this app happens to call.
  saveDataRoot: (path: string) => Promise<void>;
  runRequirementsCheck: () => Promise<{ ready: boolean; output: string }>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export function isElectron(): boolean {
  return typeof window !== "undefined" && window.electronAPI !== undefined;
}
