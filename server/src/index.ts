import { rm } from 'node:fs/promises'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import {
  addOnline,
  addToPlaylist,
  createPlaylist,
  DEFAULT_MEDIA_DIR,
  deletePlaylist,
  deleteTrack,
  getTrack,
  listPlaylists,
  listTracks,
  MEDIA_DIR,
  recordPlay,
  removeFromPlaylist,
  renamePlaylist,
  renameTrack,
  saveOrder,
} from './db.ts'
import {
  clearErrors,
  dismissJob,
  enqueue,
  enqueueDownloads,
  getConcurrency,
  getQueue,
  isDownloading,
  resolveJob,
  setConcurrency,
  type ImportTarget,
} from './downloader.ts'
import { deleteModel, ensureModel, isModelReady, isSyncEnabled, modelStatus, setSyncEnabled } from './align.ts'
import { backfillLoudness } from './loudness.ts'
import { lookup, lyricsFor, requestSync } from './lyrics.ts'
import { radio, searchFirst, searchMore } from './search.ts'
import { stats } from './stats.ts'
import { cleanup, cleanupPreview, moveMedia, usage } from './storage.ts'
import { streamUrl } from './stream.ts'
import { update, versionInfo } from './ytdlp.ts'

const app = new Hono()

app.onError((e, c) => c.json({ error: e.message }, 500))

app.get('/api/tracks', (c) => c.json(listTracks()))

app.patch('/api/tracks/:id', async (c) => {
  const { title, artist } = await c.req.json<{ title: string; artist: string | null }>()
  if (!title?.trim()) return c.json({ error: 'Название не может быть пустым' }, 400)
  renameTrack(c.req.param('id'), title.trim(), artist?.trim() || null)
  return c.body(null, 204)
})

app.delete('/api/tracks/:id', async (c) => {
  const track = getTrack(c.req.param('id'))
  if (!track) return c.notFound()
  deleteTrack(track.id)
  // Online tracks have no file and a remote cover; only local files are removed.
  for (const f of [track.file, track.thumb]) {
    if (f && !f.startsWith('http')) await rm(path.join(MEDIA_DIR, f), { force: true })
  }
  return c.body(null, 204)
})

// Add a YouTube Music result to the library without downloading it.
app.post('/api/tracks', async (c) => {
  const t = await c.req.json<{ id: string; title: string; artist: string; duration: number | null; thumb: string | null }>()
  if (!/^[\w-]{11}$/.test(t.id)) return c.json({ error: 'Неверный id видео' }, 400)
  addOnline({ ...t, artist: t.artist || null })
  return c.body(null, 204)
})

// Download the files of library tracks that are online-only.
app.post('/api/tracks/download', async (c) => {
  const { ids } = await c.req.json<{ ids: string[] }>()
  return c.json({ queued: enqueueDownloads(ids) })
})

app.get('/api/tracks/:id/lyrics', async (c) => {
  const lyrics = await lyricsFor(c.req.param('id'))
  return lyrics ? c.json(lyrics) : c.notFound()
})

// Prefetch: time the next track's lyrics in the background before it starts playing.
app.post('/api/tracks/:id/lyrics/prepare', (c) => {
  if (!getTrack(c.req.param('id'))) return c.notFound()
  requestSync(c.req.param('id'), false)
  return c.body(null, 202)
})

// Lyrics for a track that isn't in the library (streamed from YouTube Music); not cached.
app.get('/api/lyrics', async (c) => {
  const { id, title, artist, duration } = c.req.query()
  if (!id || !title) return c.json({ error: 'Нужны id и название' }, 400)
  return c.json(await lookup({ videoId: id, title, artist: artist ?? '', duration: duration ? Number(duration) : null }))
})

// Plays a YouTube Music track without downloading it: the <audio> element follows the redirect
// straight to YouTube's audio stream, including the Range requests used for seeking.
app.get('/api/stream/:id', async (c) => {
  const id = c.req.param('id')
  if (!/^[\w-]{11}$/.test(id)) return c.json({ error: 'Неверный id видео' }, 400)
  try {
    return c.redirect(await streamUrl(id), 302)
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502)
  }
})

// Warm the stream URL cache for the track that's next, so it starts without a yt-dlp wait.
app.post('/api/stream/:id/prepare', (c) => {
  const id = c.req.param('id')
  if (/^[\w-]{11}$/.test(id)) streamUrl(id).catch(() => {})
  return c.body(null, 202)
})

// The player reports each listening session when the track changes or ends.
app.post('/api/plays', async (c) => {
  const { trackId, playedAt, listened, completed } = await c.req.json<{
    trackId: string
    playedAt: number
    listened: number
    completed: boolean
  }>()
  if (!getTrack(trackId) || !(listened > 0)) return c.body(null, 204)
  recordPlay(trackId, playedAt, listened, completed)
  return c.body(null, 204)
})

app.get('/api/stats', (c) => c.json(stats(Number(c.req.query('days') ?? 30))))

app.get('/api/playlists', (c) => c.json(listPlaylists()))

// The user's own order after dragging: the whole list, of the library (playlistId null) or a playlist.
app.put('/api/order', async (c) => {
  const { playlistId, ids } = await c.req.json<{ playlistId: number | null; ids: string[] }>()
  saveOrder(playlistId, ids)
  return c.body(null, 204)
})

app.post('/api/playlists', async (c) => {
  const { name } = await c.req.json<{ name: string }>()
  if (!name?.trim()) return c.json({ error: 'Название не может быть пустым' }, 400)
  return c.json({ id: createPlaylist(name.trim()) })
})

