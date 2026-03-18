// ============================================================
// TAGG — Renderer
// ============================================================

const tagg = window.tagg;

if (tagg.platform === 'darwin') document.body.classList.add('mac');

let state = { tabs:[], activeTab:null, activeUrl:'', canGoBack:false, canGoForward:false };
let aiOpen = false;

// ---- ELEMENTS ----
const urlInput   = document.getElementById('url-input');
const urlWrap    = document.getElementById('top-url-wrap');
const urlDot     = document.getElementById('url-dot');
const backBtn    = document.getElementById('back-btn');
const fwdBtn     = document.getElementById('fwd-btn');
const reloadBtn  = document.getElementById('reload-btn');
const aiPanel    = document.getElementById('ai-panel');
const aiBtn      = document.getElementById('ai-btn');
const aiClose    = document.getElementById('ai-close');
const aiMessages = document.getElementById('ai-messages');
const aiInput    = document.getElementById('ai-input');
const aiSend     = document.getElementById('ai-send');
const panelOverlay = document.getElementById('panel-overlay');

// ============================================================
// INIT
// ============================================================
async function init() {
  state = await tagg.getState();
  renderAll();
  tagg.onStateUpdate(s => { state = s; renderAll(); });
}
init();

// ============================================================
// RENDER
// ============================================================
function renderAll() {
  renderUrlBar();
  renderNavBtns();
  renderMainUrlBar();
}

function renderMainUrlBar() {
  const mainUrl = document.getElementById('main-url');
  const mainDot = document.querySelector('.main-dot');
  const mainLock = document.querySelector('.main-lock');
  if (mainUrl) mainUrl.textContent = state.activeUrl || 'about:blank';
  if (mainDot) mainDot.classList.toggle('secure', (state.activeUrl || '').startsWith('https://'));
  if (mainLock) mainLock.style.opacity = (state.activeUrl || '').startsWith('https://') ? '1' : '0.3';
}

function renderUrlBar() {
  if (document.activeElement !== urlInput) {
    urlInput.value = state.activeUrl || '';
  }
  const isHttps = (state.activeUrl || '').startsWith('https://');
  urlDot.className = 'url-dot' + (isHttps ? ' secure' : '');
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
// AI PANEL
// ============================================================
aiBtn.addEventListener('click',        () => toggleAI());
aiClose.addEventListener('click',      () => toggleAI(false));
panelOverlay.addEventListener('click', () => toggleAI(false));

function toggleAI(force) {
  aiOpen = force !== undefined ? force : !aiOpen;
  aiPanel.classList.toggle('open', aiOpen);
  aiBtn.classList.toggle('active', aiOpen);
  panelOverlay.style.display = aiOpen ? 'block' : 'none';
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
// SCREENSHOT & VISION
// ============================================================
const screenshotBtn = document.getElementById('screenshot-btn');
screenshotBtn?.addEventListener('click', captureAndAnalyze);

async function captureAndAnalyze() {
  showToast('Capturing page...');
  screenshotBtn.disabled = true;
  toggleAI(true);

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
    'Analyze this webpage screenshot. Describe what you see: the layout, main content, key elements, and any important information visible.');
  typing.remove();
  screenshotBtn.disabled = false;
  appendMsg('ai', result.ok ? result.analysis : `⚠ Analysis failed: ${result.error}`);
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
