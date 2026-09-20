import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import {
  AppConfig,
  Profile,
  Day,
  Section,
  Link,
  Note,
  Poll,
  Settings,
  ScheduledTime,
  DEFAULT_CONFIG,
  DEFAULT_SETTINGS,
  DEFAULT_PROFILE,
  DEFAULT_BACKUP_SETTINGS,
  SectionItem,
  LinkStatus,
  AdditionalUrl,
} from '../../shared/types';

interface Notification {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

// Derive a multi-link group's overall status from its child URLs. Priority
// matches the icon shown in LinkItem: real failures first, then in-progress,
// then all-clear, then unverifiable.
function aggregateLinkStatus(entries: AdditionalUrl[]): LinkStatus {
  if (entries.length === 0) return 'unchecked';
  const statuses = entries.map((e) => e.status);
  if (statuses.includes('broken')) return 'broken';
  if (statuses.includes('timeout')) return 'timeout';
  if (statuses.includes('pending')) return 'pending';
  if (statuses.every((s) => s === 'ok')) return 'ok';
  return 'unchecked';
}

interface AppState {
  config: AppConfig;
  selectedDayId: string | null;
  isLoading: boolean;
  isSidebarOpen: boolean;
  isSettingsOpen: boolean;
  notifications: Notification[];
  isEditMode: boolean;
  selectedItemIds: Set<string>;
  selectedSectionIds: Set<string>;
  isBreakAlertActive: boolean;
  showValidationModal: boolean;
  _configLoadStarted: boolean;

  // Actions
  loadConfig: () => Promise<void>;
  saveConfig: () => Promise<void>;

  // Day operations
  addDay: (name: string) => void;
  updateDay: (dayId: string, updates: Partial<Pick<Day, 'name' | 'dayNumber' | 'labCount'>>) => void;
  deleteDay: (dayId: string) => void;
  selectDay: (dayId: string | null) => void;
  reorderDays: (fromIndex: number, toIndex: number) => void;

  // Section operations
  addSection: (dayId: string, name: string) => void;
  updateSection: (dayId: string, sectionId: string, name: string) => void;
  deleteSection: (dayId: string, sectionId: string) => void;
  toggleSectionCollapse: (dayId: string, sectionId: string) => void;
  collapseAllSections: (dayId: string) => void;
  expandAllSections: (dayId: string) => void;
  assignLabToSection: (dayId: string, sectionId: string, labNumber: string) => void;
  unassignLabFromSection: (dayId: string, sectionId: string) => void;
  updateLabNotes: (labNumber: string, notes: string) => void;

  // Day navigation
  goToPreviousDay: () => void;
  goToNextDay: () => void;

  // Item operations (links and notes)
  addLink: (dayId: string, sectionId: string, url: string, title: string, additionalUrls?: AdditionalUrl[]) => void;
  updateLink: (dayId: string, sectionId: string, linkId: string, updates: Partial<Link>) => void;
  deleteLink: (dayId: string, sectionId: string, linkId: string) => void;
  addNote: (dayId: string, sectionId: string, title: string, content: string) => void;
  updateNote: (dayId: string, sectionId: string, noteId: string, updates: Partial<Note>) => void;
  deleteNote: (dayId: string, sectionId: string, noteId: string) => void;
  updateLinkStatus: (url: string, status: LinkStatus, skipSave?: boolean) => void;

  // Poll operations
  addPoll: (dayId: string, sectionId: string, title: string, content: string) => void;
  updatePoll: (dayId: string, sectionId: string, pollId: string, updates: Partial<Poll>) => void;
  deletePoll: (dayId: string, sectionId: string, pollId: string) => void;
  markPollSent: (dayId: string, sectionId: string, pollId: string) => void;
  resetPoll: (dayId: string, sectionId: string, pollId: string) => void;
  resetSectionPolls: (dayId: string, sectionId: string) => void;
  resetAllPolls: () => void;

  // Settings
  updateSettings: (settings: Partial<Settings>) => void;

  // Scheduled times
  addScheduledTime: (label: string, time: string, duration: number) => void;
  updateScheduledTime: (id: string, updates: Partial<ScheduledTime>) => void;
  deleteScheduledTime: (id: string) => void;
  setBreakAlertActive: (active: boolean) => void;

  // Edit mode
  toggleEditMode: () => void;
  toggleItemSelection: (itemId: string) => void;
  toggleSectionSelection: (sectionId: string) => void;
  clearSelections: () => void;
  moveItems: (targetDayId: string, targetSectionId: string) => void;
  moveSections: (targetDayId: string) => void;
  moveItemToSection: (itemId: string, sourceDayId: string, sourceSectionId: string, targetDayId: string, targetSectionId: string) => void;
  reorderSection: (dayId: string, fromSectionId: string, toSectionId: string) => void;

