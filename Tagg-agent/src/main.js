// ============================================================
// TAGG BROWSER — Main Process (src/main.js)
// Electron entry point. Creates the browser window,
// manages BrowserViews for tabs + split view.
// ============================================================

const { app, BrowserWindow, BrowserView, ipcMain,
        session, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs   = require('fs');

// ---- STORE (simple JSON persistence) ----
// storePath is resolved lazily after app is ready (app.getPath requires app to be ready on Windows)
let storePath = null;

function getStorePath() {
  if (!storePath) storePath = path.join(app.getPath('userData'), 'tagg-store.json');
  return storePath;
}

function readStore() {
  try { return JSON.parse(fs.readFileSync(getStorePath(), 'utf8')); }
  catch { return {}; }
}

function writeStore(data) {
  try { fs.writeFileSync(getStorePath(), JSON.stringify(data, null, 2)); }
  catch {}
}

// ---- STATE ----
let mainWin   = null;
const views   = new Map();   // tabId → BrowserView
let tabs      = [];          // [{ id, url, title, favicon, loading }]
let activeTab = null;        // tabId
let splitTab  = null;        // tabId of right-pane tab (null = no split)
let nextId    = 1;

const TAB_BAR_HEIGHT = 36; // topbar only — no separate address bar in Holorun layout
// store is read lazily inside createWindow after app is ready
let store = {};

// ============================================================
// CREATE MAIN WINDOW
// ============================================================
function createWindow() {
  store = readStore(); // safe to call now — app is ready

  mainWin = new BrowserWindow({
    width:  1280,
    height: 800,
    minWidth:  800,
    minHeight: 500,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    frame: false,
    backgroundColor: '#07091a',
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../assets/icon.png')
  });

  // Load the UI shell
  mainWin.loadFile(path.join(__dirname, 'ui/index.html'));

  // Open DevTools only in dev mode (npm run dev)
  if (process.argv.includes('--dev')) {
    mainWin.webContents.openDevTools({ mode: 'bottom' });
  }

  mainWin.on('resize', layoutViews);
  mainWin.on('closed', () => { mainWin = null; });

  // Open new tab on startup
  mainWin.webContents.once('did-finish-load', () => {
    const startUrl = store.lastUrl || 'https://www.google.com';
    createTab(startUrl);
  });
}

// ============================================================
// TAB MANAGEMENT
// ============================================================
function createTab(url = 'https://www.google.com', background = false) {
  const id  = nextId++;
  const tab = { id, url, title: 'New Tab', favicon: '', loading: true };
  tabs.push(tab);

  const view = new BrowserView({
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  views.set(id, view);
  mainWin.addBrowserView(view);

  // Wire up events
  const wc = view.webContents;

  // Add custom context menu for highlighting
  wc.on('context-menu', (event, params) => {
    if (params.selectionText && params.selectionText.trim()) {
      const menu = Menu.buildFromTemplate([
        {
          label: 'Highlight with Tagg',
          click: () => {
            wc.executeJavaScript(`
              (function() {
                const sel = window.getSelection();
                if (sel && sel.rangeCount > 0) {
                  const range = sel.getRangeAt(0);
                  const span = document.createElement('span');
                  span.style.background = '#ffe066';
                  span.style.color = '#222';
                  span.style.borderRadius = '3px';
                  span.style.padding = '0 2px';
                  range.surroundContents(span);
                }
              })();
            `);
          }
        }
      ]);
      menu.popup();
    }
  });

  wc.on('did-start-loading', () => {
    updateTab(id, { loading: true });
  });

  wc.on('did-stop-loading', () => {
    updateTab(id, { loading: false, url: wc.getURL(), title: wc.getTitle() });
    store.lastUrl = wc.getURL();
    writeStore(store);
  });

  wc.on('did-finish-load', () => {
    updateTab(id, { url: wc.getURL(), title: wc.getTitle() });
  });

  wc.on('page-title-updated', (e, title) => {
    updateTab(id, { title });
  });

  wc.on('page-favicon-updated', (e, favicons) => {
    if (favicons[0]) updateTab(id, { favicon: favicons[0] });
  });

  wc.on('did-navigate', (e, url) => {
    updateTab(id, { url, loading: false });
    broadcastUI();
  });

  wc.on('did-navigate-in-page', (e, url) => {
    updateTab(id, { url });
    broadcastUI();
  });

  // New window → open as new tab
  wc.setWindowOpenHandler(({ url }) => {
    createTab(url);
    return { action: 'deny' };
  });

  // Load URL
  wc.loadURL(normalizeUrl(url)).catch(() => {
    wc.loadURL('data:text/html,<h1>Could not load page</h1>');
  });

  if (!background) {
    setActiveTab(id);
  } else {
    broadcastUI();
    layoutViews();
  }

  return id;
}

function closeTab(id) {
  const view = views.get(id);
  if (!view) return;

  // If this is the split tab, close split
  if (splitTab === id) {
    splitTab = null;
    broadcastUI();
  }

  mainWin.removeBrowserView(view);
  view.webContents.destroy();
  views.delete(id);
  tabs = tabs.filter(t => t.id !== id);

  // Switch to another tab
  if (activeTab === id) {
    const remaining = tabs;
    if (remaining.length > 0) {
      setActiveTab(remaining[remaining.length - 1].id);
    } else {
      activeTab = null;
      createTab();
    }
  } else {
    broadcastUI();
    layoutViews();
  }
}

function setActiveTab(id) {
  activeTab = id;
  layoutViews();
  broadcastUI();
}

function updateTab(id, data) {
  const tab = tabs.find(t => t.id === id);
  if (tab) Object.assign(tab, data);
  broadcastUI();
}

// ============================================================
// SPLIT VIEW
// ============================================================
function enableSplit(rightTabId) {
  splitTab = rightTabId;
  layoutViews();
  broadcastUI();
}

function disableSplit() {
  splitTab = null;
  layoutViews();
  broadcastUI();
}

// ============================================================
// LAYOUT — position BrowserViews (Holorun style)
// ============================================================
const SIDEBAR_W    = 48; // Left sidebar width
const MAIN_URL_H   = 36; // #main-urlbar height inside main-view
const PADDING      = 8;  // #center-area padding

function layoutViews() {
  if (!mainWin) return;
  const [winW, winH] = mainWin.getContentSize();
  const mainViewX = SIDEBAR_W + PADDING;
  const mainViewY = TAB_BAR_HEIGHT + PADDING + MAIN_URL_H;
  const mainViewW = winW - SIDEBAR_W - PADDING * 2;
  const mainViewH = winH - TAB_BAR_HEIGHT - PADDING * 2 - MAIN_URL_H;
  const mainUrlBarH = 0; // already accounted for in mainViewY

  // Hide all views first
  for (const [id, view] of views) {
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }

  if (!activeTab) return;
  const activeView = views.get(activeTab);
  if (!activeView) return;

  if (splitTab && splitTab !== activeTab) {
    // Split view logic unchanged
    const half = Math.floor(mainViewW / 2);
    const divider = 2;
    activeView.setBounds({
      x: mainViewX,
      y: mainViewY + mainUrlBarH,
      width: half - divider,
      height: mainViewH - mainUrlBarH
    });
    const splitView = views.get(splitTab);
    if (splitView) {
      splitView.setBounds({
        x: mainViewX + half + divider,
        y: mainViewY + mainUrlBarH,
        width: mainViewW - half - divider,
        height: mainViewH - mainUrlBarH
      });
    }
  } else {
    activeView.setBounds({
      x: mainViewX,
      y: mainViewY,
      width:  Math.max(mainViewW, 200),
      height: Math.max(mainViewH, 100)
    });
  }
  // Bring active views to front
  mainWin.setTopBrowserView(activeView);
  if (splitTab) {
    const sv = views.get(splitTab);
    if (sv) mainWin.setTopBrowserView(sv);
  }
}

// ============================================================
// BROADCAST STATE TO UI
// ============================================================
function broadcastUI() {
  if (!mainWin?.webContents) return;
  mainWin.webContents.send('state-update', {
    tabs,
    activeTab,
    splitTab,
    activeUrl:   views.get(activeTab)?.webContents?.getURL()  || '',
    activeTitle: views.get(activeTab)?.webContents?.getTitle() || '',
    canGoBack:    views.get(activeTab)?.webContents?.canGoBack()    || false,
    canGoForward: views.get(activeTab)?.webContents?.canGoForward() || false,
    splitUrl:     splitTab ? (views.get(splitTab)?.webContents?.getURL() || '') : ''
  });
}

// ============================================================
// IPC — UI → Main process
// ============================================================
ipcMain.handle('new-tab',      (e, url)     => createTab(url));
ipcMain.handle('close-tab',    (e, id)      => closeTab(id));
ipcMain.handle('switch-tab',   (e, id)      => setActiveTab(id));
ipcMain.handle('navigate',     (e, url)     => {
  const v = views.get(activeTab);
  if (v) v.webContents.loadURL(normalizeUrl(url));
});
ipcMain.handle('go-back',      ()           => views.get(activeTab)?.webContents?.goBack());
ipcMain.handle('go-forward',   ()           => views.get(activeTab)?.webContents?.goForward());
ipcMain.handle('reload',       ()           => views.get(activeTab)?.webContents?.reload());
ipcMain.handle('stop',         ()           => views.get(activeTab)?.webContents?.stop());

ipcMain.handle('enable-split',  (e, id)     => enableSplit(id));
ipcMain.handle('disable-split', ()          => disableSplit());
ipcMain.handle('split-navigate',(e, url)    => {
  const v = views.get(splitTab);
  if (v) v.webContents.loadURL(normalizeUrl(url));
});

ipcMain.handle('get-state',    ()           => ({
  tabs, activeTab, splitTab,
  activeUrl:    views.get(activeTab)?.webContents?.getURL()      || '',
  canGoBack:    views.get(activeTab)?.webContents?.canGoBack()    || false,
  canGoForward: views.get(activeTab)?.webContents?.canGoForward() || false,
  splitUrl:     splitTab ? (views.get(splitTab)?.webContents?.getURL() || '') : ''
}));

ipcMain.handle('get-settings', ()           => readStore());
ipcMain.handle('save-settings',(e, data)    => { writeStore({ ...readStore(), ...data }); });

ipcMain.handle('ask-ai', async (e, { prompt, apiKey, context }) => {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: `You are Tagg AI, a smart browser assistant. Be concise. Current context: ${context}`,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `API error ${res.status}`);
    return { ok: true, reply: data.content?.[0]?.text || '' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ============================================================
// SCREENSHOT + VISION ANALYSIS
// ============================================================
ipcMain.handle('capture-screenshot', async () => {
  try {
    const view = views.get(activeTab);
    if (!view) return { ok: false, error: 'No active tab' };
    
    const image = await view.webContents.capturePage();
    const base64 = image.toDataURL().replace(/^data:image\/png;base64,/, '');
    const url = view.webContents.getURL();
    const title = view.webContents.getTitle();
    
    return { ok: true, base64, url, title };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('analyze-screenshot', async (e, { base64, apiKey, prompt }) => {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: base64
              }
            },
            {
              type: 'text',
              text: prompt || 'Analyze this webpage screenshot. Describe what you see: the layout, main content, key elements, and any important information visible.'
            }
          ]
        }]
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `API error ${res.status}`);
    return { ok: true, analysis: data.content?.[0]?.text || '' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Window controls (for frameless window)
ipcMain.on('win-minimize', () => mainWin?.minimize());
ipcMain.on('win-maximize', () => {
  if (mainWin?.isMaximized()) mainWin.unmaximize();
  else mainWin?.maximize();
});
ipcMain.on('win-close',    () => mainWin?.close());
ipcMain.on('win-fullscreen', () => {
  mainWin?.setFullScreen(!mainWin?.isFullScreen());
});
ipcMain.on('open-devtools', () => {
  mainWin?.webContents?.openDevTools({ mode: 'detach' });
});

// ============================================================
// UTILS
// ============================================================
function normalizeUrl(input) {
  if (!input) return 'https://www.google.com';
  input = input.trim();
  if (/^https?:\/\//i.test(input)) return input;
  if (/^[\w-]+:\/\//i.test(input)) return input;
  // Looks like a domain
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(input)) return 'https://' + input;
  // Search
  return 'https://www.google.com/search?q=' + encodeURIComponent(input);
}

// ============================================================
// APP LIFECYCLE
// ============================================================
app.whenReady().then(() => {
  // Remove default menu
  Menu.setApplicationMenu(null);
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
