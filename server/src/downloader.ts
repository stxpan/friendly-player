import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  addOnline,
  addToPlaylist,
  createPlaylist,
  deleteJob,
  getSetting,
  getTrack,
  hasSource,
  loadJobs,
  MEDIA_DIR,
  saveDownload,
  saveJob,
  setSetting,
} from './db.ts'
import { queueLoudness } from './loudness.ts'
import { searchMusic } from './search.ts'
import { fetchYandexPlaylist } from './yandex.ts'
import { run } from './ytdlp.ts'

// Tracks are added to the library "online" (played as a stream) by default; downloading the
// file is a separate, explicit step. The queue is mirrored in the database, so a restart resumes it.

// How far the found YouTube Music track may differ from the imported one, in seconds.
const DURATION_TOLERANCE = 10

export type Job = {
  id: string
  // 'add' finds a YouTube match for an imported track; 'download' fetches a library track's file.
  kind: 'add' | 'download'
  title: string
  status: 'queued' | 'downloading' | 'error'
  progress: number
  error?: string
  videoId?: string
  // Track imported from another service, looked up on YouTube Music.
  search?: { query: string; title: string; artist: string; durationMs: number; source: string }
  // Import into a playlist, keeping the source's order.
  playlist?: { id: number; addedAt: number; position: number }
}

// Interrupted work starts over; progress isn't worth persisting.
const jobs: Job[] = loadJobs<Job>().map((j) => (j.status === 'downloading' ? { ...j, status: 'queued', progress: 0 } : j))
// Bumped on every finished job so the UI knows when to refetch the library.
let completed = 0

export const getQueue = () => ({ jobs, completed })
export const isDownloading = () => jobs.some((j) => j.status === 'downloading' && j.kind === 'download')

function push(...added: Job[]) {
  for (const j of added) {
    jobs.push(j)
    saveJob(j)
  }
  processQueue()
}

function remove(job: Job) {
  const i = jobs.indexOf(job)
  if (i !== -1) jobs.splice(i, 1)
  deleteJob(job.id)
}

export function dismissJob(id: string) {
  const job = jobs.find((j) => j.id === id && j.status === 'error')
  if (job) remove(job)
}

export function clearErrors() {
  for (const job of jobs.filter((j) => j.status === 'error')) remove(job)
}

// The user picked the right video for an import that wasn't matched; add it with the original metadata.
export function resolveJob(id: string, videoId: string) {
  const job = jobs.find((j) => j.id === id && j.status === 'error')
  if (!job) return false
  Object.assign(job, { videoId, status: 'queued', progress: 0, error: undefined })
  saveJob(job)
  processQueue()
  return true
}

const isQueued = (match: (j: Job) => boolean) => jobs.some((j) => j.status !== 'error' && match(j))

