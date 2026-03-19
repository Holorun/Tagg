// ============================================================
// TAGG — Holoview 3D
// CSS preserve-3d carousel of tab screenshots
// ============================================================

const HoloView = (() => {
  const CARD_W = 280, CARD_H = 200;
  let snaps = [], rotY = 0, zoom = 1;
  let dragX = null, dragRot = null;
  let isOpen = false;

  // ---- Build overlay DOM (once) ----
  function build() {
    if (document.getElementById('holo3d')) return;

    const el = document.createElement('div');
    el.id = 'holo3d';
    el.innerHTML = `
      <div id="holo3d-header">
        <div id="holo3d-logo">◈</div>
        <span id="holo3d-title">Holoview</span>
        <span id="holo3d-hint">drag to rotate &nbsp;·&nbsp; scroll to zoom &nbsp;·&nbsp; click card to open tab</span>
        <button id="holo3d-refresh" title="Re-snap all tabs">↺</button>
        <button id="holo3d-close">✕</button>
      </div>
      <div id="holo3d-loader">
        <div class="holo-spin"></div>
        <span>Capturing tabs…</span>
      </div>
      <div id="holo3d-scene">
        <div id="holo3d-stage"></div>
      </div>
    `;
    document.body.appendChild(el);

    document.getElementById('holo3d-close').addEventListener('click', () => HoloView.close());
    document.getElementById('holo3d-refresh').addEventListener('click', () => HoloView.refresh());

    const scene = document.getElementById('holo3d-scene');

    // Mouse drag to rotate
    scene.addEventListener('mousedown', e => {
      if (e.target.closest('.holo-card')) return;
      dragX = e.clientX;
      dragRot = rotY;
      document.getElementById('holo3d-stage').style.transition = 'none';
    });
    window.addEventListener('mousemove', e => {
      if (dragX === null) return;
      rotY = dragRot + (e.clientX - dragX) * 0.4;
      applyTransform();
    });
    window.addEventListener('mouseup', () => {
      if (dragX === null) return;
      dragX = null;
      const stage = document.getElementById('holo3d-stage');
      if (stage) stage.style.transition = 'transform 0.25s ease-out';
    });

    // Scroll to zoom
    scene.addEventListener('wheel', e => {
      e.preventDefault();
      zoom = Math.max(0.25, Math.min(2.5, zoom - e.deltaY * 0.001));
      applyTransform();
    }, { passive: false });

    // ESC closes
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && isOpen) HoloView.close();
    });
  }

  function applyTransform() {
    const stage = document.getElementById('holo3d-stage');
    if (stage) stage.style.transform = `rotateY(${rotY}deg) scale(${zoom})`;
  }

  function htmlEsc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function getDomain(url) {
    try { return new URL(url).hostname.replace('www.', ''); } catch { return 'New Tab'; }
  }

  function renderCards() {
    const stage = document.getElementById('holo3d-stage');
    if (!stage) return;
    stage.innerHTML = '';

    if (!snaps.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:rgba(160,200,190,0.35);font-size:12px;position:absolute;transform:translate(-50%,-50%);top:50%;left:50%;font-family:"Space Mono",monospace;white-space:nowrap;';
      empty.textContent = 'No tabs captured';
      stage.appendChild(empty);
      return;
    }

    const n = snaps.length;
    // Spread cards evenly around a circle; radius grows with tab count
    const radius = Math.max(360, n * 95);
    const angleStep = 360 / n;

    snaps.forEach((snap, i) => {
      const angle = angleStep * i;
      const card = document.createElement('div');
      card.className = 'holo-card' + (snap.isActive ? ' active' : '') + (snap.source === 'chrome' ? ' chrome' : '');
      // Place card at its angle around the Y axis, offset so it's centered on the origin
      card.style.transform =
        `rotateY(${angle}deg) translateZ(${radius}px) translateX(-${CARD_W / 2}px) translateY(-${CARD_H / 2}px)`;

      const domain = getDomain(snap.url);
      const isHttps = (snap.url || '').startsWith('https://');

      card.innerHTML = `
        <div class="holo-card-bar">
          <div class="holo-card-dot${isHttps ? ' secure' : ''}"></div>
          <span class="holo-card-domain">${htmlEsc(domain)}</span>
          <span class="holo-card-badge">${snap.source === 'chrome' ? '⬡ Chrome' : `${i + 1}/${n}`}</span>
        </div>
        <div class="holo-card-img">
          ${snap.base64
            ? `<img src="${snap.base64}" alt="${htmlEsc(domain)}" draggable="false">`
            : '<div class="holo-card-empty">No preview</div>'}
        </div>
        <div class="holo-card-footer">${htmlEsc((snap.title || domain).substring(0, 42))}</div>
      `;

      card.addEventListener('click', () => {
        if (snap.source === 'chrome') {
          // Open the URL in a new Tagg tab
          window.tagg.newTab(snap.url);
          HoloView.close();
        } else {
          window.tagg.switchTab(snap.tabId);
          HoloView.close();
        }
      });

      stage.appendChild(card);
    });
  }

  async function loadSnaps() {
    const loader = document.getElementById('holo3d-loader');
    const scene  = document.getElementById('holo3d-scene');
    loader.style.display = 'flex';
    scene.style.opacity  = '0';

    const [results, currentState] = await Promise.all([
      window.tagg.captureAllSnaps(),
      window.tagg.getState()
    ]);

    const taggSnaps = results
      .filter(r => r.ok)
      .map(r => ({ ...r, source: 'tagg', isActive: r.tabId === currentState.activeTab }));

    // Merge with any Chrome snaps already received (chrome snaps shown first)
    snaps = [...chromeSnaps, ...taggSnaps];

    loader.style.display = 'none';
    scene.style.opacity  = '1';
    renderCards();
  }

  // Chrome snaps received from the extension bridge
  let chromeSnaps = [];

  // ---- Public API ----
  return {
    addChromeSnap(snap) {
      // Replace existing snap for same tab, or prepend
      const idx = chromeSnaps.findIndex(s => s.tabId === snap.tabId && s.source === 'chrome');
      if (idx >= 0) chromeSnaps[idx] = snap; else chromeSnaps.unshift(snap);
      if (isOpen) renderCards();
    },

    async open() {
      build();
      isOpen = true;
      rotY = 0; zoom = 1;
      document.getElementById('holo3d').classList.add('open');
      applyTransform();
      if (typeof showToast === 'function') showToast('◈ Holoview — capturing tabs…');
      await loadSnaps();
    },

    async refresh() {
      if (!isOpen) return;
      rotY = 0; zoom = 1;
      applyTransform();
      if (typeof showToast === 'function') showToast('↺ Re-snapping all tabs…');
      await loadSnaps();
    },

    close() {
      isOpen = false;
      const el = document.getElementById('holo3d');
      if (el) el.classList.remove('open');
    }
  };
})();
