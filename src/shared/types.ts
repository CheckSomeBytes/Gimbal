// Core data types for Gimbal

export interface Profile {
  id: string;
  name: string;
  settings: Settings;
  days: Day[];
}

export interface AppConfig {
  currentProfileId: string;
  profiles: Profile[];
  // Legacy fields for migration - will be removed after migration
  settings?: Settings;
  days?: Day[];
}

export interface ScheduledTime {
  id: string;
  label: string;
  time: string; // HH:MM format (24-hour)
  duration: number; // Duration in minutes
  enabled: boolean;
  isBreak?: boolean; // Whether to show in time estimate popup as a break option
}

export type FontSize = 'small' | 'medium' | 'large';

export interface BackupSettings {
  enabled: boolean;
  intervalMinutes: number;
  maxBackups: number;
  backupDirectory: string;
  lastBackupTime?: string;
  lastBackupHash?: string;
}

export interface BackupMetadata {
  filename: string;
  filepath: string;
  timestamp: string;
  size: number;
  profileCount: number;
  dayCount: number;
}

export interface BackupResult {
  success: boolean;
  error?: string;
  filepath?: string;
  metadata?: BackupMetadata;
}

export interface Settings {
  windowTarget: WindowTarget;
  checkLinksOnStartup: boolean;
  theme: Theme;
  customThemes?: Theme[]; // User-created custom themes
  fontSize: FontSize;
  labPollTemplate: string;
  timezone: string;
  scheduledTimes: ScheduledTime[];
  breakAlertTheme: Theme | null; // Theme to use when within 5 minutes of a break
  breakAlertMinutes: number; // Minutes before break to trigger alert theme (default 5)
  lastLaunchDate?: string; // ISO date string of last launch
  timerFontFamily?: string; // Font family for countdown timer (falls back to theme.fontFamily)
  labNotes?: Record<string, string>; // Lab notes keyed by lab number (e.g., "4.1")
  todos?: Todo[]; // Instructor todo list (per profile)
  backupSettings?: BackupSettings;
  includeBetaUpdates?: boolean; // Whether to include beta releases in update checks (default false)
}

// Font size presets (in pixels) - separate presets for retro (pixel) and modern fonts
export const FONT_SIZE_PRESETS_RETRO: Record<FontSize, { xs: number; sm: number; base: number; lg: number }> = {
  small: { xs: 7, sm: 9, base: 11, lg: 13 },
  medium: { xs: 8, sm: 10, base: 12, lg: 14 },
  large: { xs: 10, sm: 12, base: 14, lg: 16 },
};

export const FONT_SIZE_PRESETS_MODERN: Record<FontSize, { xs: number; sm: number; base: number; lg: number }> = {
  small: { xs: 11, sm: 13, base: 15, lg: 17 },
  medium: { xs: 12, sm: 14, base: 16, lg: 18 },
  large: { xs: 14, sm: 16, base: 18, lg: 20 },
};

export interface WindowTarget {
  matchMode: 'exact' | 'contains' | 'regex';
  pattern: string;
  pressEnterAfterPaste: boolean; // Auto-press Enter after pasting URLs and Notes
}

export interface Theme {
  name: string;
  isCustom: boolean;
  colors: ThemeColors;
  fontFamily: string;
}

export interface ThemeColors {
  primary: string;
  secondary: string;
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  accent: string;
  border: string;
  danger: string;
  success: string;
}

export interface Day {
  id: string;
  name: string;
  order: number;
  dayNumber?: number;
  labCount?: number;
  sections: Section[];
}

export interface Section {
  id: string;
  name: string;
  order: number;
  isCollapsed: boolean;
  items: SectionItem[];
  polls: Poll[];
  assignedLab?: string; // Lab number assigned to this section (e.g., "4.1")
}

export type SectionItem = Link | Note;

export interface AdditionalUrl {
  url: string;
  title: string;
  status?: LinkStatus;
}

