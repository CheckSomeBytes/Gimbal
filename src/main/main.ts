import { app, BrowserWindow, ipcMain, shell, clipboard, dialog, Menu, net } from 'electron';
import { autoUpdater } from 'electron-updater';
import { join, dirname, basename, isAbsolute, resolve } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, renameSync, copyFileSync } from 'fs';
import { createHash } from 'crypto';
import QRCode from 'qrcode';
import { WindowHelper } from './windowHelper';
import {
  AppConfig,
  DEFAULT_CONFIG,
  IPC_CHANNELS,
  LinkCheckResult,
  BackupMetadata,
  BackupResult,
  ConfigLoadResult,
  ConfigReplaceResult,
} from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let countdownWindow: BrowserWindow | null = null;
// Lab progress poll the open countdown window's POLL button posts, if any.
let countdownLabPoll: TimerLabPoll | null = null;
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

// Set when config.json exists but could not be read. Saves are refused until a
// backup is restored or a config imported: otherwise the defaults shown in its
// place would be saved over the damaged file, and then backed up over the good
// backups.
let configLoadFailed = false;

// Whether config.json currently holds a config we could read or wrote
// ourselves. Only then is it worth keeping as config.json.bak.
let configFileReadable = false;

// The first load happens before the window opens; the renderer's first
// config:load receives that result so it can tell the user about a recovery.
let initialConfigLoad: ConfigLoadResult | null = null;

function getConfigBackupPath(): string {
  return getDataPath() + '.bak';
}

// A config the app can save: the profile format, with at least one profile.
function isSavableConfig(value: unknown): value is AppConfig {
  const config = value as AppConfig;
  return (
    !!config &&
    typeof config === 'object' &&
    Array.isArray(config.profiles) &&
    config.profiles.length > 0 &&
    config.profiles.every(
      (p) => !!p && typeof p === 'object' && typeof p.id === 'string' &&
        Array.isArray(p.days) && !!p.settings && typeof p.settings === 'object'
    )
  );
}

// A config the app can load. Also accepts the pre-profile format (settings and
// days at the root), which the renderer migrates.
function isLoadableConfig(value: unknown): value is AppConfig {
  if (!value || typeof value !== 'object') return false;
  if (!('profiles' in value)) return Array.isArray((value as AppConfig).days);
  return isSavableConfig(value);
}

// Read and check a config file; null if it is missing, unparseable or not a config.
function readConfigFile(path: string): AppConfig | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    return isLoadableConfig(parsed) ? parsed : null;
  } catch (error) {
    console.error(`Error reading config ${path}:`, error);
    return null;
  }
}

// The config on disk, or null if there is none or it is unreadable. Used by
// the backup code, which must never back up defaults in place of real data.
function readCurrentConfig(): AppConfig | null {
  const config = readConfigFile(getDataPath());
  return config && Array.isArray(config.profiles) ? config : null;
}

// Load the config for the renderer, recovering from a damaged file if possible.
function loadConfig(): ConfigLoadResult {
  const configPath = getDataPath();
  if (!existsSync(configPath)) {
    configLoadFailed = false;
    configFileReadable = false;
    return { config: DEFAULT_CONFIG, status: 'new' };
  }

  const config = readConfigFile(configPath);
  if (config) {
    configLoadFailed = false;
    configFileReadable = true;
    return { config, status: 'ok' };
  }

  // Damaged. Keep a copy before anything can replace it.
  configFileReadable = false;
  const stamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
  const corruptPath = configPath.replace(/\.json$/, '') + `.corrupt-${stamp}.json`;
  try {
    copyFileSync(configPath, corruptPath);
  } catch (error) {
    console.error('Error keeping a copy of the damaged config:', error);
  }

  const previous = readConfigFile(getConfigBackupPath());
  if (previous && writeConfigFile(previous)) {
    configLoadFailed = false;
    console.warn(`[Config] ${configPath} was unreadable; loaded ${getConfigBackupPath()}`);
    return {
      config: previous,
      status: 'recovered',
      message: `Your saved data was damaged, so the previous good copy was loaded. Your most recent change may be missing. The damaged file was kept as ${basename(corruptPath)}.`,
    };
  }

  configLoadFailed = true;
  console.error(`[Config] ${configPath} is unreadable and there is no usable ${getConfigBackupPath()}`);
  return {
    config: DEFAULT_CONFIG,
    status: 'failed',
    message: `Your saved data could not be read. Nothing will be saved until you restore a backup (Settings > System) or import a config. The damaged file was kept as ${basename(corruptPath)}.`,
  };
}

