import { playsSince, type PlayRow } from './db.ts'

const DAY_MS = 24 * 60 * 60 * 1000
// A day counts towards the streak with at least this much listening.
const STREAK_MIN_SEC = 60
const TOP = 10

const dayKey = (ts: number) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function top<T extends { plays: number; seconds: number }>(groups: Map<string, T>) {
  return [...groups.values()].sort((a, b) => b.plays - a.plays || b.seconds - a.seconds).slice(0, TOP)
}

function streak(all: PlayRow[]) {
  const secondsByDay = new Map<string, number>()
  for (const p of all) secondsByDay.set(dayKey(p.playedAt), (secondsByDay.get(dayKey(p.playedAt)) ?? 0) + p.listened)
  const listened = (ts: number) => (secondsByDay.get(dayKey(ts)) ?? 0) >= STREAK_MIN_SEC
  // Today doesn't break the streak until it's over.
  let day = listened(Date.now()) ? Date.now() : Date.now() - DAY_MS
  let count = 0
  while (listened(day)) {
    count++
    day -= DAY_MS
  }
  return count
}

// `days` = 0 means all time.
export function stats(days: number) {
  const all = playsSince(0)
  const since = days ? Date.now() - days * DAY_MS : (all[0]?.playedAt ?? Date.now())
  const plays = all.filter((p) => p.playedAt >= since)
  const counted = plays.filter((p) => !p.skipped)

  // Every day of the range, including silent ones, so the chart has no gaps (at most a year).
  const daily = new Map<string, number>()
  for (let ts = Math.max(since, Date.now() - 365 * DAY_MS); ts <= Date.now(); ts += DAY_MS) daily.set(dayKey(ts), 0)
  daily.set(dayKey(Date.now()), daily.get(dayKey(Date.now())) ?? 0)
  const byHour = Array.from({ length: 24 }, () => 0)
  for (const p of plays) {
    const key = dayKey(p.playedAt)
    if (daily.has(key)) daily.set(key, daily.get(key)! + p.listened)
    byHour[new Date(p.playedAt).getHours()] += p.listened
  }

  const tracks = new Map<string, { id: string; title: string; artist: string | null; thumb: string | null; plays: number; seconds: number }>()
  const artists = new Map<string, { artist: string; plays: number; seconds: number }>()
  for (const p of counted) {
    // Deleted tracks still count in the totals, but can't be listed.
    if (!p.title) continue
    const t = tracks.get(p.trackId) ?? { id: p.trackId, title: p.title, artist: p.artist, thumb: p.thumb, plays: 0, seconds: 0 }
    t.plays++
    t.seconds += p.listened
    tracks.set(p.trackId, t)
    for (const name of (p.artist ?? '').split(', ').filter(Boolean)) {
      const a = artists.get(name) ?? { artist: name, plays: 0, seconds: 0 }
      a.plays++
      a.seconds += p.listened
      artists.set(name, a)
    }
  }

  const skips = new Map<string, { id: string; title: string; artist: string | null; thumb: string | null; skips: number }>()
  for (const p of plays) {
    if (!p.skipped || !p.title) continue
    const s = skips.get(p.trackId) ?? { id: p.trackId, title: p.title, artist: p.artist, thumb: p.thumb, skips: 0 }
    s.skips++
    skips.set(p.trackId, s)
  }

  return {
    totalSeconds: plays.reduce((sum, p) => sum + p.listened, 0),
    plays: counted.length,
    skips: plays.length - counted.length,
    uniqueTracks: new Set(counted.map((p) => p.trackId)).size,
    streak: streak(all),
    daily: [...daily].map(([day, seconds]) => ({ day, seconds })),
    byHour,
    topTracks: top(tracks),
    topArtists: top(artists),
    // Skipped at least twice: candidates for deletion.
    mostSkipped: [...skips.values()].filter((s) => s.skips >= 2).sort((a, b) => b.skips - a.skips).slice(0, 5),
  }
}