export interface Link {
  type: 'link';
  id: string;
  url: string;
  title: string;
  customTitle?: string;
  additionalUrls?: AdditionalUrl[];
  order: number;
  lastChecked?: string;
  status: LinkStatus;
}

export type LinkStatus = 'ok' | 'broken' | 'timeout' | 'unchecked' | 'pending';

export interface Note {
  type: 'note';
  id: string;
  title: string;
  content: string;
  order: number;
}

export interface Todo {
  id: string;
  text: string;
  done: boolean;
  order: number;
  createdAt: string;
}

export interface Poll {
  id: string;
  title: string;
  content: string;
  order: number;
  sent: boolean;
}

// IPC channel names
export const IPC_CHANNELS = {
  // Storage
  LOAD_CONFIG: 'config:load',
  SAVE_CONFIG: 'config:save',
  EXPORT_CONFIG: 'config:export',
  IMPORT_CONFIG: 'config:import',

  // Links
  FETCH_TITLE: 'link:fetch-title',
  CHECK_LINK: 'link:check',
  CHECK_ALL_LINKS: 'link:check-all',
  LINK_CHECK_RESULT: 'link:check-result',
  OPEN_IN_CHROME: 'link:open-chrome',

  // Window
  FOCUS_AND_PASTE: 'window:focus-paste',
  GET_WINDOWS: 'window:get-list',
  OPEN_COUNTDOWN_TIMER: 'window:open-countdown',

  // App
  GET_APP_PATH: 'app:get-path',
  QUIT_APP: 'app:quit',
  MINIMIZE_APP: 'app:minimize',

  // Auto-updater
  CHECK_FOR_UPDATES: 'app:check-for-updates',
  DOWNLOAD_UPDATE: 'app:download-update',
  INSTALL_UPDATE: 'app:install-update',
  GET_APP_VERSION: 'app:get-version',

  // Backups
  BACKUP_CREATE_MANUAL: 'backup:create-manual',
  BACKUP_LIST: 'backup:list',
  BACKUP_RESTORE: 'backup:restore',
  BACKUP_DELETE: 'backup:delete',
  BACKUP_SELECT_DIRECTORY: 'backup:select-directory',
  BACKUP_GET_DEFAULT_DIRECTORY: 'backup:get-default-directory',
  BACKUP_CREATED: 'backup:created',
} as const;

// Default theme - 8-bit style
export const DEFAULT_THEME: Theme = {
  name: '8-Bit Classic',
  isCustom: false,
  fontFamily: '"Lexend", sans-serif',
  colors: {
    primary: '#4a9eff',
    secondary: '#ff6b9d',
    background: '#1a1a2e',
    surface: '#16213e',
    text: '#eaeaea',
    textMuted: '#888888',
    accent: '#ffd93d',
    border: '#4a9eff',
    danger: '#ff4757',
    success: '#2ed573',
  },
};

// Preset themes from Coolors.co
export const THEME_WARM_AUTUMN_GLOW: Theme = {
  name: 'Warm Autumn Glow',
  isCustom: false,
  fontFamily: '"Press Start 2P", monospace',
  colors: {
    primary: '#F77F00',
    secondary: '#FCBF49',
    background: '#003049',
    surface: '#00405f',
    text: '#EAE2B7',
    textMuted: '#b8ad8a',
    accent: '#FCBF49',
    border: '#F77F00',
    danger: '#D62828',
    success: '#2ed573',
  },
};

export const THEME_SUNNY_BEACH_DAY: Theme = {
  name: 'Sunny Beach Day',
  isCustom: false,
  fontFamily: '"Press Start 2P", monospace',
  colors: {
    primary: '#2A9D8F',
    secondary: '#E9C46A',
    background: '#264653',
    surface: '#2d5561',
    text: '#f4f4f4',
    textMuted: '#a8c5c0',
    accent: '#E9C46A',
    border: '#2A9D8F',
    danger: '#E76F51',
    success: '#2A9D8F',
  },
};

