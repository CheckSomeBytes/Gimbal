import { clipboard } from 'electron';
import { MatchMode, PasteResult, WindowAutomation, WindowInfo } from './types';
import { windowsAutomation } from './windows';
import { unsupportedAutomation } from './unsupported';

export type { MatchMode, PasteResult, WindowInfo } from './types';

function selectBackend(): WindowAutomation {
  switch (process.platform) {
    case 'win32':
      return windowsAutomation;
    default:
      return unsupportedAutomation;
  }
}

const backend = selectBackend();

export function isAutomationSupported(): boolean {
  return backend.isSupported();
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
