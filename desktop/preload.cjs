// Electron preload — exposes window.poe2native bridge to the renderer.
// contextIsolation:true, nodeIntegration:false (configured in main.cjs).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('poe2native', {
  getLogStatus:   () => ipcRenderer.invoke('poe2:log-status'),
  configureLog:   (p) => ipcRenderer.invoke('poe2:log-configure', p),
  priceCheck:     (t) => ipcRenderer.invoke('poe2:price-check', t),
  setInteractive: (on) => ipcRenderer.send('poe2:set-interactive', on),
  onZone:         (cb) => ipcRenderer.on('poe2:zone', (_e, s) => cb(s)),
  onPriceResult:  (cb) => ipcRenderer.on('poe2:price-result', (_e, r) => cb(r)),
  onSetInteractive: (cb) => ipcRenderer.on('poe2:set-interactive', (_e, v) => cb(v)),
  close:          () => ipcRenderer.send('poe2:close'),
  collapse:       (collapsed, height) => ipcRenderer.send('poe2:collapse', { collapsed, height }),
  drag:           (msg) => ipcRenderer.send('poe2:drag', msg),
});
