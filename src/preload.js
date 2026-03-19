// ============================================================
// TAGG — Preload Script
// Exposes a safe, typed API to the renderer (UI)
// via contextBridge. No direct Node.js access in UI.
// ============================================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tagg', {

  // ---- TABS ----
  newTab:      (url)  => ipcRenderer.invoke('new-tab', url),
  closeTab:    (id)   => ipcRenderer.invoke('close-tab', id),
  switchTab:   (id)   => ipcRenderer.invoke('switch-tab', id),

  // ---- NAVIGATION ----
  navigate:    (url)  => ipcRenderer.invoke('navigate', url),
  goBack:      ()     => ipcRenderer.invoke('go-back'),
  goForward:   ()     => ipcRenderer.invoke('go-forward'),
  reload:      ()     => ipcRenderer.invoke('reload'),
  stop:        ()     => ipcRenderer.invoke('stop'),

  // ---- SPLIT VIEW ----
  enableSplit:    (id)  => ipcRenderer.invoke('enable-split', id),
  disableSplit:   ()    => ipcRenderer.invoke('disable-split'),
  splitNavigate:  (url) => ipcRenderer.invoke('split-navigate', url),

  // ---- STATE ----
  getState:    ()     => ipcRenderer.invoke('get-state'),

  // ---- SETTINGS ----
  getSettings: ()     => ipcRenderer.invoke('get-settings'),
  saveSettings:(data) => ipcRenderer.invoke('save-settings', data),

  // ---- AI ----
  askAI: (prompt, apiKey, context) =>
    ipcRenderer.invoke('ask-ai', { prompt, apiKey, context }),

  // ---- SCREENSHOT + VISION ----
  captureScreenshot: () => ipcRenderer.invoke('capture-screenshot'),
  analyzeScreenshot: (base64, apiKey, prompt) =>
    ipcRenderer.invoke('analyze-screenshot', { base64, apiKey, prompt }),

  // ---- HOLOVIEW ----
  captureTabSnap:  (tabId) => ipcRenderer.invoke('capture-tab-snap', tabId),
  captureAllSnaps: ()      => ipcRenderer.invoke('capture-all-snaps'),

  // ---- STATE UPDATES (push from main) ----
  onStateUpdate: (cb) => {
    ipcRenderer.on('state-update', (e, state) => cb(state));
  },

  // ---- WINDOW CONTROLS ----
  minimize: () => ipcRenderer.send('win-minimize'),
  maximize: () => ipcRenderer.send('win-maximize'),
  close:    () => ipcRenderer.send('win-close'),
  fullscreen: () => ipcRenderer.send('win-fullscreen'),
  openDevTools: () => ipcRenderer.send('open-devtools'),

  // ---- PLATFORM ----
  platform: process.platform
});
