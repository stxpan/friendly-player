// Desktop shell: starts the player's server in a utility process and shows its UI in a window.
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  session,
  shell,
  utilityProcess,
} = require('electron')
const { autoUpdater } = require('electron-updater')
const fs = require('node:fs')
const path = require('node:path')

// Fixed port: the UI keeps its settings and queue in localStorage, which is tied to the origin.
const PORT = 47615
const ORIGIN = `http://127.0.0.1:${PORT}`
const STARTUP_TIMEOUT_MS = 30_000
// The app may stay open for days; look for a new release now and then, not only at launch.
const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000

// Packaged: next to app.asar in resources/; unpackaged (`pnpm start`): the local build/ folder.
const resource = (...p) => (app.isPackaged ? path.join(process.resourcesPath, ...p) : path.join(__dirname, 'build', ...p))

let server
let win
// Shown while the window is minimized (it then leaves the taskbar).
let tray = null
// Version of an update that has been downloaded and waits to be installed.
let updateReady = null

// yt-dlp updates itself in place, and the install folder may not be writable (installed for all
// users), so it runs from the user's profile: copied there on first launch and after app updates.
function userYtdlp() {
  const bundled = resource('bin', 'yt-dlp.exe')
  const copy = path.join(app.getPath('userData'), 'bin', 'yt-dlp.exe')
  if (!fs.existsSync(copy) || fs.statSync(bundled).mtimeMs > fs.statSync(copy).mtimeMs) {
    fs.mkdirSync(path.dirname(copy), { recursive: true })
    fs.copyFileSync(bundled, copy)
  }
  return copy
}

function startServer() {
  const bin = resource('bin')
  // Written by the installer's "sync lyrics" checkbox; the default for the first run only.
  let syncLyrics = '1'
  try {
    syncLyrics = fs.readFileSync(resource('sync-lyrics.txt'), 'utf8').trim()
  } catch {
    // not installed through the installer
  }
  // Set when launched from VS Code's terminal; it would make the child a plain Node process.
  const { ELECTRON_RUN_AS_NODE, ...env } = process.env
  // ffmpeg is looked up on PATH, by the server and by yt-dlp. On Windows the key is usually 'Path'.
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  env[pathKey] = `${bin}${path.delimiter}${env[pathKey] ?? ''}`
  const log = fs.createWriteStream(path.join(app.getPath('userData'), 'server.log'), { flags: 'w' })
  server = utilityProcess.fork(resource('server', 'index.mjs'), [], {
    serviceName: 'Friendly Player server',
    stdio: 'pipe',
    env: {
      ...env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      PLAYER_DATA_DIR: path.join(app.getPath('userData'), 'data'),
      PLAYER_WEB_DIR: resource('web'),
      PLAYER_SYNC_LYRICS: syncLyrics,
      YTDLP_PATH: userYtdlp(),
      // The server quits when the app is gone, even if it crashed instead of closing.
      PLAYER_PARENT_PID: String(process.pid),
    },
  })
  server.stdout.pipe(log)
  server.stderr.pipe(log)
  return new Promise((resolve, reject) => {
    server.once('exit', (code) => reject(new Error(`Сервер завершился с кодом ${code}`)))
    const started = Date.now()
    const poll = async () => {
      try {
        if ((await fetch(`${ORIGIN}/api/settings`)).ok) return resolve()
      } catch {
        // not listening yet
      }
      if (Date.now() - started > STARTUP_TIMEOUT_MS) return reject(new Error('Сервер не запустился за 30 секунд'))
      setTimeout(poll, 200)
    }
    poll()
  })
}

// Updates come from GitHub Releases (see "publish" in electron-builder.yml): downloaded in the
// background, installed when the user restarts from the UI's prompt or simply quits the app.
function startUpdates() {
  if (!app.isPackaged) return
  const log = fs.createWriteStream(path.join(app.getPath('userData'), 'updater.log'), { flags: 'w' })
  const write = (level) => (msg) => log.write(`${new Date().toISOString()} ${level} ${msg}\n`)
  autoUpdater.logger = { info: write('info'), warn: write('warn'), error: write('error'), debug: () => {} }
  autoUpdater.on('update-downloaded', ({ version }) => {
    updateReady = version
    win?.webContents.send('update-ready', version)
  })
  // No network or no release yet: try again at the next check.
  const check = () => autoUpdater.checkForUpdates().catch(() => {})
  check()
  setInterval(check, UPDATE_CHECK_MS)
}

