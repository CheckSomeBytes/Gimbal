import { execFile } from 'child_process';
import { accessSync, constants, readFileSync } from 'fs';
import { delimiter, join } from 'path';
import { createWindowTitleMatcher } from '../../shared/windowMatch';
import { MatchMode, PasteResult, WindowAutomation, WindowInfo } from './types';

// Linux backend for X11 sessions. Uses two common command-line tools rather
// than native bindings: wmctrl to list and activate windows, xdotool to send
// the paste keystroke. Wayland doesn't let one app list, focus or type into
// another app's windows, so there it reports itself as unsupported.

const REQUIRED_TOOLS = ['wmctrl', 'xdotool'];
const COMMAND_TIMEOUT_MS = 5000;

interface X11Window extends WindowInfo {
  id: string;
}

function isOnPath(command: string): boolean {
  return (process.env.PATH || '').split(delimiter).some((dir) => {
    if (!dir) return false;
    try {
      accessSync(join(dir, command), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function detectUnsupportedReason(): string | null {
  const sessionType = (process.env.XDG_SESSION_TYPE || '').toLowerCase();
  // XWayland sets DISPLAY under Wayland too, so check the session type first.
  if (sessionType === 'wayland' || (process.env.WAYLAND_DISPLAY && sessionType !== 'x11')) {
    return (
      "Auto-paste isn't available under Wayland, which doesn't let apps control other " +
      'windows. Log in with an X11 session (often called "Xorg") to use it.'
    );
  }
  if (!process.env.DISPLAY) {
    return 'Auto-paste needs an X11 display, and none was found.';
  }
  const missing = REQUIRED_TOOLS.filter((tool) => !isOnPath(tool));
  if (missing.length > 0) {
    return (
      `Auto-paste needs ${missing.join(' and ')}. Install ${missing.length > 1 ? 'them' : 'it'} ` +
      `with your package manager (for example: sudo apt install ${missing.join(' ')}), ` +
      'then restart Gimbal.'
    );
  }
  return null;
}

// The session and installed tools don't change while the app runs.
let cachedReason: string | null | undefined;
function unsupportedReason(): string | null {
  if (cachedReason === undefined) {
    cachedReason = detectUnsupportedReason();
  }
  return cachedReason;
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: COMMAND_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

function processName(pid: number): string {
  if (pid <= 0) return '';
  try {
    return readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
  } catch {
    return '';
  }
}

// Parses `wmctrl -lp` output. Each line is:
//   <window id> <desktop> <pid> <client machine> <title...>
// The title can contain spaces and may be missing entirely.
export function parseWmctrlList(output: string): X11Window[] {
  const windows: X11Window[] = [];
  for (const line of output.split('\n')) {
    const match = /^(0x[0-9a-fA-F]+)\s+-?\d+\s+(\d+)\s+\S+(?:\s(.*))?$/.exec(line);
    if (!match) continue;
    const title = (match[3] || '').trim();
    if (!title) continue;
    windows.push({ id: match[1], title, processName: processName(Number(match[2])) });
  }
  return windows;
}

async function listX11Windows(): Promise<X11Window[]> {
  return parseWmctrlList(await run('wmctrl', ['-lp']));
}

async function listWindows(): Promise<WindowInfo[]> {
  if (unsupportedReason() !== null) return [];
  try {
    const windows = await listX11Windows();
    return windows.map(({ title, processName }) => ({ title, processName }));
  } catch (error) {
    console.error('wmctrl error:', error);
    return [];
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    const target = (await listX11Windows()).find((w) => matchesTitle(w.title));
    if (!target) {
      return { success: false, error: 'Window not found matching pattern: ' + pattern };
    }

    // wmctrl -a switches desktop if needed, raises and focuses the window.
    await run('wmctrl', ['-i', '-a', target.id]);
    await sleep(300);
    // --clearmodifiers stops a still-held key (e.g. from a shortcut) from
    // turning Ctrl+V into something else.
    await run('xdotool', ['key', '--clearmodifiers', 'ctrl+v']);
    if (pressEnter) {
      await sleep(100);
      await run('xdotool', ['key', '--clearmodifiers', 'Return']);
    }
    return { success: true };
  } catch (error) {
    console.error('Linux automation error:', error);
    return {
      success: false,
      error: 'Failed to execute: ' + ((error as Error).message || 'Unknown error'),
    };
  }
}

export const linuxAutomation: WindowAutomation = {
  unsupportedReason,
  listWindows,
  focusAndPaste,
};
