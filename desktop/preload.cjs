// What the web UI may ask of the desktop app (window.desktop); absent when it runs in a browser.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  // Calls back with the version once an update has been downloaded (right away if it already is);
  // returns an unsubscribe function.
  onUpdateReady(callback) {
    const listener = (_e, version) => callback(version)
    ipcRenderer.on('update-ready', listener)
    ipcRenderer.invoke('update-ready-version').then((version) => version && callback(version))
    return () => ipcRenderer.removeListener('update-ready', listener)
  },
  installUpdate: () => ipcRenderer.send('install-update'),
  version: () => ipcRenderer.invoke('app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-updates'),
  // Player commands from the system-wide hotkeys and the tray menu; returns an unsubscribe function.
  onTrackHotkey(callback) {
    const listener = (_e, action) => callback(action)
    ipcRenderer.on('track-hotkey', listener)
    return () => ipcRenderer.removeListener('track-hotkey', listener)
  },
})
