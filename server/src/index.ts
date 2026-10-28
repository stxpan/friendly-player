import { rm } from 'node:fs/promises'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import {
  addToPlaylist,
  createPlaylist,
  DATA_DIR,
  deletePlaylist,
  deleteTrack,
  getTrack,
  listPlaylists,
  listTracks,
  MEDIA_DIR,
  removeFromPlaylist,
  renamePlaylist,
  renameTrack,
} from './db.ts'
import { clearErrors, dismissJob, enqueue, getQueue, isDownloading, resolveJob } from './downloader.ts'
import { backfillLoudness } from './loudness.ts'
import { lyricsFor } from './lyrics.ts'
import { searchMusic } from './search.ts'
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
  for (const f of [track.file, track.thumb]) if (f) await rm(path.join(MEDIA_DIR, f), { force: true })
  return c.body(null, 204)
})

app.get('/api/tracks/:id/lyrics', async (c) => {
  const lyrics = await lyricsFor(c.req.param('id'))
  return lyrics ? c.json(lyrics) : c.notFound()
})

app.get('/api/playlists', (c) => c.json(listPlaylists()))

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
  if (!q) return c.json([])
  try {
    return c.json(await searchMusic(q))
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502)
  }
})

app.get('/api/downloads', (c) => c.json(getQueue()))

app.post('/api/downloads', async (c) => {
  const { url } = await c.req.json<{ url: string }>()
  try {
    return c.json(await enqueue(url))
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

app.use(
  '/media/*',
  serveStatic({
    root: path.relative(process.cwd(), DATA_DIR),
    // Hono's mime table has no .m4a, which would otherwise go out as octet-stream.
    onFound: (p, c) => {
      if (p.endsWith('.m4a')) c.header('Content-Type', 'audio/mp4')
    },
  }),
)

backfillLoudness()

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3001) }, (info) => console.log(`Server on http://localhost:${info.port}`))
