import { app, BrowserWindow, ipcMain, shell, clipboard, dialog, Menu, net } from 'electron';
import { autoUpdater } from 'electron-updater';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { createHash } from 'crypto';
import QRCode from 'qrcode';
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

// Shared PowerShell type: enumerates every top-level window, not just each
// process's "main" window. Get-Process only reports MainWindowTitle, so apps
// that hold several windows (Slack, Chrome, PowerPoint) were invisible unless
// Windows happened to designate the wanted one as main.
const PS_WINDOW_HELPER = `
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
public class GimbalWin {
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
    public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();

    public class Win { public IntPtr Handle; public string Title; public string ProcessName; }

    public static List<Win> All() {
        var res = new List<Win>();
        EnumWindows((h, l) => {
            // Minimized windows still count: they are restorable targets.
            if (!IsWindowVisible(h) && !IsIconic(h)) return true;
            var sb = new StringBuilder(512);
            GetWindowText(h, sb, 512);
            if (sb.Length == 0) return true;
            string pname = "";
            try {
                uint pid; GetWindowThreadProcessId(h, out pid);
                pname = Process.GetProcessById((int)pid).ProcessName;
            } catch {}
            res.Add(new Win { Handle = h, Title = sb.ToString(), ProcessName = pname });
            return true;
        }, IntPtr.Zero);
        return res;
    }

    // SetForegroundWindow is refused unless the calling thread owns the
    // foreground. Attaching to the current foreground thread lifts that.
    public static bool Focus(IntPtr h) {
        if (IsIconic(h)) ShowWindow(h, 9); // SW_RESTORE
        IntPtr fg = GetForegroundWindow();
        uint targetPid, fgPid;
        uint targetThread = GetWindowThreadProcessId(h, out targetPid);
        uint fgThread = GetWindowThreadProcessId(fg, out fgPid);
        uint thisThread = GetCurrentThreadId();
        if (fgThread != thisThread) AttachThreadInput(thisThread, fgThread, true);
        BringWindowToTop(h);
        bool ok = SetForegroundWindow(h);
        if (fgThread != thisThread) AttachThreadInput(thisThread, fgThread, false);
        for (int i = 0; i < 20 && GetForegroundWindow() != h; i++) System.Threading.Thread.Sleep(25);
        return GetForegroundWindow() == h;
    }
}
'@
`;