// Write config.json without ever leaving it half-written: write a temp file,
// then rename it over the original. A crash mid-write leaves the old file intact.
function writeConfigFile(config: AppConfig): boolean {
  const configPath = getDataPath();
  const tempPath = configPath + '.tmp';
  try {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(tempPath, JSON.stringify(config, null, 2));

    // Keep the version being replaced as the fallback for a damaged config.json.
    if (configFileReadable && existsSync(configPath)) {
      copyFileSync(configPath, getConfigBackupPath());
    }

    try {
      renameSync(tempPath, configPath);
    } catch (error) {
      // Antivirus or OneDrive can briefly lock the target, which makes the
      // rename fail on Windows. Copying still succeeds in that case.
      console.warn('Atomic config rename failed, copying instead:', error);
      copyFileSync(tempPath, configPath);
      unlinkSync(tempPath);
    }
    configFileReadable = true;
    return true;
  } catch (error) {
    console.error('Error saving config:', error);
    return false;
  }
}

// Save a config sent by the renderer.
function saveConfig(config: AppConfig): boolean {
  if (configLoadFailed) {
    console.warn('[Config] Refusing to save: the config on disk could not be loaded');
    return false;
  }
  if (!isSavableConfig(config)) {
    console.error('[Config] Refusing to save an invalid config');
    return false;
  }
  return writeConfigFile(config);
}

