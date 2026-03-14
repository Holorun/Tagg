const panelOverlay = document.getElementById('panel-overlay');
aiClose.addEventListener('click', () => toggleAI(false));
panelOverlay.addEventListener('click', () => toggleAI(false));

function toggleAI(force) {
  aiOpen = force !== undefined ? force : !aiOpen;
  aiPanel.classList.toggle('open', aiOpen);
  aiBtn.classList.toggle('active', aiOpen);
  panelOverlay.style.display = aiOpen ? 'block' : 'none';
  if (aiOpen) setTimeout(() => aiInput.focus(), 300);
}
// ============================================================
// TAGG — Renderer (Holorun-style layout)
// ============================================================

const tagg = window.tagg;

if (tagg.platform === 'darwin') document.body.classList.add('mac');

let state = { tabs:[], activeTab:null, splitTab:null, activeUrl:'', canGoBack:false, canGoForward:false };
let settings = {};
let aiOpen = false;
let panelCollapsed = false;

// ---- ELEMENTS ----
const urlInput     = document.getElementById('url-input');
const urlWrap      = document.getElementById('top-url-wrap');
const urlDot       = document.getElementById('url-dot');
const backBtn      = document.getElementById('back-btn');
const fwdBtn       = document.getElementById('fwd-btn');
const reloadBtn    = document.getElementById('reload-btn');
const tabsArea     = document.getElementById('tabs-scroll-area');
const rightPanel   = document.getElementById('right-panel');
const divArrow     = document.getElementById('divider-arrow');
const aiPanel      = document.getElementById('ai-panel');
const aiBtn        = document.getElementById('ai-btn');
const aiClose      = document.getElementById('ai-close');
const aiMessages   = document.getElementById('ai-messages');
const aiInput      = document.getElementById('ai-input');
const aiSend       = document.getElementById('ai-send');
const scrollUp     = document.getElementById('scroll-up');
const scrollDown   = document.getElementById('scroll-down');

// ============================================================
// INIT
// ============================================================
async function init() {
  console.log('[TAGG] Initializing...');
  settings = await tagg.getSettings();
  state    = await tagg.getState();
  console.log('[TAGG] State:', state);
  renderAll();
  tagg.onStateUpdate(s => { state = s; renderAll(); });
}
init();

// ============================================================
// RENDER
// ============================================================
function renderAll() {
  renderTabs();
  renderMainView();
  renderBottomStrip();
  renderUrlBar();
  renderNavBtns();
}

function renderTabs() {
  tabsArea.innerHTML = '';
  (state.tabs || []).forEach(tab => {
    const card = document.createElement('div');
    card.className = 'tab-card' + (tab.id === state.activeTab ? ' active' : '');
    card.dataset.id = tab.id;

    const domain = getDomain(tab.url);
    const favHtml = tab.favicon && !tab.favicon.startsWith('chrome://')
      ? `<img class="tab-fav" src="${esc(tab.favicon)}" onerror="this.style.display='none'" style="display:block" alt="">`
      : '';

    card.innerHTML = `
      <div class="tab-urlbar">
        <div class="tab-dot"></div>
        ${favHtml}
        <div class="tab-url">${esc(domain || 'New Tab')}</div>
        <button class="tab-close-btn" data-id="${tab.id}">✕</button>
      </div>
      <div class="tab-preview"></div>
    `;

    card.addEventListener('click', e => {
      if (e.target.classList.contains('tab-close-btn')) return;
      tagg.switchTab(tab.id);
    });

    card.querySelector('.tab-close-btn').addEventListener('click', e => {
      e.stopPropagation();
      tagg.closeTab(tab.id);
    });

    tabsArea.appendChild(card);
  });

  // Scroll active into view
  const active = tabsArea.querySelector('.tab-card.active');
  if (active) active.scrollIntoView({ block:'nearest', behavior:'smooth' });
}

// Render main view URL and pagination
function renderMainView() {
  const mainUrl = document.getElementById('main-url');
  const mainDot = document.querySelector('.main-dot');
  const dotsContainer = document.getElementById('pagination-dots');
  const placeholder = document.getElementById('browser-placeholder');

  if (mainUrl) {
    mainUrl.textContent = state.activeUrl || 'about:blank';
  }
  if (mainDot) {
    mainDot.classList.toggle('secure', (state.activeUrl || '').startsWith('https://'));
  }

  // Update browser-placeholder with site info
  if (placeholder) {
    const tab = (state.tabs || []).find(t => t.id === state.activeTab);
    if (tab) {
      placeholder.innerHTML = `<div style="font-size:13px;color:#333;">${tab.title || 'No title'}</div><div style="font-size:11px;color:#888;">${tab.url || ''}</div>`;
    } else {
      placeholder.innerHTML = 'web content';
    }
  }

  // Pagination dots
  if (dotsContainer) {
    dotsContainer.innerHTML = '';
    (state.tabs || []).forEach((tab) => {
      const dot = document.createElement('div');
      dot.className = 'page-dot' + (tab.id === state.activeTab ? ' active' : '');
      dot.addEventListener('click', () => tagg.switchTab(tab.id));
      dotsContainer.appendChild(dot);
    });
  }
}

