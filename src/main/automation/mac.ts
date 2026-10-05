import { execFile } from 'child_process';
import { systemPreferences } from 'electron';
import { createWindowTitleMatcher } from '../../shared/windowMatch';
import { MatchMode, PasteResult, WindowAutomation, WindowInfo } from './types';

// macOS backend. Talks to "System Events" through osascript, so no native
// bindings are needed. Two permissions are involved:
// - Accessibility, to read other apps' windows and send keystrokes. Checked
//   up front, and can be granted while Gimbal is running.
// - Automation (Apple Events) for System Events. macOS asks the first time
//   osascript runs; if the user says no, scripts fail with error -1743.

const COMMAND_TIMEOUT_MS = 10000;

const ACCESSIBILITY_REASON =
  'Auto-paste needs Accessibility permission. Turn on Gimbal in System Settings > ' +
  'Privacy & Security > Accessibility.';

const AUTOMATION_DENIED_ERROR =
  "Gimbal isn't allowed to control System Events. Turn it on in System Settings > " +
  'Privacy & Security > Automation, under Gimbal.';

interface MacWindow extends WindowInfo {
  pid: number;
}

// One line per window: <pid> TAB <process name> TAB <window title>.
// Tabs and line breaks in titles are replaced so they can't break the format.
const LIST_WINDOWS_SCRIPT = `
on clean(t)
  set AppleScript's text item delimiters to {tab, return, linefeed}
  set parts to text items of t
  set AppleScript's text item delimiters to " "
  set t to parts as text
  set AppleScript's text item delimiters to ""
  return t
end clean

set output to ""
tell application "System Events"
  repeat with p in (every process whose background only is false)
    try
      set pid to unix id of p
      set pname to my clean(name of p)
      repeat with w in (every window of p)
        set wname to name of w
        if wname is not missing value and wname is not "" then
          set output to output & pid & tab & pname & tab & my clean(wname) & linefeed
        end if
      end repeat
    end try
  end repeat
end tell
return output
`;

// argv: pid, exact window title, "true" to press Return after pasting.
// The values arrive as arguments, never spliced into the script source.
const FOCUS_AND_PASTE_SCRIPT = `
on run argv
  set targetPid to (item 1 of argv) as integer
  set targetTitle to item 2 of argv
  set pressEnter to item 3 of argv
  tell application "System Events"
    set targetProc to first process whose unix id is targetPid
    tell targetProc
      try
        perform action "AXRaise" of (first window whose name is targetTitle)
      end try
      set frontmost to true
    end tell
    delay 0.3
    keystroke "v" using command down
    if pressEnter is "true" then
      delay 0.1
      key code 36
    end if
  end tell
  return "SUCCESS"
end run
`;

function unsupportedReason(): string | null {
  // Not cached: the user can grant access while Gimbal is running.
  return systemPreferences.isTrustedAccessibilityClient(false) ? null : ACCESSIBILITY_REASON;
}

// Shows the system prompt that offers to open the Accessibility settings.
function requestAccess(): void {
  systemPreferences.isTrustedAccessibilityClient(true);
}

function runAppleScript(script: string, args: string[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script, ...args], { timeout: COMMAND_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

// Turns osascript's error text into something the user can act on.
function describeError(error: unknown): string {
  const message = (error as Error).message || 'Unknown error';
  if (message.includes('-1743')) {
    return AUTOMATION_DENIED_ERROR;
  }
  if (message.includes('-1719') || message.includes('-25211') || message.includes('assistive access')) {
    return ACCESSIBILITY_REASON;
  }
  return 'Failed to execute: ' + message;
}

export function parseWindowList(output: string): MacWindow[] {
  const windows: MacWindow[] = [];
  for (const line of output.split(/\r?\n/)) {
    const [pid, processName, ...titleParts] = line.split('\t');
    const title = titleParts.join(' ').trim();
    if (!title || !/^\d+$/.test(pid)) continue;
    windows.push({ pid: Number(pid), processName, title });
  }
  return windows;
}

async function listMacWindows(): Promise<MacWindow[]> {
  return parseWindowList(await runAppleScript(LIST_WINDOWS_SCRIPT));
}

async function listWindows(): Promise<WindowInfo[]> {
  if (unsupportedReason() !== null) return [];
  try {
    const windows = await listMacWindows();
    return windows.map(({ title, processName }) => ({ title, processName }));
  } catch (error) {
    console.error('osascript error:', error);
    return [];
  }
}

async function focusAndPaste(pattern: string, matchMode: MatchMode, pressEnter: boolean): Promise<PasteResult> {
  const reason = unsupportedReason();
  if (reason !== null) {
    return { success: false, error: reason };
  }

  let matchesTitle: (title: string) => boolean;
  try {
    matchesTitle = createWindowTitleMatcher(pattern, matchMode);
  } catch {
    return { success: false, error: `"${pattern}" is not a valid regular expression.` };
  }

  try {
    const target = (await listMacWindows()).find((w) => matchesTitle(w.title));
    if (!target) {
      return { success: false, error: 'Window not found matching pattern: ' + pattern };
    }

    const result = await runAppleScript(FOCUS_AND_PASTE_SCRIPT, [
      String(target.pid),
      target.title,
      String(pressEnter),
    ]);
    if (!result.includes('SUCCESS')) {
      return { success: false, error: 'Failed to paste into ' + target.title };
    }
    return { success: true };
  } catch (error) {
    console.error('macOS automation error:', error);
    return { success: false, error: describeError(error) };
  }
}

export const macAutomation: WindowAutomation = {
  unsupportedReason,
  requestAccess,
  listWindows,
  focusAndPaste,
};
