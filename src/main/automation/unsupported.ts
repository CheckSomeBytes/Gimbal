import { WindowAutomation } from './types';

// Fallback for platforms without a backend yet. Callers still get the text on
// the clipboard, so the user can paste it by hand.
export const unsupportedAutomation: WindowAutomation = {
  unsupportedReason: () => "Auto-paste isn't available on this platform.",
  listWindows: async () => [],
  focusAndPaste: async () => ({ success: false, error: 'Platform not supported' }),
};
