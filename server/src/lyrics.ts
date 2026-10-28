import { getLyrics, getTrack, saveLyrics, type Lyrics } from './db.ts'

const API = 'https://lrclib.net/api'
// LRCLIB asks clients to identify themselves.
const HEADERS = { 'User-Agent': 'player (local music player)' }
// Seconds a release may differ from our file before synced timestamps stop lining up.
const SYNC_TOLERANCE = 5

type LrcRecord = { syncedLyrics: string | null; plainLyrics: string | null; duration: number }

const toLyrics = (r: LrcRecord): Lyrics => ({ synced: r.syncedLyrics, plain: r.plainLyrics })

async function lookup(title: string, artist: string, duration: number | null): Promise<Lyrics> {
  // Exact lookup wants a single artist; ours are joined like "Miyagi & Эндшпиль, Sимптом".
  const mainArtist = artist.split(', ')[0]
  const params = new URLSearchParams({ track_name: title, artist_name: mainArtist })
  if (duration) params.set('duration', String(Math.round(duration)))
  const exact = await fetch(`${API}/get?${params}`, { headers: HEADERS })
  if (exact.ok) return toLyrics(await exact.json())
  if (exact.status !== 404) throw new Error(`LRCLIB ответил ${exact.status}`)

  // Fuzzy search: drop "(feat. …)" and similar, then take the closest length, preferring synced lyrics.
  const q = `${mainArtist} ${title.replace(/\s*[([][^)\]]*[)\]]/g, '')}`
  const res = await fetch(`${API}/search?${new URLSearchParams({ q })}`, { headers: HEADERS })
  if (!res.ok) throw new Error(`LRCLIB ответил ${res.status}`)
  const off = (h: LrcRecord) => (duration ? Math.abs(h.duration - duration) : 0)
  const hits = ((await res.json()) as LrcRecord[]).sort((a, b) => off(a) - off(b))
  const best = hits.find((h) => h.syncedLyrics && off(h) <= SYNC_TOLERANCE) ?? hits[0]
  if (!best) return { synced: null, plain: null }
  // A different cut (e.g. a music video with an intro) would put synced lines out of step.
  return off(best) <= SYNC_TOLERANCE ? toLyrics(best) : { synced: null, plain: best.plainLyrics }
}

export async function lyricsFor(trackId: string) {
  const cached = getLyrics(trackId)
  if (cached) return cached
  const track = getTrack(trackId)
  if (!track) return undefined
  const lyrics = await lookup(track.title, track.artist ?? '', track.duration)
  // Misses aren't cached: LRCLIB is community-filled, lyrics may show up later.
  if (lyrics.synced || lyrics.plain) saveLyrics(trackId, lyrics)
  return lyrics
}