// Replace the whole config (import or restore). Backs up the current config
// first, so the replacement can itself be undone from the backup list.
function replaceConfig(config: AppConfig): ConfigReplaceResult {
  if (!isSavableConfig(config)) {
    return { success: false, error: 'Not a Gimbal configuration file' };
  }

  const current = readCurrentConfig();
  if (current) {
    const directory = resolveBackupDirectory(current);
    const backup = createBackup(current, directory);
    if (!backup.success) {
      return { success: false, error: `Could not back up the current configuration first: ${backup.error}` };
    }
    enforceBackupRetention(directory, getBackupSettings(current)?.maxBackups);
  }

  if (!writeConfigFile(config)) {
    return { success: false, error: 'Could not write the configuration file' };
  }
  configLoadFailed = false;
  return { success: true };
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
  const result = await windowHelper.exclusive(() => windowHelper.send({ op: 'list' }));
  return result.windows || [];
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

// Normalise a link for opening, or null if it must not be opened. Only web and
// mail links: links arrive from shared or imported configs, and openExternal
// will happily launch file:, ms-msdt: and other protocol handlers.
function toOpenableUrl(url: string): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  let candidate = url.trim();
  // Saved links may omit the scheme ("example.com/page").
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) candidate = 'https://' + candidate;
  try {
    const parsed = new URL(candidate);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

// chrome.exe from the standard install locations, or null if not installed.
function findChromeExecutable(): string | null {
  const roots = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env['LOCALAPPDATA']];
  for (const root of roots) {
    if (!root) continue;
    const candidate = join(root, 'Google', 'Chrome', 'Application', 'chrome.exe');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// Open URL in Chrome (fallback to default browser). Chrome is started directly
// with the URL as its own argument; building a `start chrome "<url>"` command
// line let a quote in the URL break out and run other commands.
async function openInChrome(url: string): Promise<boolean> {
  const safeUrl = toOpenableUrl(url);
  if (!safeUrl) {
    console.warn('[Open] Refusing to open link with unsupported scheme:', url);
    return false;
  }

  const chrome = process.platform === 'win32' && !safeUrl.startsWith('mailto:') ? findChromeExecutable() : null;
  if (chrome) {
    const { execFile } = require('child_process');
    execFile(chrome, [safeUrl], (error: Error | null) => {
      if (error) shell.openExternal(safeUrl);
    });
  } else {
    await shell.openExternal(safeUrl);
  }
  return true;
}

// How long to leave the pasted text on the clipboard before putting the
// user's clipboard back. The target reads it when it handles Ctrl+V, which
// SendWait has already delivered; this is margin for slow apps.
const CLIPBOARD_RESTORE_DELAY_MS = 600;

interface ClipboardSnapshot {
  text: string;
  html: string;
  rtf: string;
  image: Electron.NativeImage;
}

function snapshotClipboard(): ClipboardSnapshot {
  return {
    text: clipboard.readText(),
    html: clipboard.readHTML(),
    rtf: clipboard.readRTF(),
    image: clipboard.readImage(),
  };
}

// Put the user's clipboard back after a paste, unless they have copied
// something else in the meantime. Formats Electron can't read (e.g. files
// copied in Explorer) can't be restored; then the pasted text stays.
function restoreClipboard(snapshot: ClipboardSnapshot, pastedText: string): void {
  if (clipboard.readText() !== pastedText) return;
  const data: Electron.Data = {};
  if (snapshot.text) data.text = snapshot.text;
  if (snapshot.html) data.html = snapshot.html;
  if (snapshot.rtf) data.rtf = snapshot.rtf;
  if (!snapshot.image.isEmpty()) data.image = snapshot.image;
  if (Object.keys(data).length > 0) clipboard.write(data);
}

const windowHelper = new WindowHelper();

// Focus the target window and paste text into it. Pastes run one at a time:
// two quick clicks used to race, both pressing Ctrl+V after the second text was
// on the clipboard. Resolves as soon as the paste is done; restoring the
// clipboard happens afterwards, before the next paste starts.
async function focusAndPaste(
  pattern: string,
  matchMode: 'exact' | 'contains' | 'regex',
  textToPaste: string,
  pressEnter: boolean = false
): Promise<{ success: boolean; error?: string }> {
  if (process.platform !== 'win32') {
    // Can't paste here, but leave the text ready to paste by hand.
    clipboard.writeText(textToPaste);
    return { success: false, error: 'Platform not supported' };
  }
  if (typeof pattern !== 'string' || !['exact', 'contains', 'regex'].includes(matchMode)) {
    return { success: false, error: 'Invalid window target settings' };
  }

  return new Promise((resolve) => {
    windowHelper.exclusive(async () => {
      const saved = snapshotClipboard();
      clipboard.writeText(textToPaste);
      const res = await windowHelper.send({ op: 'paste', pattern, mode: matchMode, enter: pressEnter });

      switch (res.status) {
        case 'SUCCESS':
          resolve({ success: true });
          await new Promise((r) => setTimeout(r, CLIPBOARD_RESTORE_DELAY_MS));
          restoreClipboard(saved, textToPaste);
          return;
        // On failure the text stays on the clipboard so it can be pasted by hand.
        case 'NOTFOUND':
          resolve({ success: false, error: 'Window not found matching pattern: ' + pattern });
          return;
        case 'NOFOCUS':
          resolve({
            success: false,
            error: 'Found the window but Windows blocked focusing it. Click the target window once, then try again.',
          });
          return;
        case 'TIMEOUT':
          resolve({
            success: false,
            error: 'The target window did not respond in time. Check it is not frozen, then try again.',
          });
          return;
        default:
          console.error('[Paste] Window helper error:', res.error);
          resolve({ success: false, error: 'Paste failed: ' + (res.error || 'unknown error') });
      }
    });
  });
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
      // Already Electron's default; stated so it can't silently regress.
      sandbox: true,
    },
  });

  // The window must only ever show the app. Dropping a link onto it would
  // otherwise navigate there, and that page would get window.electronAPI.
  // Reloads (import, restore) are not navigations and still work.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) {
      event.preventDefault();
      console.warn('[Security] Blocked navigation to', url);
    }
  });
  // target=_blank links and window.open open in the browser instead.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openInChrome(url);
    return { action: 'deny' };
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