export const THEME_DARK_SUNSET: Theme = {
  name: 'Dark Sunset',
  isCustom: false,
  fontFamily: '"Press Start 2P", monospace',
  colors: {
    primary: '#E09F3E',
    secondary: '#FFF3B0',
    background: '#540B0E',
    surface: '#6b1215',
    text: '#FFF3B0',
    textMuted: '#c9b98a',
    accent: '#FFF3B0',
    border: '#E09F3E',
    danger: '#9E2A2B',
    success: '#335C67',
  },
};

// Cool Mist - Light and airy blue palette
export const THEME_COOL_MIST: Theme = {
  name: 'Cool Mist',
  isCustom: false,
  fontFamily: '"Press Start 2P", monospace',
  colors: {
    primary: '#5C6B73',
    secondary: '#9DB4C0',
    background: '#253237',
    surface: '#5C6B73',
    text: '#E0FBFC',
    textMuted: '#C2DFE3',
    accent: '#C2DFE3',
    border: '#9DB4C0',
    danger: '#C44900',
    success: '#9DB4C0',
  },
};

// Dark Ember - Deep warm palette with burnt orange accents
export const THEME_DARK_EMBER: Theme = {
  name: 'Dark Ember',
  isCustom: false,
  fontFamily: '"Press Start 2P", monospace',
  colors: {
    primary: '#C44900',
    secondary: '#EFD6AC',
    background: '#04151F',
    surface: '#183A37',
    text: '#EFD6AC',
    textMuted: '#b8a87d',
    accent: '#C44900',
    border: '#EFD6AC',
    danger: '#C44900',
    success: '#183A37',
  },
};

// Hacker - Classic black and green terminal theme
export const THEME_HACKER: Theme = {
  name: 'Hacker',
  isCustom: false,
  fontFamily: '"Press Start 2P", monospace',
  colors: {
    primary: '#00FF00',
    secondary: '#33FF33',
    background: '#000000',
    surface: '#0a0a0a',
    text: '#00FF00',
    textMuted: '#00AA00',
    accent: '#00FF00',
    border: '#00AA00',
    danger: '#FF0000',
    success: '#00FF00',
  },
};

// All preset themes
export const PRESET_THEMES: Theme[] = [
  DEFAULT_THEME,
  THEME_WARM_AUTUMN_GLOW,
  THEME_SUNNY_BEACH_DAY,
  THEME_DARK_SUNSET,
  THEME_COOL_MIST,
  THEME_DARK_EMBER,
  THEME_HACKER,
];

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  enabled: true,
  intervalMinutes: 60,
  maxBackups: 10,
  backupDirectory: '',
  lastBackupTime: undefined,
  lastBackupHash: undefined,
};

export const DEFAULT_SETTINGS: Settings = {
  windowTarget: {
    matchMode: 'contains',
    pattern: '',
    pressEnterAfterPaste: false,
  },
  checkLinksOnStartup: false,
  theme: DEFAULT_THEME,
  fontSize: 'medium',
  labPollTemplate: '/poll "How are we doing on Lab <LAB_NUMBER>? :lab_coat:" ":exclamation: Having Issues" ":timer_clock:Need More Time" ":white_check_mark: Finished the Lab!" no-preview anonymous',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  scheduledTimes: [],
  breakAlertTheme: null,
  breakAlertMinutes: 5,
  includeBetaUpdates: false,
};

// Common timezones for the dropdown
export const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Phoenix',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Australia/Perth',
  'Pacific/Auckland',
  'UTC',
];

export const DEFAULT_PROFILE: Profile = {
  id: 'default',
  name: 'Default Profile',
  settings: DEFAULT_SETTINGS,
  days: [],
};

export const DEFAULT_CONFIG: AppConfig = {
  currentProfileId: 'default',
  profiles: [DEFAULT_PROFILE],
};

// Link check result
export interface LinkCheckResult {
  url: string;
  status: LinkStatus;
  statusCode?: number;
  error?: string;
}

// Window info for selection
export interface WindowInfo {
  title: string;
  handle: number;
}