// Get list of open windows (Windows only)
async function getWindowList(): Promise<{ title: string; processName: string }[]> {
  if (process.platform !== 'win32') {
    return [];
  }

  const { execFile } = require('child_process');

  return new Promise((resolve) => {
    const psScript = `${PS_WINDOW_HELPER}
[GimbalWin]::All() | Select-Object ProcessName, Title | ConvertTo-Json -Compress
`;

    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
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
            windows.map((w: { ProcessName: string; Title: string }) => ({
              title: w.Title,
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
          matchCondition = `$_.Title -eq '${escapedPattern}'`;
          break;
        case 'contains':
          matchCondition = `$_.Title -like '*${escapedPattern}*'`;
          break;
        case 'regex':
          matchCondition = `$_.Title -match '${escapedPattern}'`;
          break;
      }

      // Enumerate every top-level window (not just per-process main windows),
      // then focus the match and paste into it.
      const psScript = `${PS_WINDOW_HELPER}
$all = [GimbalWin]::All()
Write-Host "DEBUG: Available windows:"
$all | ForEach-Object { Write-Host "  - $($_.ProcessName): $($_.Title)" }
Write-Host "DEBUG: Looking for pattern '${escapedPattern}' with condition: ${matchCondition}"

$matches = @($all | Where-Object { ${matchCondition} })
if ($matches.Count -gt 1) {
    Write-Host "DEBUG: $($matches.Count) windows matched; using the first."
}
$win = $matches | Select-Object -First 1
if ($win) {
    Write-Host "DEBUG: Found window - $($win.ProcessName): $($win.Title)"
    $focused = [GimbalWin]::Focus($win.Handle)
    if (-not $focused) {
        Write-Host "DEBUG: Could not bring window to foreground"
        Write-Output 'NOFOCUS'
    } else {
        Start-Sleep -Milliseconds 150
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.SendKeys]::SendWait('^v')
        ${pressEnter ? `Start-Sleep -Milliseconds 100
        [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')` : ''}
        Write-Output 'SUCCESS'
    }
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
          } else if (stdout.includes('NOFOCUS')) {
            console.log('PowerShell output:', stdout);
            resolve({
              success: false,
              error:
                'Found the window but Windows blocked focusing it. Click the target window once, then try again.',
            });
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
      theme: TimerTheme
    ) => {
      const evalQrs = await buildEvalQrs(theme.evalLinks);
      return openCountdownTimer(totalMinutes, message, theme, evalQrs);
    }
  );

  // The countdown window resizes its own text; forward the new scale to the
  // main window so it can persist it to the active profile.
  ipcMain.on(IPC_CHANNELS.TIMER_SET_TEXT_SCALE, (_, scale: number) => {
    if (typeof scale !== 'number' || !isFinite(scale)) return;
    const clamped = Math.min(2, Math.max(0.5, scale));
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.TIMER_TEXT_SCALE_CHANGED, clamped);
    }
  });

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
  /** Text size multiplier for the countdown window; 1 = default. */
  textScale?: number;
  /** Profile's break alert theme; the window switches to it near the end. */
  alert?: TimerAlertColors | null;
  /** Minutes remaining at which the alert theme kicks in. */
  alertMinutes?: number;
  /** IANA timezone used to display the return time. */
  timezone?: string;
  /** Each day's course eval; the QR button lets the instructor pick one. */
  evalLinks?: { url: string; dayNumber: number; dayName: string }[];
  /** Day# of the day selected in the main window, highlighted in the picker. */
  currentEvalDay?: number | null;
}

interface TimerAlertColors {
  background: string;
  text: string;
  textMuted: string;
  accent: string;
  danger: string;
  border?: string;
}

interface EvalQr {
  dayNumber: number;
  dayName: string;
  svg: string;
}

// Render each day's eval link as an inline SVG QR code for the countdown window.
async function buildEvalQrs(evalLinks: TimerTheme['evalLinks']): Promise<EvalQr[]> {
  const qrs: EvalQr[] = [];
  for (const link of evalLinks || []) {
    if (!/^https?:\/\//i.test(link.url)) continue;
    // One entry per Day#: the settings page flags duplicates, and they would
    // produce identical codes anyway.
    if (qrs.some((q) => q.dayNumber === link.dayNumber)) continue;
    try {
      // Always dark-on-white: phone scanners struggle with inverted or
      // low-contrast codes, so this deliberately ignores the theme.
      const svg = await QRCode.toString(link.url, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      });
      qrs.push({ dayNumber: link.dayNumber, dayName: link.dayName, svg });
    } catch (error) {
      console.error(`Error generating eval QR code for day ${link.dayNumber}:`, error);
    }
  }
  return qrs.sort((a, b) => a.dayNumber - b.dayNumber);
}

