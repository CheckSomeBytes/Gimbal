import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useOverlayDismiss } from '../../hooks/useOverlayDismiss';
import { TIMEZONES, ScheduledTime, Link, Note } from '../../../shared/types';
import TodoPopup from '../Todo/TodoPopup';
import MarkdownEditor from '../Markdown/MarkdownEditor';
import { markdownToPlainText } from '../Markdown/markdown';
import { buildEvalUrl } from '../../../shared/evalLinks';
import iconBrowser from '../../assets/icon-browser.png';
import iconSlack from '../../assets/icon-slack.png';
import './Header.css';

// Common Slack emoji codes for the quick poll emoji picker
const COMMON_SLACK_EMOJIS: { code: string; unicode: string }[] = [
  // Yes / No / Status
  { code: ':white_check_mark:', unicode: '✅' },
  { code: ':x:', unicode: '❌' },
  { code: ':thumbsup:', unicode: '👍' },
  { code: ':thumbsdown:', unicode: '👎' },
  { code: ':heavy_check_mark:', unicode: '✔️' },
  { code: ':no_entry_sign:', unicode: '🚫' },
  // Reactions
  { code: ':heart:', unicode: '❤️' },
  { code: ':star:', unicode: '⭐' },
  { code: ':fire:', unicode: '🔥' },
  { code: ':100:', unicode: '💯' },
  { code: ':tada:', unicode: '🎉' },
  { code: ':clap:', unicode: '👏' },
  { code: ':raised_hands:', unicode: '🙌' },
  { code: ':muscle:', unicode: '💪' },
  { code: ':pray:', unicode: '🙏' },
  // Faces
  { code: ':smile:', unicode: '😄' },
  { code: ':laughing:', unicode: '😆' },
  { code: ':thinking_face:', unicode: '🤔' },
  { code: ':neutral_face:', unicode: '😐' },
  { code: ':confused:', unicode: '😕' },
  { code: ':disappointed:', unicode: '😞' },
  { code: ':scream:', unicode: '😱' },
  { code: ':sleeping:', unicode: '😴' },
  { code: ':nerd_face:', unicode: '🤓' },
  { code: ':sunglasses:', unicode: '😎' },
  { code: ':partying_face:', unicode: '🥳' },
  { code: ':shrug:', unicode: '🤷' },
  // Objects / Symbols
  { code: ':bulb:', unicode: '💡' },
  { code: ':rocket:', unicode: '🚀' },
  { code: ':eyes:', unicode: '👀' },
  { code: ':warning:', unicode: '⚠️' },
  { code: ':question:', unicode: '❓' },
  { code: ':exclamation:', unicode: '❗' },
  { code: ':mega:', unicode: '📣' },
  { code: ':trophy:', unicode: '🏆' },
  { code: ':dart:', unicode: '🎯' },
  { code: ':books:', unicode: '📚' },
  { code: ':pencil:', unicode: '✏️' },
  { code: ':wrench:', unicode: '🔧' },
  { code: ':hammer:', unicode: '🔨' },
  { code: ':lock:', unicode: '🔒' },
  { code: ':key:', unicode: '🔑' },
  { code: ':gear:', unicode: '⚙️' },
  { code: ':hourglass:', unicode: '⏳' },
  { code: ':stopwatch:', unicode: '⏱️' },
  { code: ':calendar:', unicode: '📅' },
  { code: ':clipboard:', unicode: '📋' },
  { code: ':bar_chart:', unicode: '📊' },
  { code: ':chart_with_upwards_trend:', unicode: '📈' },
  { code: ':link:', unicode: '🔗' },
  { code: ':computer:', unicode: '💻' },
  { code: ':bug:', unicode: '🐛' },
  { code: ':shield:', unicode: '🛡️' },
  // Hands / Gestures
  { code: ':point_up:', unicode: '☝️' },
  { code: ':point_right:', unicode: '👉' },
  { code: ':point_down:', unicode: '👇' },
  { code: ':point_left:', unicode: '👈' },
  { code: ':wave:', unicode: '👋' },
  { code: ':ok_hand:', unicode: '👌' },
  { code: ':v:', unicode: '✌️' },
  // Math / Arrows
  { code: ':heavy_plus_sign:', unicode: '➕' },
  { code: ':heavy_minus_sign:', unicode: '➖' },
  { code: ':arrow_up:', unicode: '⬆️' },
  { code: ':arrow_down:', unicode: '⬇️' },
  { code: ':arrow_left:', unicode: '⬅️' },
  { code: ':arrow_right:', unicode: '➡️' },
  // Numbers / Letters
  { code: ':one:', unicode: '1️⃣' },
  { code: ':two:', unicode: '2️⃣' },
  { code: ':three:', unicode: '3️⃣' },
  { code: ':four:', unicode: '4️⃣' },
  { code: ':five:', unicode: '5️⃣' },
  { code: ':six:', unicode: '6️⃣' },
  { code: ':seven:', unicode: '7️⃣' },
  { code: ':eight:', unicode: '8️⃣' },
  { code: ':nine:', unicode: '9️⃣' },
  { code: ':keycap_ten:', unicode: '🔟' },
  { code: ':a:', unicode: '🅰️' },
  { code: ':b:', unicode: '🅱️' },
  { code: ':o:', unicode: '⭕' },
  // Colors / Shapes
  { code: ':red_circle:', unicode: '🔴' },
  { code: ':large_blue_circle:', unicode: '🔵' },
  { code: ':white_circle:', unicode: '⚪' },
  { code: ':black_circle:', unicode: '⚫' },
  { code: ':green_heart:', unicode: '💚' },
  { code: ':blue_heart:', unicode: '💙' },
  { code: ':purple_heart:', unicode: '💜' },
  { code: ':yellow_heart:', unicode: '💛' },
  { code: ':large_green_square:', unicode: '🟩' },
  { code: ':large_red_square:', unicode: '🟥' },
  { code: ':large_blue_square:', unicode: '🟦' },
  { code: ':large_yellow_square:', unicode: '🟨' },
];

// Search result interface
interface SearchResult {
  type: 'link' | 'note';
  item: Link | Note;
  dayId: string;
  dayName: string;
  sectionId: string;
  sectionName: string;
  matchField: 'title' | 'url' | 'content';
}

// Format minutes as "X hr Y min" or "X min" depending on duration
function formatDuration(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins === 0) {
      return `${hours} hr`;
    }
    return `${hours} hr ${mins} min`;
  }
  return `${minutes} min`;
}

