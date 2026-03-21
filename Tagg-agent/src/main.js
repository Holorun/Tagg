// ============================================================
// TAGG BROWSER — Main Process (src/main.js)
// Electron entry point. Creates the browser window,
// manages BrowserViews for tabs + split view.
// ============================================================

const { app, BrowserWindow, BrowserView, ipcMain, Menu } = require('electron');
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

// store is read lazily inside createWindow after app is ready
let store = {};
let cachedRect = null; // last measured content area — updated on resize & initial load

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

  mainWin.on('resize', queryAndLayout);
  mainWin.on('closed', () => { mainWin = null; });

  // Open new tab on startup — query DOM rect first so layoutViews has it
  mainWin.webContents.once('did-finish-load', async () => {
    cachedRect = await queryRect();
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
  wc.on('context-menu', (_event, params) => {
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

  wc.on('page-title-updated', (_e, title) => {
    updateTab(id, { title });
  });

  wc.on('page-favicon-updated', (_e, favicons) => {
    if (favicons[0]) updateTab(id, { favicon: favicons[0] });
  });

  wc.on('did-navigate', (_e, url) => {
    updateTab(id, { url, loading: false });
    broadcastUI();
  });

  wc.on('did-navigate-in-page', (_e, url) => {
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
// LAYOUT — position BrowserViews to match actual DOM layout
// ============================================================

// Query the exact rendered content area from the shell DOM.
// Returns null if the query fails (e.g. renderer not ready).
async function queryRect() {
  if (!mainWin?.webContents) return null;
  try {
    return await mainWin.webContents.executeJavaScript(`
      (() => {
        const urlbar   = document.getElementById('main-urlbar');
        const mainView = document.getElementById('main-view');
        if (!mainView || !urlbar) return null;
        const mv = mainView.getBoundingClientRect();
        const ub = urlbar.getBoundingClientRect();
        return {
          x: Math.round(mv.left),
          y: Math.round(ub.bottom),
          w: Math.round(mv.width),
          h: Math.round(mv.bottom - ub.bottom)
        };
      })()
    `);
  } catch { return null; }
}

// Re-query the DOM rect then immediately re-layout.
// Called on resize so the cache stays in sync with window size.
async function queryAndLayout() {
  cachedRect = await queryRect();
  layoutViews();
}

// Synchronous layout — uses cachedRect so it never causes jank.
// cachedRect is populated on initial load and on every resize.
function layoutViews() {
  if (!mainWin) return;

  // Hide all inactive views
  for (const [id, view] of views) {
    if (id !== activeTab && id !== splitTab) {
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
  }

  if (!activeTab) return;
  const activeView = views.get(activeTab);
  if (!activeView || !cachedRect || cachedRect.w < 10 || cachedRect.h < 10) return;

  const { x, y, w, h } = cachedRect;

  if (splitTab && splitTab !== activeTab) {
    const half    = Math.floor(w / 2);
    const divider = 2;
    activeView.setBounds({
      x,
      y,
      width:  Math.max(half - divider, 100),
      height: Math.max(h, 100)
    });
    const splitView = views.get(splitTab);
    if (splitView) {
      splitView.setBounds({
        x: x + half + divider,
        y,
        width:  Math.max(w - half - divider, 100),
        height: Math.max(h, 100)
      });
    }
  } else {
    activeView.setBounds({
      x,
      y,
      width:  Math.max(w, 200),
      height: Math.max(h, 100)
    });
  }

  // Active tab always on top (both panes visible side-by-side in split mode)
  mainWin.setTopBrowserView(activeView);
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
ipcMain.handle('new-tab',      (_e, url)    => createTab(url));
ipcMain.handle('close-tab',    (_e, id)     => closeTab(id));
ipcMain.handle('switch-tab',   (_e, id)     => setActiveTab(id));
ipcMain.handle('navigate',     (_e, url)    => {
  const v = views.get(activeTab);
  if (v) v.webContents.loadURL(normalizeUrl(url));
});
ipcMain.handle('go-back',      ()           => views.get(activeTab)?.webContents?.goBack());
ipcMain.handle('go-forward',   ()           => views.get(activeTab)?.webContents?.goForward());
ipcMain.handle('reload',       ()           => views.get(activeTab)?.webContents?.reload());
ipcMain.handle('stop',         ()           => views.get(activeTab)?.webContents?.stop());

ipcMain.handle('enable-split',  (_e, id)    => enableSplit(id));
ipcMain.handle('disable-split', ()          => disableSplit());
ipcMain.handle('split-navigate',(_e, url)   => {
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

ipcMain.handle('get-settings',    ()        => readStore());
ipcMain.handle('save-settings',   (_e, data) => { writeStore({ ...readStore(), ...data }); });
ipcMain.handle('query-and-layout', ()       => queryAndLayout());

ipcMain.handle('ask-ai', async (_e, { prompt, apiKey, context }) => {
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

ipcMain.handle('analyze-screenshot', async (_e, { base64, apiKey, prompt }) => {
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

// ============================================================
// ELEMENT CAPTURE — inject selector into BrowserView, screenshot result
// ============================================================
ipcMain.handle('capture-element', async () => {
  const view = views.get(activeTab);
  if (!view) return { ok: false, error: 'No active tab' };

  // Inject hover/click selector. executeJavaScript waits for the returned Promise.
  let elementData;
  try {
    elementData = await view.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        // Remove any existing capture overlay
        document.getElementById('__tagg_hl__')?.remove();
        document.getElementById('__tagg_tip__')?.remove();

        const hl = document.createElement('div');
        hl.id = '__tagg_hl__';
        hl.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;outline:2px solid #7c5cff;background:rgba(124,92,255,0.10);box-sizing:border-box;border-radius:2px;transition:all 0.05s ease';
        document.body.appendChild(hl);

        const tip = document.createElement('div');
        tip.id = '__tagg_tip__';
        tip.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);background:#7c5cff;color:#fff;font:600 12px system-ui,sans-serif;padding:5px 14px;border-radius:20px;z-index:2147483647;pointer-events:none;box-shadow:0 2px 14px rgba(0,0,0,0.35);letter-spacing:0.02em';
        tip.textContent = 'Click element to capture  ·  Esc to cancel';
        document.body.appendChild(tip);

        function onMove(e) {
          const el = e.target;
          if (el === hl || el === tip) return;
          const r = el.getBoundingClientRect();
          hl.style.left = r.left + 'px';
          hl.style.top  = r.top  + 'px';
          hl.style.width  = r.width  + 'px';
          hl.style.height = r.height + 'px';
        }
        function onClick(e) {
          if (e.target === hl || e.target === tip) return;
          e.preventDefault(); e.stopImmediatePropagation();
          const el = e.target;
          const r  = el.getBoundingClientRect();
          cleanup();
          resolve({
            rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
            text: (el.innerText || '').slice(0, 400),
            tag:  el.tagName
          });
        }
        function onKey(e) {
          if (e.key === 'Escape') { cleanup(); reject(new Error('cancelled')); }
        }
        function cleanup() {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('click',     onClick, true);
          document.removeEventListener('keydown',   onKey);
          hl.remove(); tip.remove();
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('click',     onClick, true);
        document.addEventListener('keydown',   onKey);
      })
    `);
  } catch (err) {
    if (err.message === 'cancelled') return { ok: false, cancelled: true };
    return { ok: false, error: err.message };
  }

  // Screenshot just the captured element's rect
  const { rect } = elementData;
  try {
    const img = await view.webContents.capturePage({
      x: Math.max(rect.x, 0), y: Math.max(rect.y, 0),
      width: Math.max(rect.w, 1), height: Math.max(rect.h, 1)
    });
    return {
      ok:       true,
      base64:   img.toDataURL(),
      rect,
      viewRect: cachedRect,
      text:     elementData.text,
      tag:      elementData.tag,
      url:      view.webContents.getURL()
    };
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
