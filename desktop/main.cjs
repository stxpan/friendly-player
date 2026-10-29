// Desktop shell: starts the player's server in a utility process and shows its UI in a window.
const { app, BrowserWindow, Menu, dialog, shell, utilityProcess } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

// Fixed port: the UI keeps its settings and queue in localStorage, which is tied to the origin.
const PORT = 47615
const ORIGIN = `http://127.0.0.1:${PORT}`
const STARTUP_TIMEOUT_MS = 30_000

// Packaged: next to app.asar in resources/; unpackaged (`pnpm start`): the local build/ folder.
const resource = (...p) => (app.isPackaged ? path.join(process.resourcesPath, ...p) : path.join(__dirname, 'build', ...p))

let server
let win

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

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Friendly Player',
    backgroundColor: '#0a0a0a',
    show: false,
  })
  // Links (e.g. "copy link" targets, GitHub) open in the browser, not in the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.once('ready-to-show', () => win.show())
  win.loadURL(ORIGIN)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win?.isMinimized()) win.restore()
    win?.focus()
  })

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
    createWindow()
  })

  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => server?.kill())
}
