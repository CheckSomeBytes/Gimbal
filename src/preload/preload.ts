import { contextBridge, ipcRenderer } from 'electron';
import { AppConfig, IPC_CHANNELS, LinkCheckResult, BackupMetadata, BackupResult } from '../shared/types';

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Config operations
  loadConfig: (): Promise<AppConfig> => {
    return ipcRenderer.invoke(IPC_CHANNELS.LOAD_CONFIG);
  },

  saveConfig: (config: AppConfig): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SAVE_CONFIG, config);
  },

  exportConfig: (): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.EXPORT_CONFIG);
  },

  importConfig: (): Promise<AppConfig | null> => {
    return ipcRenderer.invoke(IPC_CHANNELS.IMPORT_CONFIG);
  },

  // Link operations
  fetchTitle: (url: string): Promise<string> => {
    return ipcRenderer.invoke(IPC_CHANNELS.FETCH_TITLE, url);
  },

  checkLink: (url: string): Promise<LinkCheckResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.CHECK_LINK, url);
  },

  checkAllLinks: (urls: string[]): Promise<LinkCheckResult[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.CHECK_ALL_LINKS, urls);
  },

  onLinkCheckResult: (callback: (result: LinkCheckResult) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, result: LinkCheckResult) => callback(result);
    ipcRenderer.on(IPC_CHANNELS.LINK_CHECK_RESULT, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.LINK_CHECK_RESULT, handler);
  },

  openInChrome: (url: string): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_IN_CHROME, url);
  },

  // Window operations
  focusAndPaste: (
    pattern: string,
    matchMode: 'exact' | 'contains' | 'regex',
    textToPaste: string,
    pressEnter: boolean = false
  ): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(
      IPC_CHANNELS.FOCUS_AND_PASTE,
      pattern,
      matchMode,
      textToPaste,
      pressEnter
    );
  },

  getAppPath: (): Promise<string> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_APP_PATH);
  },

  getWindowList: (): Promise<{ title: string; processName: string }[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_WINDOWS);
  },

  openCountdownTimer: (
    totalMinutes: number,
    message: string,
    theme: {
      background: string;
      text: string;
      textMuted: string;
      accent: string;
      success: string;
      danger: string;
      fontFamily: string;
      border?: string;
      textScale?: number;
    }
  ): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_COUNTDOWN_TIMER, totalMinutes, message, theme);
  },

  quitApp: (): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.QUIT_APP);
  },
  minimizeApp: (): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.MINIMIZE_APP);
  },

  // Auto-updater operations
  checkForUpdates: (): Promise<{
    updateAvailable: boolean;
    currentVersion: string;
    latestVersion?: string;
    isDev?: boolean;
    error?: string;
  }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.CHECK_FOR_UPDATES);
  },

  downloadUpdate: (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_UPDATE);
  },

  installUpdate: (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.INSTALL_UPDATE);
  },

  getAppVersion: (): Promise<string> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_APP_VERSION);
  },

  onUpdateAvailable: (callback: (info: { version: string; releaseNotes?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: { version: string; releaseNotes?: string }) => callback(info);
    ipcRenderer.on('update-available', handler);
    return () => ipcRenderer.removeListener('update-available', handler);
  },

  onDownloadProgress: (callback: (progress: { percent: number; transferred: number; total: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: { percent: number; transferred: number; total: number }) => callback(progress);
    ipcRenderer.on('download-progress', handler);
    return () => ipcRenderer.removeListener('download-progress', handler);
  },

  onUpdateDownloaded: (callback: (info: { version: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: { version: string }) => callback(info);
    ipcRenderer.on('update-downloaded', handler);
    return () => ipcRenderer.removeListener('update-downloaded', handler);
  },

  onUpdateError: (callback: (error: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: string) => callback(error);
    ipcRenderer.on('update-error', handler);
    return () => ipcRenderer.removeListener('update-error', handler);
  },

  // Backup operations
  createBackup: (): Promise<BackupResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.BACKUP_CREATE_MANUAL);
  },

  listBackups: (): Promise<BackupMetadata[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.BACKUP_LIST);
  },

  restoreBackup: (filepath: string): Promise<{ success: boolean; config?: AppConfig; error?: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.BACKUP_RESTORE, filepath);
  },

  deleteBackup: (filepath: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.BACKUP_DELETE, filepath);
  },

  selectBackupDirectory: (): Promise<string | null> => {
    return ipcRenderer.invoke(IPC_CHANNELS.BACKUP_SELECT_DIRECTORY);
  },

  getDefaultBackupDirectory: (): Promise<string> => {
    return ipcRenderer.invoke(IPC_CHANNELS.BACKUP_GET_DEFAULT_DIRECTORY);
  },

  onBackupCreated: (callback: (metadata: BackupMetadata) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, metadata: BackupMetadata) => callback(metadata);
    ipcRenderer.on(IPC_CHANNELS.BACKUP_CREATED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.BACKUP_CREATED, handler);
  },
});

// Type declaration for the renderer
declare global {
  interface Window {
    electronAPI: {
      loadConfig: () => Promise<AppConfig>;
      saveConfig: (config: AppConfig) => Promise<boolean>;
      exportConfig: () => Promise<boolean>;
      importConfig: () => Promise<AppConfig | null>;
      fetchTitle: (url: string) => Promise<string>;
      checkLink: (url: string) => Promise<LinkCheckResult>;
      checkAllLinks: (urls: string[]) => Promise<LinkCheckResult[]>;
      onLinkCheckResult: (callback: (result: LinkCheckResult) => void) => () => void;
      openInChrome: (url: string) => Promise<boolean>;
      focusAndPaste: (
        pattern: string,
        matchMode: 'exact' | 'contains' | 'regex',
        textToPaste: string,
        pressEnter?: boolean
      ) => Promise<{ success: boolean; error?: string }>;
      getAppPath: () => Promise<string>;
      getWindowList: () => Promise<{ title: string; processName: string }[]>;
      openCountdownTimer: (
        totalMinutes: number,
        message: string,
        theme: {
          background: string;
          text: string;
          textMuted: string;
          accent: string;
          success: string;
          danger: string;
          fontFamily: string;
          border?: string;
          textScale?: number;
        }
      ) => Promise<boolean>;
      quitApp: () => Promise<void>;
      minimizeApp: () => Promise<void>;
      checkForUpdates: () => Promise<{
        updateAvailable: boolean;
        currentVersion: string;
        latestVersion?: string;
        isDev?: boolean;
        error?: string;
      }>;
      downloadUpdate: () => Promise<{ success: boolean; error?: string }>;
      installUpdate: () => Promise<{ success: boolean; error?: string }>;
      getAppVersion: () => Promise<string>;
      onUpdateAvailable: (callback: (info: { version: string; releaseNotes?: string }) => void) => () => void;
      onDownloadProgress: (callback: (progress: { percent: number; transferred: number; total: number }) => void) => () => void;
      onUpdateDownloaded: (callback: (info: { version: string }) => void) => () => void;
      onUpdateError: (callback: (error: string) => void) => () => void;
      createBackup: () => Promise<BackupResult>;
      listBackups: () => Promise<BackupMetadata[]>;
      restoreBackup: (filepath: string) => Promise<{ success: boolean; config?: AppConfig; error?: string }>;
      deleteBackup: (filepath: string) => Promise<{ success: boolean; error?: string }>;
      selectBackupDirectory: () => Promise<string | null>;
      getDefaultBackupDirectory: () => Promise<string>;
      onBackupCreated: (callback: (metadata: BackupMetadata) => void) => () => void;
    };
  }
}
