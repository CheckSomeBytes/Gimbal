import { contextBridge, ipcRenderer } from 'electron';

// Minimal bridge for the standalone countdown timer window. It reports
// text-size changes back so the main window can persist them to the active
// profile, and asks the main process to post the lab progress poll.
//
// The channel names are inlined rather than imported from shared/types: a
// sandboxed preload can only require() Electron built-ins, so any import
// shared with preload.ts gets hoisted by Rollup into a chunk that then fails
// to load at runtime. Keep this file dependency-free.
// Must match IPC_CHANNELS.TIMER_SET_TEXT_SCALE in src/shared/types.ts.
const TIMER_SET_TEXT_SCALE = 'timer:set-text-scale';
// Must match IPC_CHANNELS.TIMER_SEND_LAB_POLL in src/shared/types.ts.
const TIMER_SEND_LAB_POLL = 'timer:send-lab-poll';

contextBridge.exposeInMainWorld('countdownAPI', {
  setTextScale: (scale: number): void => {
    ipcRenderer.send(TIMER_SET_TEXT_SCALE, scale);
  },
  sendLabPoll: (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(TIMER_SEND_LAB_POLL);
  },
});
