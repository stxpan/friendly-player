import { rm } from 'node:fs/promises'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { DATA_DIR, deleteTrack, getTrack, listTracks, MEDIA_DIR } from './db.ts'
import { clearErrors, dismissJob, enqueue, getQueue } from './downloader.ts'

const app = new Hono()

app.get('/api/tracks', (c) => c.json(listTracks()))

app.delete('/api/tracks/:id', async (c) => {
  const track = getTrack(c.req.param('id'))
  if (!track) return c.notFound()
  deleteTrack(track.id)
  for (const f of [track.file, track.thumb]) if (f) await rm(path.join(MEDIA_DIR, f), { force: true })
  return c.body(null, 204)
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

app.use('/media/*', serveStatic({
    root: path.relative(process.cwd(), DATA_DIR),
    // Hono's mime table has no .m4a, which would otherwise go out as octet-stream.
    onFound: (p, c) => {
      if (p.endsWith('.m4a')) c.header('Content-Type', 'audio/mp4')
    },
  }),)

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3001) }, (info) => console.log(`Server on http://localhost:${info.port}`))
