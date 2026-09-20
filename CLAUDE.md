# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gimbal (formerly TeachersPet) is a Windows desktop application (Electron + React + TypeScript) for instructors to manage and share links with students during class sessions. Features a retro 8-bit themed UI with multi-profile support, link health checking, and window automation for pasting URLs into target applications (e.g., Zoom chat).

## Development Commands

```bash
npm run dev         # Start dev server with hot reload
npm run build       # Build for production (Vite)
npm run preview     # Preview production build
npm run package     # Create Windows installer using electron-builder
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
- `window:open-countdown` - Standalone countdown timer window

### Windows Automation
The app uses PowerShell for all Windows API interactions:
- Window enumeration via `Get-Process`
- Window matching supports exact, contains, and regex modes
- Focus and paste simulates Ctrl+V after bringing window to foreground
- No native Node bindings required

### Storage
- Location: `data/config.json` (in app folder)
- Format: JSON with automatic migration from single-profile to multi-profile format
- Persists on every state change

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
- Edit mode enables multi-select for bulk move/delete operations
- Validation modal prompts user if app hasn't been launched in >4 days