  // UI
  toggleSidebar: () => void;
  toggleSettings: () => void;
  openSettingsToTab: (tab: string) => void;
  addNotification: (message: string, type: 'info' | 'success' | 'error') => void;
  removeNotification: (id: string) => void;
  closeValidationModal: () => void;
  updateLastLaunchDate: () => void;

  // Profile operations
  addProfile: (name: string) => void;
  deleteProfile: (profileId: string) => void;
  renameProfile: (profileId: string, name: string) => void;
  switchProfile: (profileId: string) => void;
  duplicateProfile: (profileId: string, newName: string) => void;
  getCurrentProfile: () => Profile;
  settingsTab: string;
  setSettingsTab: (tab: string) => void;
  openLabNotesLabNumber: string | null;
  setOpenLabNotesLabNumber: (labNumber: string | null) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  config: DEFAULT_CONFIG,
  selectedDayId: null,
  isLoading: true,
  isSidebarOpen: true,
  isSettingsOpen: false,
  notifications: [],
  isEditMode: false,
  selectedItemIds: new Set<string>(),
  selectedSectionIds: new Set<string>(),
  isBreakAlertActive: false,
  showValidationModal: false,
  _configLoadStarted: false,
  settingsTab: 'profiles',
  openLabNotesLabNumber: null,