app.patch('/api/playlists/:id', async (c) => {
  const { name } = await c.req.json<{ name: string }>()
  if (!name?.trim()) return c.json({ error: 'Название не может быть пустым' }, 400)
  renamePlaylist(Number(c.req.param('id')), name.trim())
  return c.body(null, 204)
})

app.delete('/api/playlists/:id', (c) => {
  deletePlaylist(Number(c.req.param('id')))
  return c.body(null, 204)
})

app.put('/api/playlists/:id/tracks/:trackId', (c) => {
  addToPlaylist(Number(c.req.param('id')), c.req.param('trackId'))
  return c.body(null, 204)
})

app.delete('/api/playlists/:id/tracks/:trackId', (c) => {
  removeFromPlaylist(Number(c.req.param('id')), c.req.param('trackId'))
  return c.body(null, 204)
})

app.get('/api/search', async (c) => {
  const q = c.req.query('q')?.trim()
  if (!q) return c.json({ results: [], more: null })
  try {
    return c.json(await searchFirst(q))
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502)
  }
})

// The next page of a search, by the `more` token the previous page came with.
app.get('/api/search/more', async (c) => {
  try {
    const page = await searchMore(c.req.query('token') ?? '')
    return page ? c.json(page) : c.json({ results: [], more: null })
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502)
  }
})

app.get('/api/radio/:id', async (c) => {
  try {
    return c.json(await radio(c.req.param('id')))
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502)
  }
})

app.get('/api/downloads', (c) => c.json(getQueue()))

app.post('/api/downloads', async (c) => {
  // `playlist`: an existing playlist id, 'new' for one named after the source, or null for the library only.
  const { url, playlist } = await c.req.json<{ url: string; playlist?: ImportTarget }>()
  try {
    return c.json(await enqueue(url, playlist ?? null))
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400)
  }
})

app.delete('/api/downloads', (c) => {
  clearErrors()
  return c.body(null, 204)
})

app.delete('/api/downloads/:id', (c) => {
  dismissJob(c.req.param('id'))
  return c.body(null, 204)
})

app.post('/api/downloads/:id/resolve', async (c) => {
  const { videoId } = await c.req.json<{ videoId: string }>()
  return resolveJob(c.req.param('id'), videoId) ? c.body(null, 204) : c.notFound()
})

app.get('/api/ytdlp', async (c) => c.json(await versionInfo()))

app.post('/api/ytdlp/update', async (c) => {
  // Replacing the binary while it's running a download would break that download.
  if (isDownloading()) return c.json({ error: 'Дождись окончания загрузок — yt-dlp сейчас занят' }, 409)
  return c.json(await update())
})

// --- settings & storage ---

const settings = () => ({
  concurrency: getConcurrency(),
  mediaDir: MEDIA_DIR,
  defaultMediaDir: DEFAULT_MEDIA_DIR,
  lyricsModel: modelStatus(),
})

app.get('/api/settings', (c) => c.json(settings()))

app.put('/api/settings', async (c) => {
  const body = await c.req.json<{ concurrency?: number; mediaDir?: string; syncLyrics?: boolean }>()
  if (body.concurrency !== undefined) setConcurrency(body.concurrency)
  if (body.syncLyrics !== undefined) setSyncEnabled(body.syncLyrics)
  let moved
  if (body.mediaDir !== undefined) {
    try {
      moved = await moveMedia(body.mediaDir)
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  }
  return c.json({ ...settings(), moved })
})

app.delete('/api/lyrics-model', async (c) => {
  try {
    await deleteModel()
  } catch (e) {
    return c.json({ error: (e as Error).message }, 409)
  }
  return c.json(settings())
})

app.get('/api/storage', async (c) => c.json(await usage()))
app.get('/api/storage/cleanup', async (c) => c.json(await cleanupPreview(Number(c.req.query('days') ?? 90))))
app.post('/api/storage/cleanup', async (c) => {
  const { days } = await c.req.json<{ days: number }>()
  return c.json(await cleanup(days))
})

// The music folder can be moved in settings, so the static handler is built per request.
app.use('/media/*', (c, next) =>
  serveStatic({
    root: MEDIA_DIR,
    rewriteRequestPath: (p) => p.replace(/^\/media/, ''),
    // Hono's mime table has no .m4a, which would otherwise go out as octet-stream.
    onFound: (p, ctx) => {
      if (p.endsWith('.m4a')) ctx.header('Content-Type', 'audio/mp4')
    },
  })(c, next),
)

// The desktop app serves the built web UI from here; in development Vite does.
const WEB_DIR = process.env.PLAYER_WEB_DIR
if (WEB_DIR) {
  app.use('*', serveStatic({ root: WEB_DIR }))
  // Anything else is a page of the single-page app.
  app.get('*', serveStatic({ root: WEB_DIR, path: 'index.html' }))
}

// Started by the desktop app: quit along with it, even when it didn't get to stop the server.
const PARENT_PID = Number(process.env.PLAYER_PARENT_PID)
if (PARENT_PID) {
  setInterval(() => {
    try {
      process.kill(PARENT_PID, 0)
    } catch {
      process.exit(0)
    }
  }, 2000).unref()
}

backfillLoudness()
// First run with syncing on (the installer's checkbox): fetch the model in the background.
if (isSyncEnabled() && !isModelReady()) ensureModel().catch((e) => console.warn(`Модель синхронизации: ${(e as Error).message}`))

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3001), hostname: process.env.HOST }, (info) =>
  console.log(`Server on http://localhost:${info.port}`),
)
