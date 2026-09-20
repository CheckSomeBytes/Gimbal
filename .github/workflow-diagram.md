# Git Workflow Diagram

```
                    PRODUCTION (master)
                           │
                           │ v1.0.0
                           ●─────────────────────────────────┐
                           │                                 │
                           │                    HOTFIX       │
                           │                   (hotfix/*)    │
                           │                        │        │
                           │                        ●        │
                           │                        │        │
                           │                        ↓        │
                           ●←───────────────────────┘        │
                           │ v1.0.1 (hotfix merged)          │
                           │                                 │
                           │                                 │
    ┌──────────────────────┘                                 │
    │                                                        │
    │                                                        ↓
    │              DEVELOPMENT (develop)                     │
    │                      │                                 │
    │                      ● (created from master)           │
    │                      │                                 │
    │         ┌────────────┴────────────┬──────────┐        │
    │         │                         │          │        │
    │    FEATURE 1               FEATURE 2    BUGFIX        │
    │  (feature/*)              (feature/*)  (bugfix/*)     │
    │         │                         │          │        │
    │         ●                         ●          ●        │
    │         │                         │          │        │
    │         ↓                         ↓          ↓        │
    │         └────────────┬────────────┴──────────┘        │
    │                      ↓                                 │
    │                      ● (features merged to develop)    │
    │                      │                                 │
    │                      │ v1.1.0-beta.1 (beta testing)   │
    │                      ●                                 │
    │                      │                                 │
    │                      │ (more testing)                  │
    │                      │                                 │
    └─────────────────────→●                                 │
                           │ (develop merged to master)      │
                           │                                 │
                           │ v1.1.0 (production release)     │
                           ●←────────────────────────────────┘
                           │ (merge back to develop)
                           │
                          ...


LEGEND:
───────  Main branch timeline
───────→ Merge direction
●        Commit point / Merge point
v1.0.0   Version tag

BRANCH TYPES:
• master       - Production releases (v1.0.0, v1.1.0)
• develop      - Integration branch (v1.1.0-beta.1)
• feature/*    - New features
• bugfix/*     - Bug fixes
• hotfix/*     - Emergency production fixes
```

## Update Flow for End Users

```
┌─────────────────────────────────────────────────┐
│  Developer pushes tag: v1.2.0                   │
└─────────────────┬───────────────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────────────┐
│  GitHub Actions: release.yml triggered          │
│  • Builds app                                   │
│  • Creates installer (Gimbal-Setup-1.2.0)  │
│  • Uploads to GitHub Release                    │
│  • Generates latest.yml                         │
└─────────────────┬───────────────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────────────┐
│  User opens Gimbal (current v1.1.0)        │
│  • App checks GitHub on startup                 │
│  • Finds update available: v1.2.0               │
│  • Shows notification in settings               │
└─────────────────┬───────────────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────────────┐
│  User clicks "Download Update"                  │
│  • Downloads installer from GitHub Release      │
│  • Shows progress bar                           │
│  • Enables "Install" button when ready          │
└─────────────────┬───────────────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────────────┐
│  User clicks "Restart & Install"                │
│  • App quits                                    │
│  • Installer runs                               │
│  • App restarts with v1.2.0                     │
└─────────────────────────────────────────────────┘
```

## Beta vs Stable Channels

```
BETA CHANNEL (opt-in, for testers)
├── v1.2.0-beta.1  ← First beta
├── v1.2.0-beta.2  ← Bug fixes in beta
├── v1.2.0-beta.3  ← More testing
└── [Testing complete]
         ↓
STABLE CHANNEL (default, for all users)
└── v1.2.0  ← Promoted to stable after beta testing
```

**Note:** Currently the app only supports the stable channel. Beta channel support could be added later with a setting in the app.