function getBackupSettings(config: AppConfig | null) {
  const profile = config?.profiles?.find((p) => p.id === config.currentProfileId);
  return profile?.settings?.backupSettings;
}

// The backup folder setting travels with the config (export/import, a dev
// config shared between Windows and WSL), so it can hold a path that means
// nothing on this machine. Under Linux "C:\Users\..." is a relative name, and
// mkdir created a folder with that literal name in the working directory.
// Only an absolute path is used; anything else falls back to the default.
function resolveBackupDirectory(config: AppConfig | null): string {
  const setting = getBackupSettings(config)?.backupDirectory;
  if (setting && isAbsolute(setting)) return setting;
  if (setting) {
    console.warn(`[Backup] Ignoring backup directory that is not an absolute path here: ${setting}`);
  }
  return getDefaultBackupDirectory();
}

// SHA256 of the config for change detection. Leaves out fields that change
// without the user editing anything, otherwise every check looks like a change.
function calculateConfigHash(config: AppConfig): string {
  const comparable = {
    ...config,
    profiles: config.profiles.map((p) => ({
      ...p,
      settings: {
        ...p.settings,
        lastLaunchDate: undefined,
        backupSettings: p.settings.backupSettings && {
          ...p.settings.backupSettings,
          lastBackupTime: undefined,
          lastBackupHash: undefined,
        },
      },
    })),
  };
  return createHash('sha256').update(JSON.stringify(comparable)).digest('hex');
}

// Hash of the newest backup in the folder, or null if there is none. Compared
// with the live config so an unchanged config is not backed up again; storing
// the hash in the config instead never matched, because writing it changed the
// config.
function getNewestBackupHash(directory: string): string | null {
  const newest = listBackups(directory)[0];
  if (!newest) return null;
  const config = readConfigFile(newest.filepath);
  return config && Array.isArray(config.profiles) ? calculateConfigHash(config) : null;
}

