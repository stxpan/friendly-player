import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { getTrack, hasSource, insertTrack, MEDIA_DIR } from './db.ts'
import { queueLoudness } from './loudness.ts'
import { fetchYandexPlaylist } from './yandex.ts'
import { run } from './ytdlp.ts'

// How far the found YouTube Music track may differ from the imported one, in seconds.
const DURATION_TOLERANCE = 10

export type Job = {
  id: string
  title: string
  status: 'queued' | 'downloading' | 'error'
  progress: number
  error?: string
  // Direct YouTube link, or the video the user picked by hand for an imported track.
  videoId?: string
  // Track imported from another service, looked up on YouTube Music.
  search?: { query: string; title: string; artist: string; durationMs: number; source: string }
}

export const isDownloading = () => jobs.some((j) => j.status === 'downloading')

const jobs: Job[] = []
// Bumped on every finished download so the UI knows when to refetch the library.
let completed = 0

export const getQueue = () => ({ jobs, completed })

export function dismissJob(id: string) {
  const i = jobs.findIndex((j) => j.id === id && j.status === 'error')
  if (i !== -1) jobs.splice(i, 1)
}

export function clearErrors() {
  for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].status === 'error') jobs.splice(i, 1)
}

// The user picked the right video for a failed import; retry with it, keeping the original metadata.
export function resolveJob(id: string, videoId: string) {
  const job = jobs.find((j) => j.id === id && j.status === 'error')
  if (!job) return false
  Object.assign(job, { videoId, status: 'queued', progress: 0, error: undefined })
  processQueue()
  return true
}

const isQueued = (match: (j: Job) => boolean) => jobs.some((j) => j.status !== 'error' && match(j))

export async function enqueue(url: string) {
  const u = new URL(url)
  const added = u.hostname.startsWith('music.yandex.') ? await enqueueYandex(u) : await enqueueYoutube(u)
  jobs.push(...added)
  processQueue()
  return added
}

// A watch URL that carries a list= param (mixes, "play all") is treated as a single video;
// whole playlists come from /playlist?list=... links.
async function enqueueYoutube(u: URL) {
  const single = u.searchParams.has('v') || u.hostname === 'youtu.be'
  const info = JSON.parse(await run(['-J', '--flat-playlist', single ? '--no-playlist' : '--yes-playlist', u.href]))
  const entries: { id?: string; title?: string }[] = info._type === 'playlist' ? info.entries : [info]

  const added: Job[] = []
  for (const e of entries) {
    if (!e.id || getTrack(e.id) || isQueued((j) => j.videoId === e.id)) continue
    added.push({ id: randomUUID(), videoId: e.id, title: e.title ?? e.id, status: 'queued', progress: 0 })
  }
  return added
}

async function enqueueYandex(u: URL) {
  const added: Job[] = []
  for (const t of await fetchYandexPlaylist(u)) {
    const source = `yandex:${t.id}`
    if (hasSource(source) || isQueued((j) => j.search?.source === source)) continue
    const artist = t.artists.join(', ')
    added.push({
      id: randomUUID(),
      title: `${artist} — ${t.title}`,
      status: 'queued',
      progress: 0,
      search: { query: `${t.artists.join(' ')} ${t.title}`, title: t.title, artist, durationMs: t.durationMs, source },
    })
  }
  return added
}

// More parallel downloads tend to trip YouTube's rate limiting (429 / "confirm you're not a bot").
const CONCURRENCY = 3
let workers = 0

function processQueue() {
  while (workers < CONCURRENCY && jobs.some((j) => j.status === 'queued')) {
    workers++
    void worker()
  }
}

async function worker() {
  let job: Job | undefined
  // find + status change happen synchronously, so two workers never pick the same job.
  while ((job = jobs.find((j) => j.status === 'queued'))) {
    job.status = 'downloading'
    try {
      await download(job)
      jobs.splice(jobs.indexOf(job), 1)
      completed++
    } catch (e) {
      job.status = 'error'
      job.error = (e as Error).message
    }
  }
  workers--
}

function target(job: Job) {
  if (job.videoId) return ['--no-playlist', `https://www.youtube.com/watch?v=${job.videoId}`]
  // Top hit in YouTube Music's "Songs" section, rejected unless its length matches the original.
  const d = job.search!.durationMs / 1000
  return [
    '--playlist-items', '1',
    '--match-filter', `duration >= ${Math.floor(d - DURATION_TOLERANCE)} & duration <= ${Math.ceil(d + DURATION_TOLERANCE)}`,
    `https://music.youtube.com/search?q=${encodeURIComponent(job.search!.query)}#songs`,
  ]
}

async function download(job: Job) {
  const out = await run(
    [
      '-f', 'bestaudio[ext=m4a]/bestaudio',
      '-o', path.join(MEDIA_DIR, '%(id)s.%(ext)s'),
      '--write-thumbnail', '--convert-thumbnails', 'jpg',
      '--progress', '--newline',
      '--progress-template', 'download:PROGRESS %(progress.downloaded_bytes)s %(progress.total_bytes,progress.total_bytes_estimate)s',
      '--print', 'after_move:%(.{id,title,artist,uploader,duration,ext})j',
      ...target(job),
    ],
    (line) => {
      const m = line.match(/^PROGRESS (\d+) (\d+(?:\.\d+)?)/)
      if (m) job.progress = Math.min(100, (Number(m[1]) / Number(m[2])) * 100)
    },
  )
  const json = out.split('\n').find((l) => l.startsWith('{'))
  // Nothing printed means the search hit was filtered out by --match-filter.
  if (!json) throw new Error('Не найдено на YouTube Music')
  const meta = JSON.parse(json)
  const thumb = `${meta.id}.jpg`
  const file = `${meta.id}.${meta.ext}`
  insertTrack(
    {
      id: meta.id,
      title: job.search?.title ?? meta.title,
      artist: job.search?.artist ?? meta.artist ?? meta.uploader ?? null,
      duration: meta.duration ?? null,
      file,
      thumb: existsSync(path.join(MEDIA_DIR, thumb)) ? thumb : null,
      addedAt: Date.now(),
    },
    job.search?.source,
  )
  queueLoudness(meta.id, file)
}
