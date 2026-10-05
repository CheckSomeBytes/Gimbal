import { WindowTarget } from '../../shared/types';

export type MatchMode = WindowTarget['matchMode'];

export interface WindowInfo {
  title: string;
  processName: string;
}

export interface PasteResult {
  success: boolean;
  error?: string;
}

// One implementation per OS. The text to paste is already on the clipboard
// when focusAndPaste is called, so a backend only has to find the window,
// bring it to the front and send the paste keystroke.
export interface WindowAutomation {
  // Null when auto-paste works here, otherwise a sentence for the user saying
  // why not and, where possible, how to fix it.
  unsupportedReason(): string | null;
  // For platforms where the user can grant a permission to fix it: asks the
  // OS to prompt for it.
  requestAccess?(): void;
  listWindows(): Promise<WindowInfo[]>;
  focusAndPaste(pattern: string, matchMode: MatchMode, pressEnter: boolean): Promise<PasteResult>;
}
