import { clipboard } from 'electron';
import { AutomationSupport } from '../../shared/types';
import { MatchMode, PasteResult, WindowAutomation, WindowInfo } from './types';
import { windowsAutomation } from './windows';
import { linuxAutomation } from './linux';
import { macAutomation } from './mac';
import { unsupportedAutomation } from './unsupported';

export type { MatchMode, PasteResult, WindowInfo } from './types';

function selectBackend(): WindowAutomation {
  switch (process.platform) {
    case 'win32':
      return windowsAutomation;
    case 'linux':
      return linuxAutomation;
    case 'darwin':
      return macAutomation;
    default:
      return unsupportedAutomation;
  }
}

const backend = selectBackend();

export function getAutomationSupport(): AutomationSupport {
  const reason = backend.unsupportedReason();
  if (reason === null) return { supported: true };
  return { supported: false, reason, canRequestAccess: backend.requestAccess !== undefined };
}

export function requestAutomationAccess(): void {
  backend.requestAccess?.();
}

export function getWindowList(): Promise<WindowInfo[]> {
  return backend.listWindows();
}

export async function focusAndPaste(
  pattern: string,
  matchMode: MatchMode,
  textToPaste: string,
  pressEnter: boolean = false
): Promise<PasteResult> {
  // Copy to clipboard first, on every platform, so manual paste always works
  // even when the backend can't reach the target window.
  clipboard.writeText(textToPaste);
  return backend.focusAndPaste(pattern, matchMode, pressEnter);
}