// Open a countdown timer window
function openCountdownTimer(
  totalMinutes: number,
  message: string,
  theme: TimerTheme,
  evalQrs: EvalQr[] = []
): boolean {
  try {
    // Close existing countdown window if open
    if (countdownWindow && !countdownWindow.isDestroyed()) {
      countdownWindow.close();
    }

    countdownWindow = new BrowserWindow({
      width: 960,
      height: 540,
      minWidth: 320,
      minHeight: 200,
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
        preload: join(__dirname, '../preload/countdownPreload.js'),
      },
    });

    // Create HTML content for the countdown timer
    const totalSeconds = totalMinutes * 60;
    // Clamp: a stored value outside this range would make the window unusable.
    const textScale = Math.min(2, Math.max(0.5, theme.textScale || 1));
    const alertSeconds = Math.max(0, theme.alertMinutes || 5) * 60;
    const alert = theme.alert;
    // Validate before embedding in a script: an invalid zone makes
    // toLocaleTimeString throw and would stop the timer from ticking.
    let timezone: string | undefined;
    try {
      if (theme.timezone) {
        new Intl.DateTimeFormat('en-US', { timeZone: theme.timezone });
        timezone = theme.timezone;
      }
    } catch {
      timezone = undefined;
    }
    const escapeHtml = (value: string) =>
      value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const escapedMessage = escapeHtml(message);
    const currentEvalDay = theme.currentEvalDay ?? null;

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
    :root {
      --text-scale: ${textScale};
      --bg: ${theme.background};
      --text: ${theme.text};
      --text-muted: ${theme.textMuted};
      --accent: ${theme.accent};
      --danger: ${theme.danger};
      --success: ${theme.success};
      --border: ${theme.border || theme.accent};
    }
${alert ? `    /* Mirrors the main window's break alert theme near the end. */
    body.alert {
      --bg: ${alert.background};
      --text: ${alert.text};
      --text-muted: ${alert.textMuted};
      --accent: ${alert.accent};
      --danger: ${alert.danger};
      --border: ${alert.border || alert.accent};
    }
    body.alert .timer { color: var(--text); }
` : ''}
    body {
      font-family: ${theme.fontFamily};
      background: var(--bg);
      color: var(--text);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      padding: 10px;
      text-align: center;
      position: relative;
      -webkit-app-region: drag;
      border: 2px solid var(--border);
    }
    button, input, .message-container, .qr-panel, .qr-menu {
      -webkit-app-region: no-drag;
    }
    /* Keep the hover controls above the timer text: the text is later in the
       DOM and on its own compositing layer, so it would otherwise paint over
       them and swallow the clicks once it grows large enough to overlap. */
    .close-btn, .qr-btn, .qr-menu, .time-controls, .size-controls {
      z-index: 10;
    }
    .timer-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 0;
      max-height: 100%;
      max-width: 100%;
      flex-shrink: 1;
    }
    .qr-btn {
      position: absolute;
      top: 10px;
      left: 10px;
      background: var(--bg);
      border: 2px solid var(--text-muted);
      color: var(--text-muted);
      font-family: ${theme.fontFamily};
      font-size: 10px;
      cursor: pointer;
      padding: 4px 8px;
      opacity: 0;
      transition: opacity 0.2s;
    }
    body:hover .qr-btn, body.qr-on .qr-btn, body.qr-menu-open .qr-btn {
      opacity: 1;
    }
    .qr-btn:hover, body.qr-on .qr-btn, body.qr-menu-open .qr-btn {
      border-color: var(--accent);
      color: var(--accent);
    }
    /* QR shown: timer and code sit side by side, and the timer text shrinks
       to share the width. */
    body.qr-on {
      flex-direction: row;
      gap: 4vw;
    }
    body.qr-on .timer { font-size: calc(min(10vw, 34vh) * var(--text-scale)); }
    body.qr-on .message { font-size: calc(min(2.6vw, 6vh) * var(--text-scale)); }
    body.qr-on .return-time { font-size: calc(min(2.2vw, 6vh) * var(--text-scale)); }
    .qr-panel {
      display: none;
      flex-direction: column;
      align-items: center;
      flex-shrink: 0;
      /* Fixed light card so the code scans the same on every theme. */
      background: #ffffff;
      color: #000000;
      padding: min(1.5vh, 10px);
    }
    body.qr-on .qr-panel {
      display: flex;
    }
    .qr-day {
      display: none;
      flex-direction: column;
      align-items: center;
    }
    .qr-day.active {
      display: flex;
    }
    /* Day picker opened by the QR button. */
    .qr-menu {
      position: absolute;
      top: 42px;
      left: 10px;
      display: none;
      flex-direction: column;
      max-height: calc(100vh - 60px);
      overflow-y: auto;
      background: var(--bg);
      border: 2px solid var(--accent);
      padding: 4px;
    }
    body.qr-menu-open .qr-menu {
      display: flex;
    }
    .qr-menu-title {
      font-family: ${theme.fontFamily};
      font-size: 8px;
      color: var(--text-muted);
      padding: 4px 8px;
      text-align: left;
    }
    .qr-menu-item {
      background: none;
      border: 2px solid transparent;
      color: var(--text);
      font-family: ${theme.fontFamily};
      font-size: 10px;
      padding: 6px 8px;
      text-align: left;
      white-space: nowrap;
      cursor: pointer;
    }
    .qr-menu-item:hover {
      border-color: var(--accent);
      color: var(--accent);
    }
    .qr-menu-item.shown {
      color: var(--accent);
    }
    .qr-menu-note {
      color: var(--text-muted);
    }
    .qr-menu-hide {
      color: var(--text-muted);
      margin-top: 4px;
      display: none;
    }
    body.qr-on .qr-menu-hide {
      display: block;
    }
    .qr-code svg {
      display: block;
      width: min(70vh, 38vw);
      height: min(70vh, 38vw);
    }
    .qr-label {
      font-family: ${theme.fontFamily};
      font-size: min(2.2vw, 3.5vh);
      margin-top: min(1vh, 6px);
      white-space: nowrap;
    }
    .close-btn {
      position: absolute;
      top: 10px;
      right: 10px;
      background: none;
      border: 2px solid transparent;
      color: var(--text-muted);
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
      color: var(--danger);
      border-color: var(--danger);
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
      background: var(--bg);
      border: 2px solid var(--text-muted);
      color: var(--text-muted);
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
      border-color: var(--accent);
      color: var(--accent);
    }
    .size-controls {
      position: absolute;
      right: 10px;
      top: 50%;
      transform: translateY(-50%);
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: center;
      opacity: 0;
      transition: opacity 0.2s;
    }
    body:hover .size-controls {
      opacity: 1;
    }
    .size-btn {
      background: var(--bg);
      border: 2px solid var(--text-muted);
      color: var(--text-muted);
      font-family: ${theme.fontFamily};
      width: 28px;
      height: 28px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      padding: 0;
    }
    .size-btn--up { font-size: 15px; }
    .size-btn--down { font-size: 10px; }
    .size-btn:hover:not(:disabled) {
      border-color: var(--accent);
      color: var(--accent);
    }
    .size-btn:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .size-readout {
      font-family: ${theme.fontFamily};
      font-size: 8px;
      color: var(--text-muted);
      white-space: nowrap;
    }
    .message-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex-shrink: 1;
      min-height: 0;
      overflow: hidden;
      max-height: 40vh;
      gap: 2px;
      margin-bottom: min(2vh, 14px);
      max-width: 100%;
    }
    .message { font-size: calc(${theme.fontFamily.includes('Lexend') || theme.fontFamily.includes('sans-serif') || theme.fontFamily === 'sans-serif' ? 'min(5.5vw, 8.5vh)' : 'min(4vw, 6vh)'} * var(--text-scale)); color: var(--text); word-wrap: break-word; line-height: 1.35; text-align: center; }
    .message-line { display: block; }
    .message-separator { color: var(--text-muted); font-size: calc(min(3.5vw, 5vh) * var(--text-scale)); }
    .message-edit-btn {
      background: var(--bg);
      border: 2px solid var(--text-muted);
      color: var(--text-muted);
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
      border-color: var(--accent);
      color: var(--accent);
    }
    .message-input {
      font-family: ${theme.fontFamily};
      font-size: 10px;
      color: var(--text);
      background: var(--bg);
      border: 2px solid var(--accent);
      padding: 8px;
      width: 300px;
      text-align: center;
    }
    .message-input:focus {
      outline: none;
    }
    .timer {
      /* Scales with the window so the timer stays readable when the
         window is resized or the display is projected. At large scales the
         flex layout shrinks this to fit rather than letting it overflow. */
      font-size: calc(min(22vw, 34vh) * var(--text-scale));
      line-height: 1.05;
      font-weight: bold;
      flex-shrink: 1;
      min-height: 0;
      white-space: nowrap;
      color: var(--accent);
      font-family: ${theme.fontFamily};
      /* Own compositing layer: ClearType on a transparent window leaves
         colored fringes and stray hairlines around the large glyphs. */
      will-change: transform;
    }
    .return-time {
      font-size: calc(min(4vw, 6vh) * var(--text-scale));
      line-height: 1.35;
      margin-top: min(2vh, 14px);
      flex-shrink: 0;
      white-space: nowrap;
      color: var(--text);
      font-family: ${theme.fontFamily};
    }
    .timer.warning { color: #ffd93d; }
    .timer.danger { color: var(--danger); }
    /* Time's up: fade slowly between blue and red. Fixed colors so it reads
       the same on every theme. */
    .timer.done { color: #4da6ff; animation: done-blink 2s ease-in-out infinite alternate; }
    @keyframes done-blink { from { color: #4da6ff; } to { color: #ff4d4d; } }
  </style>
</head>
<body>
  <button class="close-btn" onclick="window.close()" title="Close">X</button>
${evalQrs.length ? `  <button class="qr-btn" onclick="toggleQrMenu(event)" title="Show a day's eval QR code">QR</button>
  <div class="qr-menu" id="qrMenu">
    <div class="qr-menu-title">SHOW EVAL FOR</div>
${evalQrs.map((q) => `    <button class="qr-menu-item" data-day="${q.dayNumber}" onclick="showQr(${q.dayNumber})">Day ${q.dayNumber} - ${escapeHtml(q.dayName)}${q.dayNumber === currentEvalDay ? ' <span class="qr-menu-note">(today)</span>' : ''}</button>
`).join('')}    <button class="qr-menu-item qr-menu-hide" onclick="hideQr()">Hide QR</button>
  </div>
` : ''}  <div class="time-controls">
    <button class="time-btn" onclick="adjustTime(60)" title="Add 1 minute">+</button>
    <button class="time-btn" onclick="adjustTime(-60)" title="Remove 1 minute">−</button>
  </div>
  <div class="size-controls">
    <button class="size-btn size-btn--up" id="sizeUp" onclick="adjustTextScale(0.1)" title="Increase text size">A</button>
    <span class="size-readout" id="sizeReadout">100%</span>
    <button class="size-btn size-btn--down" id="sizeDown" onclick="adjustTextScale(-0.1)" title="Decrease text size">A</button>
  </div>
  <div class="timer-content">
  <div class="message-container" id="messageContainer">
    <div class="message" id="message">${escapedMessage.replace(/ \+ /g, '</span><span class="message-separator">+</span><span class="message-line">').replace(/^/, '<span class="message-line">').replace(/$/, '</span>')}</div>
    <button class="message-edit-btn" onclick="editMessage()" title="Edit message">✎</button>
  </div>
  <div class="timer" id="timer">00:00</div>
  <div class="return-time" id="returnTime"></div>
  </div>
${evalQrs.length ? `  <div class="qr-panel">
${evalQrs.map((q) => `    <div class="qr-day" data-day="${q.dayNumber}">
      <div class="qr-code">${q.svg}</div>
      <div class="qr-label">Day ${q.dayNumber} Evaluation</div>
    </div>
`).join('')}  </div>
` : ''}  <script>
    // Track a wall-clock deadline rather than counting ticks. Timers in a
    // background window get throttled or suspended outright (most visibly when
    // the machine is locked or sleeping), so a tick-counting timer silently
    // loses that time and resumes where it left off. Deriving the remaining
    // time from Date.now() means the countdown is correct the moment the
    // window is visible again, however long it was starved.
    var deadline = Date.now() + ${totalSeconds} * 1000;
    var remaining = ${totalSeconds};
    function computeRemaining() {
      return Math.max(0, Math.round((deadline - Date.now()) / 1000));
    }
    var ALERT_SECONDS = ${alertSeconds};
    var HAS_ALERT_THEME = ${alert ? 'true' : 'false'};
    var TIMEZONE = ${timezone ? JSON.stringify(timezone) : 'undefined'};
    var lastReturnDeadline = null;
    function updateReturnTime() {
      if (deadline === lastReturnDeadline) return;
      lastReturnDeadline = deadline;
      var opts = { hour: 'numeric', minute: '2-digit', hour12: true };
      if (TIMEZONE) opts.timeZone = TIMEZONE;
      // Formatted the same way as the "Back at approximately" chat message so
      // the two always agree.
      var backAt = new Date(deadline);
      document.getElementById('returnTime').textContent = 'Back at ' + backAt.toLocaleTimeString('en-US', opts);
    }
    function toggleQrMenu(event) {
      event.stopPropagation();
      document.body.classList.toggle('qr-menu-open');
    }
    function showQr(day) {
      document.querySelectorAll('.qr-day, .qr-menu-item').forEach(function(el) {
        var match = el.getAttribute('data-day') === String(day);
        el.classList.toggle(el.classList.contains('qr-day') ? 'active' : 'shown', match);
      });
      document.body.classList.add('qr-on');
      document.body.classList.remove('qr-menu-open');
    }
    function hideQr() {
      document.body.classList.remove('qr-on');
      document.body.classList.remove('qr-menu-open');
      document.querySelectorAll('.qr-menu-item.shown').forEach(function(el) { el.classList.remove('shown'); });
    }
    // Clicking anywhere else closes the day picker.
    document.addEventListener('click', function(e) {
      if (!e.target.closest || !e.target.closest('.qr-menu')) {
        document.body.classList.remove('qr-menu-open');
      }
    });
    var isEditing = false;
    var MIN_SCALE = 0.5;
    var MAX_SCALE = 2;
    var textScale = ${textScale};
    function applyTextScale() {
      document.documentElement.style.setProperty('--text-scale', String(textScale));
      document.getElementById('sizeReadout').textContent = Math.round(textScale * 100) + '%';
      document.getElementById('sizeUp').disabled = textScale >= MAX_SCALE - 0.001;
      document.getElementById('sizeDown').disabled = textScale <= MIN_SCALE + 0.001;
    }
    function adjustTextScale(delta) {
      // Round to the nearest step so repeated clicks can't drift off 10% marks.
      var next = Math.round((textScale + delta) * 10) / 10;
      next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
      if (next === textScale) return;
      textScale = next;
      applyTextScale();
      // Persist to the active profile so the next timer opens at this size.
      if (window.countdownAPI) {
        window.countdownAPI.setTextScale(textScale);
      }
    }
    applyTextScale();
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
      // Re-base on the current remaining time so an adjustment made after the
      // timer hit 00:00 counts from now, not from an already-past deadline.
      var base = Math.max(0, computeRemaining());
      deadline = Date.now() + Math.max(0, base + seconds) * 1000;
      var wasRunning = timerRunning;
      timerRunning = true;
      updateDisplay();
      if (!wasRunning) {
        startTicking();
      }
    }
    function updateDisplay() {
      remaining = computeRemaining();
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

      updateReturnTime();
      // Same rule as the main window: alert theme while within the alert
      // window, back to normal once time is up.
      document.body.classList.toggle('alert', HAS_ALERT_THEME && remaining > 0 && remaining <= ALERT_SECONDS);

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
    var tickHandle = null;
    function tick() {
      updateDisplay();
      if (!timerRunning || remaining <= 0) {
        stopTicking();
        return;
      }
      // Re-align to the next whole second. A fixed 1000ms interval drifts
      // against the deadline and can skip or repeat a displayed second.
      tickHandle = setTimeout(tick, ((deadline - Date.now()) % 1000 + 1000) % 1000 || 1000);
    }
    function stopTicking() {
      if (tickHandle !== null) {
        clearTimeout(tickHandle);
        tickHandle = null;
      }
    }
    function startTicking() {
      stopTicking();
      tick();
    }
    // A throttled window may not run a pending timeout at all while hidden, so
    // recompute as soon as it is shown or the machine wakes up.
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden && timerRunning) startTicking();
    });
    window.addEventListener('focus', function() {
      if (timerRunning) startTicking();
    });
    startTicking();
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