function Header() {
  const {
    toggleSettings,
    selectedDayId,
    goToPreviousDay,
    goToNextDay,
    isEditMode,
    toggleEditMode,
    addNotification,
    updateSettings,
    isBreakAlertActive,
    setBreakAlertActive,
    getCurrentProfile,
    openSettingsToTab,
    openLabNotesLabNumber,
    setOpenLabNotesLabNumber,
    updateLabNotes,
    setTodoPopupOpen,
    addPoll,
  } = useAppStore();

  const currentProfile = getCurrentProfile();

  const [showLabPopup, setShowLabPopup] = useState(false);
  const [labNumber, setLabNumber] = useState('');
  const [isCustomLabNumber, setIsCustomLabNumber] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Time estimate popup state
  const [showTimeEstimatePopup, setShowTimeEstimatePopup] = useState(false);
  const [estimateLabNumber, setEstimateLabNumber] = useState('');
  const [isCustomEstimateLabNumber, setIsCustomEstimateLabNumber] = useState(false);
  const [estimateLabTime, setEstimateLabTime] = useState('30');
  const [estimateBreakId, setEstimateBreakId] = useState<string>('');

  // Custom timer mode state
  const [isCustomTimerMode, setIsCustomTimerMode] = useState(false);
  const [customTimerMinutes, setCustomTimerMinutes] = useState('10');
  const [customTimerMessage, setCustomTimerMessage] = useState('');

  // Lab notes popup state
  const [labNotesText, setLabNotesText] = useState('');

  // Search popup state
  const [showSearchPopup, setShowSearchPopup] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  // Quick Poll popup state
  const [showQuickPollPopup, setShowQuickPollPopup] = useState(false);
  const [quickPollQuestion, setQuickPollQuestion] = useState('');
  const [quickPollOptions, setQuickPollOptions] = useState<{ emoji: string; text: string }[]>([
    { emoji: '', text: '' },
    { emoji: '', text: '' },
  ]);
  const [quickPollAnonymous, setQuickPollAnonymous] = useState(true);

  // Backdrop dismissal for each popup. Dragging from inside a popup out over
  // the backdrop must not close it, so these ignore drags that began inside.
  const labPopupDismiss = useOverlayDismiss(() => setShowLabPopup(false));
  const labNotesDismiss = useOverlayDismiss(() => setOpenLabNotesLabNumber(null));
  const timeEstimateDismiss = useOverlayDismiss(() => setShowTimeEstimatePopup(false));
  const quickPollDismiss = useOverlayDismiss(() => setShowQuickPollPopup(false));
  const searchDismiss = useOverlayDismiss(() => setShowSearchPopup(false));
  const [showQuickPollSaveDropdown, setShowQuickPollSaveDropdown] = useState(false);
  const [quickPollSaveTitle, setQuickPollSaveTitle] = useState('');
  const [quickPollSaveDayId, setQuickPollSaveDayId] = useState('');
  const [quickPollSaveSectionId, setQuickPollSaveSectionId] = useState('');
  const [quickPollEmojiPickerIndex, setQuickPollEmojiPickerIndex] = useState<number | null>(null);
  const [quickPollCustomEmoji, setQuickPollCustomEmoji] = useState('');

  const timezone = currentProfile.settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const scheduledTimes = currentProfile.settings.scheduledTimes || [];
  const breakAlertMinutes = currentProfile.settings.breakAlertMinutes || 5;
  const openTodoCount = (currentProfile.settings.todos || []).filter((t) => !t.done).length;

  // Detect if using modern font
  const fontFamily = currentProfile.settings.theme.fontFamily;
  const isModernFont = fontFamily.includes('Lexend') ||
                       fontFamily === 'sans-serif' ||
                       fontFamily.includes('Courier');

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // The countdown window has its own text-size buttons; persist whatever size
  // the instructor lands on so the next timer opens at that size.
  useEffect(() => {
    // Guard the bridge: if the preload ever fails to load, a bare call here
    // throws during render and blanks the entire window instead of degrading.
    if (!window.electronAPI?.onTimerTextScaleChanged) return;
    return window.electronAPI.onTimerTextScaleChanged((scale) => {
      updateSettings({ timerTextScale: scale });
    });
  }, [updateSettings]);

  // Sync lab notes text when opening a lab notes popup
  useEffect(() => {
    if (openLabNotesLabNumber) {
      setLabNotesText(currentProfile.settings.labNotes?.[openLabNotesLabNumber] || '');
    }
  }, [openLabNotesLabNumber]);

  const openSearchPopup = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setShowSearchPopup(true);
  }, []);

  // Global shortcuts: Ctrl/Cmd+K opens search, Ctrl/Cmd+S opens settings.
  // Both were documented in the README but never implemented.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'k') {
        e.preventDefault();
        openSearchPopup();
      } else if (key === 's') {
        // Prevent the browser "save page" dialog in dev.
        e.preventDefault();
        openSettingsToTab('general');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openSearchPopup, openSettingsToTab]);

  // Get current time in the selected timezone
  const getCurrentTimeInTimezone = () => {
    const timeStr = currentTime.toLocaleTimeString('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const [hours, minutes, seconds] = timeStr.split(':').map(Number);
    return hours * 3600 + minutes * 60 + seconds;
  };

  // Convert HH:MM time string to seconds since midnight
  const timeToSeconds = (time: string) => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 3600 + minutes * 60;
  };

  // Find the next scheduled time
  const getNextScheduledTime = (): { time: ScheduledTime; secondsUntil: number } | null => {
    const enabledTimes = scheduledTimes.filter((st) => st.enabled);
    if (enabledTimes.length === 0) return null;

    const currentSeconds = getCurrentTimeInTimezone();
    let closest: { time: ScheduledTime; secondsUntil: number } | null = null;

    for (const st of enabledTimes) {
      const targetSeconds = timeToSeconds(st.time);
      let diff = targetSeconds - currentSeconds;

      // If the time has passed today, it's for tomorrow (add 24 hours)
      if (diff < 0) {
        diff += 24 * 3600;
      }

      if (closest === null || diff < closest.secondsUntil) {
        closest = { time: st, secondsUntil: diff };
      }
    }

    return closest;
  };

  const nextScheduled = useMemo(() => getNextScheduledTime(), [currentTime, scheduledTimes, timezone]);

  // Check if we should show break alert theme
  useEffect(() => {
    if (nextScheduled && currentProfile.settings.breakAlertTheme) {
      const minutesUntil = nextScheduled.secondsUntil / 60;
      const shouldBeActive = minutesUntil <= breakAlertMinutes && minutesUntil > 0;

      if (shouldBeActive !== isBreakAlertActive) {
        setBreakAlertActive(shouldBeActive);
      }
    } else if (isBreakAlertActive) {
      setBreakAlertActive(false);
    }
  }, [nextScheduled, breakAlertMinutes, currentProfile.settings.breakAlertTheme, isBreakAlertActive, setBreakAlertActive]);

  // Format countdown as MM:SS or HH:MM:SS
  const formatCountdown = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  const getTimezoneAbbr = (tz: string) => {
    // Get the timezone abbreviation (e.g., "EST", "PST")
    const abbr = new Date().toLocaleTimeString('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    }).split(' ').pop() || tz.split('/').pop()?.replace(/_/g, ' ') || tz;
    return abbr;
  };

  const sortedDays = [...currentProfile.days].sort((a, b) => a.order - b.order);
  const currentIndex = sortedDays.findIndex((d) => d.id === selectedDayId);
  const currentDay = sortedDays[currentIndex];
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex < sortedDays.length - 1;

  // Get enabled scheduled times for the countdown display
  const enabledScheduledTimes = scheduledTimes.filter((st) => st.enabled);
  // Get scheduled times marked as breaks for the time estimate popup
  const breakScheduledTimes = scheduledTimes.filter((st) => st.isBreak);

  // Calculate return time based on lab time and optional break
  const calculateReturnTime = (): { time: string; message: string; timerMessage: string; totalMinutes: number } => {
    const hasLab = estimateLabNumber.trim() !== '';
    const labMinutes = hasLab ? (parseInt(estimateLabTime) || 30) : 0;
    const selectedBreak = breakScheduledTimes.find((st) => st.id === estimateBreakId);

    // Get current time in timezone
    const now = new Date();
    const nowInTz = new Date(now.toLocaleString('en-US', { timeZone: timezone }));

    let totalMinutes = labMinutes;
    const parts: string[] = [];
    const timerParts: string[] = [];

    if (hasLab) {
      parts.push(`:lab_coat: Lab ${estimateLabNumber.trim()} (${formatDuration(labMinutes)})`);
      timerParts.push(`Lab ${estimateLabNumber.trim()} (${formatDuration(labMinutes)})`);
    }

    if (selectedBreak) {
      totalMinutes += selectedBreak.duration || 15;
      parts.push(`:timer_clock: ${selectedBreak.label} (${formatDuration(selectedBreak.duration || 15)})`);
      timerParts.push(`${selectedBreak.label} (${formatDuration(selectedBreak.duration || 15)})`);
    }

    const returnDate = new Date(nowInTz.getTime() + totalMinutes * 60 * 1000);
    const returnTimeStr = returnDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    const timerMessage = totalMinutes > 0
      ? timerParts.join(' + ')
      : 'Timer';

    const message = totalMinutes > 0
      ? `${parts.join(' + ')} - Back at approximately ${returnTimeStr}`
      : 'Please select lab time or a break';

    return { time: returnTimeStr, message, timerMessage, totalMinutes };
  };

  const handleSendTimeEstimate = async () => {
    const { totalMinutes } = calculateReturnTime();

    if (totalMinutes <= 0) {
      addNotification('Please select lab time or a break', 'error');
      return;
    }

    const { windowTarget } = currentProfile.settings;

    if (!windowTarget.pattern) {
      addNotification('No window pattern configured. Go to Settings.', 'error');
      return;
    }

    const { message } = calculateReturnTime();

    const result = await window.electronAPI.focusAndPaste(
      windowTarget.pattern,
      windowTarget.matchMode,
      message
    );

    if (result.success) {
      addNotification('Time estimate sent!', 'success');
    } else {
      addNotification(result.error || 'Failed to send time estimate', 'error');
    }
  };

  // Every day's eval, each derived from that day's own Day# so a QR code can
  // only ever point at the evaluation for the day it is labelled with. Days
  // without a Day# are left out.
  const getEvalLinks = () =>
    sortedDays.flatMap((day) => {
      const url = buildEvalUrl(currentProfile.settings.evalTemplateUrl, day.dayNumber);
      return url && day.dayNumber ? [{ url, dayNumber: day.dayNumber, dayName: day.name }] : [];
    });

  // Colours and settings passed to the countdown window. Includes the break
  // alert theme so the timer turns red near the end, like the main window.
  const getTimerTheme = (endLabel?: string) => {
    const { theme, breakAlertTheme, timerFontFamily, timerTextScale } = currentProfile.settings;
    return {
      background: theme.colors.background,
      text: theme.colors.text,
      textMuted: theme.colors.textMuted,
      accent: theme.colors.accent,
      success: theme.colors.success,
      danger: theme.colors.danger,
      fontFamily: timerFontFamily || theme.fontFamily,
      border: theme.colors.border,
      textScale: timerTextScale,
      alert: breakAlertTheme
        ? {
            background: breakAlertTheme.colors.background,
            text: breakAlertTheme.colors.text,
            textMuted: breakAlertTheme.colors.textMuted,
            accent: breakAlertTheme.colors.accent,
            danger: breakAlertTheme.colors.danger,
            border: breakAlertTheme.colors.border,
          }
        : null,
      alertMinutes: breakAlertMinutes,
      timezone,
      endLabel,
      evalLinks: getEvalLinks(),
      currentEvalDay: currentDay?.dayNumber ?? null,
    };
  };

  const handleOpenCountdownTimer = async () => {
    const { totalMinutes, timerMessage } = calculateReturnTime();

    if (totalMinutes <= 0) {
      addNotification('Please select lab time or a break', 'error');
      return;
    }

    await window.electronAPI.openCountdownTimer(totalMinutes, timerMessage, getTimerTheme());
    addNotification('Countdown timer opened!', 'success');
  };

  const handleSendAndOpenTimer = async () => {
    const { totalMinutes, message, timerMessage } = calculateReturnTime();

    if (totalMinutes <= 0) {
      addNotification('Please select lab time or a break', 'error');
      return;
    }

    const { windowTarget } = currentProfile.settings;

    if (!windowTarget.pattern) {
      addNotification('No window pattern configured. Go to Settings.', 'error');
      return;
    }

    // Focus window, paste, and press Enter
    const result = await window.electronAPI.focusAndPaste(
      windowTarget.pattern,
      windowTarget.matchMode,
      message,
      true // Press Enter after pasting
    );

    if (result.success) {
      // Close the popup
      setShowTimeEstimatePopup(false);

      // Open the countdown timer
      await window.electronAPI.openCountdownTimer(totalMinutes, timerMessage, getTimerTheme());

      addNotification('Time estimate sent and timer opened!', 'success');
    } else {
      addNotification(result.error || 'Failed to send time estimate', 'error');
    }
  };

  const classStartTime = currentProfile.settings.classStartTime || '09:00';

  // Seconds from now until today's class start in the profile's timezone, or
  // null if it has already passed.
  const getSecondsUntilClassStart = (): number | null => {
    const [hours, minutes] = classStartTime.split(':').map((n) => parseInt(n, 10));
    if (isNaN(hours) || isNaN(minutes)) return null;
    const now = new Date();
    const nowInTz = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    const startInTz = new Date(nowInTz);
    startInTz.setHours(hours, minutes, 0, 0);
    // toLocaleString drops milliseconds, so add them back to land on :00.
    const seconds = (startInTz.getTime() - nowInTz.getTime() - now.getMilliseconds()) / 1000;
    return seconds > 0 ? seconds : null;
  };

  const formatClassStartTime = () => {
    const [hours, minutes] = classStartTime.split(':').map((n) => parseInt(n, 10));
    const date = new Date();
    date.setHours(hours || 0, minutes || 0, 0, 0);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const handleOpenClassStartTimer = async () => {
    const seconds = getSecondsUntilClassStart();
    if (seconds === null) {
      addNotification(`Class start (${formatClassStartTime()}) has already passed today`, 'error');
      return;
    }
    await window.electronAPI.openCountdownTimer(seconds / 60, 'Class Starts Soon', getTimerTheme('Starts at'));
    addNotification('Class start timer opened!', 'success');
    setShowTimeEstimatePopup(false);
  };

  const handleOpenCustomTimer = async () => {
    const minutes = parseInt(customTimerMinutes) || 0;
    if (minutes <= 0) {
      addNotification('Please enter a valid number of minutes', 'error');
      return;
    }

    const message = customTimerMessage.trim() || `${formatDuration(minutes)} Timer`;
    await window.electronAPI.openCountdownTimer(minutes, message, getTimerTheme());
    addNotification('Countdown timer opened!', 'success');
    setShowTimeEstimatePopup(false);
  };

  const handleSendLabPoll = async () => {
    if (!labNumber.trim()) {
      addNotification('Please enter a lab number', 'error');
      return;
    }

    const { windowTarget, labPollTemplate } = currentProfile.settings;

    if (!windowTarget.pattern) {
      addNotification('No window pattern configured. Go to Settings.', 'error');
      return;
    }

    const pollText = (labPollTemplate || '').replace(/<LAB_NUMBER>/g, labNumber.trim());

    const result = await window.electronAPI.focusAndPaste(
      windowTarget.pattern,
      windowTarget.matchMode,
      pollText
    );

    if (result.success) {
      addNotification(`Lab ${labNumber} poll sent!`, 'success');
      setShowLabPopup(false);
      setLabNumber('');
    } else {
      addNotification(result.error || 'Failed to send lab poll', 'error');
    }
  };

  // Lab notes are written in markdown but copied as plain text, since the
  // usual paste targets (Slack, Zoom chat) have no markdown rendering.
  const handleCopyLabNotes = async () => {
    if (!labNotesText.trim()) {
      addNotification('No notes to copy', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(markdownToPlainText(labNotesText));
      addNotification('Lab notes copied to clipboard', 'success');
    } catch {
      addNotification('Failed to copy lab notes', 'error');
    }
  };

  // Search functionality
  const performSearch = useCallback((query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    currentProfile.days.forEach((day) => {
      day.sections.forEach((section) => {
        section.items.forEach((item) => {
          if (item.type === 'link') {
            const link = item as Link;
            // Check title (including customTitle)
            const displayTitle = link.customTitle || link.title;
            if (displayTitle.toLowerCase().includes(lowerQuery)) {
              results.push({
                type: 'link',
                item: link,
                dayId: day.id,
                dayName: day.name,
                sectionId: section.id,
                sectionName: section.name,
                matchField: 'title',
              });
            } else if (link.url.toLowerCase().includes(lowerQuery)) {
              results.push({
                type: 'link',
                item: link,
                dayId: day.id,
                dayName: day.name,
                sectionId: section.id,
                sectionName: section.name,
                matchField: 'url',
              });
            }
            // Also check additional URLs
            if (link.additionalUrls) {
              link.additionalUrls.forEach((addUrl) => {
                if (addUrl.title.toLowerCase().includes(lowerQuery) || addUrl.url.toLowerCase().includes(lowerQuery)) {
                  // Avoid duplicates if main link already matched
                  const alreadyAdded = results.some(r => r.item.id === link.id);
                  if (!alreadyAdded) {
                    results.push({
                      type: 'link',
                      item: link,
                      dayId: day.id,
                      dayName: day.name,
                      sectionId: section.id,
                      sectionName: section.name,
                      matchField: 'url',
                    });
                  }
                }
              });
            }
          } else if (item.type === 'note') {
            const note = item as Note;
            if (note.title.toLowerCase().includes(lowerQuery)) {
              results.push({
                type: 'note',
                item: note,
                dayId: day.id,
                dayName: day.name,
                sectionId: section.id,
                sectionName: section.name,
                matchField: 'title',
              });
            } else if (note.content.toLowerCase().includes(lowerQuery)) {
              results.push({
                type: 'note',
                item: note,
                dayId: day.id,
                dayName: day.name,
                sectionId: section.id,
                sectionName: section.name,
                matchField: 'content',
              });
            }
          }
        });
      });
    });

    setSearchResults(results);
  }, [currentProfile.days]);

  const handleSearchResultClick = (result: SearchResult) => {
    // Navigate to the day containing the result
    const { selectDay } = useAppStore.getState();
    selectDay(result.dayId);
    setShowSearchPopup(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  // Search result action handlers
  const handleSearchOpenInChrome = async (e: React.MouseEvent, url: string) => {
    e.stopPropagation();
    try {
      await window.electronAPI.openInChrome(url);
    } catch {
      addNotification('Failed to open link in Chrome', 'error');
    }
  };

  const handleSearchFocusAndPaste = async (e: React.MouseEvent, result: SearchResult) => {
    e.stopPropagation();
    const { windowTarget } = currentProfile.settings;

    if (!windowTarget.pattern) {
      addNotification('No window pattern configured. Go to Settings.', 'error');
      return;
    }

    let textToPaste: string;
    if (result.type === 'link') {
      const link = result.item as Link;
      const displayTitle = link.customTitle || link.title;
      textToPaste = `${displayTitle}\n${link.url}`;
    } else {
      const note = result.item as Note;
      textToPaste = note.content;
    }

    const pasteResult = await window.electronAPI.focusAndPaste(
      windowTarget.pattern,
      windowTarget.matchMode,
      textToPaste,
      windowTarget.pressEnterAfterPaste
    );

    if (!pasteResult.success) {
      addNotification(pasteResult.error || 'Failed to paste', 'error');
    }
  };

  const handleSearchTitleClick = async (e: React.MouseEvent, result: SearchResult) => {
    e.stopPropagation();
    try {
      let textToCopy: string;
      if (result.type === 'link') {
        const link = result.item as Link;
        const displayTitle = link.customTitle || link.title;
        textToCopy = `${displayTitle}\n${link.url}`;
      } else {
        const note = result.item as Note;
        textToCopy = note.content;
      }
      await navigator.clipboard.writeText(textToCopy);
      addNotification('Copied to clipboard', 'success');
    } catch {
      addNotification('Failed to copy', 'error');
    }
  };

  const handleQuickLabPoll = async (labNum: string) => {
    const { windowTarget, labPollTemplate } = currentProfile.settings;

    if (!windowTarget.pattern) {
      addNotification('No window pattern configured. Go to Settings.', 'error');
      return;
    }

    const pollText = (labPollTemplate || '').replace(/<LAB_NUMBER>/g, labNum);

    const result = await window.electronAPI.focusAndPaste(
      windowTarget.pattern,
      windowTarget.matchMode,
      pollText
    );

    if (result.success) {
      addNotification(`Lab ${labNum} poll sent!`, 'success');
    } else {
      addNotification(result.error || 'Failed to send lab poll', 'error');
    }
  };

  // Quick Poll helpers
  const generateQuickPollText = () => {
    const question = quickPollQuestion.trim() || 'Your question here';
    const validOptions = quickPollOptions.filter((o) => o.text.trim());
    const optionStrings = validOptions.map((o) => {
      const emoji = o.emoji.trim();
      return emoji ? `"${o.text.trim()}"${emoji}` : `"${o.text.trim()}"`;
    });
    const flags: string[] = [];
    if (quickPollAnonymous) flags.push('anonymous');
    const flagStr = flags.length > 0 ? ' ' + flags.join(' ') : '';
    return `/poll "${question}" ${optionStrings.join(' ')}${flagStr}`;
  };

  const handleAddPollOption = () => {
    if (quickPollOptions.length >= 10) {
      addNotification('Maximum 10 options allowed', 'error');
      return;
    }
    setQuickPollOptions([...quickPollOptions, { emoji: '', text: '' }]);
  };

  const handleRemovePollOption = (index: number) => {
    setQuickPollOptions(quickPollOptions.filter((_, i) => i !== index));
  };

  const handleSendQuickPoll = async () => {
    if (!quickPollQuestion.trim()) {
      addNotification('Please enter a question', 'error');
      return;
    }
    const validOptions = quickPollOptions.filter((o) => o.text.trim());
    if (validOptions.length < 2) {
      addNotification('Please fill in at least 2 options', 'error');
      return;
    }
    const { windowTarget } = currentProfile.settings;
    if (!windowTarget.pattern) {
      addNotification('No window pattern configured. Go to Settings.', 'error');
      return;
    }
    const pollText = generateQuickPollText();
    const result = await window.electronAPI.focusAndPaste(
      windowTarget.pattern,
      windowTarget.matchMode,
      pollText
    );
    if (result.success) {
      addNotification('Quick poll sent!', 'success');
      setShowQuickPollPopup(false);
    } else {
      addNotification(result.error || 'Failed to send quick poll', 'error');
    }
  };

  const handleSaveQuickPoll = () => {
    if (!quickPollQuestion.trim()) {
      addNotification('Please enter a question', 'error');
      return;
    }
    const validOptions = quickPollOptions.filter((o) => o.text.trim());
    if (validOptions.length < 2) {
      addNotification('Please fill in at least 2 options', 'error');
      return;
    }
    if (!quickPollSaveDayId || !quickPollSaveSectionId) {
      addNotification('Please select a day and section to save to', 'error');
      return;
    }
    const title = quickPollSaveTitle.trim() || quickPollQuestion.trim();
    addPoll(quickPollSaveDayId, quickPollSaveSectionId, title, generateQuickPollText());
    addNotification('Poll saved to section!', 'success');
  };


  return (
    <>
    <header className="header">
      <div className="header-left">
        <h1
          className="header-title header-title--clickable"
          onClick={() => openSettingsToTab('profiles')}
          title="Click to manage profiles"
        >
          {currentProfile.name.toUpperCase()}
        </h1>
      </div>

      <div className="header-center">
        <button
          className="header-nav-btn"
          onClick={goToPreviousDay}
          disabled={!hasPrevious}
          title="Previous day"
        >
          ◀
        </button>
        <span className="header-day-name">
          {currentDay ? currentDay.name : 'NO DAYS'}
        </span>
        <button
          className="header-nav-btn"
          onClick={goToNextDay}
          disabled={!hasNext}
          title="Next day"
        >
          ▶
        </button>
      </div>

      <div className="header-right">
        <div
          className={`header-mode-toggle ${isEditMode ? 'header-mode-toggle--edit' : ''}`}
          onClick={toggleEditMode}
          title={isEditMode ? 'Switch to Read mode' : 'Switch to Edit mode'}
        >
          <span className={`header-mode-label ${!isEditMode ? 'header-mode-label--active' : ''}`}>READ</span>
          <div className="header-mode-track">
            <div className="header-mode-thumb" />
          </div>
          <span className={`header-mode-label ${isEditMode ? 'header-mode-label--active' : ''}`}>EDIT</span>
        </div>
        <button
          className="header-settings-btn btn btn--small"
          onClick={toggleSettings}
          title="Settings"
        >
          {isModernFont ? '⚙' : '*'}
        </button>
        <button
          className="btn btn--small"
          onClick={() => window.electronAPI.minimizeApp()}
          title="Minimize"
        >
          _
        </button>
        <button
          className="btn btn--small btn--danger"
          onClick={() => window.electronAPI.quitApp()}
          title="Exit"
        >
          ✕
        </button>
      </div>

      {/* Lab Poll Popup */}
      {showLabPopup && (
        <div className="lab-popup-overlay" {...labPopupDismiss}>
          <div className="lab-popup" onClick={(e) => e.stopPropagation()}>
            <div className="lab-popup-header">
              <span className="lab-popup-title">LAB POLL</span>
              <button
                className="btn btn--small btn--danger"
                onClick={() => setShowLabPopup(false)}
              >
                ✕
              </button>
            </div>
            <div className="lab-popup-content">
              <div className="lab-label-row">
                <label className="lab-popup-label">LAB NUMBER</label>
                <label className="lab-popup-label">CUSTOM</label>
              </div>
              <div className="lab-number-row">
                {currentDay?.dayNumber && currentDay?.labCount && currentDay.labCount > 0 && (
                  <div className="lab-buttons-row">
                    {Array.from({ length: currentDay.labCount }, (_, i) => {
                      const label = `${currentDay.dayNumber}.${i + 1}`;
                      return (
                        <button
                          key={label}
                          className={`btn btn--small lab-btn ${labNumber === label && !isCustomLabNumber ? 'lab-btn--active' : ''}`}
                          onClick={() => { setLabNumber(label); setIsCustomLabNumber(false); }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
                <input
                  type="text"
                  className={`input lab-popup-input-small ${isCustomLabNumber ? 'lab-popup-input-small--active' : ''}`}
                  placeholder="..."
                  value={isCustomLabNumber ? labNumber : ''}
                  onChange={(e) => { setLabNumber(e.target.value); setIsCustomLabNumber(true); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSendLabPoll();
                    if (e.key === 'Escape') setShowLabPopup(false);
                  }}
                  autoFocus
                />
              </div>
              <div className="lab-popup-preview">
                <label className="lab-popup-label">PREVIEW</label>
                <div className="lab-popup-preview-text">
                  {(currentProfile.settings.labPollTemplate || '').replace(
                    /<LAB_NUMBER>/g,
                    labNumber || '<LAB_NUMBER>'
                  )}
                </div>
              </div>
            </div>
            <div className="lab-popup-actions">
              <button
                className="btn btn--success"
                onClick={handleSendLabPoll}
              >
                SEND LAB POLL
              </button>
              <button
                className="btn btn--secondary"
                onClick={() => setShowLabPopup(false)}
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}
    </header>

      <div className={`sub-header ${isBreakAlertActive ? 'sub-header--alert' : ''}`}>
        <div className="header-timezone">
          <span className="header-timezone-time">{formatTime(currentTime)}</span>
          <div className="header-timezone-selector">
            <select
              className="header-timezone-select"
              value={timezone}
              onChange={(e) => updateSettings({ timezone: e.target.value })}
              title={timezone.replace(/_/g, ' ')}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <span className="header-timezone-abbr">{getTimezoneAbbr(timezone)}</span>
          </div>
        </div>

        {nextScheduled && (
          <div className={`header-countdown ${isBreakAlertActive ? 'header-countdown--alert' : ''}`}>
            <span className="header-countdown-label">{nextScheduled.time.label}</span>
            <span className="header-countdown-time">{formatCountdown(nextScheduled.secondsUntil)}</span>
          </div>
        )}

        <button
          className="header-poll-btn btn btn--small"
          onClick={() => {
            setQuickPollQuestion('');
            setQuickPollOptions([
              { emoji: ':white_check_mark:', text: '' },
              { emoji: ':x:', text: '' },
            ]);
            setQuickPollAnonymous(true);
            setQuickPollSaveDayId(selectedDayId || '');
            setQuickPollSaveSectionId(currentDay?.sections[0]?.id || '');
            setShowQuickPollSaveDropdown(false);
            setQuickPollEmojiPickerIndex(null);
            setQuickPollCustomEmoji('');
            setShowQuickPollPopup(true);
          }}
          title="Quick Poll"
        >
          📊
        </button>
        <button
          className="header-search-btn btn btn--small"
          onClick={openSearchPopup}
          title="Search links and notes (Ctrl+K)"
        >
          🔍
        </button>
        <button
          className="header-time-btn btn btn--small"
          onClick={() => {
            setEstimateBreakId('');
            setEstimateLabNumber('');
            setIsCustomEstimateLabNumber(false);
            setIsCustomTimerMode(false);
            setShowTimeEstimatePopup(true);
          }}
          title="Timer"
        >
          ⏱
        </button>
        <button
          className="header-todo-btn btn btn--small"
          onClick={() => setTodoPopupOpen(true)}
          title={openTodoCount > 0 ? `Todo (${openTodoCount} open)` : 'Todo'}
        >
          ✓
          {openTodoCount > 0 && (
            <span className="todo-badge">{openTodoCount > 99 ? '99+' : openTodoCount}</span>
          )}
        </button>
      </div>

      {/* Lab Bar */}
      {currentDay?.dayNumber && currentDay?.labCount && currentDay.labCount > 0 && (
        <div className="lab-bar">
          <span className="lab-bar-label">LABS</span>
          <div className="lab-bar-buttons">
            {Array.from({ length: currentDay.labCount }, (_, i) => {
              const label = `${currentDay.dayNumber}.${i + 1}`;
              // Check if this lab is assigned to any section
              const assignedSection = currentDay.sections.find(s => s.assignedLab === label);
              const isAssigned = !!assignedSection;
              return (
                <button
                  key={label}
                  className={`btn btn--small lab-bar-btn ${isAssigned ? 'lab-bar-btn--assigned' : ''} ${currentProfile.settings.labNotes?.[label] ? 'lab-bar-btn--has-notes' : ''}`}
                  onClick={() => {
                    setOpenLabNotesLabNumber(label);
                  }}
                  draggable={isEditMode}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/lab-assign', JSON.stringify({ labNumber: label }));
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  title={isEditMode ? `Drag to assign Lab ${label} to a section, or click to send poll` : `Send Lab ${label} poll`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <TodoPopup />

      {/* Lab Notes Popup */}
      {openLabNotesLabNumber && (
        <div className="lab-popup-overlay lab-popup-overlay--top-anchored" {...labNotesDismiss}>
          <div className="lab-popup lab-popup--notes" onClick={(e) => e.stopPropagation()}>
            <div className="lab-popup-header">
              <span className="lab-popup-title">Lab {openLabNotesLabNumber} Notes</span>
              <div className="lab-popup-header-right">
                <button
                  className="btn btn--small btn--danger"
                  onClick={() => setOpenLabNotesLabNumber(null)}
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="lab-popup-content">
              <MarkdownEditor
                value={labNotesText}
                onChange={(next) => {
                  setLabNotesText(next);
                  updateLabNotes(openLabNotesLabNumber, next);
                }}
                placeholder="Enter your lab notes here... Markdown is supported."
                autoFocus
                actions={
                  <>
                    <button
                      className="btn btn--small btn--secondary"
                      onClick={handleCopyLabNotes}
                      title="Copy notes as plain text"
                    >
                      COPY
                    </button>
                    <button
                      className="btn btn--small btn--success"
                      onClick={() => handleQuickLabPoll(openLabNotesLabNumber)}
                      title="Send lab poll to target window"
                    >
                      🧪 SEND POLL
                    </button>
                  </>
                }
              />
            </div>
          </div>
        </div>
      )}

      {/* Time Estimate Popup */}
      {showTimeEstimatePopup && (
        <div className="lab-popup-overlay lab-popup-overlay--top-anchored" {...timeEstimateDismiss}>
          <div className="lab-popup" onClick={(e) => e.stopPropagation()}>
            <div className="lab-popup-header">
              <span className="lab-popup-title">LAUNCH TIMER</span>
              <div className="lab-popup-header-right">
                <div
                  className={`time-estimate-mode-toggle ${isCustomTimerMode ? 'time-estimate-mode-toggle--custom' : ''}`}
                  onClick={() => setIsCustomTimerMode(!isCustomTimerMode)}
                >
                  <span className={`time-estimate-mode-label ${!isCustomTimerMode ? 'time-estimate-mode-label--active' : ''}`}>STANDARD</span>
                  <div className="time-estimate-mode-track">
                    <div className="time-estimate-mode-thumb" />
                  </div>
                  <span className={`time-estimate-mode-label ${isCustomTimerMode ? 'time-estimate-mode-label--active' : ''}`}>CUSTOM</span>
                </div>
                <button
                  className="btn btn--small btn--danger"
                  onClick={() => setShowTimeEstimatePopup(false)}
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="lab-popup-content">
              {isCustomTimerMode ? (
                <>
                  <div className="time-estimate-lab-time">
                    <label className="lab-popup-label">MINUTES</label>
                    <input
                      type="number"
                      className="input lab-popup-input-small"
                      value={customTimerMinutes}
                      onChange={(e) => setCustomTimerMinutes(e.target.value)}
                      min="1"
                      max="180"
                      autoFocus
                    />
                  </div>
                  <div className="time-estimate-lab-time">
                    <label className="lab-popup-label">MESSAGE (OPTIONAL)</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g. Lunch Break"
                      value={customTimerMessage}
                      onChange={(e) => setCustomTimerMessage(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleOpenCustomTimer();
                      }}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="time-estimate-buttons-row">
                    <div className="lab-buttons-row">
                      {breakScheduledTimes.map((st) => (
                        <button
                          key={st.id}
                          className={`btn btn--small lab-btn ${estimateBreakId === st.id ? 'lab-btn--active' : ''}`}
                          onClick={() => setEstimateBreakId(estimateBreakId === st.id ? '' : st.id)}
                        >
                          {st.label}
                        </button>
                      ))}
                    </div>
                    <div className="time-estimate-separator"></div>
                    <div className="lab-buttons-row">
                      {currentDay?.dayNumber && currentDay?.labCount && currentDay.labCount > 0 && (
                        <>
                          {Array.from({ length: currentDay.labCount }, (_, i) => {
                            const label = `${currentDay.dayNumber}.${i + 1}`;
                            return (
                              <button
                                key={label}
                                className={`btn btn--small lab-btn ${estimateLabNumber === label && !isCustomEstimateLabNumber ? 'lab-btn--active' : ''}`}
                                onClick={() => {
                                  if (estimateLabNumber === label && !isCustomEstimateLabNumber) {
                                    setEstimateLabNumber('');
                                  } else {
                                    setEstimateLabNumber(label);
                                    setIsCustomEstimateLabNumber(false);
                                  }
                                }}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </>
                      )}
                      <input
                        type="text"
                        className={`input lab-popup-input-small ${isCustomEstimateLabNumber ? 'lab-popup-input-small--active' : ''}`}
                        placeholder="..."
                        value={isCustomEstimateLabNumber ? estimateLabNumber : ''}
                        onChange={(e) => { setEstimateLabNumber(e.target.value); setIsCustomEstimateLabNumber(true); }}
                      />
                    </div>
                  </div>
                  <div className="time-estimate-lab-time">
                    <label className="lab-popup-label">LAB TIME (MIN)</label>
                    <input
                      type="number"
                      className="input lab-popup-input-small"
                      value={estimateLabTime}
                      onChange={(e) => setEstimateLabTime(e.target.value)}
                      min="1"
                      max="180"
                    />
                  </div>
                  <div className="lab-popup-preview">
                    <label className="lab-popup-label">PREVIEW</label>
                    <div className="lab-popup-preview-text">
                      {calculateReturnTime().message}
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="lab-popup-actions">
              {isCustomTimerMode ? (
                <button
                  className="btn btn--primary btn--full-width"
                  onClick={handleOpenCustomTimer}
                >
                  OPEN TIMER
                </button>
              ) : (
                <>
                  <button
                    className="btn btn--accent btn--full-width"
                    onClick={handleSendAndOpenTimer}
                    title="Send estimate, press Enter, and open timer"
                  >
                    SEND & OPEN TIMER
                  </button>
                  <button
                    className="btn btn--primary btn--half-width"
                    onClick={handleOpenCountdownTimer}
                    title="Open a shareable countdown timer window"
                  >
                    OPEN TIMER
                  </button>
                  <button
                    className="btn btn--success btn--half-width"
                    onClick={handleSendTimeEstimate}
                    title="Send estimate to target window"
                  >
                    SEND ESTIMATE
                  </button>
                  <button
                    className="btn btn--secondary btn--full-width"
                    onClick={handleOpenClassStartTimer}
                    title="Open a timer counting down to the class start time (set in Settings > Days)"
                  >
                    CLASS START ({formatClassStartTime()})
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Quick Poll Popup */}
      {showQuickPollPopup && (
        <div className="lab-popup-overlay" {...quickPollDismiss}>
          <div className="lab-popup quick-poll-popup" onClick={(e) => { e.stopPropagation(); setQuickPollEmojiPickerIndex(null); }}>
            <div className="lab-popup-header">
              <span className="lab-popup-title">QUICK POLL</span>
              <button
                className="btn btn--small btn--danger"
                onClick={() => setShowQuickPollPopup(false)}
              >
                ✕
              </button>
            </div>
            <div className="lab-popup-content">
              <div className="quick-poll-field">
                <label className="lab-popup-label">QUESTION</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Enter your poll question..."
                  value={quickPollQuestion}
                  onChange={(e) => setQuickPollQuestion(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="quick-poll-field">
                <label className="lab-popup-label">ANSWERS</label>
                {quickPollOptions.map((option, index) => (
                  <div key={index} className="quick-poll-option-row">
                    <div className="quick-poll-emoji-wrapper">
                      <button
                        className="quick-poll-emoji-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (quickPollEmojiPickerIndex === index) {
                            setQuickPollEmojiPickerIndex(null);
                            setQuickPollCustomEmoji('');
                          } else {
                            setQuickPollEmojiPickerIndex(index);
                            setQuickPollCustomEmoji('');
                          }
                        }}
                        title={option.emoji || 'Select emoji'}
                      >
                        {option.emoji || 'emoji'}
                      </button>
                      {quickPollEmojiPickerIndex === index && (
                        <div className="quick-poll-emoji-picker" onClick={(e) => e.stopPropagation()}>
                          <div className="quick-poll-emoji-grid">
                            {COMMON_SLACK_EMOJIS.map((emoji) => (
                              <button
                                key={emoji.code}
                                className={`quick-poll-emoji-grid-btn ${option.emoji === emoji.code ? 'quick-poll-emoji-grid-btn--active' : ''}`}
                                onClick={() => {
                                  const updated = [...quickPollOptions];
                                  updated[index] = { ...updated[index], emoji: emoji.code };
                                  setQuickPollOptions(updated);
                                  setQuickPollEmojiPickerIndex(null);
                                  setQuickPollCustomEmoji('');
                                }}
                                title={emoji.code}
                              >
                                {emoji.unicode}
                              </button>
                            ))}
                          </div>
                          <div className="quick-poll-emoji-custom">
                            <input
                              type="text"
                              className="input quick-poll-emoji-custom-input"
                              placeholder=":custom_emoji:"
                              value={quickPollCustomEmoji}
                              onChange={(e) => setQuickPollCustomEmoji(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && quickPollCustomEmoji.trim()) {
                                  const updated = [...quickPollOptions];
                                  updated[index] = { ...updated[index], emoji: quickPollCustomEmoji.trim() };
                                  setQuickPollOptions(updated);
                                  setQuickPollEmojiPickerIndex(null);
                                  setQuickPollCustomEmoji('');
                                }
                              }}
                              autoFocus
                            />
                            <button
                              className="btn btn--small btn--accent"
                              onClick={() => {
                                if (quickPollCustomEmoji.trim()) {
                                  const updated = [...quickPollOptions];
                                  updated[index] = { ...updated[index], emoji: quickPollCustomEmoji.trim() };
                                  setQuickPollOptions(updated);
                                  setQuickPollEmojiPickerIndex(null);
                                  setQuickPollCustomEmoji('');
                                }
                              }}
                            >
                              APPLY
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    <input
                      type="text"
                      className="input quick-poll-text-input"
                      placeholder={`Option ${index + 1}`}
                      value={option.text}
                      onChange={(e) => {
                        const updated = [...quickPollOptions];
                        updated[index] = { ...updated[index], text: e.target.value };
                        setQuickPollOptions(updated);
                      }}
                    />
                    {quickPollOptions.length > 2 && (
                      <button
                        className="btn btn--small btn--danger quick-poll-remove-btn"
                        onClick={() => handleRemovePollOption(index)}
                        title="Remove option"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                <button
                  className="btn btn--small quick-poll-add-btn"
                  onClick={handleAddPollOption}
                >
                  + ADD OPTION
                </button>
              </div>
              <div className="quick-poll-toggle">
                <label>
                  <input
                    type="checkbox"
                    checked={quickPollAnonymous}
                    onChange={(e) => setQuickPollAnonymous(e.target.checked)}
                  />
                  <span className="quick-poll-toggle-label">ANONYMOUS</span>
                </label>
              </div>
              <div className="lab-popup-preview">
                <label className="lab-popup-label">PREVIEW</label>
                <div className="lab-popup-preview-text">
                  {generateQuickPollText()}
                </div>
              </div>
            </div>
            <div className="lab-popup-actions quick-poll-buttons-row">
              <div className="quick-poll-save-wrapper">
                <button
                  className="btn btn--accent btn--full-width"
                  onClick={() => {
                    if (!showQuickPollSaveDropdown) {
                      setQuickPollSaveTitle(quickPollQuestion.trim());
                    }
                    setShowQuickPollSaveDropdown(!showQuickPollSaveDropdown);
                  }}
                  title="Save poll to section"
                >
                  SAVE
                </button>
                {showQuickPollSaveDropdown && (
                  <div className="quick-poll-save-dropdown">
                    <input
                      type="text"
                      className="input"
                      placeholder="Poll title..."
                      value={quickPollSaveTitle}
                      onChange={(e) => setQuickPollSaveTitle(e.target.value)}
                    />
                    <select
                      className="input quick-poll-section-select"
                      value={quickPollSaveDayId}
                      onChange={(e) => {
                        setQuickPollSaveDayId(e.target.value);
                        const day = currentProfile.days.find((d) => d.id === e.target.value);
                        setQuickPollSaveSectionId(day?.sections[0]?.id || '');
                      }}
                    >
                      {sortedDays.map((day) => (
                        <option key={day.id} value={day.id}>
                          {day.name}
                        </option>
                      ))}
                    </select>
                    <select
                      className="input quick-poll-section-select"
                      value={quickPollSaveSectionId}
                      onChange={(e) => setQuickPollSaveSectionId(e.target.value)}
                    >
                      {(currentProfile.days.find((d) => d.id === quickPollSaveDayId)?.sections || []).map((section) => (
                        <option key={section.id} value={section.id}>
                          {section.name}
                        </option>
                      ))}
                    </select>
                    <div className="quick-poll-save-preview">
                      {generateQuickPollText()}
                    </div>
                    <button
                      className="btn btn--accent btn--full-width"
                      onClick={() => {
                        handleSaveQuickPoll();
                        setShowQuickPollSaveDropdown(false);
                      }}
                      disabled={!quickPollSaveSectionId}
                    >
                      CONFIRM SAVE
                    </button>
                  </div>
                )}
              </div>
              <button
                className="btn btn--success btn--half-width"
                onClick={handleSendQuickPoll}
              >
                SEND TO SLACK
              </button>
              <button
                className="btn btn--primary btn--half-width"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(generateQuickPollText());
                    addNotification('Poll command copied to clipboard!', 'success');
                  } catch {
                    addNotification('Failed to copy', 'error');
                  }
                }}
                title="Copy poll command to clipboard"
              >
                COPY
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search Popup */}
      {showSearchPopup && (
        <div className="lab-popup-overlay" {...searchDismiss}>
          <div className="search-popup" onClick={(e) => e.stopPropagation()}>
            <div className="lab-popup-header">
              <span className="lab-popup-title">SEARCH</span>
              <button
                className="btn btn--small btn--danger"
                onClick={() => setShowSearchPopup(false)}
              >
                ✕
              </button>
            </div>
            <div className="search-popup-content">
              <input
                type="text"
                className="input search-input"
                placeholder="Search links and notes..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  performSearch(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setShowSearchPopup(false);
                }}
                autoFocus
              />
              <div className="search-results">
                {searchQuery.trim() === '' ? (
                  <div className="search-placeholder">Type to search across all links and notes</div>
                ) : searchResults.length === 0 ? (
                  <div className="search-no-results">No results found</div>
                ) : (
                  searchResults.map((result, index) => (
                    <div
                      key={`${result.item.id}-${index}`}
                      className="search-result-item"
                      onClick={() => handleSearchResultClick(result)}
                    >
                      <div className="search-result-type">
                        {result.type === 'link' ? '🔗' : '📝'}
                      </div>
                      <div className="search-result-content">
                        <div
                          className="search-result-title search-result-title--clickable"
                          onClick={(e) => handleSearchTitleClick(e, result)}
                          title="Click to copy"
                        >
                          {result.type === 'link'
                            ? ((result.item as Link).customTitle || (result.item as Link).title)
                            : (result.item as Note).title}
                        </div>
                        <div className="search-result-location">
                          {result.dayName} › {result.sectionName}
                        </div>
                        {result.matchField === 'url' && result.type === 'link' && (
                          <div className="search-result-url">{(result.item as Link).url}</div>
                        )}
                        {result.matchField === 'content' && result.type === 'note' && (
                          <div className="search-result-snippet">
                            {(result.item as Note).content.substring(0, 100)}
                            {(result.item as Note).content.length > 100 ? '...' : ''}
                          </div>
                        )}
                      </div>
                      <div className="search-result-actions">
                        {result.type === 'link' && (
                          <button
                            className="search-action-btn"
                            onClick={(e) => handleSearchOpenInChrome(e, (result.item as Link).url)}
                            title="Open in Chrome"
                          >
                            <img src={iconBrowser} alt="Open in Chrome" className="search-action-icon" />
                          </button>
                        )}
                        <button
                          className="search-action-btn"
                          onClick={(e) => handleSearchFocusAndPaste(e, result)}
                          title="Focus window and paste"
                        >
                          <img src={iconSlack} alt="Focus & Paste" className="search-action-icon" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Header;
