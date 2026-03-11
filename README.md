# Tagg Browser

A redesigned Electron-based browser with a custom tab bar, split view, and built-in Claude AI.

## Stack
- **Electron 28** — cross-platform desktop app shell
- **BrowserView** — renders web content (one per tab)
- **HTML/CSS/JS** — the entire browser UI you see
- **Claude API** — AI assistant built in

## Project Structure

```
tagg-browser/
├── package.json          ← dependencies + build config
├── assets/
│   └── icon.png          ← app icon
└── src/
    ├── main.js           ← Electron main process (tab/window management)
    ├── preload.js        ← secure IPC bridge (main ↔ renderer)
    └── ui/
        ├── index.html    ← browser shell HTML
        ├── style.css     ← all UI styles
        └── renderer.js   ← all UI logic
```

## How it works

```
┌─────────────────────────────────┐
│  src/ui/  (HTML/CSS/JS)         │  ← YOUR custom browser UI
│  Tab bar, address bar, AI panel │
├─────────────────────────────────┤
│  preload.js                     │  ← secure bridge
├─────────────────────────────────┤
│  src/main.js                    │  ← Electron + BrowserViews
│  Tab management, layout         │
├─────────────────────────────────┤
│  Chromium (bundled by Electron) │  ← renders all web content
│  Blink + V8 + Network           │  ← you never touch this
└─────────────────────────────────┘
```

## Setup

### 1. Install Node.js
Download from https://nodejs.org (v18 or newer)

### 2. Install dependencies
```bash
cd tagg-browser
npm install
```

### 3. Run in development
```bash
npm start
```

### 4. Build for distribution
```bash
# Mac
npm run build-mac

# Windows
npm run build-win

# Linux
npm run build-linux

# All platforms
npm run build-all
```

Built apps appear in the `dist/` folder.

## Features

### Tab Bar
- Completely redesigned pill-shaped tabs
- Active tab has gradient underline indicator
- Favicon + title per tab
- Smooth animations
- Keyboard shortcuts: Cmd/Ctrl+T (new), Cmd/Ctrl+W (close), Cmd/Ctrl+L (focus URL)

### Split View
- Click the split icon in the top right
- Pick any existing tab or open a new one
- Both views are full BrowserViews — real browser panes, not iframes
- Each has its own URL bar

### AI Assistant (Claude)
- Click ✦ in the top right
- Add your Anthropic API key: Settings → API Key
- Ask anything about the current page
- Built on Claude Haiku for fast responses

## Adding your Anthropic API key
The app saves settings to your OS user data folder.
Open the app → click ✦ → the AI panel shows a prompt to add your key.
Or edit `tagg-store.json` in your user data folder directly.

## Keyboard Shortcuts
| Shortcut | Action |
|---|---|
| Cmd/Ctrl + T | New tab |
| Cmd/Ctrl + W | Close tab |
| Cmd/Ctrl + L | Focus address bar |
| Cmd/Ctrl + R | Reload |
| Alt + ← | Go back |
| Alt + → | Go forward |