const thumbFor = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`

// Where imported tracks go: nowhere but the library, an existing playlist, or a new one named
// after the source playlist.
export type ImportTarget = number | 'new' | null

// Adds whatever the link points to. YouTube entries go straight into the library; Yandex tracks
// need a YouTube Music lookup each, which runs as queued jobs.
export async function enqueue(url: string, target: ImportTarget) {
  const u = new URL(url)
  // Earlier tracks get later "added" times, so newest-first sorting keeps the source's order.
  const startedAt = Date.now()
  const slots = (playlistId: number | null) => (i: number) =>
    playlistId === null ? undefined : { id: playlistId, addedAt: startedAt - i, position: i }

  if (!u.hostname.startsWith('music.yandex.')) {
    const source = await youtubeEntries(u)
    const playlistId = target === 'new' ? createPlaylist(source.title) : target
    const slot = slots(playlistId)
    let added = 0
    source.tracks.forEach((t, i) => {
      if (!getTrack(t.id)) added++
      addOnline(t)
      const s = slot(i)
      if (s) addToPlaylist(s.id, t.id, s)
    })
    completed++
    return { added, queued: 0, playlistId }
  }

  const source = await fetchYandexPlaylist(u)
  const playlistId = target === 'new' ? createPlaylist(source.title) : target
  const slot = slots(playlistId)
  const queued: Job[] = []
  source.tracks.forEach((t, i) => {
    const sourceId = `yandex:${t.id}`
    // Already imported once: only the playlist needs it now, and that's handled when found again.
    if (playlistId === null && (hasSource(sourceId) || isQueued((j) => j.search?.source === sourceId))) return
    const artist = t.artists.join(', ')
    queued.push({
      id: randomUUID(),
      kind: 'add',
      title: `${artist} — ${t.title}`,
      status: 'queued',
      progress: 0,
      search: { query: `${t.artists.join(' ')} ${t.title}`, title: t.title, artist, durationMs: t.durationMs, source: sourceId },
      playlist: slot(i),
    })
  })
  push(...queued)
  return { added: 0, queued: queued.length, playlistId }
}

// A watch URL that carries a list= param (mixes, "play all") is treated as a single video;
// whole playlists come from /playlist?list=... links.
async function youtubeEntries(u: URL) {
  const single = u.searchParams.has('v') || u.hostname === 'youtu.be'
  const info = JSON.parse(await run(['-J', '--flat-playlist', single ? '--no-playlist' : '--yes-playlist', u.href]))
  type Entry = {
    id?: string
    title?: string
    artist?: string
    channel?: string
    uploader?: string
    duration?: number
    thumbnails?: { url: string }[]
  }
  const entries: Entry[] = info._type === 'playlist' ? info.entries : [info]
  return {
    title: (info.title as string) ?? 'YouTube',
    tracks: entries
      .filter((e): e is Entry & { id: string } => Boolean(e.id))
      .map((e) => ({
        id: e.id,
        title: e.title ?? e.id,
        artist: e.artist ?? e.channel ?? e.uploader ?? null,
        duration: e.duration ?? null,
        thumb: e.thumbnails?.at(-1)?.url ?? thumbFor(e.id),
      })),
  }
}

// Downloads files for library tracks that are still online-only.
export function enqueueDownloads(ids: string[]) {
  const queued: Job[] = []
  for (const id of ids) {
    const t = getTrack(id)
    if (!t || t.file || isQueued((j) => j.kind === 'download' && j.videoId === id)) continue
    queued.push({
      id: randomUUID(),
      kind: 'download',
      videoId: id,
      title: t.artist ? `${t.artist} — ${t.title}` : t.title,
      status: 'queued',
      progress: 0,
    })
  }
  push(...queued)
  return queued.length
}

// More parallel downloads tend to trip YouTube's rate limiting (429 / "confirm you're not a bot").
export const getConcurrency = () => getSetting('concurrency', 3)
export function setConcurrency(n: number) {
  setSetting('concurrency', Math.min(5, Math.max(1, Math.round(n))))
  processQueue()
}
let workers = 0

function processQueue() {
  while (workers < getConcurrency() && jobs.some((j) => j.status === 'queued')) {
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
      await (job.kind === 'add' ? add(job) : download(job))
      remove(job)
      completed++
    } catch (e) {
      job.status = 'error'
      job.error = (e as Error).message
      saveJob(job)
    }
    // Lowering the setting takes effect as running jobs finish.
    if (workers > getConcurrency()) break
  }
  workers--
}

async function add(job: Job) {
  const s = job.search!
  let videoId = job.videoId
  let duration = s.durationMs / 1000
  let thumb = videoId ? thumbFor(videoId) : null
  if (!videoId) {
    // Top YouTube Music song whose length matches the original; anything else is likely another song.
    const hit = (await searchMusic(s.query)).find(
      (r) => r.duration != null && Math.abs(r.duration - duration) <= DURATION_TOLERANCE,
    )
    if (!hit) throw new Error('Не найдено на YouTube Music')
    videoId = hit.id
    duration = hit.duration ?? duration
    thumb = hit.thumb ?? thumbFor(hit.id)
  }
  addOnline({ id: videoId, title: s.title, artist: s.artist, duration, thumb }, s.source)
  if (job.playlist) addToPlaylist(job.playlist.id, videoId, job.playlist)
}

async function download(job: Job) {
  const out = await run(
    [
      '-f', 'bestaudio[ext=m4a]/bestaudio',
      '-o', path.join(MEDIA_DIR, '%(id)s.%(ext)s'),
      '--write-thumbnail', '--convert-thumbnails', 'jpg',
      '--progress', '--newline',
      '--progress-template', 'download:PROGRESS %(progress.downloaded_bytes)s %(progress.total_bytes,progress.total_bytes_estimate)s',
      '--print', 'after_move:%(.{id,duration,ext})j',
      '--no-playlist',
      `https://www.youtube.com/watch?v=${job.videoId}`,
    ],
    (line) => {
      const m = /^PROGRESS (\d+) (\d+(?:\.\d+)?)/.exec(line)
      if (m) job.progress = Math.min(100, (Number(m[1]) / Number(m[2])) * 100)
    },
  )
  const json = out.split('\n').find((l) => l.startsWith('{'))
  if (!json) throw new Error('yt-dlp не сообщил, куда сохранил файл')
  const meta = JSON.parse(json)
  const thumb = `${meta.id}.jpg`
  const file = `${meta.id}.${meta.ext}`
  saveDownload(meta.id, file, existsSync(path.join(MEDIA_DIR, thumb)) ? thumb : null, meta.duration ?? null)
  queueLoudness(meta.id, file)
}

processQueue()