// A path is only restored or deleted if it is a backup file in the backup folder.
function isBackupFilePath(filepath: string, directory: string): boolean {
  return (
    typeof filepath === 'string' &&
    resolve(dirname(filepath)) === resolve(directory) &&
    /^backup-.*\.json$/.test(basename(filepath))
  );
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
function enforceBackupRetention(directory: string, maxBackups: number | undefined): void {
  try {
    if (!maxBackups || maxBackups < 1 || !existsSync(directory)) {
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
  const s = getBackupSettings(config);
  if (!s?.enabled) return 'disabled';
  return `enabled:${s.intervalMinutes}:${resolveBackupDirectory(config)}`;
}

// Start the automatic backup timer
function startBackupTimer(config: AppConfig): void {
  // Stop any existing timer
  stopBackupTimer();

  activeBackupTimerSignature = getBackupTimerSignature(config);

  // Find backup settings from current profile
  const settings = getBackupSettings(config);
  if (!settings?.enabled) {
    console.log('[Backup] Auto-backup is disabled');
    return;
  }

  const intervalMs = settings.intervalMinutes * 60 * 1000;

  console.log(`[Backup] Starting auto-backup timer (interval: ${settings.intervalMinutes} minutes)`);

  backupTimerHandle = setInterval(() => {
    // Reload config to get latest state. Never back up when it can't be read:
    // that would rotate good backups out in favour of defaults.
    const latestConfig = readCurrentConfig();
    if (!latestConfig || configLoadFailed) {
      console.warn('[Backup] Config unreadable, skipping auto-backup');
      return;
    }
    const latestSettings = getBackupSettings(latestConfig);

    if (!latestSettings?.enabled) {
      console.log('[Backup] Auto-backup disabled, stopping timer');
      stopBackupTimer();
      return;
    }

    const directory = resolveBackupDirectory(latestConfig);

    // Check if config has changed since the newest backup
    if (getNewestBackupHash(directory) === calculateConfigHash(latestConfig)) {
      console.log('[Backup] No changes detected, skipping backup');
      return;
    }

    const result = createBackup(latestConfig, directory);

    if (result.success) {
      console.log('[Backup] Auto-backup created:', result.filepath);

      // Enforce retention policy
      enforceBackupRetention(directory, latestSettings.maxBackups);

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
  ipcMain.handle(IPC_CHANNELS.LOAD_CONFIG, (): ConfigLoadResult => {
    const result = initialConfigLoad ?? loadConfig();
    initialConfigLoad = null;
    return result;
  });

  const handleSaveConfig = (config: AppConfig): boolean => {
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
  };

  ipcMain.handle(IPC_CHANNELS.SAVE_CONFIG, (_, config: AppConfig) => handleSaveConfig(config));

  // Synchronous save, used only to flush a pending (debounced) save while the
  // window is unloading, when an async round trip would never complete.
  ipcMain.on(IPC_CHANNELS.SAVE_CONFIG_SYNC, (event, config: AppConfig) => {
    event.returnValue = handleSaveConfig(config);
  });

  ipcMain.handle(IPC_CHANNELS.EXPORT_CONFIG, async () => {
    const result = await dialog.showSaveDialog({
      title: 'Export Configuration',
      defaultPath: 'gimbal-export.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });

    if (!result.canceled && result.filePath) {
      const config = readCurrentConfig();
      if (!config) return false;
      writeFileSync(result.filePath, JSON.stringify(config, null, 2));
      return true;
    }
    return false;
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_CONFIG, async (): Promise<ConfigReplaceResult> => {
    const result = await dialog.showOpenDialog({
      title: 'Import Configuration',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });

    if (result.canceled || !result.filePaths[0]) {
      return { success: false, canceled: true };
    }
    let config: unknown;
    try {
      config = JSON.parse(readFileSync(result.filePaths[0], 'utf-8'));
    } catch (error) {
      return { success: false, error: `Could not read the file: ${error instanceof Error ? error.message : String(error)}` };
    }
    return replaceConfig(config as AppConfig);
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
    return openInChrome(url);
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

  // POLL button in the countdown window: paste the lab progress poll into the
  // target window, same as the main window's lab poll.
  ipcMain.handle(IPC_CHANNELS.TIMER_SEND_LAB_POLL, async () => {
    if (!countdownLabPoll) {
      return { success: false, error: 'No lab poll for this timer' };
    }
    const { pattern, matchMode, text } = countdownLabPoll;
    return focusAndPaste(pattern, matchMode, text);
  });

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
        const config = readCurrentConfig();
        const currentProfile = config?.profiles.find((p) => p.id === config.currentProfileId);
        const includeBeta = currentProfile?.settings.includeBetaUpdates ?? false;
        autoUpdater.allowPrerelease = includeBeta;
        autoUpdater.channel = includeBeta ? 'beta' : 'latest';
        console.log(`[Update] Checking for updates (includeBeta: ${includeBeta}, channel: ${autoUpdater.channel})...`);
        const result = await autoUpdater.checkForUpdates();
        console.log('[Update] Check result:', {
          current: app.getVersion(),
          latest: result?.updateInfo.version,
          updateAvailable: result?.isUpdateAvailable ?? false,
        });
        // isUpdateAvailable, not a version comparison: a beta user who turns
        // betas off would otherwise be offered the older stable release.
        return {
          updateAvailable: result?.isUpdateAvailable ?? false,
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
        const config = readCurrentConfig();
        const currentProfile = config?.profiles.find((p) => p.id === config.currentProfileId);
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
    const config = readCurrentConfig();
    if (!config || configLoadFailed) {
      return { success: false, error: 'The current configuration could not be read' };
    }
    const directory = resolveBackupDirectory(config);

    const result = createBackup(config, directory);

    if (result.success) {
      enforceBackupRetention(directory, getBackupSettings(config)?.maxBackups);
    }

    return result;
  });

  ipcMain.handle(IPC_CHANNELS.BACKUP_LIST, async (): Promise<BackupMetadata[]> => {
    return listBackups(resolveBackupDirectory(readCurrentConfig()));
  });

  // Restores and saves in one step, so a stale save from the renderer can't
  // land in between. The renderer reloads afterwards.
  ipcMain.handle(
    IPC_CHANNELS.BACKUP_RESTORE,
    async (_, filepath: string): Promise<ConfigReplaceResult> => {
      if (!isBackupFilePath(filepath, resolveBackupDirectory(readCurrentConfig()))) {
        return { success: false, error: 'Not a backup file in the backup folder' };
      }
      const restored = restoreBackup(filepath);
      if (!restored.success || !restored.config) {
        return { success: false, error: restored.error };
      }
      return replaceConfig(restored.config);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.BACKUP_DELETE,
    async (_, filepath: string): Promise<{ success: boolean; error?: string }> => {
      if (!isBackupFilePath(filepath, resolveBackupDirectory(readCurrentConfig()))) {
        return { success: false, error: 'Not a backup file in the backup folder' };
      }
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
  /** Text before the end time under the timer; defaults to "Back at". */
  endLabel?: string;
  /** Each day's course eval; the QR button lets the instructor pick one. */
  evalLinks?: { url: string; dayNumber: number; dayName: string }[];
  /** Day# of the day selected in the main window, highlighted in the picker. */
  currentEvalDay?: number | null;
  /** Lab progress poll for a lab timer; shows a POLL button in the window. */
  labPoll?: TimerLabPoll | null;
}

interface TimerLabPoll {
  labNumber: string;
  text: string;
  pattern: string;
  matchMode: 'exact' | 'contains' | 'regex';
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

// Embed a string as a JS literal inside an inline <script>. JSON.stringify
// alone would let "</script>" in the value close the tag.
function escapeJsString(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

// Open a countdown timer window
// Theme colours and font come from the config (which can be shared or
// imported) and are written straight into the countdown page's <style>. Drop
// the characters that could end a declaration or the style block itself.
function cssValue(value: string | undefined, fallback: string): string {
  const cleaned = typeof value === 'string' ? value.replace(/[<>{};\\]/g, '').trim() : '';
  return cleaned || fallback;
}

function sanitizeTimerTheme(theme: TimerTheme): TimerTheme {
  const alert = theme.alert;
  return {
    ...theme,
    background: cssValue(theme.background, '#1a1a2e'),
    text: cssValue(theme.text, '#eaeaea'),
    textMuted: cssValue(theme.textMuted, '#888888'),
    accent: cssValue(theme.accent, '#4a9eff'),
    success: cssValue(theme.success, '#6bcf7f'),
    danger: cssValue(theme.danger, '#ff6b6b'),
    fontFamily: cssValue(theme.fontFamily, 'monospace'),
    border: theme.border === undefined ? undefined : cssValue(theme.border, '#4a9eff'),
    alert: alert
      ? {
          background: cssValue(alert.background, '#1a1a2e'),
          text: cssValue(alert.text, '#eaeaea'),
          textMuted: cssValue(alert.textMuted, '#888888'),
          accent: cssValue(alert.accent, '#4a9eff'),
          danger: cssValue(alert.danger, '#ff6b6b'),
          border: alert.border === undefined ? undefined : cssValue(alert.border, '#4a9eff'),
        }
      : alert,
  };
}

function openCountdownTimer(
  totalMinutes: number,
  message: string,
  rawTheme: TimerTheme,
  evalQrs: EvalQr[] = []
): boolean {
  const theme = sanitizeTimerTheme(rawTheme);
  try {
    // Close existing countdown window if open
    if (countdownWindow && !countdownWindow.isDestroyed()) {
      countdownWindow.close();
    }

    countdownLabPoll = theme.labPoll || null;

    // Opaque, not transparent: Windows composites transparent (layered)
    // windows differently, and they stopped repainting while unfocused and
    // dropped out of the alt-tab / topmost order. The page paints its own
    // background edge to edge, so nothing is lost visually.
    countdownWindow = new BrowserWindow({
      width: 960,
      height: 540,
      minWidth: 320,
      minHeight: 200,
      alwaysOnTop: true,
      frame: false,
      resizable: true,
      backgroundColor: /^#[0-9a-f]{6}$/i.test(theme.background) ? theme.background : '#000000',
      title: 'Countdown Timer',
      autoHideMenuBar: true,
      roundedCorners: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: join(__dirname, '../preload/countdownPreload.js'),
        // Keep ticking while unfocused or covered: the timer is often screen
        // shared from the background, and Chromium otherwise throttles it.
        backgroundThrottling: false,
        // The end-of-timer tones play without a click in the window.
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    // 'screen-saver' sits above other topmost windows (Zoom's share toolbar,
    // etc.). Windows can still demote a topmost window when another app
    // activates, so re-assert it whenever the timer loses focus.
    const win = countdownWindow;
    win.setAlwaysOnTop(true, 'screen-saver');
    win.on('blur', () => {
      if (!win.isDestroyed()) {
        win.setAlwaysOnTop(true, 'screen-saver');
        win.moveTop();
      }
    });

    // Create HTML content for the countdown timer
    // Rounded: the class start timer passes fractional minutes so it lands
    // on the start time exactly.
    const totalSeconds = Math.round(totalMinutes * 60);
    const endLabel = escapeJsString(theme.endLabel || 'Back at');
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
    const labPoll = theme.labPoll || null;

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
    .close-btn, .qr-btn, .qr-menu, .time-controls, .size-controls, .poll-btn {
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
    .poll-btn {
      position: absolute;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--bg);
      border: 2px solid var(--text-muted);
      color: var(--text-muted);
      font-family: ${theme.fontFamily};
      font-size: 10px;
      cursor: pointer;
      padding: 4px 8px;
      white-space: nowrap;
      opacity: 0;
      transition: opacity 0.2s;
    }
    body:hover .poll-btn, .poll-btn.sent, .poll-btn.failed {
      opacity: 1;
    }
    .poll-btn:hover:not(:disabled) {
      border-color: var(--accent);
      color: var(--accent);
    }
    .poll-btn:disabled { cursor: default; }
    .poll-btn.sent { border-color: var(--success); color: var(--success); }
    .poll-btn.failed { border-color: var(--danger); color: var(--danger); }
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
    /* Time's up: the whole window flashes between blue and red, with white
       text so it stays readable on both. Fixed colors so every theme (and the
       break alert theme) looks the same at 00:00. */
    body.done {
      --text: #ffffff;
      --text-muted: #ffffff;
      --border: #ffffff;
      animation: done-flash 1s steps(1, end) infinite;
    }
    body.done .timer.done, body.done .message, body.done .return-time { color: #ffffff; animation: none; }
    @keyframes done-flash {
      0% { background-color: #1f5fbf; }
      50% { background-color: #c62828; }
    }
  </style>
</head>
<body>
  <button class="close-btn" onclick="window.close()" title="Close">X</button>
${labPoll ? `  <button class="poll-btn" id="pollBtn" onclick="sendLabPoll()" title="Post the lab ${escapeHtml(labPoll.labNumber)} progress poll">LAB ${escapeHtml(labPoll.labNumber)} POLL</button>
` : ''}${evalQrs.length ? `  <button class="qr-btn" onclick="toggleQrMenu(event)" title="Show a day's eval QR code">QR</button>
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
      document.getElementById('returnTime').textContent = ${endLabel} + ' ' + backAt.toLocaleTimeString('en-US', opts);
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
    var POLL_LABEL = document.getElementById('pollBtn') ? document.getElementById('pollBtn').textContent : '';
    var pollResetHandle = null;
    function sendLabPoll() {
      var btn = document.getElementById('pollBtn');
      if (!btn || !window.countdownAPI || btn.disabled) return;
      btn.disabled = true;
      btn.classList.remove('sent', 'failed');
      btn.textContent = 'SENDING...';
      window.countdownAPI.sendLabPoll().then(function(result) {
        var ok = result && result.success;
        btn.textContent = ok ? 'POLL SENT!' : 'POLL FAILED';
        btn.title = ok ? btn.title : ((result && result.error) || 'Failed to send lab poll');
        btn.classList.add(ok ? 'sent' : 'failed');
      }, function() {
        btn.textContent = 'POLL FAILED';
        btn.classList.add('failed');
      }).then(function() {
        btn.disabled = false;
        clearTimeout(pollResetHandle);
        pollResetHandle = setTimeout(function() {
          btn.textContent = POLL_LABEL;
          btn.classList.remove('sent', 'failed');
        }, 3000);
      });
    }
    // Retro square-wave beeps: a quiet one at the one-minute mark and a louder
    // three-note chime at 00:00.
    var audioCtx = null;
    function playNotes(notes, volume) {
      try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        var t = audioCtx.currentTime + 0.05;
        notes.forEach(function(note) {
          var osc = audioCtx.createOscillator();
          var gain = audioCtx.createGain();
          osc.type = 'square';
          osc.frequency.value = note.freq;
          // Short ramps avoid clicks at the start and end of each note.
          gain.gain.setValueAtTime(0, t);
          gain.gain.linearRampToValueAtTime(volume, t + 0.01);
          gain.gain.setValueAtTime(volume, t + note.dur - 0.03);
          gain.gain.linearRampToValueAtTime(0, t + note.dur);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(t);
          osc.stop(t + note.dur);
          t += note.dur + 0.06;
        });
      } catch (e) {
        // No audio device: the visual cues still work.
      }
    }
    function playOneMinuteTone() {
      playNotes([{ freq: 880, dur: 0.15 }], 0.04);
    }
    function playEndTone() {
      playNotes([
        { freq: 659, dur: 0.18 }, { freq: 880, dur: 0.18 }, { freq: 1319, dur: 0.4 },
        { freq: 659, dur: 0.18 }, { freq: 880, dur: 0.18 }, { freq: 1319, dur: 0.4 }
      ], 0.15);
    }
    // Remaining seconds at the last update, so each tone fires once when its
    // mark is crossed. Starting from the full duration means a timer opened
    // with a minute or less left doesn't sound the one-minute tone.
    var lastRemaining = ${totalSeconds};
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

      if (lastRemaining > 60 && remaining <= 60 && remaining > 0) {
        playOneMinuteTone();
      } else if (lastRemaining > 0 && remaining <= 0) {
        playEndTone();
      }
      lastRemaining = remaining;

      document.body.classList.toggle('done', remaining <= 0);
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

    // Closing a previous timer fires its 'closed' after the replacement is
    // open, so only clear state that still belongs to this window.
    win.on('closed', () => {
      if (countdownWindow === win) {
        countdownWindow = null;
        countdownLabPoll = null;
      }
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
  // Read (and if needed recover) the config before the window can ask for it.
  initialConfigLoad = loadConfig();
  const config = initialConfigLoad.config;
  const currentProfile = config.profiles?.find((p) => p.id === config.currentProfileId);

  setupIPC();
  createWindow();

  // Start the paste helper now so the first paste of the session is fast too.
  if (process.platform === 'win32') {
    windowHelper.start().catch((error) => console.error('[WindowHelper] Could not start:', error));
  }

  // Initialize backup system. Failures here (e.g. a backup folder on a drive
  // that isn't connected) must not stop the update check below.
  try {
    const diskConfig = initialConfigLoad.status === 'failed' ? null : readCurrentConfig();
    if (diskConfig) {
      const backupDir = resolveBackupDirectory(diskConfig);
      if (listBackups(backupDir).length === 0) {
        console.log('[Backup] No existing backups found, creating initial backup');
        createBackup(diskConfig, backupDir);
      }
      startBackupTimer(diskConfig);
    }
  } catch (error) {
    console.error('[Backup] Could not initialise backups:', error);
  }

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
  windowHelper.stop();
});
