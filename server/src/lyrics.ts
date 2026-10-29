import path from 'node:path'
import { alignLyrics, ensureModel, isModelReady } from './align.ts'
import { getLyrics, getTrack, MEDIA_DIR, saveLyrics } from './db.ts'
import { innertube } from './search.ts'
import { streamUrl } from './stream.ts'

export type Lyrics = {
  synced: string | null
  plain: string | null
  source: string | null
  // Nothing found because LRCLIB was unreachable, not because there are no lyrics: worth asking again.
  retry?: boolean
}

const API = 'https://lrclib.net/api'
// LRCLIB asks clients to identify themselves.
const HEADERS = { 'User-Agent': 'player (local music player)' }
// Seconds a release may differ from our file before synced timestamps stop lining up.
const SYNC_TOLERANCE = 5
// LRCLIB is often briefly overloaded and answers 503 "retry in a moment".
const RETRY_DELAYS_MS = [700, 1500, 3000]

type LrcRecord = { syncedLyrics: string | null; plainLyrics: string | null; duration: number }

const toLyrics = (r: LrcRecord): Lyrics => ({ synced: r.syncedLyrics, plain: r.plainLyrics, source: 'LRCLIB' })

async function lrclib(path: string, params: URLSearchParams) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}/${path}?${params}`, { headers: HEADERS })
    if (res.status !== 503 || attempt === RETRY_DELAYS_MS.length) return res
    await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]))
  }
}

async function fromLrclib(title: string, artist: string, duration: number | null): Promise<Lyrics | null> {
  // Exact lookup wants a single artist; ours are joined like "Miyagi & Эндшпиль, Sимптом".
  const mainArtist = artist.split(', ')[0]
  const params = new URLSearchParams({ track_name: title, artist_name: mainArtist })
  if (duration) params.set('duration', String(Math.round(duration)))
  const exact = await lrclib('get', params)
  // The exact match can be an entry without timestamps while another album's entry of the same
  // song has them, so a plain-only hit is only a fallback for the search below.
  let fallback: Lyrics | null = null
  if (exact.ok) {
    const found = toLyrics(await exact.json())
    if (found.synced) return found
    fallback = found
  } else if (exact.status !== 404) throw new Error(`LRCLIB ответил ${exact.status}`)

  // Fuzzy search: drop "(feat. …)" and similar, then take the closest length, preferring synced lyrics.
  const q = `${mainArtist} ${title.replace(/\s*[([][^)\]]*[)\]]/g, '')}`
  const res = await lrclib('search', new URLSearchParams({ q }))
  if (!res.ok) {
    if (fallback) return fallback
    throw new Error(`LRCLIB ответил ${res.status}`)
  }
  const off = (h: LrcRecord) => (duration ? Math.abs(h.duration - duration) : 0)
  const hits = ((await res.json()) as LrcRecord[]).sort((a, b) => off(a) - off(b))
  const synced = hits.find((h) => h.syncedLyrics && off(h) <= SYNC_TOLERANCE)
  if (synced) return toLyrics(synced)
  // A different cut (e.g. a music video with an intro) would put synced lines out of step.
  const plain = fallback?.plain ?? hits[0]?.plainLyrics
  return plain ? { synced: null, plain, source: 'LRCLIB' } : null
}

// Licensed plain lyrics YouTube Music shows for the video itself, so no guessing by name.
async function fromYoutubeMusic(videoId: string): Promise<Lyrics | null> {
  const shelf = await (await innertube()).music.getLyrics(videoId)
  const plain = shelf?.description?.toString()
  if (!plain) return null
  // Footer reads like "Source: LyricFind".
  const source = shelf?.footer?.toString().replace(/^Source:\s*/i, '') || 'YouTube Music'
  return { synced: null, plain, source }
}

// Synced lyrics come only from LRCLIB; when it has none (or is down), YouTube Music's plain text is
// preferred over LRCLIB's: it's tied to the exact video.
export async function lookup(t: { videoId: string; title: string; artist: string; duration: number | null }) {
  let lrc: Lyrics | null = null
  let lrcError: unknown
  try {
    lrc = await fromLrclib(t.title, t.artist, t.duration)
  } catch (e) {
    lrcError = e
  }
  if (lrc?.synced) return lrc
  const yt = await fromYoutubeMusic(t.videoId).catch(() => null)
  if (yt) return yt
  if (lrc) return lrc
  if (lrcError) console.warn(`LRCLIB недоступен: ${(lrcError as Error).message}`)
  return { synced: null, plain: null, source: null, retry: lrcError !== undefined }
}

// --- local alignment ---
// Tracks with only plain lyrics get timed by forced alignment (align.ts), one at a time in the
// background. The UI polls while a track's state is set.

export type SyncState = 'model' | 'queued' | 'aligning'

const MAX_SYNC_SEC = 10 * 60

const syncQueue: string[] = []
const syncState = new Map<string, SyncState>()
// Plain lyrics already found for tracks waiting in the queue, so polling doesn't hit LRCLIB again.
const pending = new Map<string, Lyrics>()
let syncing = false

const lrcTime = (sec: number) => {
  const m = Math.floor(sec / 60)
  const s = (sec - m * 60).toFixed(2).padStart(5, '0')
  return `${String(m).padStart(2, '0')}:${s}`
}

// `urgent` puts the track first: it's the one playing, as opposed to a prefetch of the next one.
export function requestSync(trackId: string, urgent: boolean) {
  if (getLyrics(trackId) || syncState.get(trackId) === 'aligning') return
  // Long tracks are mixes, live sets and podcasts more often than songs; not worth the CPU.
  if ((getTrack(trackId)?.duration ?? 0) > MAX_SYNC_SEC) return
  const i = syncQueue.indexOf(trackId)
  if (i !== -1) syncQueue.splice(i, 1)
  if (urgent) syncQueue.unshift(trackId)
  else syncQueue.push(trackId)
  syncState.set(trackId, 'queued')
  void drainSync()
}

async function drainSync() {
  if (syncing) return
  syncing = true
  let id: string | undefined
  while ((id = syncQueue.shift())) {
    try {
      const track = getTrack(id)
      if (!track) continue
      const found =
        pending.get(id) ??
        (await lookup({ videoId: id, title: track.title, artist: track.artist ?? '', duration: track.duration }))
      if (found.synced) {
        saveLyrics(id, { synced: found.synced, plain: found.plain, source: found.source ?? 'LRCLIB' })
        continue
      }
      if (!found.plain) continue
      if (!isModelReady()) {
        syncState.set(id, 'model')
        await ensureModel()
      }
      syncState.set(id, 'aligning')
      const lines = found.plain.split('\n').map((l) => l.trim()).filter(Boolean)
      // Online tracks have no file; ffmpeg reads the audio straight from the YouTube stream.
      const audio = track.file ? path.join(MEDIA_DIR, track.file) : await streamUrl(id)
      const times = await alignLyrics(audio, lines)
      const synced = lines.flatMap((l, i) => (times[i] == null ? [] : [`[${lrcTime(times[i]!)}] ${l}`])).join('\n')
      if (synced) saveLyrics(id, { synced, plain: found.plain, source: 'Авто' })
    } catch (e) {
      console.warn(`Синхронизация текста ${id}: ${(e as Error).message}`)
    } finally {
      syncState.delete(id)
      pending.delete(id)
    }
  }
  syncing = false
}

export async function lyricsFor(trackId: string): Promise<(Lyrics & { syncing?: SyncState }) | undefined> {
  const cached = getLyrics(trackId)
  if (cached) return cached
  const waiting = pending.get(trackId)
  if (waiting && syncState.has(trackId)) return { ...waiting, syncing: syncState.get(trackId) }
  const track = getTrack(trackId)
  if (!track) return undefined
  const lyrics = await lookup({ videoId: track.id, title: track.title, artist: track.artist ?? '', duration: track.duration })
  if (lyrics.synced) {
    saveLyrics(trackId, { synced: lyrics.synced, plain: lyrics.plain, source: lyrics.source ?? 'LRCLIB' })
    return lyrics
  }
  // Plain text only: show it now and time it in the background.
  if (lyrics.plain) {
    pending.set(trackId, lyrics)
    requestSync(trackId, true)
  }
  return { ...lyrics, syncing: syncState.get(trackId) }
}
