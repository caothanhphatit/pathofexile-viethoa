'use strict';

const path = require('path');
const url = require('url');
const { app, BrowserWindow, ipcMain, globalShortcut, clipboard } = require('electron');

// Single-instance lock — bail out early if another instance is running.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let win = null;
let watcher = null;
let interactive = true; // interactive (movable) by default; Ctrl+Alt+L locks click-through

// Price-check function (CommonJS). Loaded lazily so a missing/broken module
// does not crash the whole app at require time.
let priceCheckFn = null;
function getPriceCheck() {
  if (!priceCheckFn) {
    try {
      const mod = require('./price-check.cjs');
      priceCheckFn = mod.priceCheck || mod.default || mod;
    } catch (err) {
      console.error('[poe2] failed to load price-check.cjs:', err);
      priceCheckFn = async () => ({
        ok: false,
        type: null,
        count: 0,
        lowest: [],
        error: 'price-check module unavailable',
      });
    }
  }
  return priceCheckFn;
}

async function priceCheck(itemText) {
  const fn = getPriceCheck();
  try {
    return await fn(itemText);
  } catch (err) {
    console.error('[poe2] price check error:', err);
    return { ok: false, type: null, count: 0, lowest: [], error: String((err && err.message) || err) };
  }
}

function applyInteractive() {
  if (!win) return;
  // setIgnoreMouseEvents(ignore) — ignore mouse when NOT interactive.
  win.setIgnoreMouseEvents(!interactive, { forward: true });
  if (win.webContents) {
    win.webContents.send('poe2:set-interactive', interactive);
  }
}

function createWindow() {
  win = new BrowserWindow({
    transparent: true,
    frame: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: true,
    fullscreenable: false,
    width: 320,
    height: 400,
    minWidth: 220,
    minHeight: 90,
    x: 24,
    y: 80,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(false); // interactive (movable) by default
  interactive = true;
  // Push the initial interactive state to the renderer once it has loaded.
  win.webContents.on('did-finish-load', () => {
    if (win && win.webContents) win.webContents.send('poe2:set-interactive', interactive);
  });

  win.loadFile(path.join(__dirname, 'overlay.html'));

  // Surface renderer console + errors into the main stdout for debugging.
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    console.log('[renderer]', message);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] process gone:', details && details.reason);
  });

  win.on('closed', () => {
    win = null;
  });
}

async function startWatcher() {
  try {
    const watcherUrl = url.pathToFileURL(
      path.join(__dirname, '..', 'src', 'server', 'services', 'poe2-log-watcher.mjs')
    ).href;
    const { Poe2LogWatcher } = await import(watcherUrl);

    watcher = new Poe2LogWatcher({ pollIntervalMs: 2000, env: process.env });

    watcher.on('zone', () => {
      if (win && win.webContents) {
        win.webContents.send('poe2:zone', watcher.status());
      }
    });

    await watcher.start();
  } catch (err) {
    // Do not crash on missing Client.txt or watcher problems — the watcher
    // handles missing files internally; this guards import/start failures.
    console.error('[poe2] log watcher failed to start:', err);
  }
}

function registerIpc() {
  ipcMain.handle('poe2:log-status', () => {
    if (!watcher) {
      return {
        watching: false,
        configuredPath: null,
        activePath: null,
        exists: false,
        zoneName: null,
        characterName: null,
        characterClass: null,
        characterLevel: null,
        characterUpdatedAt: null,
        enteredAt: null,
        lastLineAt: null,
        updatedAt: new Date().toISOString(),
        error: 'watcher unavailable',
        bytesRead: 0,
        recentEvents: [],
      };
    }
    return watcher.status();
  });

  ipcMain.handle('poe2:log-configure', async (_e, logPath) => {
    if (!watcher) {
      return { error: 'watcher unavailable' };
    }
    try {
      await watcher.configure(logPath);
    } catch (err) {
      console.error('[poe2] log configure error:', err);
    }
    return watcher.status();
  });

  ipcMain.handle('poe2:price-check', async (_e, itemText) => {
    return priceCheck(itemText);
  });

  ipcMain.on('poe2:set-interactive', (_e, on) => {
    interactive = !!on;
    applyInteractive();
  });

  ipcMain.on('poe2:close', () => {
    console.log('[main] close requested');
    if (win) win.close();
    app.quit();
  });

  // Manual window drag (─webkit-app-region: drag is unreliable on transparent
  // Windows windows). Renderer sends screen mouse coords; we reposition.
  let dragState = null;
  ipcMain.on('poe2:drag', (_e, msg) => {
    if (!win || !msg) return;
    if (msg.type === 'start') {
      const b = win.getBounds();
      dragState = { winX: b.x, winY: b.y, mouseX: msg.screenX, mouseY: msg.screenY };
    } else if (msg.type === 'move' && dragState) {
      const nx = Math.round(dragState.winX + (msg.screenX - dragState.mouseX));
      const ny = Math.round(dragState.winY + (msg.screenY - dragState.mouseY));
      win.setPosition(nx, ny);
    } else if (msg.type === 'end') {
      dragState = null;
    }
  });

  // Collapse to just the header+banner (and restore). Renderer reports the
  // pixel height it wants while collapsed.
  let savedBounds = null;
  ipcMain.on('poe2:collapse', (_e, payload) => {
    if (!win) return;
    const collapsed = payload && payload.collapsed;
    const height = (payload && payload.height) || 72;
    const b = win.getBounds();
    if (collapsed) {
      savedBounds = { width: b.width, height: b.height };
      win.setBounds({ x: b.x, y: b.y, width: b.width, height: Math.round(height) });
    } else {
      const h = (savedBounds && savedBounds.height) || 540;
      win.setBounds({ x: b.x, y: b.y, width: b.width, height: h });
    }
  });
}

function registerShortcuts() {
  // Control+Alt+L toggles interactive (click-through on/off).
  globalShortcut.register('Control+Alt+L', () => {
    interactive = !interactive;
    applyInteractive();
  });

  // Control+D: read clipboard, run a price check, push the result.
  globalShortcut.register('Control+D', async () => {
    try {
      const text = clipboard.readText();
      const r = await priceCheck(text);
      if (win && win.webContents) {
        win.webContents.send('poe2:price-result', r);
      }
    } catch (err) {
      console.error('[poe2] Control+D price check error:', err);
    }
  });
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(async () => {
  createWindow();
  registerIpc();
  registerShortcuts();
  await startWatcher();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (watcher) {
    try {
      watcher.stop();
    } catch (err) {
      console.error('[poe2] watcher stop error:', err);
    }
  }
});