// Render bottom thumbnail strip
function renderBottomStrip() {
  const strip = document.getElementById('strip-tabs');
  if (!strip) return;
  
  strip.innerHTML = '';
  (state.tabs || []).forEach(tab => {
    const card = document.createElement('div');
    card.className = 'strip-card' + (tab.id === state.activeTab ? ' active' : '');
    
    const url = tab.url || '';
    const isHttps = url.startsWith('https://');
    const domain = getDomain(url) || 'New Tab';
    
    card.innerHTML = `
      <div class="strip-urlbar">
        <div class="strip-dot"></div>
        <span class="strip-lock">${isHttps ? '🔒' : ''}</span>
        <div class="strip-url">${esc(domain)}</div>
      </div>
      <div class="strip-preview"></div>
    `;
    
    card.addEventListener('click', () => tagg.switchTab(tab.id));
    strip.appendChild(card);
  });
  
  // Scroll active into view
  const active = strip.querySelector('.strip-card.active');
  if (active) active.scrollIntoView({ inline:'center', behavior:'smooth' });
}

function renderUrlBar() {
  if (document.activeElement !== urlInput) {
    urlInput.value = state.activeUrl || '';
  }
  // Secure indicator
  const isHttps = (state.activeUrl || '').startsWith('https://');
  urlDot.className = 'url-dot' + (isHttps ? ' secure' : '');
  // Loading
  const loading = state.tabs?.find(t => t.id === state.activeTab)?.loading;
  urlWrap.classList.toggle('is-loading', !!loading);
}

function renderNavBtns() {
  backBtn.disabled = !state.canGoBack;
  fwdBtn.disabled  = !state.canGoForward;
}

// ============================================================
// URL BAR
// ============================================================
urlInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { tagg.navigate(urlInput.value); urlInput.blur(); }
  if (e.key === 'Escape') urlInput.blur();
});
urlInput.addEventListener('focus', () => urlInput.select());

// ============================================================
// NAV
// ============================================================
backBtn.addEventListener('click',   () => tagg.goBack());
fwdBtn.addEventListener('click',    () => tagg.goForward());
reloadBtn.addEventListener('click', () => {
  const loading = state.tabs?.find(t => t.id === state.activeTab)?.loading;
  loading ? tagg.stop() : tagg.reload();
});

document.getElementById('home-btn')?.addEventListener('click', () => tagg.navigate('https://www.google.com'));

// New tab
const newTabCard = document.getElementById('new-tab-card');
console.log('[TAGG] new-tab-card element:', newTabCard);
if (newTabCard) {
  newTabCard.addEventListener('click', () => {
    console.log('[TAGG] New tab clicked!');
    tagg.newTab().then(() => console.log('[TAGG] New tab created'));
  });
} else {
  console.error('[TAGG] new-tab-card NOT FOUND!');
}

const sbMax = document.getElementById('sb-max');
if (sbMax) {
  sbMax.addEventListener('click', () => {
    console.log('[TAGG] Sidebar + clicked');
    tagg.newTab();
  });
}

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================
document.addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key === 't') { e.preventDefault(); tagg.newTab(); }
  if (mod && e.key === 'w') { e.preventDefault(); if (state.activeTab) tagg.closeTab(state.activeTab); }
  if (mod && e.key === 'l') { e.preventDefault(); urlInput.focus(); urlInput.select(); }
  if (mod && e.key === 'r') { e.preventDefault(); tagg.reload(); }
  if (e.altKey && e.key === 'ArrowLeft')  tagg.goBack();
  if (e.altKey && e.key === 'ArrowRight') tagg.goForward();
});

// ============================================================
// SIDE ARROWS (Holorun style - switch tabs)
// ============================================================
function switchToTab(direction) {
  const tabs = state.tabs || [];
  if (tabs.length === 0) return;
  const currentIdx = tabs.findIndex(t => t.id === state.activeTab);
  let newIdx = currentIdx + direction;
  if (newIdx < 0) newIdx = tabs.length - 1;
  if (newIdx >= tabs.length) newIdx = 0;
  tagg.switchTab(tabs[newIdx].id);
}

document.getElementById('prev-tab')?.addEventListener('click', () => switchToTab(-1));
document.getElementById('next-tab')?.addEventListener('click', () => switchToTab(1));

// Strip scroll buttons
document.getElementById('strip-prev')?.addEventListener('click', () => {
  document.getElementById('strip-tabs')?.scrollBy({ left: -200, behavior:'smooth' });
});
document.getElementById('strip-next')?.addEventListener('click', () => {
  document.getElementById('strip-tabs')?.scrollBy({ left: 200, behavior:'smooth' });
});

// ============================================================
// PANEL TOGGLE
// ============================================================
function togglePanel() {
  panelCollapsed = !panelCollapsed;
  rightPanel.classList.toggle('collapsed', panelCollapsed);
  divArrow.textContent = panelCollapsed ? '‹' : '›';
  showToast(panelCollapsed ? 'Panel hidden' : 'Panel shown');
}

