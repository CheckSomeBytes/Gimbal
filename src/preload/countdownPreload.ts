import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/types';

// Minimal bridge for the standalone countdown timer window. It only needs to
// report text-size changes back so the main window can persist them to the
// active profile.
contextBridge.exposeInMainWorld('countdownAPI', {
  setTextScale: (scale: number): void => {
    ipcRenderer.send(IPC_CHANNELS.TIMER_SET_TEXT_SCALE, scale);
  },
});
