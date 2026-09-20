import { app, BrowserWindow, ipcMain, shell, clipboard, dialog, Menu, net } from 'electron';
import { autoUpdater } from 'electron-updater';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { createHash } from 'crypto';
import {
  AppConfig,
  DEFAULT_CONFIG,
  IPC_CHANNELS,
  LinkCheckResult,
  BackupMetadata,
  BackupResult,
} from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let countdownWindow: BrowserWindow | null = null;
let backupTimerHandle: NodeJS.Timeout | null = null;
let activeBackupTimerSignature: string | null = null;

// Where config is stored.
//
// Packaged builds use Electron's per-user userData directory. The previous
// location was a `data` folder next to the executable, which is not writable
// for a normal user under C:\Program Files: saveConfig() caught the EPERM and
// returned false, so changes were lost on exit with no visible error.
//
// Dev keeps using the repo's data/config.json so a working tree stays
// self-contained.
function getDataPath(): string {
  if (!app.isPackaged) {
    return join(__dirname, '..', '..', 'data', 'config.json');
  }
  return join(app.getPath('userData'), 'config.json');
}

// Config locations used by earlier versions, newest first.
function getLegacyDataPaths(): string[] {
  const paths = [join(app.getPath('exe'), '..', 'data', 'config.json')];

  // userData is derived from the app name, so the pre-rename build wrote to a
  // sibling folder named after the old package name.
  const userData = app.getPath('userData');
  const legacyUserData = join(userData, '..', 'teacherspet', 'config.json');
  paths.push(legacyUserData);

  return paths;
}

// One-time migration: if the current location has no config but an older one
// does, copy it across. Copies rather than moves, so the original stays as a
// fallback if anything goes wrong.
function migrateConfigIfNeeded(): void {
  if (!app.isPackaged) return;

  const target = getDataPath();
  if (existsSync(target)) return;

  for (const source of getLegacyDataPaths()) {
    try {
      if (!existsSync(source)) continue;

      // Only accept a file that parses and looks like our config.
      const raw = readFileSync(source, 'utf-8');
      const parsed = JSON.parse(raw) as AppConfig;
      if (!parsed || !Array.isArray(parsed.profiles)) {
        console.warn(`[Migrate] Skipping ${source}: not a recognisable config`);
        continue;
      }

      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, raw);
      console.log(`[Migrate] Imported config from ${source} -> ${target}`);
      return;
    } catch (error) {
      console.error(`[Migrate] Could not import ${source}:`, error);
    }
  }

  console.log('[Migrate] No previous config found; starting fresh');
}

// Load configuration from disk
function loadConfig(): AppConfig {
  const configPath = getDataPath();
  try {
    if (existsSync(configPath)) {
      const data = readFileSync(configPath, 'utf-8');
      return JSON.parse(data) as AppConfig;
    }
  } catch (error) {
    console.error('Error loading config:', error);
  }
  return DEFAULT_CONFIG;
}

