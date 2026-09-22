import { contextBridge, ipcRenderer } from 'electron';

// Minimal bridge for the standalone countdown timer window. It only needs to
// report text-size changes back so the main window can persist them to the
// active profile.
//
// The channel names are inlined rather than imported from shared/types: a
// sandboxed preload can only require() Electron built-ins, so any import
// shared with preload.ts gets hoisted by Rollup into a chunk that then fails
// to load at runtime. Keep this file dependency-free.
// Must match IPC_CHANNELS.TIMER_SET_TEXT_SCALE in src/shared/types.ts.
const TIMER_SET_TEXT_SCALE = 'timer:set-text-scale';

contextBridge.exposeInMainWorld('countdownAPI', {
  setTextScale: (scale: number): void => {
    ipcRenderer.send(TIMER_SET_TEXT_SCALE, scale);
  },
});
