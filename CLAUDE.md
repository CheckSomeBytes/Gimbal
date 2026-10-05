# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gimbal (formerly TeachersPet) is a desktop application for Windows, macOS and Linux (Electron + React + TypeScript) for instructors to manage and share links with students during class sessions. Features a retro 8-bit themed UI with multi-profile support, link health checking, and window automation for pasting URLs into target applications (e.g., Zoom chat).

## Development Commands

```bash
npm run dev         # Start dev server with hot reload
npm run build       # Build for production (Vite)
npm run preview     # Preview production build
npm run package     # Package for the current OS using electron-builder
npm run package:win   # Windows: NSIS installer + portable exe
npm run package:mac   # macOS: dmg + zip for arm64 and x64 (must run on a Mac)
npm run package:linux # Linux: AppImage + deb
```

## Architecture

### Process Model (Electron)
- **Main Process** (`src/main/main.ts`): Handles IPC, file I/O, window management, link checking, and Windows automation via PowerShell
- **Preload** (`src/preload/preload.ts`): Context-isolated IPC bridge
- **Renderer** (`src/renderer/`): React frontend with Zustand state management

### State Management
All application state lives in a single Zustand store (`src/renderer/stores/appStore.ts`, ~1500 lines). This includes:
- Profile management (multiple independent configurations)
- Days/sections/items CRUD
- UI state (sidebar, modals, notifications, edit mode)
- Link status tracking
- Break alert scheduling

### Data Model Hierarchy
```
AppConfig
└── Profile[] (id, name, settings, days)
    └── Day[] (id, name, order, sections)
        └── Section[] (id, name, order, isCollapsed, items, polls)
            ├── Link (type: 'link', url, title, status, additionalUrls)
            └── Note (type: 'note', title, content)
```

Items (Links and Notes) are stored as a union type `SectionItem` in a single `items` array per section.

### Key IPC Channels
- `config:load/save/export/import` - Configuration persistence
- `link:fetch-title` - Extract page title from URL (uses native fetch, 8s timeout)
- `link:check/check-all/check-result` - Link health checking (HEAD then GET fallback, 10s timeout)
- `window:focus-paste` - PowerShell automation to focus window by title pattern and simulate Ctrl+V
- `window:get-list` - Enumerate open windows via PowerShell
- `window:automation-support` - Whether this platform can focus another window and paste, with a reason when it can't
- `window:request-automation-access` - Ask the OS to prompt for the permission auto-paste needs (macOS Accessibility)
- `window:open-countdown` - Standalone countdown timer window

### Window Automation
Window listing and focus-and-paste live in `src/main/automation/`, behind the `WindowAutomation` interface (`unsupportedReason`, `listWindows`, `focusAndPaste`). `index.ts` picks a backend by `process.platform` and always copies the text to the clipboard first; platforms without a backend fall back to `unsupported.ts`. Shared title matching is in `src/shared/windowMatch.ts`.

The Windows backend (`windows.ts`) uses PowerShell for all Windows API interactions:
- Window enumeration via `Get-Process`
- Window matching supports exact, contains, and regex modes
- Focus and paste simulates Ctrl+V after bringing window to foreground
- No native Node bindings required

The Linux backend (`linux.ts`) works on X11 only, using `wmctrl` (list and activate windows) and `xdotool` (send Ctrl+V / Enter). Under Wayland, or when either tool is missing, it reports itself unsupported with a reason that Settings shows.

The macOS backend (`mac.ts`) runs AppleScript against System Events via `osascript`, passing the target pid and title as script arguments. It needs Accessibility permission, checked live with `systemPreferences.isTrustedAccessibilityClient` (the renderer re-checks on window focus, and Settings offers GRANT ACCESS), plus Automation permission for System Events, which needs `NSAppleEventsUsageDescription` in the packaged app's Info.plist (set under `build.mac.extendInfo` in `package.json`).

### Packaging and Releases
- Config is the `build` field in `package.json`. Release workflows build each platform on its own runner with `--publish never`, then a single job uploads every artifact to the GitHub release.
- macOS: `build/afterPack.js` ad-hoc signs the app, because electron-builder 24 leaves an invalid signature without a certificate and Apple Silicon refuses to run it. Real signing and notarization happen in CI only when the `MAC_CSC_LINK`/`MAC_CSC_KEY_PASSWORD` and `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` secrets exist. Don't set `CSC_IDENTITY_AUTO_DISCOVERY=false` when signing: it makes electron-builder ignore `CSC_LINK`. Hardened-runtime entitlements (including Apple Events for auto-paste) are in `build/entitlements.mac.plist`.
- Linux: icons come from `build/icons/` (one PNG per size; a single PNG installs under `hicolor/0x0`). The deb recommends `wmctrl` and `xdotool` for auto-paste.

### Storage
- Location: `data/config.json` (in app folder)
- Format: JSON with automatic migration from single-profile to multi-profile format
- Persists on every state change
- Backup folder: always go through `getBackupDirectory()` in `main.ts`, never `backupSettings.backupDirectory` directly. The configured folder can come from another computer or OS (e.g. a Windows path on macOS), so `src/main/backupDirectory.ts` falls back to the default when it isn't a native absolute path or can't be written. The setting itself is left unchanged, and Settings shows where backups actually go.

## Component Organization

```
src/renderer/components/
├── Layout/        # Header, Sidebar, MainContent
├── Day/           # DayView
├── Section/       # Section, AddItemForm, AddPollForm
├── Link/          # LinkItem
├── Note/          # NoteItem
├── Poll/          # PollItem
├── Settings/      # SettingsModal
└── common/        # Notifications, MoveDialog, ValidationModal
```

## Theming

Five preset 8-bit themes available, plus custom theme editor. Themes use CSS custom properties. Break alert system automatically switches theme when approaching scheduled break times.

## Important Rules

- When making code changes, ensure the change applies across all themes unless specifically stated otherwise.

## Important Patterns

- Link checking uses streaming results via IPC (results sent individually, not batched)
- 500ms delay between link checks to avoid rate limiting
- Title fetching uses native `fetch` API for speed; link checking uses Electron's `net` module
- Send/paste buttons call the store's `sendToTargetWindow` action, not `electronAPI.focusAndPaste` directly. Where auto-paste isn't supported (`automationSupported` is false) it copies to the clipboard and notifies instead, returning `copiedOnly: true` so callers skip their "sent" message. Buttons are relabelled from SEND to COPY in that case.
- Edit mode enables multi-select for bulk move/delete operations
- Validation modal prompts user if app hasn't been launched in >4 days
