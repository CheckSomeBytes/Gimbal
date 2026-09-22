import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useOverlayDismiss } from '../../hooks/useOverlayDismiss';
import { DEFAULT_THEME, Theme, ThemeColors, PRESET_THEMES, TIMEZONES, ScheduledTime, FontSize, BackupMetadata } from '../../../shared/types';
import './SettingsModal.css';

type SettingsTab = 'general' | 'profiles' | 'days' | 'theme' | 'system';

interface WindowInfo {
  title: string;
  processName: string;
}

function SettingsModal() {
  const {
    isSettingsOpen,
    toggleSettings,
    config,
    updateSettings,
    addNotification,
    addDay,
    updateDay,
    deleteDay,
    resetAllPolls,
    addScheduledTime,
    updateScheduledTime,
    deleteScheduledTime,
    getCurrentProfile,
    addProfile,
    deleteProfile,
    renameProfile,
    switchProfile,
    duplicateProfile,
    settingsTab,
    setSettingsTab,
  } = useAppStore();

  const currentProfile = getCurrentProfile();
  const [activeTab, setActiveTab] = useState<SettingsTab>(settingsTab as SettingsTab || 'profiles');

  // Sync with store's settingsTab
  useEffect(() => {
    if (settingsTab && settingsTab !== activeTab) {
      setActiveTab(settingsTab as SettingsTab);
    }
  }, [settingsTab]);

  const handleTabChange = (tab: SettingsTab) => {
    setActiveTab(tab);
    setSettingsTab(tab);
  };
  const [isCheckingLinks, setIsCheckingLinks] = useState(false);
  const [windowList, setWindowList] = useState<WindowInfo[]>([]);
  const [isLoadingWindows, setIsLoadingWindows] = useState(false);
  const [isTestingTarget, setIsTestingTarget] = useState(false);
  const [targetTestResult, setTargetTestResult] = useState<
    { ok: boolean; message: string; matches?: string[] } | null
  >(null);
  const [newDayName, setNewDayName] = useState('');
  const [editingDayId, setEditingDayId] = useState<string | null>(null);
  const [editingDayName, setEditingDayName] = useState('');
  const [newScheduleLabel, setNewScheduleLabel] = useState('');
  const [newScheduleHour, setNewScheduleHour] = useState('12');
  const [newScheduleMinute, setNewScheduleMinute] = useState('00');
  const [newScheduleAmPm, setNewScheduleAmPm] = useState<'AM' | 'PM'>('AM');
  const [newScheduleDuration, setNewScheduleDuration] = useState('15');
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [editingScheduleLabel, setEditingScheduleLabel] = useState('');
  const [editingScheduleHour, setEditingScheduleHour] = useState('12');
  const [editingScheduleMinute, setEditingScheduleMinute] = useState('00');
  const [editingScheduleAmPm, setEditingScheduleAmPm] = useState<'AM' | 'PM'>('AM');
  const [editingScheduleDuration, setEditingScheduleDuration] = useState('15');

  // Theme customization state
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [customThemeName, setCustomThemeName] = useState('');
  const [isThemeDropdownOpen, setIsThemeDropdownOpen] = useState(false);
  const [isBreakAlertDropdownOpen, setIsBreakAlertDropdownOpen] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState<{ key: keyof ThemeColors; label: string } | null>(null);
  const settingsOverlayDismiss = useOverlayDismiss(toggleSettings);
  const colorPickerOverlayDismiss = useOverlayDismiss(() => setColorPickerOpen(null));
  const [tempColorValue, setTempColorValue] = useState('');

  const { settings } = currentProfile;

  // Profile management state
  const [newProfileName, setNewProfileName] = useState('');
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [editingProfileName, setEditingProfileName] = useState('');
  const [duplicatingProfileId, setDuplicatingProfileId] = useState<string | null>(null);
  const [duplicateProfileName, setDuplicateProfileName] = useState('');

  // Updates state
  const [appVersion, setAppVersion] = useState('');
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{
    updateAvailable: boolean;
    currentVersion: string;
    latestVersion?: string;
    isDev?: boolean;
  } | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isUpdateReady, setIsUpdateReady] = useState(false);

  // Backup state
  const [backupList, setBackupList] = useState<BackupMetadata[]>([]);
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [isBackupHistoryCollapsed, setIsBackupHistoryCollapsed] = useState(true);

  // Convert 12-hour to 24-hour format (HH:MM)
  const to24Hour = (hour: string, minute: string, amPm: 'AM' | 'PM'): string => {
    let h = parseInt(hour);
    if (amPm === 'AM') {
      if (h === 12) h = 0;
    } else {
      if (h !== 12) h += 12;
    }
    return `${h.toString().padStart(2, '0')}:${minute.padStart(2, '0')}`;
  };

  // Convert 24-hour format (HH:MM) to 12-hour components
  const to12Hour = (time: string): { hour: string; minute: string; amPm: 'AM' | 'PM' } => {
    const [h, m] = time.split(':').map(Number);
    let hour = h % 12;
    if (hour === 0) hour = 12;
    const amPm: 'AM' | 'PM' = h < 12 ? 'AM' : 'PM';
    return { hour: hour.toString(), minute: m.toString().padStart(2, '0'), amPm };
  };

  // Format time for display (e.g., "9:30 AM")
  const formatTimeDisplay = (time: string): string => {
    const { hour, minute, amPm } = to12Hour(time);
    return `${hour}:${minute} ${amPm}`;
  };

  // Load window list when general tab is active
  useEffect(() => {
    if (isSettingsOpen && activeTab === 'general') {
      loadWindowList();
    }
  }, [isSettingsOpen, activeTab]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.settings-theme-dropdown')) {
        setIsThemeDropdownOpen(false);
        setIsBreakAlertDropdownOpen(false);
      }
    };

    if (isThemeDropdownOpen || isBreakAlertDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isThemeDropdownOpen, isBreakAlertDropdownOpen]);

  // Get app version and set up update listeners
  useEffect(() => {
    const loadVersion = async () => {
      const version = await window.electronAPI.getAppVersion();
      setAppVersion(version);
    };
    loadVersion();

    // Set up update event listeners
    const removeUpdateAvailable = window.electronAPI.onUpdateAvailable((info) => {
      setUpdateInfo({
        updateAvailable: true,
        currentVersion: appVersion,
        latestVersion: info.version,
      });
      addNotification(`Update ${info.version} available!`, 'info');
    });

    const removeDownloadProgress = window.electronAPI.onDownloadProgress((progress) => {
      setDownloadProgress(progress.percent);
    });

    const removeUpdateDownloaded = window.electronAPI.onUpdateDownloaded((info) => {
      setIsDownloading(false);
      setIsUpdateReady(true);
      addNotification(`Update ${info.version} downloaded!`, 'success');
    });

    const removeUpdateError = window.electronAPI.onUpdateError((error) => {
      setIsCheckingForUpdates(false);
      setIsDownloading(false);
      addNotification(`Update error: ${error}`, 'error');
    });

    return () => {
      removeUpdateAvailable();
      removeDownloadProgress();
      removeUpdateDownloaded();
      removeUpdateError();
    };
  }, [appVersion]);

  // Load backups when data tab is activated
  useEffect(() => {
    if (isSettingsOpen && activeTab === 'system') {
      loadBackupList();
    }
  }, [isSettingsOpen, activeTab]);

  // Listen for auto-backup creation events
  useEffect(() => {
    const removeBackupCreated = window.electronAPI.onBackupCreated((metadata) => {
      addNotification('Auto-backup created', 'success');
      // Refresh backup list if we're on the data tab
      if (isSettingsOpen && activeTab === 'system') {
        loadBackupList();
      }
    });

    return () => {
      removeBackupCreated();
    };
  }, [isSettingsOpen, activeTab]);

  // Dry-run the window target: reports whether the current pattern would find a
  // window, without stealing focus or pasting anything. Mirrors the matching
  // PowerShell performs in focusAndPaste, which is case-insensitive for -eq,
  // -like and -match alike.
  const handleTestWindowTarget = async () => {
    const { pattern, matchMode } = settings.windowTarget;

    if (!pattern.trim()) {
      setTargetTestResult({ ok: false, message: 'No pattern set. Enter one or pick an open window.' });
      return;
    }

    setIsTestingTarget(true);
    setTargetTestResult(null);
    try {
      const windows = await window.electronAPI.getWindowList();

      let matches: string[];
      if (matchMode === 'regex') {
        let re: RegExp;
        try {
          re = new RegExp(pattern, 'i');
        } catch {
          setTargetTestResult({ ok: false, message: `"${pattern}" is not a valid regular expression.` });
          return;
        }
        matches = windows.filter((w) => re.test(w.title)).map((w) => w.title);
      } else {
        const needle = pattern.toLowerCase();
        matches = windows
          .filter((w) => {
            const title = w.title.toLowerCase();
            return matchMode === 'exact' ? title === needle : title.includes(needle);
          })
          .map((w) => w.title);
      }

      if (matches.length === 0) {
        setTargetTestResult({
          ok: false,
          message: `No open window matches "${pattern}" (${matchMode}). Open the target app, or pick it from the list below.`,
        });
      } else if (matches.length === 1) {
        setTargetTestResult({ ok: true, message: 'Match found — pasting should work.', matches });
      } else {
        setTargetTestResult({
          ok: true,
          message: `${matches.length} windows match. The first one is used, which may not be the one you want.`,
          matches,
        });
      }
    } catch {
      setTargetTestResult({ ok: false, message: 'Could not read the window list.' });
    } finally {
      setIsTestingTarget(false);
    }
  };

  const loadWindowList = async () => {
    setIsLoadingWindows(true);
    try {
      const windows = await window.electronAPI.getWindowList();
      setWindowList(windows);
    } catch (error) {
      console.error('Failed to load windows:', error);
    }
    setIsLoadingWindows(false);
  };

  if (!isSettingsOpen) return null;

  const handleCheckAllLinks = async () => {
    setIsCheckingLinks(true);

    // Collect every URL, expanding multi-link groups. For a group the real URLs
    // live in additionalUrls; item.url is only a copy of the first one, so
    // checking it alone silently skipped the rest of the group.
    const urlSet = new Set<string>();
    currentProfile.days.forEach((day) => {
      day.sections.forEach((section) => {
        section.items.forEach((item) => {
          if (item.type === 'link') {
            if (item.additionalUrls && item.additionalUrls.length > 0) {
              item.additionalUrls.forEach((a) => urlSet.add(a.url));
            } else {
              urlSet.add(item.url);
            }
          }
        });
      });
    });
    const urls = Array.from(urlSet);

    if (urls.length === 0) {
      addNotification('No links to check', 'info');
      setIsCheckingLinks(false);
      return;
    }

    try {
      const results = await window.electronAPI.checkAllLinks(urls);
      const broken = results.filter((r) => r.status !== 'ok');

      // Apply all statuses without saving, then persist once, instead of
      // writing the whole config to disk for every single result.
      results.forEach((result) => {
        useAppStore.getState().updateLinkStatus(result.url, result.status, true);
      });
      await useAppStore.getState().saveConfig();

      if (broken.length === 0) {
        addNotification(`All ${urls.length} links are OK!`, 'success');
      } else {
        addNotification(`${broken.length} of ${urls.length} links have issues`, 'error');
      }
    } catch (error) {
      addNotification('Failed to check links', 'error');
    }

    setIsCheckingLinks(false);
  };

  const handleExport = async () => {
    const success = await window.electronAPI.exportConfig();
    if (success) {
      addNotification('Configuration exported!', 'success');
    }
  };

  const handleImport = async () => {
    const imported = await window.electronAPI.importConfig();
    if (imported) {
      addNotification('Configuration imported! Reloading...', 'success');
      setTimeout(() => {
        useAppStore.getState().loadConfig();
      }, 500);
    }
  };

  const handleCheckForUpdates = async () => {
    setIsCheckingForUpdates(true);
    try {
      const result = await window.electronAPI.checkForUpdates();
      setUpdateInfo(result);

      if (result.isDev) {
        addNotification('Running in dev mode', 'info');
      } else if (result.error) {
        addNotification(`Update check failed: ${result.error}`, 'error');
      } else if (result.updateAvailable) {
        addNotification(`Update ${result.latestVersion} available!`, 'success');
      } else {
        addNotification('You are on the latest version!', 'success');
      }
    } catch (error) {
      addNotification('Failed to check for updates', 'error');
    }
    setIsCheckingForUpdates(false);
  };

  const handleDownloadUpdate = async () => {
    setIsDownloading(true);
    setDownloadProgress(0);
    try {
      const result = await window.electronAPI.downloadUpdate();
      if (!result.success) {
        addNotification(`Download failed: ${result.error}`, 'error');
        setIsDownloading(false);
      }
      // Download completion is handled by the event listener
    } catch (error) {
      addNotification('Failed to download update', 'error');
      setIsDownloading(false);
    }
  };

  const handleInstallUpdate = async () => {
    try {
      await window.electronAPI.installUpdate();
      // App will quit and install
    } catch (error) {
      addNotification('Failed to install update', 'error');
    }
  };

  // Backup utility functions
  const formatBackupDate = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Backup handlers
  const loadBackupList = async () => {
    setIsLoadingBackups(true);
    try {
      const backups = await window.electronAPI.listBackups();
      setBackupList(backups);
    } catch (error) {
      addNotification('Failed to load backup list', 'error');
    } finally {
      setIsLoadingBackups(false);
    }
  };

  const handleCreateBackup = async () => {
    setIsCreatingBackup(true);
    try {
      const result = await window.electronAPI.createBackup();
      if (result.success) {
        addNotification('Backup created successfully', 'success');
        await loadBackupList();
      } else {
        addNotification(`Backup failed: ${result.error}`, 'error');
      }
    } catch (error) {
      addNotification('Failed to create backup', 'error');
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const handleRestoreBackup = async (filepath: string, filename: string) => {
    if (!confirm(`Restore configuration from backup "${filename}"?\n\nThis will replace your current configuration and reload the app.`)) {
      return;
    }

    try {
      const result = await window.electronAPI.restoreBackup(filepath);
      if (result.success && result.config) {
        // Save the restored config
        await window.electronAPI.saveConfig(result.config);
        addNotification('Backup restored successfully. Reloading...', 'success');
        // Reload the app to apply the restored config
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } else {
        addNotification(`Restore failed: ${result.error}`, 'error');
      }
    } catch (error) {
      addNotification('Failed to restore backup', 'error');
    }
  };

  const handleDeleteBackup = async (filepath: string, filename: string) => {
    if (!confirm(`Delete backup "${filename}"?\n\nThis action cannot be undone.`)) {
      return;
    }

    try {
      const result = await window.electronAPI.deleteBackup(filepath);
      if (result.success) {
        addNotification('Backup deleted', 'success');
        await loadBackupList();
      } else {
        addNotification(`Delete failed: ${result.error}`, 'error');
      }
    } catch (error) {
      addNotification('Failed to delete backup', 'error');
    }
  };

  const handleSelectBackupDirectory = async () => {
    try {
      const directory = await window.electronAPI.selectBackupDirectory();
      if (directory) {
        updateSettings({
          backupSettings: {
            ...settings.backupSettings!,
            backupDirectory: directory,
          },
        });
        addNotification('Backup directory updated', 'success');
      }
    } catch (error) {
      addNotification('Failed to select directory', 'error');
    }
  };

  const updateThemeColor = (key: keyof ThemeColors, value: string) => {
    updateSettings({
      theme: {
        ...settings.theme,
        isCustom: true,
        colors: {
          ...settings.theme.colors,
          [key]: value,
        },
      },
    });
  };

  const resetTheme = () => {
    updateSettings({ theme: DEFAULT_THEME });
  };

  const saveCustomTheme = () => {
    if (!customThemeName.trim()) {
      addNotification('Please enter a theme name', 'error');
      return;
    }

    const newTheme: Theme = {
      ...settings.theme,
      name: customThemeName.trim(),
      isCustom: true,
    };

    const customThemes = settings.customThemes || [];
    const existingIndex = customThemes.findIndex(t => t.name === newTheme.name);

    if (existingIndex >= 0) {
      // Update existing theme
      customThemes[existingIndex] = newTheme;
      updateSettings({ customThemes: [...customThemes] });
      addNotification(`Theme "${newTheme.name}" updated!`, 'success');
    } else {
      // Add new theme
      updateSettings({ customThemes: [...customThemes, newTheme] });
      addNotification(`Theme "${newTheme.name}" saved!`, 'success');
    }

    setCustomThemeName('');
    setIsCustomizing(false);
  };

  const deleteCustomTheme = (themeName: string) => {
    const customThemes = settings.customThemes || [];
    const updatedThemes = customThemes.filter(t => t.name !== themeName);
    updateSettings({ customThemes: updatedThemes });

    // If we're deleting the active theme, switch to default
    if (settings.theme.name === themeName) {
      updateSettings({ theme: DEFAULT_THEME });
    }

    addNotification(`Theme "${themeName}" deleted`, 'success');
  };

  const getAllThemes = (): Theme[] => {
    return [...PRESET_THEMES, ...(settings.customThemes || [])];
  };

  // Calculate if a color is light or dark to determine text color
  const getContrastColor = (hexColor: string): string => {
    // Convert hex to RGB
    const hex = hexColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);

    // Calculate relative luminance (perceived brightness)
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    // Return black for light colors, white for dark colors
    return luminance > 0.5 ? '#000000' : '#ffffff';
  };

  const openColorPicker = (key: keyof ThemeColors, label: string) => {
    setColorPickerOpen({ key, label });
    setTempColorValue(settings.theme.colors[key]);
  };

  const applyColorChange = () => {
    if (colorPickerOpen && tempColorValue) {
      updateThemeColor(colorPickerOpen.key, tempColorValue);
      setColorPickerOpen(null);
    }
  };

  const selectWindow = (windowTitle: string) => {
    updateSettings({
      windowTarget: {
        ...settings.windowTarget,
        pattern: windowTitle,
        matchMode: 'contains',
      },
    });
    addNotification(`Window pattern set to: ${windowTitle}`, 'success');
  };

  return (
    <div className="settings-overlay" {...settingsOverlayDismiss}>
      <div className="settings-modal panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2 className="settings-title">SETTINGS</h2>
          <button className="btn btn--small btn--danger" onClick={toggleSettings}>
            ✕
          </button>
        </div>

        <div className="settings-tabs">
          <button
            className={`settings-tab ${activeTab === 'general' ? 'settings-tab--active' : ''}`}
            onClick={() => handleTabChange('general')}
          >
            GENERAL
          </button>
          <button
            className={`settings-tab ${activeTab === 'profiles' ? 'settings-tab--active' : ''}`}
            onClick={() => handleTabChange('profiles')}
          >
            PROFILES
          </button>
          <button
            className={`settings-tab ${activeTab === 'days' ? 'settings-tab--active' : ''}`}
            onClick={() => handleTabChange('days')}
          >
            SCHEDULE
          </button>
          <button
            className={`settings-tab ${activeTab === 'theme' ? 'settings-tab--active' : ''}`}
            onClick={() => handleTabChange('theme')}
          >
            THEME
          </button>
          <button
            className={`settings-tab ${activeTab === 'system' ? 'settings-tab--active' : ''}`}
            onClick={() => handleTabChange('system')}
          >
            SYSTEM
          </button>
        </div>

        <div className="settings-content">
          {activeTab === 'profiles' && (
            <div className="settings-section">
              <h3 className="settings-section-title">CURRENT PROFILE</h3>
              <div className="settings-current-profile">
                <span className="settings-current-profile-name">{currentProfile.name}</span>
              </div>

              <h3 className="settings-section-title">CREATE NEW PROFILE</h3>
              <div className="settings-add-day-row">
                <input
                  type="text"
                  className="input"
                  placeholder="Profile name..."
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newProfileName.trim()) {
                      addProfile(newProfileName.trim());
                      setNewProfileName('');
                    }
                  }}
                />
                <button
                  className="btn btn--small btn--success"
                  onClick={() => {
                    if (newProfileName.trim()) {
                      addProfile(newProfileName.trim());
                      setNewProfileName('');
                    }
                  }}
                >
                  + NEW
                </button>
              </div>

              <h3 className="settings-section-title">ALL PROFILES</h3>
              <div className="settings-day-list">
                {config.profiles.map((profile) => (
                  <div
                    key={profile.id}
                    className={`settings-day-item ${profile.id === config.currentProfileId ? 'settings-day-item--active' : ''}`}
                  >
                    {editingProfileId === profile.id ? (
                      <div className="settings-day-edit-row">
                        <input
                          type="text"
                          className="input"
                          value={editingProfileName}
                          onChange={(e) => setEditingProfileName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && editingProfileName.trim()) {
                              renameProfile(profile.id, editingProfileName.trim());
                              setEditingProfileId(null);
                            }
                            if (e.key === 'Escape') setEditingProfileId(null);
                          }}
                          autoFocus
                        />
                        <button
                          className="btn btn--small btn--success"
                          onClick={() => {
                            if (editingProfileName.trim()) {
                              renameProfile(profile.id, editingProfileName.trim());
                              setEditingProfileId(null);
                            }
                          }}
                        >
                          ✓
                        </button>
                        <button
                          className="btn btn--small btn--secondary"
                          onClick={() => setEditingProfileId(null)}
                        >
                          ✕
                        </button>
                      </div>
                    ) : duplicatingProfileId === profile.id ? (
                      <div className="settings-day-edit-row">
                        <input
                          type="text"
                          className="input"
                          placeholder="New profile name..."
                          value={duplicateProfileName}
                          onChange={(e) => setDuplicateProfileName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && duplicateProfileName.trim()) {
                              duplicateProfile(profile.id, duplicateProfileName.trim());
                              setDuplicatingProfileId(null);
                              setDuplicateProfileName('');
                            }
                            if (e.key === 'Escape') {
                              setDuplicatingProfileId(null);
                              setDuplicateProfileName('');
                            }
                          }}
                          autoFocus
                        />
                        <button
                          className="btn btn--small btn--success"
                          onClick={() => {
                            if (duplicateProfileName.trim()) {
                              duplicateProfile(profile.id, duplicateProfileName.trim());
                              setDuplicatingProfileId(null);
                              setDuplicateProfileName('');
                            }
                          }}
                        >
                          ✓
                        </button>
                        <button
                          className="btn btn--small btn--secondary"
                          onClick={() => {
                            setDuplicatingProfileId(null);
                            setDuplicateProfileName('');
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <>
                        <span
                          className="settings-day-name settings-profile-name"
                          onClick={() => {
                            if (profile.id !== config.currentProfileId) {
                              switchProfile(profile.id);
                            }
                          }}
                          title={profile.id === config.currentProfileId ? 'Current profile' : 'Click to switch'}
                        >
                          {profile.name}
                          {profile.id === config.currentProfileId && (
                            <span className="settings-profile-current"> (ACTIVE)</span>
                          )}
                        </span>
                        <div className="settings-day-actions">
                          <button
                            className="btn btn--small btn--secondary"
                            onClick={() => {
                              setDuplicatingProfileId(profile.id);
                              setDuplicateProfileName(`${profile.name} Copy`);
                            }}
                            title="Duplicate profile"
                          >
                            ⧉
                          </button>
                          <button
                            className="btn btn--small btn--secondary"
                            onClick={() => {
                              setEditingProfileId(profile.id);
                              setEditingProfileName(profile.name);
                            }}
                            title="Rename profile"
                          >
                            ✎
                          </button>
                          <button
                            className="btn btn--small btn--danger"
                            onClick={() => {
                              if (config.profiles.length <= 1) {
                                addNotification('Cannot delete the last profile', 'error');
                                return;
                              }
                              if (confirm(`Delete profile "${profile.name}" and all its data?`)) {
                                deleteProfile(profile.id);
                              }
                            }}
                            title="Delete profile"
                            disabled={config.profiles.length <= 1}
                          >
                            ✕
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>

              <p className="settings-help">
                Each profile stores its own days, sections, links, notes, polls, theme, and all other settings.
                Click a profile name to switch to it.
              </p>
            </div>
          )}

          {activeTab === 'days' && (
            <div className="settings-section">
              <h3 className="settings-section-title">ADD NEW DAY</h3>
              <div className="settings-add-day-row">
                <input
                  type="text"
                  className="input"
                  placeholder="Day name..."
                  value={newDayName}
                  onChange={(e) => setNewDayName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newDayName.trim()) {
                      addDay(newDayName.trim());
                      setNewDayName('');
                    }
                  }}
                />
                <button
                  className="btn btn--small btn--success"
                  onClick={() => {
                    if (newDayName.trim()) {
                      addDay(newDayName.trim());
                      setNewDayName('');
                    }
                  }}
                >
                  + ADD
                </button>
              </div>

              <h3 className="settings-section-title">EXISTING DAYS</h3>
              <div className="settings-day-list">
                {[...currentProfile.days]
                  .sort((a, b) => a.order - b.order)
                  .map((day) => (
                    <div key={day.id} className="settings-day-item">
                      {editingDayId === day.id ? (
                        <div className="settings-day-edit-row">
                          <input
                            type="text"
                            className="input"
                            value={editingDayName}
                            onChange={(e) => setEditingDayName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && editingDayName.trim()) {
                                updateDay(day.id, { name: editingDayName.trim() });
                                setEditingDayId(null);
                              }
                              if (e.key === 'Escape') setEditingDayId(null);
                            }}
                            autoFocus
                          />
                          <button
                            className="btn btn--small btn--success"
                            onClick={() => {
                              if (editingDayName.trim()) {
                                updateDay(day.id, { name: editingDayName.trim() });
                                setEditingDayId(null);
                              }
                            }}
                          >
                            ✓
                          </button>
                          <button
                            className="btn btn--small btn--secondary"
                            onClick={() => setEditingDayId(null)}
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="settings-day-name">{day.name}</span>
                          <div className="settings-day-lab-fields">
                            <label className="settings-day-lab-label">Day#</label>
                            <input
                              type="number"
                              className="input settings-day-lab-input"
                              value={day.dayNumber ?? ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                updateDay(day.id, { dayNumber: val ? parseInt(val) : undefined });
                              }}
                              min="1"
                              placeholder=""
                            />
                            <label className="settings-day-lab-label">Labs</label>
                            <input
                              type="number"
                              className="input settings-day-lab-input"
                              value={day.labCount ?? ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                updateDay(day.id, { labCount: val ? parseInt(val) : undefined });
                              }}
                              min="0"
                              placeholder=""
                            />
                          </div>
                          <div className="settings-day-actions">
                            <button
                              className="btn btn--small btn--secondary"
                              onClick={() => {
                                setEditingDayId(day.id);
                                setEditingDayName(day.name);
                              }}
                            >
                              ✎
                            </button>
                            <button
                              className="btn btn--small btn--danger"
                              onClick={() => {
                                if (confirm(`Delete "${day.name}" and all its contents?`)) {
                                  deleteDay(day.id);
                                }
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                {currentProfile.days.length === 0 && (
                  <p className="settings-help">No days created yet.</p>
                )}
              </div>

              <h3 className="settings-section-title">SCHEDULED TIMES</h3>
              <p className="settings-help">
                Add times to track (e.g., breaks, lunch). A countdown will show in the header.
              </p>

              <div className="settings-schedule-add-row">
                <input
                  type="text"
                  className="input settings-schedule-label-input"
                  placeholder="Label (e.g., Break)"
                  value={newScheduleLabel}
                  onChange={(e) => setNewScheduleLabel(e.target.value)}
                />
                <div className="settings-time-picker">
                  <select
                    className="select settings-time-select"
                    value={newScheduleHour}
                    onChange={(e) => setNewScheduleHour(e.target.value)}
                  >
                    {[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((h) => (
                      <option key={h} value={h.toString()}>{h}</option>
                    ))}
                  </select>
                  <span className="settings-time-colon">:</span>
                  <select
                    className="select settings-time-select"
                    value={newScheduleMinute}
                    onChange={(e) => setNewScheduleMinute(e.target.value)}
                  >
                    {['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'].map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <select
                    className="select settings-time-select"
                    value={newScheduleAmPm}
                    onChange={(e) => setNewScheduleAmPm(e.target.value as 'AM' | 'PM')}
                  >
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </select>
                </div>
                <div className="settings-duration-picker">
                  <input
                    type="number"
                    className="input settings-duration-input"
                    value={newScheduleDuration}
                    onChange={(e) => setNewScheduleDuration(e.target.value)}
                    min="1"
                    max="120"
                  />
                  <span className="settings-duration-label">min</span>
                </div>
                <button
                  className="btn btn--small btn--success"
                  onClick={() => {
                    if (newScheduleLabel.trim()) {
                      const time24 = to24Hour(newScheduleHour, newScheduleMinute, newScheduleAmPm);
                      addScheduledTime(newScheduleLabel.trim(), time24, parseInt(newScheduleDuration) || 15);
                      setNewScheduleLabel('');
                      setNewScheduleHour('12');
                      setNewScheduleMinute('00');
                      setNewScheduleAmPm('AM');
                      setNewScheduleDuration('15');
                    }
                  }}
                >
                  + ADD
                </button>
              </div>

              {(settings.scheduledTimes || []).length > 0 && (
                <div className="settings-schedule-header">
                  <span className="settings-schedule-header-info">Schedule</span>
                  <span className="settings-schedule-header-break">Break?</span>
                  <span className="settings-schedule-header-actions">Actions</span>
                </div>
              )}
              <div className="settings-day-list">
                {(settings.scheduledTimes || [])
                  .sort((a, b) => a.time.localeCompare(b.time))
                  .map((st) => (
                    <div key={st.id} className="settings-day-item">
                      {editingScheduleId === st.id ? (
                        <div className="settings-schedule-edit-row">
                          <input
                            type="text"
                            className="input settings-schedule-label-input"
                            value={editingScheduleLabel}
                            onChange={(e) => setEditingScheduleLabel(e.target.value)}
                            autoFocus
                          />
                          <div className="settings-time-picker">
                            <select
                              className="select settings-time-select"
                              value={editingScheduleHour}
                              onChange={(e) => setEditingScheduleHour(e.target.value)}
                            >
                              {[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((h) => (
                                <option key={h} value={h.toString()}>{h}</option>
                              ))}
                            </select>
                            <span className="settings-time-colon">:</span>
                            <select
                              className="select settings-time-select"
                              value={editingScheduleMinute}
                              onChange={(e) => setEditingScheduleMinute(e.target.value)}
                            >
                              {['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'].map((m) => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                            </select>
                            <select
                              className="select settings-time-select"
                              value={editingScheduleAmPm}
                              onChange={(e) => setEditingScheduleAmPm(e.target.value as 'AM' | 'PM')}
                            >
                              <option value="AM">AM</option>
                              <option value="PM">PM</option>
                            </select>
                          </div>
                          <div className="settings-duration-picker">
                            <input
                              type="number"
                              className="input settings-duration-input"
                              value={editingScheduleDuration}
                              onChange={(e) => setEditingScheduleDuration(e.target.value)}
                              min="1"
                              max="120"
                            />
                            <span className="settings-duration-label">min</span>
                          </div>
                          <button
                            className="btn btn--small btn--success"
                            onClick={() => {
                              if (editingScheduleLabel.trim()) {
                                const time24 = to24Hour(editingScheduleHour, editingScheduleMinute, editingScheduleAmPm);
                                updateScheduledTime(st.id, {
                                  label: editingScheduleLabel.trim(),
                                  time: time24,
                                  duration: parseInt(editingScheduleDuration) || 15,
                                });
                                setEditingScheduleId(null);
                              }
                            }}
                          >
                            ✓
                          </button>
                          <button
                            className="btn btn--small btn--secondary"
                            onClick={() => setEditingScheduleId(null)}
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="settings-schedule-info">
                            <span className="settings-schedule-time">{formatTimeDisplay(st.time)}</span>
                            <span className="settings-schedule-label">{st.label}</span>
                            <span className="settings-schedule-duration">({st.duration || 15} min)</span>
                          </span>
                          <label className="settings-checkbox settings-schedule-break-checkbox">
                            <input
                              type="checkbox"
                              checked={st.isBreak ?? false}
                              onChange={(e) =>
                                updateScheduledTime(st.id, { isBreak: e.target.checked })
                              }
                            />
                          </label>
                          <div className="settings-day-actions">
                            <button
                              className="btn btn--small btn--secondary"
                              onClick={() => {
                                const { hour, minute, amPm } = to12Hour(st.time);
                                setEditingScheduleId(st.id);
                                setEditingScheduleLabel(st.label);
                                setEditingScheduleHour(hour);
                                setEditingScheduleMinute(minute);
                                setEditingScheduleAmPm(amPm);
                                setEditingScheduleDuration((st.duration || 15).toString());
                              }}
                            >
                              ✎
                            </button>
                            <button
                              className="btn btn--small btn--danger"
                              onClick={() => {
                                if (confirm(`Delete "${st.label}" at ${formatTimeDisplay(st.time)}?`)) {
                                  deleteScheduledTime(st.id);
                                }
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                {(settings.scheduledTimes || []).length === 0 && (
                  <p className="settings-help">No scheduled times yet.</p>
                )}
              </div>

              <h3 className="settings-section-title">BREAK ALERT</h3>
              <p className="settings-help">
                Set when to trigger the break alert theme before scheduled break times.
              </p>

              <div className="settings-field">
                <label className="settings-label">ALERT MINUTES BEFORE</label>
                <input
                  type="number"
                  className="input settings-number-input"
                  min={1}
                  max={30}
                  value={settings.breakAlertMinutes || 5}
                  onChange={(e) =>
                    updateSettings({ breakAlertMinutes: parseInt(e.target.value) || 5 })
                  }
                />
              </div>

              <p className="settings-help">
                Configure the break alert theme in the THEME tab.
              </p>
            </div>
          )}

          {activeTab === 'general' && (
            <div className="settings-section">
              <h3 className="settings-section-title">LINK HEALTH</h3>

              <div className="settings-field">
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={settings.checkLinksOnStartup}
                    onChange={(e) =>
                      updateSettings({ checkLinksOnStartup: e.target.checked })
                    }
                  />
                  <span>Check all links on startup</span>
                </label>
              </div>

              <button
                className="btn"
                onClick={handleCheckAllLinks}
                disabled={isCheckingLinks}
              >
                {isCheckingLinks ? 'CHECKING...' : 'CHECK ALL LINKS NOW'}
              </button>

              <h3 className="settings-section-title">TIMEZONE</h3>

              <div className="settings-field">
                <label className="settings-label">SELECT TIMEZONE</label>
                <select
                  className="select"
                  value={settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}
                  onChange={(e) => updateSettings({ timezone: e.target.value })}
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>

              <h3 className="settings-section-title">WINDOW TARGET</h3>
              <p className="settings-help">
                Select a window or type a pattern to match when pasting.
              </p>

              <div className="settings-field">
                <label className="settings-label">CURRENT PATTERN</label>
                <div className="settings-pattern-row">
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., Zoom Meeting, Slack, etc."
                    value={settings.windowTarget.pattern}
                    onChange={(e) => {
                      setTargetTestResult(null);
                      updateSettings({
                        windowTarget: {
                          ...settings.windowTarget,
                          pattern: e.target.value,
                        },
                      });
                    }}
                  />
                  <select
                    className="select settings-match-mode"
                    value={settings.windowTarget.matchMode}
                    onChange={(e) => {
                      setTargetTestResult(null);
                      updateSettings({
                        windowTarget: {
                          ...settings.windowTarget,
                          matchMode: e.target.value as 'exact' | 'contains' | 'regex',
                        },
                      });
                    }}
                  >
                    <option value="contains">Contains</option>
                    <option value="exact">Exact</option>
                    <option value="regex">Regex</option>
                  </select>
                </div>
                <div className="settings-target-test">
                  <button
                    className="btn btn--small btn--secondary"
                    onClick={handleTestWindowTarget}
                    disabled={isTestingTarget}
                    title="Check this pattern finds a window, without pasting anything"
                  >
                    {isTestingTarget ? 'TESTING...' : 'TEST TARGET'}
                  </button>
                  {targetTestResult && (
                    <div
                      className={`settings-target-test-result ${
                        targetTestResult.ok
                          ? 'settings-target-test-result--ok'
                          : 'settings-target-test-result--fail'
                      }`}
                    >
                      <span className="settings-target-test-icon">
                        {targetTestResult.ok ? '✓' : '⚠'}
                      </span>
                      <div className="settings-target-test-body">
                        <div>{targetTestResult.message}</div>
                        {targetTestResult.matches && targetTestResult.matches.length > 0 && (
                          <ul className="settings-target-test-matches">
                            {targetTestResult.matches.slice(0, 5).map((title, i) => (
                              <li key={i} className="truncate" title={title}>
                                {i === 0 ? '→ ' : ''}
                                {title}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="settings-field">
                <div className="settings-label-row">
                  <label className="settings-label">SELECT FROM OPEN WINDOWS</label>
                  <button
                    className="btn btn--small btn--secondary"
                    onClick={loadWindowList}
                    disabled={isLoadingWindows}
                  >
                    {isLoadingWindows ? '...' : '↻'}
                  </button>
                </div>
                <select
                  className="select"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      selectWindow(e.target.value);
                    }
                  }}
                  disabled={isLoadingWindows || windowList.length === 0}
                >
                  <option value="">
                    {isLoadingWindows ? 'Loading...' : windowList.length === 0 ? 'No windows found' : 'Choose a window...'}
                  </option>
                  {windowList.map((win, index) => (
                    <option key={index} value={win.title}>
                      {win.processName}: {win.title}
                    </option>
                  ))}
                </select>
              </div>

              <h3 className="settings-section-title">PASTE OPTIONS</h3>

              <div className="settings-field">
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={settings.windowTarget.pressEnterAfterPaste || false}
                    onChange={(e) =>
                      updateSettings({
                        windowTarget: {
                          ...settings.windowTarget,
                          pressEnterAfterPaste: e.target.checked,
                        },
                      })
                    }
                  />
                  <span>Press Enter after pasting URLs and Notes</span>
                </label>
              </div>

              <h3 className="settings-section-title">POLLS</h3>

              <div className="settings-actions">
                <button
                  className="btn btn--secondary"
                  onClick={() => {
                    if (confirm('Reset all polls to "new" status?')) {
                      resetAllPolls();
                      addNotification('All polls reset', 'success');
                    }
                  }}
                >
                  RESET ALL POLLS
                </button>
              </div>

              <p className="settings-help">
                Reset all polls across all sections to "new" status, removing the "sent" mark.
              </p>

              <h3 className="settings-section-title">LAB POLL TEMPLATE</h3>

              <div className="settings-field">
                <label className="settings-label">TEMPLATE</label>
                <textarea
                  className="textarea settings-lab-template"
                  value={settings.labPollTemplate || ''}
                  onChange={(e) =>
                    updateSettings({ labPollTemplate: e.target.value })
                  }
                  placeholder="Enter lab poll template..."
                  rows={4}
                />
              </div>

              <p className="settings-help">
                Use <code>&lt;LAB_NUMBER&gt;</code> as the placeholder for the lab number.
                This template is used when sending lab polls from the header button.
              </p>
            </div>
          )}

          {activeTab === 'theme' && (
            <div className="settings-section">
              <h3 className="settings-section-title">THEME SELECTION</h3>

              <div className="settings-theme-row">
                <div className="settings-field settings-theme-row-item">
                  <label className="settings-label">FONT FAMILY</label>
                  <select
                    className="select"
                    value={settings.theme.fontFamily}
                    onChange={(e) =>
                      updateSettings({
                        theme: {
                          ...settings.theme,
                          fontFamily: e.target.value,
                        },
                      })
                    }
                  >
                    <option value='"Press Start 2P", monospace'>Press Start 2P (8-bit)</option>
                    <option value='"Lexend", sans-serif'>Lexend (Modern)</option>
                    <option value='"Courier New", monospace'>Courier New</option>
                    <option value='monospace'>System Monospace</option>
                    <option value='sans-serif'>System Sans-Serif</option>
                  </select>
                </div>

                <div className="settings-field settings-theme-row-item">
                  <label className="settings-label">FONT SIZE</label>
                  <select
                    className="select"
                    value={settings.fontSize || 'medium'}
                    onChange={(e) =>
                      updateSettings({
                        fontSize: e.target.value as FontSize,
                      })
                    }
                  >
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                  </select>
                </div>
              </div>

              <div className="settings-theme-row">
                <div className="settings-field settings-theme-row-item">
                  <label className="settings-label">COLOR THEME</label>
                  <div className="settings-theme-dropdown">
                  <button
                    className="settings-theme-dropdown-button"
                    onClick={() => setIsThemeDropdownOpen(!isThemeDropdownOpen)}
                  >
                    <div className="settings-theme-dropdown-preview">
                      <div className="settings-theme-swatch" style={{ backgroundColor: settings.theme.colors.background }} />
                      <div className="settings-theme-swatch" style={{ backgroundColor: settings.theme.colors.surface }} />
                      <div className="settings-theme-swatch" style={{ backgroundColor: settings.theme.colors.primary }} />
                      <div className="settings-theme-swatch" style={{ backgroundColor: settings.theme.colors.secondary }} />
                      <div className="settings-theme-swatch" style={{ backgroundColor: settings.theme.colors.accent }} />
                    </div>
                    <span className="settings-theme-dropdown-name">{settings.theme.name}</span>
                    <span className="settings-theme-dropdown-arrow">{isThemeDropdownOpen ? '▲' : '▼'}</span>
                  </button>
                  {isThemeDropdownOpen && (
                    <div className="settings-theme-dropdown-menu">
                      <div className="settings-theme-dropdown-group">
                        <div className="settings-theme-dropdown-group-label">PRESET THEMES</div>
                        {PRESET_THEMES.map((theme) => (
                          <button
                            key={theme.name}
                            className={`settings-theme-dropdown-option ${settings.theme.name === theme.name ? 'settings-theme-dropdown-option--active' : ''}`}
                            onClick={() => {
                              updateSettings({ theme: { ...theme, fontFamily: settings.theme.fontFamily } });
                              setIsThemeDropdownOpen(false);
                            }}
                          >
                            <div className="settings-theme-dropdown-preview">
                              <div className="settings-theme-swatch" style={{ backgroundColor: theme.colors.background }} />
                              <div className="settings-theme-swatch" style={{ backgroundColor: theme.colors.surface }} />
                              <div className="settings-theme-swatch" style={{ backgroundColor: theme.colors.primary }} />
                              <div className="settings-theme-swatch" style={{ backgroundColor: theme.colors.secondary }} />
                              <div className="settings-theme-swatch" style={{ backgroundColor: theme.colors.accent }} />
                            </div>
                            <span className="settings-theme-dropdown-name">{theme.name}</span>
                          </button>
                        ))}
                      </div>
                      {(settings.customThemes || []).length > 0 && (
                        <div className="settings-theme-dropdown-group">
                          <div className="settings-theme-dropdown-group-label">CUSTOM THEMES</div>
                          {(settings.customThemes || []).map((theme) => (
                            <button
                              key={theme.name}
                              className={`settings-theme-dropdown-option ${settings.theme.name === theme.name ? 'settings-theme-dropdown-option--active' : ''}`}
                              onClick={() => {
                                updateSettings({ theme: { ...theme, fontFamily: settings.theme.fontFamily } });
                                setIsThemeDropdownOpen(false);
                              }}
                            >
                              <div className="settings-theme-dropdown-preview">
                                <div className="settings-theme-swatch" style={{ backgroundColor: theme.colors.background }} />
                                <div className="settings-theme-swatch" style={{ backgroundColor: theme.colors.surface }} />
                                <div className="settings-theme-swatch" style={{ backgroundColor: theme.colors.primary }} />
                                <div className="settings-theme-swatch" style={{ backgroundColor: theme.colors.secondary }} />
                                <div className="settings-theme-swatch" style={{ backgroundColor: theme.colors.accent }} />
                              </div>
                              <span className="settings-theme-dropdown-name">{theme.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  </div>
                </div>

                <div className="settings-field settings-theme-row-item">
                  <label className="settings-label">&nbsp;</label>
                  <button
                    className="btn btn--secondary"
                    style={{ width: '100%' }}
                    onClick={() => setIsCustomizing(!isCustomizing)}
                  >
                    {isCustomizing ? '▼ HIDE' : '▶ CUSTOMIZE'}
                  </button>
                </div>
              </div>

              {isCustomizing && (
                <>
                  <h3 className="settings-section-title">CUSTOMIZE COLORS</h3>

                  <div className="settings-field">
                    <label className="settings-label">COLOR PALETTE</label>
                    <div className="settings-theme-palette">
                      <div
                        className="settings-theme-color-wide settings-theme-color-clickable"
                        style={{ backgroundColor: settings.theme.colors.background }}
                        onClick={() => openColorPicker('background', 'BACKGROUND')}
                      >
                        <span className="settings-theme-color-label-overlay" style={{ color: getContrastColor(settings.theme.colors.background) }}>BG</span>
                        <span className="settings-theme-color-hex-overlay" style={{ color: getContrastColor(settings.theme.colors.background) }}>{settings.theme.colors.background}</span>
                      </div>
                      <div
                        className="settings-theme-color-wide settings-theme-color-clickable"
                        style={{ backgroundColor: settings.theme.colors.surface }}
                        onClick={() => openColorPicker('surface', 'SURFACE')}
                      >
                        <span className="settings-theme-color-label-overlay" style={{ color: getContrastColor(settings.theme.colors.surface) }}>SURFACE</span>
                        <span className="settings-theme-color-hex-overlay" style={{ color: getContrastColor(settings.theme.colors.surface) }}>{settings.theme.colors.surface}</span>
                      </div>
                      <div
                        className="settings-theme-color-wide settings-theme-color-clickable"
                        style={{ backgroundColor: settings.theme.colors.primary }}
                        onClick={() => openColorPicker('primary', 'PRIMARY')}
                      >
                        <span className="settings-theme-color-label-overlay" style={{ color: getContrastColor(settings.theme.colors.primary) }}>PRIMARY</span>
                        <span className="settings-theme-color-hex-overlay" style={{ color: getContrastColor(settings.theme.colors.primary) }}>{settings.theme.colors.primary}</span>
                      </div>
                      <div
                        className="settings-theme-color-wide settings-theme-color-clickable"
                        style={{ backgroundColor: settings.theme.colors.secondary }}
                        onClick={() => openColorPicker('secondary', 'SECONDARY')}
                      >
                        <span className="settings-theme-color-label-overlay" style={{ color: getContrastColor(settings.theme.colors.secondary) }}>SECONDARY</span>
                        <span className="settings-theme-color-hex-overlay" style={{ color: getContrastColor(settings.theme.colors.secondary) }}>{settings.theme.colors.secondary}</span>
                      </div>
                      <div
                        className="settings-theme-color-wide settings-theme-color-clickable"
                        style={{ backgroundColor: settings.theme.colors.accent }}
                        onClick={() => openColorPicker('accent', 'ACCENT')}
                      >
                        <span className="settings-theme-color-label-overlay" style={{ color: getContrastColor(settings.theme.colors.accent) }}>ACCENT</span>
                        <span className="settings-theme-color-hex-overlay" style={{ color: getContrastColor(settings.theme.colors.accent) }}>{settings.theme.colors.accent}</span>
                      </div>
                      <div
                        className="settings-theme-color-wide settings-theme-color-clickable"
                        style={{ backgroundColor: settings.theme.colors.text }}
                        onClick={() => openColorPicker('text', 'TEXT')}
                      >
                        <span className="settings-theme-color-label-overlay" style={{ color: getContrastColor(settings.theme.colors.text) }}>TEXT</span>
                        <span className="settings-theme-color-hex-overlay" style={{ color: getContrastColor(settings.theme.colors.text) }}>{settings.theme.colors.text}</span>
                      </div>
                      <div
                        className="settings-theme-color-wide settings-theme-color-clickable"
                        style={{ backgroundColor: settings.theme.colors.textMuted }}
                        onClick={() => openColorPicker('textMuted', 'TEXT MUTED')}
                      >
                        <span className="settings-theme-color-label-overlay" style={{ color: getContrastColor(settings.theme.colors.textMuted) }}>MUTED</span>
                        <span className="settings-theme-color-hex-overlay" style={{ color: getContrastColor(settings.theme.colors.textMuted) }}>{settings.theme.colors.textMuted}</span>
                      </div>
                      <div
                        className="settings-theme-color-wide settings-theme-color-clickable"
                        style={{ backgroundColor: settings.theme.colors.border }}
                        onClick={() => openColorPicker('border', 'BORDER')}
                      >
                        <span className="settings-theme-color-label-overlay" style={{ color: getContrastColor(settings.theme.colors.border) }}>BORDER</span>
                        <span className="settings-theme-color-hex-overlay" style={{ color: getContrastColor(settings.theme.colors.border) }}>{settings.theme.colors.border}</span>
                      </div>
                      <div
                        className="settings-theme-color-wide settings-theme-color-clickable"
                        style={{ backgroundColor: settings.theme.colors.danger }}
                        onClick={() => openColorPicker('danger', 'DANGER')}
                      >
                        <span className="settings-theme-color-label-overlay" style={{ color: getContrastColor(settings.theme.colors.danger) }}>DANGER</span>
                        <span className="settings-theme-color-hex-overlay" style={{ color: getContrastColor(settings.theme.colors.danger) }}>{settings.theme.colors.danger}</span>
                      </div>
                      <div
                        className="settings-theme-color-wide settings-theme-color-clickable"
                        style={{ backgroundColor: settings.theme.colors.success }}
                        onClick={() => openColorPicker('success', 'SUCCESS')}
                      >
                        <span className="settings-theme-color-label-overlay" style={{ color: getContrastColor(settings.theme.colors.success) }}>SUCCESS</span>
                        <span className="settings-theme-color-hex-overlay" style={{ color: getContrastColor(settings.theme.colors.success) }}>{settings.theme.colors.success}</span>
                      </div>
                    </div>
                  </div>

                  <div className="settings-field">
                    <label className="settings-label">SAVE CUSTOM THEME</label>
                    <div className="settings-add-day-row">
                      <input
                        type="text"
                        className="input"
                        placeholder="Theme name..."
                        value={customThemeName}
                        onChange={(e) => setCustomThemeName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && customThemeName.trim()) {
                            saveCustomTheme();
                          }
                        }}
                      />
                      <button
                        className="btn btn--small btn--success"
                        onClick={saveCustomTheme}
                      >
                        💾 SAVE
                      </button>
                    </div>
                  </div>

                  {(settings.customThemes || []).length > 0 && (
                    <>
                      <h3 className="settings-section-title">CUSTOM THEMES</h3>
                      <div className="settings-day-list">
                        {(settings.customThemes || []).map((theme) => (
                          <div key={theme.name} className="settings-day-item">
                            <span className="settings-day-name">{theme.name}</span>
                            <div className="settings-day-actions">
                              <button
                                className="btn btn--small btn--secondary"
                                onClick={() => {
                                  updateSettings({ theme: theme });
                                  setCustomThemeName(theme.name);
                                }}
                              >
                                ✎ EDIT
                              </button>
                              <button
                                className="btn btn--small btn--danger"
                                onClick={() => {
                                  if (confirm(`Delete custom theme "${theme.name}"?`)) {
                                    deleteCustomTheme(theme.name);
                                  }
                                }}
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}

              <h3 className="settings-section-title">ADDITIONAL SETTINGS</h3>

              <div className="settings-field">
                <label className="settings-label">TIMER FONT FAMILY</label>
                <select
                  className="select"
                  value={settings.timerFontFamily || ''}
                  onChange={(e) =>
                    updateSettings({
                      timerFontFamily: e.target.value || undefined,
                    })
                  }
                >
                  <option value="">Same as app</option>
                  <option value='"Press Start 2P", monospace'>Press Start 2P (8-bit)</option>
                  <option value='"Lexend", sans-serif'>Lexend (Modern)</option>
                  <option value='"Courier New", monospace'>Courier New</option>
                  <option value='monospace'>System Monospace</option>
                  <option value='sans-serif'>System Sans-Serif</option>
                </select>
              </div>

              <div className="settings-field">
                <label className="settings-label">
                  TIMER TEXT SIZE — {Math.round((settings.timerTextScale ?? 1) * 100)}%
                </label>
                <p className="settings-help" style={{ marginTop: '4px', marginBottom: '8px' }}>
                  Scales the countdown and its description. Increase this when projecting to a room.
                </p>
                <input
                  type="range"
                  min="50"
                  max="200"
                  step="10"
                  className="settings-range"
                  value={Math.round((settings.timerTextScale ?? 1) * 100)}
                  onChange={(e) =>
                    updateSettings({
                      timerTextScale: Number(e.target.value) / 100,
                    })
                  }
                />
                <div className="settings-range-ticks">
                  <span>50%</span>
                  <span>100%</span>
                  <span>200%</span>
                </div>
              </div>

              <div className="settings-field">
                <label className="settings-label">BREAK ALERT THEME</label>
                <p className="settings-help" style={{ marginTop: '4px', marginBottom: '8px' }}>
                  Change the theme when approaching a scheduled break time.
                </p>
                <div className="settings-theme-dropdown">
                  <button
                    className="settings-theme-dropdown-button"
                    onClick={() => setIsBreakAlertDropdownOpen(!isBreakAlertDropdownOpen)}
                  >
                    {settings.breakAlertTheme ? (
                      <>
                        <div className="settings-theme-dropdown-preview">
                          <div className="settings-theme-swatch" style={{ backgroundColor: settings.breakAlertTheme.colors.background }} />
                          <div className="settings-theme-swatch" style={{ backgroundColor: settings.breakAlertTheme.colors.surface }} />
                          <div className="settings-theme-swatch" style={{ backgroundColor: settings.breakAlertTheme.colors.primary }} />
                          <div className="settings-theme-swatch" style={{ backgroundColor: settings.breakAlertTheme.colors.secondary }} />
                          <div className="settings-theme-swatch" style={{ backgroundColor: settings.breakAlertTheme.colors.accent }} />
                        </div>
                        <span className="settings-theme-dropdown-name">{settings.breakAlertTheme.name}</span>
                      </>
                    ) : (
                      <span className="settings-theme-dropdown-name">None</span>
                    )}
                    <span className="settings-theme-dropdown-arrow">{isBreakAlertDropdownOpen ? '▲' : '▼'}</span>
                  </button>
                  {isBreakAlertDropdownOpen && (
                    <div className="settings-theme-dropdown-menu">
                      <div className="settings-theme-dropdown-group">
                        <button
                          className={`settings-theme-dropdown-option ${!settings.breakAlertTheme ? 'settings-theme-dropdown-option--active' : ''}`}
                          onClick={() => {
                            updateSettings({ breakAlertTheme: null });
                            setIsBreakAlertDropdownOpen(false);
                          }}
                        >
                          <span className="settings-theme-dropdown-name">None</span>
                        </button>
                      </div>
                      <div className="settings-theme-dropdown-group">
                        <div className="settings-theme-dropdown-group-label">PRESET THEMES</div>
                        {PRESET_THEMES.map((theme) => (
                          <button
                            key={theme.name}
                            className={`settings-theme-dropdown-option ${settings.breakAlertTheme?.name === theme.name ? 'settings-theme-dropdown-option--active' : ''}`}
                            onClick={() => {
                              updateSettings({ breakAlertTheme: { ...theme, fontFamily: settings.theme.fontFamily } });
                              setIsBreakAlertDropdownOpen(false);
                            }}
                          >
                            <div className="settings-theme-dropdown-preview">
                              <div className="settings-theme-swatch" style={{ backgroundColor: theme.colors.background }} />
                              <div className="settings-theme-swatch" style={{ backgroundColor: theme.colors.surface }} />
                              <div className="settings-theme-swatch" style={{ backgroundColor: theme.colors.primary }} />
                              <div className="settings-theme-swatch" style={{ backgroundColor: theme.colors.secondary }} />
                              <div className="settings-theme-swatch" style={{ backgroundColor: theme.colors.accent }} />
                            </div>
                            <span className="settings-theme-dropdown-name">{theme.name}</span>
                          </button>
                        ))}
                      </div>
                      {(settings.customThemes || []).length > 0 && (
                        <div className="settings-theme-dropdown-group">
                          <div className="settings-theme-dropdown-group-label">CUSTOM THEMES</div>
                          {(settings.customThemes || []).map((theme) => (
                            <button
                              key={theme.name}
                              className={`settings-theme-dropdown-option ${settings.breakAlertTheme?.name === theme.name ? 'settings-theme-dropdown-option--active' : ''}`}
                              onClick={() => {
                                updateSettings({ breakAlertTheme: { ...theme, fontFamily: settings.theme.fontFamily } });
                                setIsBreakAlertDropdownOpen(false);
                              }}
                            >
                              <div className="settings-theme-dropdown-preview">
                                <div className="settings-theme-swatch" style={{ backgroundColor: theme.colors.background }} />
                                <div className="settings-theme-swatch" style={{ backgroundColor: theme.colors.surface }} />
                                <div className="settings-theme-swatch" style={{ backgroundColor: theme.colors.primary }} />
                                <div className="settings-theme-swatch" style={{ backgroundColor: theme.colors.secondary }} />
                                <div className="settings-theme-swatch" style={{ backgroundColor: theme.colors.accent }} />
                              </div>
                              <span className="settings-theme-dropdown-name">{theme.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'system' && (
            <div className="settings-section">
              <h3 className="settings-section-title">APP VERSION</h3>

              <div className="settings-field">
                <p className="settings-help">
                  Current Version: <strong>{appVersion || 'Loading...'}</strong>
                </p>
              </div>

              <h3 className="settings-section-title">CHECK FOR UPDATES</h3>

              <div className="settings-field">
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={settings.includeBetaUpdates ?? false}
                    onChange={(e) =>
                      updateSettings({ includeBetaUpdates: e.target.checked })
                    }
                  />
                  <span>Include beta releases in update checks</span>
                </label>
              </div>

              <div className="settings-actions">
                <button
                  className="btn"
                  onClick={handleCheckForUpdates}
                  disabled={isCheckingForUpdates}
                >
                  {isCheckingForUpdates ? 'CHECKING...' : 'CHECK FOR UPDATES'}
                </button>
              </div>

              {updateInfo && !updateInfo.isDev && (
                <>
                  {updateInfo.updateAvailable ? (
                    <div className="settings-update-info">
                      <p className="settings-help settings-update-available">
                        New version available: <strong>{updateInfo.latestVersion}</strong>
                      </p>

                      {!isUpdateReady && !isDownloading && (
                        <div className="settings-actions">
                          <button
                            className="btn btn--success"
                            onClick={handleDownloadUpdate}
                          >
                            DOWNLOAD UPDATE
                          </button>
                        </div>
                      )}

                      {isDownloading && (
                        <div className="settings-download-progress">
                          <p className="settings-help">
                            Downloading: {downloadProgress.toFixed(1)}%
                          </p>
                          <div className="settings-progress-bar">
                            <div
                              className="settings-progress-bar-fill"
                              style={{ width: `${downloadProgress}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {isUpdateReady && (
                        <>
                          <p className="settings-help settings-update-ready">
                            Update downloaded and ready to install!
                          </p>
                          <div className="settings-actions">
                            <button
                              className="btn btn--success"
                              onClick={handleInstallUpdate}
                            >
                              RESTART & INSTALL
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    updateInfo.currentVersion && (
                      <p className="settings-help settings-update-current">
                        You are running the latest version!
                      </p>
                    )
                  )}
                </>
              )}

              {updateInfo?.isDev && (
                <p className="settings-help">
                  Auto-update is only available in production builds. You are running in development mode.
                </p>
              )}

              <p className="settings-help">
                Gimbal automatically checks for updates on startup. Updates are published to GitHub Releases
                and include bug fixes, new features, and improvements.
              </p>

              <h3 className="settings-section-title">AUTO-BACKUP</h3>

              <div className="settings-field">
                <label className="settings-label">
                  <input
                    type="checkbox"
                    checked={settings.backupSettings?.enabled ?? true}
                    onChange={(e) =>
                      updateSettings({
                        backupSettings: {
                          ...settings.backupSettings!,
                          enabled: e.target.checked,
                        },
                      })
                    }
                  />
                  ENABLE AUTO-BACKUP
                </label>
              </div>

              <div className="settings-field">
                <label className="settings-label">BACKUP INTERVAL (MINUTES)</label>
                <input
                  type="number"
                  className="input"
                  min="5"
                  max="1440"
                  value={settings.backupSettings?.intervalMinutes ?? 60}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 60;
                    updateSettings({
                      backupSettings: {
                        ...settings.backupSettings!,
                        intervalMinutes: Math.max(5, Math.min(1440, val)),
                      },
                    });
                  }}
                />
              </div>

              <div className="settings-field">
                <label className="settings-label">MAX BACKUPS TO KEEP</label>
                <input
                  type="number"
                  className="input"
                  min="1"
                  max="100"
                  value={settings.backupSettings?.maxBackups ?? 10}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 10;
                    updateSettings({
                      backupSettings: {
                        ...settings.backupSettings!,
                        maxBackups: Math.max(1, Math.min(100, val)),
                      },
                    });
                  }}
                />
              </div>

              <div className="settings-field">
                <label className="settings-label">BACKUP DIRECTORY</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="text"
                    className="input"
                    value={settings.backupSettings?.backupDirectory || ''}
                    readOnly
                    style={{ flex: 1 }}
                  />
                  <button className="btn btn--secondary" onClick={handleSelectBackupDirectory}>
                    BROWSE
                  </button>
                </div>
              </div>

              {settings.backupSettings?.lastBackupTime && (
                <p className="settings-help">
                  Last backup: {formatBackupDate(settings.backupSettings.lastBackupTime)}
                </p>
              )}

              <h3 className="settings-section-title">MANUAL BACKUP</h3>

              <div className="settings-actions">
                <button
                  className="btn"
                  onClick={handleCreateBackup}
                  disabled={isCreatingBackup}
                >
                  {isCreatingBackup ? 'CREATING BACKUP...' : 'CREATE BACKUP NOW'}
                </button>
              </div>

              <p className="settings-help">
                Create an immediate backup of your current configuration.
              </p>

              <h3
                className="settings-section-title"
                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                onClick={() => setIsBackupHistoryCollapsed(!isBackupHistoryCollapsed)}
              >
                <span style={{ fontSize: '0.8em' }}>{isBackupHistoryCollapsed ? '▶' : '▼'}</span>
                BACKUP HISTORY ({backupList.length})
              </h3>

              {!isBackupHistoryCollapsed && (
                <>
                  {isLoadingBackups ? (
                    <p className="settings-help">Loading backups...</p>
                  ) : backupList.length === 0 ? (
                    <p className="settings-help">No backups found.</p>
                  ) : (
                    <>
                      <div style={{ marginBottom: '12px' }}>
                        {backupList.map((backup) => (
                          <div
                            key={backup.filepath}
                            style={{
                              padding: '8px 12px',
                              marginBottom: '6px',
                              border: '1px solid var(--color-border)',
                              borderRadius: '4px',
                              backgroundColor: 'var(--color-surface)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '12px',
                            }}
                          >
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <strong style={{ fontSize: '0.95em' }}>{formatBackupDate(backup.timestamp)}</strong>
                              <div style={{ fontSize: '0.85em', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                                {backup.profileCount} profile{backup.profileCount !== 1 ? 's' : ''} • {backup.dayCount} day{backup.dayCount !== 1 ? 's' : ''} • {formatFileSize(backup.size)}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                              <button
                                className="btn btn--secondary"
                                onClick={() => handleRestoreBackup(backup.filepath, backup.filename)}
                                style={{ fontSize: '0.85em', padding: '4px 10px' }}
                              >
                                RESTORE
                              </button>
                              <button
                                className="btn btn--danger"
                                onClick={() => handleDeleteBackup(backup.filepath, backup.filename)}
                                style={{ fontSize: '0.85em', padding: '4px 10px' }}
                              >
                                DELETE
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="settings-help">
                        Backup directory: {settings.backupSettings?.backupDirectory || 'Loading...'}
                      </p>
                    </>
                  )}
                </>
              )}

              <h3 className="settings-section-title">IMPORT / EXPORT</h3>

              <div className="settings-actions">
                <button className="btn" onClick={handleExport}>
                  EXPORT CONFIG
                </button>
                <button className="btn btn--secondary" onClick={handleImport}>
                  IMPORT CONFIG
                </button>
              </div>

              <p className="settings-help">
                Export your days, sections, links, and settings to a JSON file for backup or sharing.
              </p>
            </div>
          )}
        </div>
      </div>

      {colorPickerOpen && (
        <div className="settings-color-picker-overlay" {...colorPickerOverlayDismiss}>
          <div className="settings-color-picker-modal panel" onClick={(e) => e.stopPropagation()}>
            <h3 className="settings-section-title">EDIT {colorPickerOpen.label}</h3>

            <div className="settings-color-picker-preview" style={{ backgroundColor: tempColorValue }}>
              <span style={{ color: getContrastColor(tempColorValue) }}>{tempColorValue}</span>
            </div>

            <div className="settings-field">
              <label className="settings-label">COLOR PICKER</label>
              <input
                type="color"
                className="settings-color-picker-input"
                value={tempColorValue}
                onChange={(e) => setTempColorValue(e.target.value)}
              />
            </div>

            <div className="settings-field">
              <label className="settings-label">HEX CODE</label>
              <input
                type="text"
                className="input"
                value={tempColorValue}
                onChange={(e) => setTempColorValue(e.target.value)}
                placeholder="#000000"
              />
            </div>

            <div className="settings-actions">
              <button className="btn btn--success" onClick={applyColorChange}>
                APPLY
              </button>
              <button className="btn btn--secondary" onClick={() => setColorPickerOpen(null)}>
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SettingsModal;