  loadConfig: async () => {
    if (get()._configLoadStarted) return; // Prevent duplicate calls (e.g., React StrictMode)
    set({ _configLoadStarted: true, isLoading: true });
    try {
      const loadedConfig = await window.electronAPI.loadConfig();

      // Migrate from old format (settings/days at root) to new profile format
      let config: AppConfig;
      if (!loadedConfig.profiles) {
        // Old format - migrate to profile format
        const defaultBackupDir = await window.electronAPI.getDefaultBackupDirectory();
        const migratedProfile: Profile = {
          id: 'default',
          name: 'Default Profile',
          settings: {
            ...DEFAULT_SETTINGS,
            ...(loadedConfig.settings || {}),
            backupSettings: {
              ...DEFAULT_BACKUP_SETTINGS,
              backupDirectory: defaultBackupDir,
            },
          },
          days: loadedConfig.days || [],
        };
        config = {
          currentProfileId: 'default',
          profiles: [migratedProfile],
        };
      } else {
        // New format - ensure defaults are merged into each profile's settings
        config = {
          ...loadedConfig,
          profiles: await Promise.all(
            loadedConfig.profiles.map(async (profile: Profile) => ({
              ...profile,
              settings: {
                ...DEFAULT_SETTINGS,
                ...profile.settings,
                backupSettings: {
                  ...DEFAULT_BACKUP_SETTINGS,
                  ...(profile.settings.backupSettings || {}),
                  backupDirectory:
                    profile.settings.backupSettings?.backupDirectory ||
                    (await window.electronAPI.getDefaultBackupDirectory()),
                },
              },
            }))
          ),
        };
      }

      // Migrate section-level labNotes to profile-level settings.labNotes
      for (const profile of config.profiles) {
        for (const day of profile.days) {
          for (const section of day.sections) {
            if ((section as any).labNotes && section.assignedLab) {
              if (!profile.settings.labNotes) profile.settings.labNotes = {};
              if (!profile.settings.labNotes[section.assignedLab]) {
                profile.settings.labNotes[section.assignedLab] = (section as any).labNotes;
              }
            }
            delete (section as any).labNotes;
          }
        }
      }

      const currentProfile = config.profiles.find(p => p.id === config.currentProfileId) || config.profiles[0];
      const selectedDayId = currentProfile.days.length > 0 ? currentProfile.days[0].id : null;

      // Check if more than 4 days have passed since last launch
      const lastLaunch = currentProfile.settings.lastLaunchDate;
      let showValidation = false;
      if (lastLaunch) {
        const lastDate = new Date(lastLaunch);
        const now = new Date();
        const diffDays = (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
        showValidation = diffDays > 4;
      }

      set({ config, selectedDayId, isLoading: false, showValidationModal: showValidation });

      // Update last launch date if validation modal is not shown
      if (!showValidation) {
        get().updateLastLaunchDate();
      }

      // Check links on startup if enabled
      if (currentProfile.settings.checkLinksOnStartup) {
        const urls: string[] = [];
        currentProfile.days.forEach((day) => {
          day.sections.forEach((section) => {
            section.items.forEach((item) => {
              if (item.type === 'link') {
                if (item.additionalUrls && item.additionalUrls.length > 0) {
                  // Multi-link: all URLs are in additionalUrls
                  urls.push(...item.additionalUrls.map(a => a.url));
                } else {
                  // Single link: use primary url
                  urls.push(item.url);
                }
              }
            });
          });
        });

        if (urls.length > 0) {
          // Mark all links as pending first (skip saving)
          urls.forEach((url) => {
            get().updateLinkStatus(url, 'pending', true);
          });

          // Listen for individual results as they come in (skip saving)
          const unsubscribe = window.electronAPI.onLinkCheckResult((result) => {
            get().updateLinkStatus(result.url, result.status, true);
          });

          try {
            // Start checking (results will stream via the listener)
            await window.electronAPI.checkAllLinks(urls);
          } finally {
            // Always drop the listener, even if the check throws; otherwise it
            // stayed registered for the lifetime of the app.
            unsubscribe();
            get().saveConfig();
          }
        }
      }
    } catch (error) {
      console.error('Failed to load config:', error);
      set({ isLoading: false });
    }
  },

  saveConfig: async () => {
    try {
      await window.electronAPI.saveConfig(get().config);
    } catch (error) {
      console.error('Failed to save config:', error);
      get().addNotification('Failed to save configuration', 'error');
    }
  },

  addDay: (name) => {
    const { config } = get();
    const currentProfile = config.profiles.find((p) => p.id === config.currentProfileId)!;
    const newDay: Day = {
      id: uuidv4(),
      name,
      order: currentProfile.days.length,
      sections: [],
    };
    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? { ...p, days: [...p.days, newDay] }
            : p
        ),
      },
      selectedDayId: newDay.id,
    }));
    get().saveConfig();
  },

  updateDay: (dayId, updates) => {
    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? {
                ...p,
                days: p.days.map((day) =>
                  day.id === dayId ? { ...day, ...updates } : day
                ),
              }
            : p
        ),
      },
    }));
    get().saveConfig();
  },

  deleteDay: (dayId) => {
    set((state) => {
      const currentProfile = state.config.profiles.find((p) => p.id === state.config.currentProfileId)!;
      const newDays = currentProfile.days
        .filter((day) => day.id !== dayId)
        .map((day, index) => ({ ...day, order: index }));
      const newSelectedId =
        state.selectedDayId === dayId
          ? newDays.length > 0
            ? newDays[0].id
            : null
          : state.selectedDayId;
      return {
        config: {
          ...state.config,
          profiles: state.config.profiles.map((p) =>
            p.id === state.config.currentProfileId ? { ...p, days: newDays } : p
          ),
        },
        selectedDayId: newSelectedId,
      };
    });
    get().saveConfig();
  },

  selectDay: (dayId) => {
    set({ selectedDayId: dayId });
  },

  reorderDays: (fromIndex, toIndex) => {
    set((state) => {
      const currentProfile = state.config.profiles.find((p) => p.id === state.config.currentProfileId)!;
      const days = [...currentProfile.days];
      const [moved] = days.splice(fromIndex, 1);
      days.splice(toIndex, 0, moved);
      const reorderedDays = days.map((day, index) => ({ ...day, order: index }));
      return {
        config: {
          ...state.config,
          profiles: state.config.profiles.map((p) =>
            p.id === state.config.currentProfileId ? { ...p, days: reorderedDays } : p
          ),
        },
      };
    });
    get().saveConfig();
  },

  addSection: (dayId, name) => {
    const currentProfile = get().getCurrentProfile();
    const day = currentProfile.days.find((d) => d.id === dayId);
    if (!day) return;

    const newSection: Section = {
      id: uuidv4(),
      name,
      order: day.sections.length,
      isCollapsed: false,
      items: [],
      polls: [],
    };

    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? {
                ...p,
                days: p.days.map((d) =>
                  d.id === dayId
                    ? { ...d, sections: [...d.sections, newSection] }
                    : d
                ),
              }
            : p
        ),
      },
    }));
    get().saveConfig();
  },

  updateSection: (dayId, sectionId, name) => {
    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? {
                ...p,
                days: p.days.map((day) =>
                  day.id === dayId
                    ? {
                        ...day,
                        sections: day.sections.map((section) =>
                          section.id === sectionId ? { ...section, name } : section
                        ),
                      }
                    : day
                ),
              }
            : p
        ),
      },
    }));
    get().saveConfig();
  },

  deleteSection: (dayId, sectionId) => {
    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? {
                ...p,
                days: p.days.map((day) =>
                  day.id === dayId
                    ? {
                        ...day,
                        sections: day.sections
                          .filter((section) => section.id !== sectionId)
                          .map((section, index) => ({ ...section, order: index })),
                      }
                    : day
                ),
              }
            : p
        ),
      },
    }));
    get().saveConfig();
  },

  toggleSectionCollapse: (dayId, sectionId) => {
    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? {
                ...p,
                days: p.days.map((day) =>
                  day.id === dayId
                    ? {
                        ...day,
                        sections: day.sections.map((section) =>
                          section.id === sectionId
                            ? { ...section, isCollapsed: !section.isCollapsed }
                            : section
                        ),
                      }
                    : day
                ),
              }
            : p
        ),
      },
    }));
    get().saveConfig();
  },

  collapseAllSections: (dayId) => {
    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? {
                ...p,
                days: p.days.map((day) =>
                  day.id === dayId
                    ? {
                        ...day,
                        sections: day.sections.map((section) => ({
                          ...section,
                          isCollapsed: true,
                        })),
                      }
                    : day
                ),
              }
            : p
        ),
      },
    }));
    get().saveConfig();
  },

  expandAllSections: (dayId) => {
    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? {
                ...p,
                days: p.days.map((day) =>
                  day.id === dayId
                    ? {
                        ...day,
                        sections: day.sections.map((section) => ({
                          ...section,
                          isCollapsed: false,
                        })),
                      }
                    : day
                ),
              }
            : p
        ),
      },
    }));
    get().saveConfig();
  },

  assignLabToSection: (dayId, sectionId, labNumber) => {
    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? {
                ...p,
                days: p.days.map((day) =>
                  day.id === dayId
                    ? {
                        ...day,
                        sections: day.sections.map((section) =>
                          section.id === sectionId
                            ? { ...section, assignedLab: labNumber }
                            : section
                        ),
                      }
                    : day
                ),
              }
            : p
        ),
      },
    }));
    get().saveConfig();
  },

  unassignLabFromSection: (dayId, sectionId) => {
    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? {
                ...p,
                days: p.days.map((day) =>
                  day.id === dayId
                    ? {
                        ...day,
                        sections: day.sections.map((section) =>
                          section.id === sectionId
                            ? { ...section, assignedLab: undefined }
                            : section
                        ),
                      }
                    : day
                ),
              }
            : p
        ),
      },
    }));
    get().saveConfig();
  },

  updateLabNotes: (labNumber, notes) => {
    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? {
                ...p,
                settings: {
                  ...p.settings,
                  labNotes: {
                    ...(p.settings.labNotes || {}),
                    [labNumber]: notes,
                  },
                },
              }
            : p
        ),
      },
    }));
    get().saveConfig();
  },

  goToPreviousDay: () => {
    const { selectedDayId } = get();
    const currentProfile = get().getCurrentProfile();
    const sortedDays = [...currentProfile.days].sort((a, b) => a.order - b.order);
    const currentIndex = sortedDays.findIndex((d) => d.id === selectedDayId);
    if (currentIndex > 0) {
      set({ selectedDayId: sortedDays[currentIndex - 1].id });
    }
  },

  goToNextDay: () => {
    const { selectedDayId } = get();
    const currentProfile = get().getCurrentProfile();
    const sortedDays = [...currentProfile.days].sort((a, b) => a.order - b.order);
    const currentIndex = sortedDays.findIndex((d) => d.id === selectedDayId);
    if (currentIndex < sortedDays.length - 1) {
      set({ selectedDayId: sortedDays[currentIndex + 1].id });
    }
  },

  addLink: (dayId, sectionId, url, title, additionalUrls?) => {
    const currentProfile = get().getCurrentProfile();
    const day = currentProfile.days.find((d) => d.id === dayId);
    const section = day?.sections.find((s) => s.id === sectionId);
    if (!section) return;

    const newLink: Link = {
      type: 'link',
      id: uuidv4(),
      url,
      title,
      order: section.items.length,
      status: 'unchecked',
      ...(additionalUrls && additionalUrls.length > 0 ? { additionalUrls } : {}),
    };

    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? {
                ...p,
                days: p.days.map((d) =>
                  d.id === dayId
                    ? {
                        ...d,
                        sections: d.sections.map((s) =>
                          s.id === sectionId
                            ? { ...s, items: [...s.items, newLink] }
                            : s
                        ),
                      }
                    : d
                ),
              }
            : p
        ),
      },
    }));
    get().saveConfig();
  },

  updateLink: (dayId, sectionId, linkId, updates) => {
    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? {
                ...p,
                days: p.days.map((day) =>
                  day.id === dayId
                    ? {
                        ...day,
                        sections: day.sections.map((section) =>
                          section.id === sectionId
                            ? {
                                ...section,
                                items: section.items.map((item) =>
                                  item.id === linkId && item.type === 'link'
                                    ? { ...item, ...updates }
                                    : item
                                ),
                              }
                            : section
                        ),
                      }
                    : day
                ),
              }
            : p
        ),
      },
    }));
    get().saveConfig();
  },

  deleteLink: (dayId, sectionId, linkId) => {
    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? {
                ...p,
                days: p.days.map((day) =>
                  day.id === dayId
                    ? {
                        ...day,
                        sections: day.sections.map((section) =>
                          section.id === sectionId
                            ? {
                                ...section,
                                items: section.items
                                  .filter((item) => item.id !== linkId)
                                  .map((item, index) => ({ ...item, order: index })),
                              }
                            : section
                        ),
                      }
                    : day
                ),
              }
            : p
        ),
      },
    }));
    get().saveConfig();
  },

  addNote: (dayId, sectionId, title, content) => {
    const currentProfile = get().getCurrentProfile();
    const day = currentProfile.days.find((d) => d.id === dayId);
    const section = day?.sections.find((s) => s.id === sectionId);
    if (!section) return;

    const newNote: Note = {
      type: 'note',
      id: uuidv4(),
      title,
      content,
      order: section.items.length,
    };

    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? {
                ...p,
                days: p.days.map((d) =>
                  d.id === dayId
                    ? {
                        ...d,
                        sections: d.sections.map((s) =>
                          s.id === sectionId
                            ? { ...s, items: [...s.items, newNote] }
                            : s
                        ),
                      }
                    : d
                ),
              }
            : p
        ),
      },
    }));
    get().saveConfig();
  },

  updateNote: (dayId, sectionId, noteId, updates) => {
    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? {
                ...p,
                days: p.days.map((day) =>
                  day.id === dayId
                    ? {
                        ...day,
                        sections: day.sections.map((section) =>
                          section.id === sectionId
                            ? {
                                ...section,
                                items: section.items.map((item) =>
                                  item.id === noteId && item.type === 'note'
                                    ? { ...item, ...updates }
                                    : item
                                ),
                              }
                            : section
                        ),
                      }
                    : day
                ),
              }
            : p
        ),
      },
    }));
    get().saveConfig();
  },

  deleteNote: (dayId, sectionId, noteId) => {
    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? {
                ...p,
                days: p.days.map((day) =>
                  day.id === dayId
                    ? {
                        ...day,
                        sections: day.sections.map((section) =>
                          section.id === sectionId
                            ? {
                                ...section,
                                items: section.items
                                  .filter((item) => item.id !== noteId)
                                  .map((item, index) => ({ ...item, order: index })),
                              }
                            : section
                        ),
                      }
                    : day
                ),
              }
            : p
        ),
      },
    }));
    get().saveConfig();
  },

  updateLinkStatus: (url, status, skipSave = false) => {
    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? {
                ...p,
                days: p.days.map((day) => ({
                  ...day,
                  sections: day.sections.map((section) => ({
                    ...section,
                    items: section.items.map((item) => {
                      if (item.type !== 'link') return item;

                      // Check if any additional URL matches (for multi-link items)
                      if (item.additionalUrls && item.additionalUrls.some(a => a.url === url)) {
                        const updatedAdditionalUrls = item.additionalUrls.map(a =>
                          a.url === url ? { ...a, status } : a
                        );
                        // Always recompute the group status from its children.
                        // Previously this only ever set the status toward
                        // broken and fell back to the old value otherwise, so a
                        // group stayed 'broken' forever once any child failed,
                        // even after every child was fixed and re-checked.
                        const parentStatus = aggregateLinkStatus(updatedAdditionalUrls);
                        return {
                          ...item,
                          additionalUrls: updatedAdditionalUrls,
                          status: parentStatus,
                          lastChecked: new Date().toISOString()
                        };
                      }

                      // Check if primary URL matches (for single-link items)
                      if (item.url === url) {
                        return { ...item, status, lastChecked: new Date().toISOString() };
                      }

                      return item;
                    }),
                  })),
                })),
              }
            : p
        ),
      },
    }));
    if (!skipSave) {
      get().saveConfig();
    }
  },

  addPoll: (dayId, sectionId, title, content) => {
    const currentProfile = get().getCurrentProfile();
    const day = currentProfile.days.find((d) => d.id === dayId);
    const section = day?.sections.find((s) => s.id === sectionId);
    if (!section) return;

    const newPoll: Poll = {
      id: uuidv4(),
      title,
      content,
      order: (section.polls || []).length,
      sent: false,
    };

    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? {
                ...p,
                days: p.days.map((d) =>
                  d.id === dayId
                    ? {
                        ...d,
                        sections: d.sections.map((s) =>
                          s.id === sectionId
                            ? { ...s, polls: [...(s.polls || []), newPoll] }
                            : s
                        ),
                      }
                    : d
                ),
              }
            : p
        ),
      },
    }));
    get().saveConfig();
  },

  updatePoll: (dayId, sectionId, pollId, updates) => {
    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? {
                ...p,
                days: p.days.map((day) =>
                  day.id === dayId
                    ? {
                        ...day,
                        sections: day.sections.map((section) =>
                          section.id === sectionId
                            ? {
                                ...section,
                                polls: (section.polls || []).map((poll) =>
                                  poll.id === pollId ? { ...poll, ...updates } : poll
                                ),
                              }
                            : section
                        ),
                      }
                    : day
                ),
              }
            : p
        ),
      },
    }));
    get().saveConfig();
  },

  deletePoll: (dayId, sectionId, pollId) => {
    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? {
                ...p,
                days: p.days.map((day) =>
                  day.id === dayId
                    ? {
                        ...day,
                        sections: day.sections.map((section) =>
                          section.id === sectionId
                            ? {
                                ...section,
                                polls: (section.polls || [])
                                  .filter((poll) => poll.id !== pollId)
                                  .map((poll, index) => ({ ...poll, order: index })),
                              }
                            : section
                        ),
                      }
                    : day
                ),
              }
            : p
        ),
      },
    }));
    get().saveConfig();
  },

  markPollSent: (dayId, sectionId, pollId) => {
    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? {
                ...p,
                days: p.days.map((day) =>
                  day.id === dayId
                    ? {
                        ...day,
                        sections: day.sections.map((section) =>
                          section.id === sectionId
                            ? {
                                ...section,
                                polls: (section.polls || []).map((poll) =>
                                  poll.id === pollId ? { ...poll, sent: true } : poll
                                ),
                              }
                            : section
                        ),
                      }
                    : day
                ),
              }
            : p
        ),
      },
    }));
    get().saveConfig();
  },

  resetPoll: (dayId, sectionId, pollId) => {
    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? {
                ...p,
                days: p.days.map((day) =>
                  day.id === dayId
                    ? {
                        ...day,
                        sections: day.sections.map((section) =>
                          section.id === sectionId
                            ? {
                                ...section,
                                polls: (section.polls || []).map((poll) =>
                                  poll.id === pollId ? { ...poll, sent: false } : poll
                                ),
                              }
                            : section
                        ),
                      }
                    : day
                ),
              }
            : p
        ),
      },
    }));
    get().saveConfig();
  },

  resetSectionPolls: (dayId, sectionId) => {
    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? {
                ...p,
                days: p.days.map((day) =>
                  day.id === dayId
                    ? {
                        ...day,
                        sections: day.sections.map((section) =>
                          section.id === sectionId
                            ? {
                                ...section,
                                polls: (section.polls || []).map((poll) => ({ ...poll, sent: false })),
                              }
                            : section
                        ),
                      }
                    : day
                ),
              }
            : p
        ),
      },
    }));
    get().saveConfig();
  },

  resetAllPolls: () => {
    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? {
                ...p,
                days: p.days.map((day) => ({
                  ...day,
                  sections: day.sections.map((section) => ({
                    ...section,
                    polls: (section.polls || []).map((poll) => ({ ...poll, sent: false })),
                  })),
                })),
              }
            : p
        ),
      },
    }));
    get().saveConfig();
  },

  updateSettings: (settings) => {
    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? { ...p, settings: { ...p.settings, ...settings } }
            : p
        ),
      },
    }));
    get().saveConfig();
  },

  addScheduledTime: (label, time, duration) => {
    const newTime: ScheduledTime = {
      id: uuidv4(),
      label,
      time,
      duration,
      enabled: true,
    };
    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? {
                ...p,
                settings: {
                  ...p.settings,
                  scheduledTimes: [...(p.settings.scheduledTimes || []), newTime],
                },
              }
            : p
        ),
      },
    }));
    get().saveConfig();
  },

  updateScheduledTime: (id, updates) => {
    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? {
                ...p,
                settings: {
                  ...p.settings,
                  scheduledTimes: (p.settings.scheduledTimes || []).map((st) =>
                    st.id === id ? { ...st, ...updates } : st
                  ),
                },
              }
            : p
        ),
      },
    }));
    get().saveConfig();
  },

  deleteScheduledTime: (id) => {
    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === state.config.currentProfileId
            ? {
                ...p,
                settings: {
                  ...p.settings,
                  scheduledTimes: (p.settings.scheduledTimes || []).filter((st) => st.id !== id),
                },
              }
            : p
        ),
      },
    }));
    get().saveConfig();
  },

  setBreakAlertActive: (active) => {
    set({ isBreakAlertActive: active });
  },

  toggleEditMode: () => {
    set((state) => ({
      isEditMode: !state.isEditMode,
      selectedItemIds: new Set<string>(),
      selectedSectionIds: new Set<string>(),
    }));
  },

  toggleItemSelection: (itemId) => {
    set((state) => {
      const next = new Set(state.selectedItemIds);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return { selectedItemIds: next };
    });
  },

  toggleSectionSelection: (sectionId) => {
    set((state) => {
      const next = new Set(state.selectedSectionIds);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return { selectedSectionIds: next };
    });
  },

  clearSelections: () => {
    set({ selectedItemIds: new Set<string>(), selectedSectionIds: new Set<string>() });
  },

  moveItems: (targetDayId, targetSectionId) => {
    const { selectedItemIds, config } = get();
    if (selectedItemIds.size === 0) return;

    const currentProfile = get().getCurrentProfile();

    // Collect selected items from all days/sections
    const itemsToMove: SectionItem[] = [];
    const newDays = currentProfile.days.map((day) => ({
      ...day,
      sections: day.sections.map((section) => {
        const kept: SectionItem[] = [];
        section.items.forEach((item) => {
          if (selectedItemIds.has(item.id)) {
            itemsToMove.push(item);
          } else {
            kept.push(item);
          }
        });
        return {
          ...section,
          items: kept.map((item, i) => ({ ...item, order: i })),
        };
      }),
    }));

    // Add items to target section
    const finalDays = newDays.map((day) =>
      day.id === targetDayId
        ? {
            ...day,
            sections: day.sections.map((section) => {
              if (section.id !== targetSectionId) return section;
              const combined = [...section.items, ...itemsToMove];
              return {
                ...section,
                items: combined.map((item, i) => ({ ...item, order: i })),
              };
            }),
          }
        : day
    );

    set({
      config: {
        ...config,
        profiles: config.profiles.map((p) =>
          p.id === config.currentProfileId ? { ...p, days: finalDays } : p
        ),
      },
      selectedItemIds: new Set<string>(),
      selectedSectionIds: new Set<string>(),
    });
    get().saveConfig();
    get().addNotification(`Moved ${itemsToMove.length} item(s)`, 'success');
  },

  moveSections: (targetDayId) => {
    const { selectedSectionIds, config } = get();
    if (selectedSectionIds.size === 0) return;

    const currentProfile = get().getCurrentProfile();

    // Collect selected sections from all days
    const sectionsToMove: Section[] = [];
    const newDays = currentProfile.days.map((day) => {
      const kept: Section[] = [];
      day.sections.forEach((section) => {
        if (selectedSectionIds.has(section.id)) {
          sectionsToMove.push(section);
        } else {
          kept.push(section);
        }
      });
      return {
        ...day,
        sections: kept.map((s, i) => ({ ...s, order: i })),
      };
    });

    // Add sections to target day
    const finalDays = newDays.map((day) =>
      day.id === targetDayId
        ? {
            ...day,
            sections: [...day.sections, ...sectionsToMove].map((s, i) => ({
              ...s,
              order: i,
            })),
          }
        : day
    );

    set({
      config: {
        ...config,
        profiles: config.profiles.map((p) =>
          p.id === config.currentProfileId ? { ...p, days: finalDays } : p
        ),
      },
      selectedItemIds: new Set<string>(),
      selectedSectionIds: new Set<string>(),
    });
    get().saveConfig();
    get().addNotification(`Moved ${sectionsToMove.length} section(s)`, 'success');
  },

  reorderSection: (dayId, fromSectionId, toSectionId) => {
    set((state) => {
      const currentProfile = state.config.profiles.find((p) => p.id === state.config.currentProfileId)!;
      const day = currentProfile.days.find((d) => d.id === dayId);
      if (!day) return state;
      const sections = [...day.sections].sort((a, b) => a.order - b.order);
      // Resolve positions by id: stored `order` values can be stale, duplicated,
      // or have gaps (legacy configs, cross-day moves), which made index math
      // splice out `undefined` and corrupt the section list.
      const fromIndex = sections.findIndex((s) => s.id === fromSectionId);
      const toIndex = sections.findIndex((s) => s.id === toSectionId);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return state;
      const [moved] = sections.splice(fromIndex, 1);
      sections.splice(toIndex, 0, moved);
      const reordered = sections.map((s, i) => ({ ...s, order: i }));
      return {
        config: {
          ...state.config,
          profiles: state.config.profiles.map((p) =>
            p.id === state.config.currentProfileId
              ? {
                  ...p,
                  days: p.days.map((d) =>
                    d.id === dayId ? { ...d, sections: reordered } : d
                  ),
                }
              : p
          ),
        },
      };
    });
    get().saveConfig();
  },

  moveItemToSection: (itemId, sourceDayId, sourceSectionId, targetDayId, targetSectionId) => {
    if (sourceDayId === targetDayId && sourceSectionId === targetSectionId) return;

    const { config } = get();
    const currentProfile = get().getCurrentProfile();
    let movedItem: SectionItem | undefined;

    // Remove item from source section
    const newDays = currentProfile.days.map((day) =>
      day.id === sourceDayId
        ? {
            ...day,
            sections: day.sections.map((section) => {
              if (section.id !== sourceSectionId) return section;
              const item = section.items.find((i) => i.id === itemId);
              if (item) movedItem = item;
              return {
                ...section,
                items: section.items
                  .filter((i) => i.id !== itemId)
                  .map((i, idx) => ({ ...i, order: idx })),
              };
            }),
          }
        : day
    );

    if (!movedItem) return;

    // Add item to target section
    const finalDays = newDays.map((day) =>
      day.id === targetDayId
        ? {
            ...day,
            sections: day.sections.map((section) => {
              if (section.id !== targetSectionId) return section;
              const combined = [...section.items, movedItem!];
              return {
                ...section,
                items: combined.map((i, idx) => ({ ...i, order: idx })),
              };
            }),
          }
        : day
    );

    set({
      config: {
        ...config,
        profiles: config.profiles.map((p) =>
          p.id === config.currentProfileId ? { ...p, days: finalDays } : p
        ),
      },
    });
    get().saveConfig();
    get().addNotification('Item moved', 'success');
  },

  toggleSidebar: () => {
    set((state) => ({ isSidebarOpen: !state.isSidebarOpen }));
  },

  toggleSettings: () => {
    set((state) => ({ isSettingsOpen: !state.isSettingsOpen }));
  },

  addNotification: (message, type) => {
    const id = uuidv4();
    set((state) => ({
      notifications: [...state.notifications, { id, message, type }],
    }));
    setTimeout(() => {
      get().removeNotification(id);
    }, 3000);
  },

  removeNotification: (id) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },

  closeValidationModal: () => {
    set({ showValidationModal: false });
    get().updateLastLaunchDate();
  },

  updateLastLaunchDate: () => {
    const { config } = get();
    set({
      config: {
        ...config,
        profiles: config.profiles.map((profile) =>
          profile.id === config.currentProfileId
            ? {
                ...profile,
                settings: {
                  ...profile.settings,
                  lastLaunchDate: new Date().toISOString(),
                },
              }
            : profile
        ),
      },
    });
    get().saveConfig();
  },

  // Profile operations
  getCurrentProfile: () => {
    const { config } = get();
    return config.profiles.find((p) => p.id === config.currentProfileId) || config.profiles[0];
  },

  addProfile: (name) => {
    const newProfile: Profile = {
      id: uuidv4(),
      name,
      settings: { ...DEFAULT_SETTINGS },
      days: [],
    };
    set((state) => ({
      config: {
        ...state.config,
        profiles: [...state.config.profiles, newProfile],
        currentProfileId: newProfile.id,
      },
      selectedDayId: null,
    }));
    get().saveConfig();
    get().addNotification(`Profile "${name}" created`, 'success');
  },

  deleteProfile: (profileId) => {
    const { config } = get();
    if (config.profiles.length <= 1) {
      get().addNotification('Cannot delete the last profile', 'error');
      return;
    }
    const profileToDelete = config.profiles.find((p) => p.id === profileId);
    const newProfiles = config.profiles.filter((p) => p.id !== profileId);
    const newCurrentId = config.currentProfileId === profileId ? newProfiles[0].id : config.currentProfileId;
    const newCurrentProfile = newProfiles.find((p) => p.id === newCurrentId)!;

    set({
      config: {
        ...config,
        profiles: newProfiles,
        currentProfileId: newCurrentId,
      },
      selectedDayId: newCurrentProfile.days.length > 0 ? newCurrentProfile.days[0].id : null,
    });
    get().saveConfig();
    get().addNotification(`Profile "${profileToDelete?.name}" deleted`, 'success');
  },

  renameProfile: (profileId, name) => {
    set((state) => ({
      config: {
        ...state.config,
        profiles: state.config.profiles.map((p) =>
          p.id === profileId ? { ...p, name } : p
        ),
      },
    }));
    get().saveConfig();
  },

  switchProfile: (profileId) => {
    const { config } = get();
    const profile = config.profiles.find((p) => p.id === profileId);
    if (!profile) return;

    set({
      config: {
        ...config,
        currentProfileId: profileId,
      },
      selectedDayId: profile.days.length > 0 ? profile.days[0].id : null,
    });
    get().saveConfig();
    get().addNotification(`Switched to "${profile.name}"`, 'success');
  },

  duplicateProfile: (profileId, newName) => {
    const { config } = get();
    const sourceProfile = config.profiles.find((p) => p.id === profileId);
    if (!sourceProfile) return;

    const newProfile: Profile = {
      ...JSON.parse(JSON.stringify(sourceProfile)),
      id: uuidv4(),
      name: newName,
    };

    set({
      config: {
        ...config,
        profiles: [...config.profiles, newProfile],
        currentProfileId: newProfile.id,
      },
      selectedDayId: newProfile.days.length > 0 ? newProfile.days[0].id : null,
    });
    get().saveConfig();
    get().addNotification(`Profile "${newName}" created from "${sourceProfile.name}"`, 'success');
  },

  setSettingsTab: (tab) => {
    set({ settingsTab: tab });
  },

  openSettingsToTab: (tab) => {
    set({ isSettingsOpen: true, settingsTab: tab });
  },

  setOpenLabNotesLabNumber: (labNumber) => {
    set({ openLabNotesLabNumber: labNumber });
  },
}));
