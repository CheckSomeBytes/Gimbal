import { clipboard } from 'electron';
import { AutomationSupport } from '../../shared/types';
import { MatchMode, PasteResult, WindowAutomation, WindowInfo } from './types';
import { windowsAutomation } from './windows';
import { linuxAutomation } from './linux';
import { unsupportedAutomation } from './unsupported';

export type { MatchMode, PasteResult, WindowInfo } from './types';

function selectBackend(): WindowAutomation {
  switch (process.platform) {
    case 'win32':
      return windowsAutomation;
    case 'linux':
      return linuxAutomation;
    default:
      return unsupportedAutomation;
  }
}

const backend = selectBackend();

export function getAutomationSupport(): AutomationSupport {
  const reason = backend.unsupportedReason();
  return reason === null ? { supported: true } : { supported: false, reason };
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
