// What the web UI may ask of the desktop app (window.desktop); absent when it runs in a browser.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  // Calls back with the version once an update has been downloaded (right away if it already is).
  onUpdateReady(callback) {
    ipcRenderer.on('update-ready', (_e, version) => callback(version))
    ipcRenderer.invoke('update-ready-version').then((version) => version && callback(version))
  },
  installUpdate: () => ipcRenderer.send('install-update'),
  // System-wide track hotkeys; returns an unsubscribe function.
  onTrackHotkey(callback) {
    const listener = (_e, action) => callback(action)
    ipcRenderer.on('track-hotkey', listener)
    return () => ipcRenderer.removeListener('track-hotkey', listener)
  },
})