// Save configuration to disk
function saveConfig(config: AppConfig): boolean {
  const configPath = getDataPath();
  try {
    const dir = join(configPath, '..');
    if (!existsSync(dir)) {
      const { mkdirSync } = require('fs');
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving config:', error);
    return false;
  }
}

// Fetch page title from URL using fetch + regex (faster and more reliable)
async function fetchPageTitle(url: string): Promise<string> {
  try {
    // Ensure URL has protocol
    let fetchUrl = url;
    if (!fetchUrl.startsWith('http://') && !fetchUrl.startsWith('https://')) {
      fetchUrl = 'https://' + fetchUrl;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(fetchUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return url;
    }

    const html = await response.text();

    // Extract title from HTML
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      // Decode HTML entities and clean up
      const title = titleMatch[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .trim();
      return title || url;
    }

    return url;
  } catch (error) {
    console.error('Error fetching title:', error);
    return url;
  }
}

// Get list of open windows (Windows only)
async function getWindowList(): Promise<{ title: string; processName: string }[]> {
  if (process.platform !== 'win32') {
    return [];
  }

  const { exec } = require('child_process');

  return new Promise((resolve) => {
    const psScript = `
      Get-Process | Where-Object { $_.MainWindowTitle -ne '' } |
      Select-Object ProcessName, MainWindowTitle |
      ConvertTo-Json
    `;

    exec(
      `powershell -Command "${psScript.replace(/\n/g, ' ')}"`,
      (error: Error | null, stdout: string) => {
        if (error) {
          resolve([]);
          return;
        }

        try {
          const result = JSON.parse(stdout);
          // Handle single result (not an array)
          const windows = Array.isArray(result) ? result : [result];
          resolve(
            windows.map((w: { ProcessName: string; MainWindowTitle: string }) => ({
              title: w.MainWindowTitle,
              processName: w.ProcessName,
            }))
          );
        } catch {
          resolve([]);
        }
      }
    );
  });
}

// Check if a link is accessible using Electron's net module (Chromium networking stack)
async function checkLink(url: string): Promise<LinkCheckResult> {
  const tryRequest = (method: 'HEAD' | 'GET'): Promise<LinkCheckResult> => {
    return new Promise((resolve) => {
      // Create the request before arming the timeout: the timeout callback
      // references `request`, so arming it first left a window where firing it
      // would throw a ReferenceError inside a bare setTimeout (an uncaught
      // exception in the main process rather than a handled rejection).
      const request = net.request({
        method,
        url,
        redirect: 'follow',
      });

      const timeout = setTimeout(() => {
        request.abort();
        resolve({ url, status: 'timeout' });
      }, 10000);

      request.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      request.setHeader('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8');
      request.setHeader('Accept-Language', 'en-US,en;q=0.5');

      request.on('response', (response) => {
        clearTimeout(timeout);
        const statusCode = response.statusCode;
        console.log(`[LinkCheck] ${method} ${url} -> ${statusCode}`);

        // Consume response data to avoid memory leaks
        response.on('data', () => {});
        response.on('end', () => {});

        if (statusCode >= 200 && statusCode < 400) {
          resolve({ url, status: 'ok', statusCode });
        } else if (statusCode === 403 || statusCode === 503) {
          resolve({ url, status: 'unchecked', statusCode });
        } else if (method === 'HEAD' && statusCode === 405) {
          resolve({ url, status: 'broken', statusCode });
        } else {
          resolve({ url, status: 'broken', statusCode });
        }
      });

      request.on('error', (error) => {
        clearTimeout(timeout);
        console.log(`[LinkCheck] ${method} ${url} -> ERROR: ${error.message}`);
        resolve({ url, status: 'broken', error: error.message });
      });

      request.on('abort', () => {
        clearTimeout(timeout);
        resolve({ url, status: 'timeout' });
      });

      request.end();
    });
  };

  // Try HEAD first, fall back to GET if HEAD fails
  const headResult = await tryRequest('HEAD');
  if (headResult.status === 'ok' || headResult.status === 'unchecked') {
    return headResult;
  }

  // HEAD failed - try GET (some servers reject HEAD but accept GET)
  const getResult = await tryRequest('GET');

  // If GET also fails but we got a response with protection status, return unchecked
  if (getResult.status === 'broken' && getResult.statusCode &&
      (getResult.statusCode === 403 || getResult.statusCode === 503)) {
    return { url, status: 'unchecked', statusCode: getResult.statusCode };
  }

  return getResult;
}

// Open URL in Chrome (fallback to default browser)
async function openInChrome(url: string): Promise<void> {
  // Try to open with Chrome specifically on Windows
  const { exec } = require('child_process');

  if (process.platform === 'win32') {
    exec(`start chrome "${url}"`, (error: Error | null) => {
      if (error) {
        // Fallback to default browser
        shell.openExternal(url);
      }
    });
  } else {
    // On other platforms, just use default browser
    shell.openExternal(url);
  }
}

// Focus window and paste - this requires native modules
// For now, we'll implement a simplified version
async function focusAndPaste(
  pattern: string,
  matchMode: 'exact' | 'contains' | 'regex',
  textToPaste: string,
  pressEnter: boolean = false
): Promise<{ success: boolean; error?: string }> {
  // Copy to clipboard first
  clipboard.writeText(textToPaste);

  // On Windows, we can use PowerShell to find and focus windows
  if (process.platform === 'win32') {
    const { execFile } = require('child_process');

    return new Promise((resolve) => {
      // Escape single quotes in the pattern for PowerShell
      const escapedPattern = pattern.replace(/'/g, "''");

      // Build the match condition based on mode
      let matchCondition: string;
      switch (matchMode) {
        case 'exact':
          matchCondition = `$_.MainWindowTitle -eq '${escapedPattern}'`;
          break;
        case 'contains':
          matchCondition = `$_.MainWindowTitle -like '*${escapedPattern}*'`;
          break;
        case 'regex':
          matchCondition = `$_.MainWindowTitle -match '${escapedPattern}'`;
          break;
      }

      // Use a simpler approach: separate commands
      const psScript = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Win32Helper {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@

$allWindows = Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object ProcessName, MainWindowTitle
Write-Host "DEBUG: Available windows:"
$allWindows | ForEach-Object { Write-Host "  - $($_.ProcessName): $($_.MainWindowTitle)" }
Write-Host "DEBUG: Looking for pattern '${escapedPattern}' with condition: ${matchCondition}"

$proc = Get-Process | Where-Object { $_.MainWindowTitle -ne '' -and (${matchCondition}) } | Select-Object -First 1
if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
    Write-Host "DEBUG: Found window - $($proc.ProcessName): $($proc.MainWindowTitle)"
    [Win32Helper]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 300
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait('^v')
    ${pressEnter ? `Start-Sleep -Milliseconds 100
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')` : ''}
    Write-Output 'SUCCESS'
} else {
    Write-Host "DEBUG: No matching window found"
    Write-Output 'NOTFOUND'
}
`;

      execFile(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
        (error: Error | null, stdout: string, stderr: string) => {
          if (error) {
            console.error('PowerShell error:', error);
            console.error('stderr:', stderr);
            resolve({
              success: false,
              error: 'Failed to execute: ' + (error.message || 'Unknown error'),
            });
          } else if (stdout.includes('SUCCESS')) {
            console.log('PowerShell debug output:', stdout);
            resolve({ success: true });
          } else {
            console.log('PowerShell output:', stdout);
            console.log('Pattern used:', pattern);
            console.log('Match mode:', matchMode);
            resolve({
              success: false,
              error: 'Window not found matching pattern: ' + pattern,
            });
          }
        }
      );
    });
  }

  return { success: false, error: 'Platform not supported' };
}

function createWindow(): void {
  // Remove the application menu
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 400,
    minHeight: 300,
    // The window is frameless, so this shows in the taskbar and alt-tab.
    // Set here as well as in index.html so it is correct before the page loads.
    title: 'Gimbal — Stay the Course',
    frame: false,
    backgroundColor: '#1a1a2e',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Load the renderer
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ============================================================================
// BACKUP FUNCTIONS
// ============================================================================

// Get the default backup directory.
// New installs use gimbal-backups. If a folder from the previous name exists
// and the new one does not, keep using it so existing backups stay visible in
// the restore list rather than being silently orphaned.
function getDefaultBackupDirectory(): string {
  const documents = app.getPath('documents');
  const current = join(documents, 'gimbal-backups');
  const legacy = join(documents, 'teachers-pet-backups');

  if (!existsSync(current) && existsSync(legacy)) {
    return legacy;
  }
  return current;
}

// Calculate SHA256 hash of config for change detection
function calculateConfigHash(config: AppConfig): string {
  const configStr = JSON.stringify(config);
  return createHash('sha256').update(configStr).digest('hex');
}

// Create a backup of the current configuration
function createBackup(config: AppConfig, directory: string): BackupResult {
  try {
    // Ensure backup directory exists
    if (!existsSync(directory)) {
      mkdirSync(directory, { recursive: true });
    }

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const filename = `backup-${timestamp}.json`;
    const filepath = join(directory, filename);

    // Calculate metadata
    const totalDays = config.profiles.reduce((sum, profile) => sum + profile.days.length, 0);
    const configStr = JSON.stringify(config, null, 2);
    const size = Buffer.byteLength(configStr, 'utf-8');

    // Write backup file
    writeFileSync(filepath, configStr);

    const metadata: BackupMetadata = {
      filename,
      filepath,
      timestamp: new Date().toISOString(),
      size,
      profileCount: config.profiles.length,
      dayCount: totalDays,
    };

    return {
      success: true,
      filepath,
      metadata,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Enforce backup retention policy (keep only N most recent backups)
function enforceBackupRetention(directory: string, maxBackups: number): void {
  try {
    if (!existsSync(directory)) {
      return;
    }

    const files = readdirSync(directory)
      .filter((f) => f.startsWith('backup-') && f.endsWith('.json'))
      .map((f) => ({
        name: f,
        path: join(directory, f),
        mtime: statSync(join(directory, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.mtime - a.mtime); // Sort newest first

    // Delete old backups
    if (files.length > maxBackups) {
      const toDelete = files.slice(maxBackups);
      toDelete.forEach((file) => {
        try {
          unlinkSync(file.path);
          console.log(`[Backup] Deleted old backup: ${file.name}`);
        } catch (error) {
          console.error(`[Backup] Error deleting ${file.name}:`, error);
        }
      });
    }
  } catch (error) {
    console.error('[Backup] Error enforcing retention:', error);
  }
}

// List all available backups
function listBackups(directory: string): BackupMetadata[] {
  try {
    if (!existsSync(directory)) {
      return [];
    }

    const files = readdirSync(directory)
      .filter((f) => f.startsWith('backup-') && f.endsWith('.json'))
      .map((filename) => {
        const filepath = join(directory, filename);
        const stats = statSync(filepath);

        // Read the file to get profile and day counts
        try {
          const content = readFileSync(filepath, 'utf-8');
          const config = JSON.parse(content) as AppConfig;
          const totalDays = config.profiles.reduce((sum, profile) => sum + profile.days.length, 0);

          return {
            filename,
            filepath,
            timestamp: stats.mtime.toISOString(),
            size: stats.size,
            profileCount: config.profiles.length,
            dayCount: totalDays,
          };
        } catch {
          // If we can't parse the file, return basic metadata
          return {
            filename,
            filepath,
            timestamp: stats.mtime.toISOString(),
            size: stats.size,
            profileCount: 0,
            dayCount: 0,
          };
        }
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()); // Newest first

    return files;
  } catch (error) {
    console.error('[Backup] Error listing backups:', error);
    return [];
  }
}

// Restore configuration from a backup file
function restoreBackup(filepath: string): { success: boolean; config?: AppConfig; error?: string } {
  try {
    if (!existsSync(filepath)) {
      return { success: false, error: 'Backup file not found' };
    }

    const content = readFileSync(filepath, 'utf-8');
    const config = JSON.parse(content) as AppConfig;

    // Validate that it's a valid config
    if (!config.profiles || !Array.isArray(config.profiles)) {
      return { success: false, error: 'Invalid backup file format' };
    }

    return { success: true, config };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Delete a backup file
function deleteBackup(filepath: string): { success: boolean; error?: string } {
  try {
    if (!existsSync(filepath)) {
      return { success: false, error: 'Backup file not found' };
    }

    unlinkSync(filepath);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Describes the settings the backup timer depends on, so we can tell whether a
// config save actually requires restarting it.
function getBackupTimerSignature(config: AppConfig): string {
  const profile = config.profiles.find((p) => p.id === config.currentProfileId);
  const s = profile?.settings.backupSettings;
  if (!s?.enabled) return 'disabled';
  return `enabled:${s.intervalMinutes}:${s.backupDirectory || getDefaultBackupDirectory()}`;
}

// Start the automatic backup timer
function startBackupTimer(config: AppConfig): void {
  // Stop any existing timer
  stopBackupTimer();

  activeBackupTimerSignature = getBackupTimerSignature(config);

  // Find backup settings from current profile
  const currentProfile = config.profiles.find((p) => p.id === config.currentProfileId);
  if (!currentProfile?.settings.backupSettings?.enabled) {
    console.log('[Backup] Auto-backup is disabled');
    return;
  }

  const settings = currentProfile.settings.backupSettings;
  const intervalMs = settings.intervalMinutes * 60 * 1000;

  console.log(`[Backup] Starting auto-backup timer (interval: ${settings.intervalMinutes} minutes)`);

  backupTimerHandle = setInterval(() => {
    // Reload config to get latest state
    const latestConfig = loadConfig();
    const latestProfile = latestConfig.profiles.find((p) => p.id === latestConfig.currentProfileId);

    if (!latestProfile?.settings.backupSettings?.enabled) {
      console.log('[Backup] Auto-backup disabled, stopping timer');
      stopBackupTimer();
      return;
    }

    const latestSettings = latestProfile.settings.backupSettings;
    const currentHash = calculateConfigHash(latestConfig);

    // Check if config has changed since last backup
    if (latestSettings.lastBackupHash && currentHash === latestSettings.lastBackupHash) {
      console.log('[Backup] No changes detected, skipping backup');
      return;
    }

    // Create backup
    const directory = latestSettings.backupDirectory || getDefaultBackupDirectory();
    const result = createBackup(latestConfig, directory);

    if (result.success) {
      console.log('[Backup] Auto-backup created:', result.filepath);

      // Enforce retention policy
      enforceBackupRetention(directory, latestSettings.maxBackups);

      // Update settings with last backup info
      latestProfile.settings.backupSettings.lastBackupTime = new Date().toISOString();
      latestProfile.settings.backupSettings.lastBackupHash = currentHash;
      saveConfig(latestConfig);

      // Notify renderer
      if (mainWindow) {
        mainWindow.webContents.send(IPC_CHANNELS.BACKUP_CREATED, result.metadata);
      }
    } else {
      console.error('[Backup] Auto-backup failed:', result.error);
    }
  }, intervalMs);
}

// Stop the automatic backup timer
function stopBackupTimer(): void {
  if (backupTimerHandle) {
    clearInterval(backupTimerHandle);
    backupTimerHandle = null;
    console.log('[Backup] Auto-backup timer stopped');
  }
  // Clear the signature so a later save that re-enables backups is always seen
  // as a change and restarts the timer.
  activeBackupTimerSignature = null;
}

// Set up IPC handlers
function setupIPC(): void {
  // Config operations
  ipcMain.handle(IPC_CHANNELS.LOAD_CONFIG, () => {
    return loadConfig();
  });

  ipcMain.handle(IPC_CHANNELS.SAVE_CONFIG, (_, config: AppConfig) => {
    const result = saveConfig(config);

    // The backup timer is configured from settings that live in the renderer's
    // config. Restart it when those settings change, otherwise enabling
    // auto-backup or changing the interval would not take effect until the next
    // launch. This also starts the timer on a fresh install, where the renderer
    // creates backupSettings only after the main process has already booted.
    if (result) {
      const signature = getBackupTimerSignature(config);
      if (signature !== activeBackupTimerSignature) {
        startBackupTimer(config);
      }
    }

    return result;
  });

  ipcMain.handle(IPC_CHANNELS.EXPORT_CONFIG, async () => {
    const result = await dialog.showSaveDialog({
      title: 'Export Configuration',
      defaultPath: 'gimbal-export.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });

    if (!result.canceled && result.filePath) {
      const config = loadConfig();
      writeFileSync(result.filePath, JSON.stringify(config, null, 2));
      return true;
    }
    return false;
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_CONFIG, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Configuration',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });

    if (!result.canceled && result.filePaths[0]) {
      try {
        const data = readFileSync(result.filePaths[0], 'utf-8');
        const config = JSON.parse(data) as AppConfig;
        saveConfig(config);
        return config;
      } catch {
        return null;
      }
    }
    return null;
  });

  // Link operations
  ipcMain.handle(IPC_CHANNELS.FETCH_TITLE, async (_, url: string) => {
    return fetchPageTitle(url);
  });

  ipcMain.handle(IPC_CHANNELS.CHECK_LINK, async (_, url: string) => {
    return checkLink(url);
  });

  ipcMain.handle(IPC_CHANNELS.CHECK_ALL_LINKS, async (event, urls: string[]) => {
    const RATE_LIMIT_DELAY = 500; // ms between requests
    const results: LinkCheckResult[] = [];

    for (const [index, url] of urls.entries()) {
      const result = await checkLink(url);
      results.push(result);

      // Send result immediately to renderer
      if (mainWindow) {
        mainWindow.webContents.send(IPC_CHANNELS.LINK_CHECK_RESULT, result);
      }

      // Rate limit: wait before next request. Uses the loop index rather than
      // urls.indexOf(url), which returns the first match and so mis-detects the
      // final item when the same URL appears more than once.
      if (index < urls.length - 1) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
      }
    }

    return results;
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_IN_CHROME, async (_, url: string) => {
    await openInChrome(url);
    return true;
  });

  // Window operations
  ipcMain.handle(
    IPC_CHANNELS.FOCUS_AND_PASTE,
    async (
      _,
      pattern: string,
      matchMode: 'exact' | 'contains' | 'regex',
      textToPaste: string,
      pressEnter: boolean = false
    ) => {
      return focusAndPaste(pattern, matchMode, textToPaste, pressEnter);
    }
  );

  ipcMain.handle(IPC_CHANNELS.GET_APP_PATH, () => {
    return app.isPackaged
      ? join(app.getPath('exe'), '..')
      : join(__dirname, '..', '..');
  });

  ipcMain.handle(IPC_CHANNELS.GET_WINDOWS, async () => {
    return getWindowList();
  });

  ipcMain.handle(
    IPC_CHANNELS.OPEN_COUNTDOWN_TIMER,
    async (
      _,
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
      }
    ) => {
      return openCountdownTimer(totalMinutes, message, theme);
    }
  );

  ipcMain.handle(IPC_CHANNELS.QUIT_APP, () => {
    app.quit();
  });

  ipcMain.handle(IPC_CHANNELS.MINIMIZE_APP, () => {
    mainWindow?.minimize();
  });

  // Auto-updater handlers
  ipcMain.handle(IPC_CHANNELS.CHECK_FOR_UPDATES, async () => {
    try {
      if (app.isPackaged) {
        // Read setting for beta updates
        const config = loadConfig();
        const currentProfile = config.profiles.find((p) => p.id === config.currentProfileId);
        const includeBeta = currentProfile?.settings.includeBetaUpdates ?? false;
        autoUpdater.allowPrerelease = includeBeta;
        autoUpdater.channel = includeBeta ? 'beta' : 'latest';
        console.log(`[Update] Checking for updates (includeBeta: ${includeBeta}, channel: ${autoUpdater.channel})...`);
        const result = await autoUpdater.checkForUpdates();
        console.log('[Update] Check result:', {
          current: app.getVersion(),
          latest: result?.updateInfo.version,
          updateAvailable: result && result.updateInfo.version !== app.getVersion(),
        });
        return {
          updateAvailable: result && result.updateInfo.version !== app.getVersion(),
          currentVersion: app.getVersion(),
          latestVersion: result?.updateInfo.version,
        };
      } else {
        return {
          updateAvailable: false,
          currentVersion: app.getVersion(),
          latestVersion: app.getVersion(),
          isDev: true,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[Update] Error checking for updates:', errorMessage);
      return { error: errorMessage };
    }
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_UPDATE, async () => {
    try {
      if (app.isPackaged) {
        // Ensure allowPrerelease and channel match user setting before download
        const config = loadConfig();
        const currentProfile = config.profiles.find((p) => p.id === config.currentProfileId);
        const includeBeta = currentProfile?.settings.includeBetaUpdates ?? false;
        autoUpdater.allowPrerelease = includeBeta;
        autoUpdater.channel = includeBeta ? 'beta' : 'latest';
        console.log(`[Update] Starting download (includeBeta: ${includeBeta}, channel: ${autoUpdater.channel})...`);
        const result = await autoUpdater.downloadUpdate();
        console.log('[Update] Download initiated:', result);
        return { success: true };
      }
      return { success: false, error: 'Not in production mode' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[Update] Error downloading update:', errorMessage);
      console.error('[Update] Full error:', error);
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle(IPC_CHANNELS.INSTALL_UPDATE, () => {
    if (app.isPackaged) {
      autoUpdater.quitAndInstall();
      return { success: true };
    }
    return { success: false, error: 'Not in production mode' };
  });

  ipcMain.handle(IPC_CHANNELS.GET_APP_VERSION, () => {
    return app.getVersion();
  });

  // Backup operations
  ipcMain.handle(IPC_CHANNELS.BACKUP_GET_DEFAULT_DIRECTORY, () => {
    return getDefaultBackupDirectory();
  });

  ipcMain.handle(IPC_CHANNELS.BACKUP_CREATE_MANUAL, async (): Promise<BackupResult> => {
    const config = loadConfig();
    const currentProfile = config.profiles.find((p) => p.id === config.currentProfileId);
    const directory =
      currentProfile?.settings.backupSettings?.backupDirectory || getDefaultBackupDirectory();

    const result = createBackup(config, directory);

    if (result.success && currentProfile?.settings.backupSettings) {
      // Enforce retention policy
      enforceBackupRetention(directory, currentProfile.settings.backupSettings.maxBackups);

      // Update last backup info
      const hash = calculateConfigHash(config);
      currentProfile.settings.backupSettings.lastBackupTime = new Date().toISOString();
      currentProfile.settings.backupSettings.lastBackupHash = hash;
      saveConfig(config);
    }

    return result;
  });

  ipcMain.handle(IPC_CHANNELS.BACKUP_LIST, async (): Promise<BackupMetadata[]> => {
    const config = loadConfig();
    const currentProfile = config.profiles.find((p) => p.id === config.currentProfileId);
    const directory =
      currentProfile?.settings.backupSettings?.backupDirectory || getDefaultBackupDirectory();

    return listBackups(directory);
  });

  ipcMain.handle(
    IPC_CHANNELS.BACKUP_RESTORE,
    async (_, filepath: string): Promise<{ success: boolean; config?: AppConfig; error?: string }> => {
      return restoreBackup(filepath);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.BACKUP_DELETE,
    async (_, filepath: string): Promise<{ success: boolean; error?: string }> => {
      return deleteBackup(filepath);
    }
  );

  ipcMain.handle(IPC_CHANNELS.BACKUP_SELECT_DIRECTORY, async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: 'Select Backup Directory',
      properties: ['openDirectory', 'createDirectory'],
    });

    if (!result.canceled && result.filePaths[0]) {
      return result.filePaths[0];
    }
    return null;
  });
}

// Theme interface for countdown timer
interface TimerTheme {
  background: string;
  text: string;
  textMuted: string;
  accent: string;
  success: string;
  danger: string;
  fontFamily: string;
  border?: string;
}

// Open a countdown timer window
function openCountdownTimer(totalMinutes: number, message: string, theme: TimerTheme): boolean {
  try {
    // Close existing countdown window if open
    if (countdownWindow && !countdownWindow.isDestroyed()) {
      countdownWindow.close();
    }

    countdownWindow = new BrowserWindow({
      width: 640,
      height: 360,
      alwaysOnTop: true,
      frame: false,
      resizable: true,
      transparent: true,
      backgroundColor: '#00000000',
      title: 'Countdown Timer',
      autoHideMenuBar: true,
      roundedCorners: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // Create HTML content for the countdown timer
    const totalSeconds = totalMinutes * 60;
    const escapedMessage = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Countdown Timer</title>
  <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      border-radius: 0;
      overflow: hidden;
      background: transparent;
    }
    body {
      font-family: ${theme.fontFamily};
      background: ${theme.background};
      color: ${theme.text};
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      padding: 10px;
      text-align: center;
      position: relative;
      -webkit-app-region: drag;
      border: 2px solid ${theme.border || theme.accent};
    }
    button, input, .message-container {
      -webkit-app-region: no-drag;
    }
    .close-btn {
      position: absolute;
      top: 10px;
      right: 10px;
      background: none;
      border: 2px solid transparent;
      color: ${theme.textMuted};
      font-family: ${theme.fontFamily};
      font-size: 10px;
      cursor: pointer;
      padding: 4px 8px;
      opacity: 0;
      transition: opacity 0.2s;
    }
    body:hover .close-btn {
      opacity: 1;
    }
    .close-btn:hover {
      color: ${theme.danger};
      border-color: ${theme.danger};
    }
    .time-controls {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      display: flex;
      flex-direction: column;
      gap: 8px;
      opacity: 0;
      transition: opacity 0.2s;
    }
    body:hover .time-controls {
      opacity: 1;
    }
    .time-btn {
      background: ${theme.background};
      border: 2px solid ${theme.textMuted};
      color: ${theme.textMuted};
      font-family: ${theme.fontFamily};
      font-size: 16px;
      width: 28px;
      height: 28px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .time-btn:hover {
      border-color: ${theme.accent};
      color: ${theme.accent};
    }
    .message-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      margin-bottom: 8px;
      max-width: 100%;
    }
    .message { font-size: ${theme.fontFamily.includes('Lexend') || theme.fontFamily.includes('sans-serif') || theme.fontFamily === 'sans-serif' ? '11px' : '8px'}; color: ${theme.textMuted}; word-wrap: break-word; line-height: 1.4; text-align: center; }
    .message-line { display: block; }
    .message-separator { color: ${theme.textMuted}; font-size: 10px; }
    .message-edit-btn {
      background: ${theme.background};
      border: 2px solid ${theme.textMuted};
      color: ${theme.textMuted};
      font-family: ${theme.fontFamily};
      font-size: 10px;
      padding: 2px 6px;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.2s;
      flex-shrink: 0;
    }
    body:hover .message-edit-btn {
      opacity: 1;
    }
    .message-edit-btn:hover {
      border-color: ${theme.accent};
      color: ${theme.accent};
    }
    .message-input {
      font-family: ${theme.fontFamily};
      font-size: 10px;
      color: ${theme.text};
      background: ${theme.background};
      border: 2px solid ${theme.accent};
      padding: 8px;
      width: 300px;
      text-align: center;
    }
    .message-input:focus {
      outline: none;
    }
    .timer {
      font-size: 43px;
      font-weight: bold;
      color: ${theme.accent};
      font-family: ${theme.fontFamily};
    }
    .timer.warning { color: #ffd93d; }
    .timer.danger { color: ${theme.danger}; animation: pulse 1s ease-in-out infinite; }
    .timer.done { color: ${theme.success}; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
  </style>
</head>
<body>
  <button class="close-btn" onclick="window.close()" title="Close">X</button>
  <div class="time-controls">
    <button class="time-btn" onclick="adjustTime(60)" title="Add 1 minute">+</button>
    <button class="time-btn" onclick="adjustTime(-60)" title="Remove 1 minute">−</button>
  </div>
  <div class="message-container" id="messageContainer">
    <div class="message" id="message">${escapedMessage.replace(/ \+ /g, '</span><span class="message-separator">+</span><span class="message-line">').replace(/^/, '<span class="message-line">').replace(/$/, '</span>')}</div>
    <button class="message-edit-btn" onclick="editMessage()" title="Edit message">✎</button>
  </div>
  <div class="timer" id="timer">00:00</div>
  <script>
    var remaining = ${totalSeconds};
    var isEditing = false;
    function editMessage() {
      if (isEditing) return;
      isEditing = true;
      var container = document.getElementById('messageContainer');
      var messageEl = document.getElementById('message');
      var currentText = messageEl.textContent;
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'message-input';
      input.value = currentText;
      messageEl.style.display = 'none';
      container.querySelector('.message-edit-btn').style.display = 'none';
      container.appendChild(input);
      input.focus();
      input.select();
      function saveEdit() {
        messageEl.textContent = input.value || currentText;
        messageEl.style.display = '';
        container.querySelector('.message-edit-btn').style.display = '';
        input.remove();
        isEditing = false;
      }
      input.addEventListener('blur', saveEdit);
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { input.blur(); }
        if (e.key === 'Escape') { input.value = currentText; input.blur(); }
      });
    }
    var timerRunning = true;
    function adjustTime(seconds) {
      remaining += seconds;
      if (remaining < 0) remaining = 0;
      var wasRunning = timerRunning;
      timerRunning = true;
      updateDisplay();
      if (!wasRunning && remaining > 0) {
        setTimeout(updateTimer, 1000);
      }
    }
    function updateDisplay() {
      var hours = Math.floor(remaining / 3600);
      var minutes = Math.floor((remaining % 3600) / 60);
      var seconds = remaining % 60;
      var timerEl = document.getElementById('timer');

      if (remaining > 3599) {
        // More than 59:59 - show HH:MM:SS
        timerEl.textContent = String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
      } else {
        // 59:59 or less - show MM:SS
        timerEl.textContent = String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
      }

      timerEl.className = 'timer';
      if (remaining <= 0) {
        timerEl.classList.add('done');
        timerEl.textContent = '00:00';
        timerRunning = false;
        return;
      } else if (remaining <= 60) {
        timerEl.classList.add('danger');
      } else if (remaining <= 300) {
        timerEl.classList.add('warning');
      }
    }
    function updateTimer() {
      updateDisplay();
      if (timerRunning && remaining > 0) {
        remaining--;
        setTimeout(updateTimer, 1000);
      }
    }
    updateTimer();
  </script>
</body>
</html>`;

    // Write to a temp file and load it
    const tempPath = join(app.getPath('temp'), 'countdown-timer.html');
    writeFileSync(tempPath, htmlContent);
    countdownWindow.loadFile(tempPath);

    countdownWindow.on('closed', () => {
      countdownWindow = null;
    });

    return true;
  } catch (error) {
    console.error('Error opening countdown timer:', error);
    return false;
  }
}

// Configure auto-updater
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.allowPrerelease = false; // Default to stable releases only
// Skip code signature verification for unsigned builds
(autoUpdater as any).verifyUpdateCodeSignature = () => Promise.resolve(null);

// Explicitly set the feed URL for GitHub releases
if (app.isPackaged) {
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'CheckSomeBytes',
    repo: 'Gimbal',
  });
}

// Auto-updater event handlers
autoUpdater.on('update-available', (info) => {
  console.log('Update available:', info.version);
  mainWindow?.webContents.send('update-available', {
    version: info.version,
    releaseNotes: info.releaseNotes,
  });
});

autoUpdater.on('update-not-available', (info) => {
  console.log('Update not available. Current version:', info.version);
});

autoUpdater.on('error', (err) => {
  console.error('Auto-updater error:', err);
  mainWindow?.webContents.send('update-error', String(err));
});

autoUpdater.on('download-progress', (progressObj) => {
  console.log(`Download progress: ${progressObj.percent.toFixed(2)}%`);
  mainWindow?.webContents.send('download-progress', {
    percent: progressObj.percent,
    transferred: progressObj.transferred,
    total: progressObj.total,
  });
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('Update downloaded:', info.version);
  mainWindow?.webContents.send('update-downloaded', {
    version: info.version,
  });
});

// App lifecycle
app.whenReady().then(() => {
  // Must run before anything reads config, including the renderer's first
  // config:load over IPC.
  migrateConfigIfNeeded();

  setupIPC();
  createWindow();

  // Initialize backup system
  const config = loadConfig();
  const currentProfile = config.profiles.find((p) => p.id === config.currentProfileId);
  const backupDir = currentProfile?.settings.backupSettings?.backupDirectory || getDefaultBackupDirectory();

  // Ensure backup directory exists
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
  }

  // Create initial backup if none exist
  const existingBackups = listBackups(backupDir);
  if (existingBackups.length === 0) {
    console.log('[Backup] No existing backups found, creating initial backup');
    const result = createBackup(config, backupDir);
    if (result.success && currentProfile?.settings.backupSettings) {
      const hash = calculateConfigHash(config);
      currentProfile.settings.backupSettings.lastBackupTime = new Date().toISOString();
      currentProfile.settings.backupSettings.lastBackupHash = hash;
      saveConfig(config);
    }
  }

  // Start auto-backup timer
  startBackupTimer(config);

  // Check for updates on startup (only in production)
  if (app.isPackaged) {
    setTimeout(() => {
      // Set allowPrerelease and channel based on user setting
      const includeBeta = currentProfile?.settings.includeBetaUpdates ?? false;
      autoUpdater.allowPrerelease = includeBeta;
      autoUpdater.channel = includeBeta ? 'beta' : 'latest';
      console.log(`[Update] Startup check (includeBeta: ${includeBeta}, channel: ${autoUpdater.channel})`);
      autoUpdater.checkForUpdates().catch((err) => {
        console.error('Error checking for updates on startup:', err);
      });
    }, 3000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopBackupTimer();
});