divArrow.addEventListener('click', togglePanel);
document.getElementById('panel-toggle-btn').addEventListener('click', togglePanel);

// Scroll arrows
scrollUp.addEventListener('click',   () => tabsArea.scrollBy({ top: -150, behavior:'smooth' }));
scrollDown.addEventListener('click', () => tabsArea.scrollBy({ top:  150, behavior:'smooth' }));

// ============================================================
// AI PANEL
// ============================================================
aiBtn.addEventListener('click',   () => toggleAI());
aiClose.addEventListener('click', () => toggleAI(false));

function toggleAI(force) {
  aiOpen = force !== undefined ? force : !aiOpen;
  aiPanel.classList.toggle('open', aiOpen);
  aiBtn.classList.toggle('active', aiOpen);
  if (aiOpen) setTimeout(() => aiInput.focus(), 300);
}

document.querySelectorAll('.ai-chip').forEach(c => {
  c.addEventListener('click', () => { aiInput.value = c.dataset.q; sendAI(); });
});

aiInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAI(); }
});
aiSend.addEventListener('click', sendAI);
aiInput.addEventListener('input', () => {
  aiInput.style.height = 'auto';
  aiInput.style.height = Math.min(aiInput.scrollHeight, 70) + 'px';
});

async function sendAI() {
  const text = aiInput.value.trim();
  if (!text) return;
  aiInput.value = ''; aiInput.style.height = 'auto';
  aiSend.disabled = true;
  appendMsg('user', text);

  const typing = document.createElement('div');
  typing.className = 'typing';
  typing.innerHTML = '<span></span><span></span><span></span>';
  aiMessages.appendChild(typing);
  aiMessages.scrollTop = aiMessages.scrollHeight;

  const s = await tagg.getSettings();
  const res = await tagg.askAI(text, s.apiKey || '', `Page: ${state.activeUrl}`);
  typing.remove(); aiSend.disabled = false;
  appendMsg('ai', res?.ok ? res.reply : `⚠ ${res?.error || 'Add API key in settings.'}`);
}

function appendMsg(role, text) {
  const div = document.createElement('div');
  div.className = `msg msg-${role}`;
  if (role === 'ai') {
    div.innerHTML = `<div class="msg-label">Tagg AI</div><div>${esc(text)}</div>`;
  } else {
    div.textContent = text;
  }
  aiMessages.appendChild(div);
  aiMessages.scrollTop = aiMessages.scrollHeight;
}

// ============================================================
// SCREENSHOT & VISION ANALYSIS
// ============================================================
const screenshotBtn = document.getElementById('screenshot-btn');
screenshotBtn?.addEventListener('click', captureAndAnalyze);

async function captureAndAnalyze() {
  showToast('📷 Capturing page...');
  screenshotBtn.disabled = true;
  
  // Open AI panel to show results
  aiPanel.classList.add('open');
  aiBtn.classList.add('active');
  aiOpen = true;

  const capture = await tagg.captureScreenshot();
  if (!capture.ok) {
    appendMsg('ai', `⚠ Screenshot failed: ${capture.error}`);
    screenshotBtn.disabled = false;
    return;
  }

  appendMsg('user', '📷 Analyze this page screenshot');
  
  const typing = document.createElement('div');
  typing.className = 'typing';
  typing.innerHTML = '<span></span><span></span><span></span>';
  aiMessages.appendChild(typing);
  aiMessages.scrollTop = aiMessages.scrollHeight;

  const s = await tagg.getSettings();
  if (!s.apiKey) {
    typing.remove();
    appendMsg('ai', '⚠ Please add your Claude API key in settings to analyze screenshots.');
    screenshotBtn.disabled = false;
    return;
  }

  const result = await tagg.analyzeScreenshot(capture.base64, s.apiKey, 
    'Analyze this webpage screenshot. Describe what you see: the layout, main content, key elements, buttons, text, images, and any important information visible. Be detailed but concise.');
  
  typing.remove();
  screenshotBtn.disabled = false;
  
  if (result.ok) {
    appendMsg('ai', result.analysis);
  } else {
    appendMsg('ai', `⚠ Analysis failed: ${result.error}`);
  }
}

// ============================================================
// WINDOW CONTROLS
// ============================================================
document.getElementById('win-close').addEventListener('click', () => tagg.close());
document.getElementById('win-min').addEventListener('click',   () => tagg.minimize());
document.getElementById('win-max').addEventListener('click',   () => tagg.maximize());
document.getElementById('sb-close').addEventListener('click',  () => tagg.close());
document.getElementById('sb-min').addEventListener('click',    () => tagg.minimize());
document.getElementById('fs-btn')?.addEventListener('click',   () => tagg.fullscreen());
document.getElementById('devtools-btn')?.addEventListener('click', () => tagg.openDevTools());

// ============================================================
// UTILS
// ============================================================
function getDomain(url) {
  try { return new URL(url).hostname.replace('www.',''); } catch { return url || ''; }
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