ipcMain.handle('update-ready-version', () => updateReady)
ipcMain.on('install-update', () => autoUpdater.quitAndInstall())
ipcMain.handle('app-version', () => app.getVersion())

// "Check for updates" in Settings. A found update downloads on its own and ends in 'update-ready'.
ipcMain.handle('check-updates', async () => {
  if (!app.isPackaged) return { status: 'dev' }
  if (updateReady) return { status: 'ready', version: updateReady }
  try {
    const result = await autoUpdater.checkForUpdates()
    return result?.isUpdateAvailable
      ? { status: 'downloading', version: result.updateInfo.version }
      : { status: 'latest' }
  } catch (e) {
    return { status: 'error', message: e.message }
  }
})

// Previous / next track from anywhere, also while another app is focused. Not Ctrl+←/→: those move
// the cursor by words in every text field. If another app already holds a combination, it stays
// with that app; the hotkey works only inside the player then.
const TRACK_HOTKEYS = { 'CommandOrControl+Shift+A': 'prev', 'CommandOrControl+Shift+D': 'next' }

// Commands for the player in the UI: 'prev', 'next' or 'toggle' (play/pause).
const sendToPlayer = (action) => win?.webContents.send('track-hotkey', action)

function registerHotkeys() {
  for (const [accelerator, action] of Object.entries(TRACK_HOTKEYS)) {
    globalShortcut.register(accelerator, () => sendToPlayer(action))
  }
}

// The app icon at the sizes Windows asks for at 100–200% display scaling, so it isn't blurry.
function trayIcon() {
  const source = nativeImage.createFromPath(path.join(__dirname, 'icon.png'))
  const icon = nativeImage.createEmpty()
  for (const [scaleFactor, size] of [[1, 16], [1.25, 20], [1.5, 24], [2, 32]]) {
    const buffer = source.resize({ width: size, height: size, quality: 'best' }).toPNG()
    icon.addRepresentation({ scaleFactor, width: size, height: size, buffer })
  }
  return icon
}

function showTray() {
  if (tray) return
  tray = new Tray(trayIcon())
  tray.setToolTip('Friendly Player')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Открыть', click: showWindow },
      { type: 'separator' },
      { label: 'Пауза / продолжить', click: () => sendToPlayer('toggle') },
      { label: 'Предыдущий трек', click: () => sendToPlayer('prev') },
      { label: 'Следующий трек', click: () => sendToPlayer('next') },
      { type: 'separator' },
      { label: 'Выход', click: () => app.quit() },
    ]),
  )
  tray.on('click', showWindow)
}

// Back from the tray (or from a second launch): the window returns, the tray icon goes away.
function showWindow() {
  if (!win) return
  win.show()
  if (win.isMinimized()) win.restore()
  win.focus()
  tray?.destroy()
  tray = null
}

// Versions up to 0.2.1 served the UI without cache headers, and the window kept showing the
// cached old one after an update. Starting a new version drops the browser cache once.
async function clearCacheAfterUpdate() {
  const marker = path.join(app.getPath('userData'), 'ui-version.txt')
  let last = null
  try {
    last = fs.readFileSync(marker, 'utf8').trim()
  } catch {
    // first launch
  }
  if (last === app.getVersion()) return
  await session.defaultSession.clearCache()
  fs.writeFileSync(marker, app.getVersion())
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Friendly Player',
    backgroundColor: '#0a0a0a',
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') },
  })
  // Links (e.g. "copy link" targets, GitHub) open in the browser, not in the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.once('ready-to-show', () => win.show())
  // Minimizing sends the player to the tray; the music keeps playing.
  win.on('minimize', () => {
    win.hide()
    showTray()
  })
  win.loadURL(ORIGIN)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    try {
      await startServer()
    } catch (e) {
      dialog.showErrorBox(
        'Friendly Player не запустился',
        `${e.message}\n\nПодробности в ${path.join(app.getPath('userData'), 'server.log')}`,
      )
      app.quit()
      return
    }
    await clearCacheAfterUpdate()
    createWindow()
    registerHotkeys()
    startUpdates()
  })

  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    server?.kill()
  })
}
