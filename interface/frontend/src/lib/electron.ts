export interface ElectronAPI {
  pickDataFolder: () => Promise<string | null>;
  getDataRoot: () => Promise<string>;
  setDataRoot: (path: string) => Promise<void>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export function isElectron(): boolean {
  return typeof window !== "undefined" && window.electronAPI !== undefined;
}
