import type { SmartView } from '@/components/Sidebar'
import type { Playlist, Track } from '@/lib/api'

export type Sort = 'added' | 'artist' | 'title' | 'plays' | 'custom'
export const SORT_LABELS: Record<Sort, string> = {
  added: 'Дата добавления',
  artist: 'Исполнитель',
  title: 'Название',
  plays: 'Сколько слушал',
  custom: 'Свой порядок',
}
const collator = new Intl.Collator('ru', { sensitivity: 'base', numeric: true })

export const DAY_MS = 24 * 60 * 60 * 1000
const TOP_SIZE = 100
const STALE_DAYS = 30

export const artistsOf = (t: Track) => (t.artist ?? '').split(', ').filter(Boolean)

// Fisher–Yates; `first` (the playing track) stays at the front, tracks matching `later` go last.
export function shuffled(ids: string[], first?: string, later?: (id: string) => boolean) {
  const rest = ids.filter((id) => id !== first)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  const ordered = later ? [...rest.filter((id) => !later(id)), ...rest.filter(later)] : rest
  return first ? [first, ...ordered] : ordered
}

const isStale = (t: Track) => t.lastPlayed != null && t.lastPlayed < Date.now() - STALE_DAYS * DAY_MS

type ViewSource = {
  tracks: Track[]
  trackById: Map<string, Track>
  playlist?: Playlist
  smart: SmartView | null
  artistName: string | null
  sort: Sort
}

// Tracks of the open view, sorted. "Top" and "stale" have their own order and ignore `sort`.
export function tracksOfView({ tracks, trackById, playlist, smart, artistName, sort }: ViewSource): Track[] {
  if (smart === 'top')
    return tracks
      .filter((t) => t.playCount > 0)
      .sort((a, b) => b.playCount - a.playCount || (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
      .slice(0, TOP_SIZE)
  if (smart === 'stale') return tracks.filter(isStale).sort((a, b) => a.lastPlayed! - b.lastPlayed!)
  // Each track with the date it was added to this view.
  let entries = playlist
    ? playlist.tracks.flatMap((pt) => {
        const t = trackById.get(pt.id)
        return t ? [{ track: t, addedAt: pt.addedAt, position: pt.position }] : []
      })
    : tracks.map((t) => ({ track: t, addedAt: t.addedAt, position: t.position }))
  if (smart === 'never') entries = entries.filter((e) => e.track.playCount === 0)
  if (artistName) entries = entries.filter((e) => artistsOf(e.track).includes(artistName))
  type Entry = (typeof entries)[0]
  const by = {
    added: (a: Entry, b: Entry) => b.addedAt - a.addedAt,
    title: (a: Entry, b: Entry) => collator.compare(a.track.title, b.track.title),
    artist: (a: Entry, b: Entry) =>
      collator.compare(a.track.artist ?? '', b.track.artist ?? '') || collator.compare(a.track.title, b.track.title),
    plays: (a: Entry, b: Entry) =>
      b.track.playCount - a.track.playCount || (b.track.lastPlayed ?? 0) - (a.track.lastPlayed ?? 0),
    // Dragged order; tracks added since then (no position yet) go on top, newest first.
    custom: (a: Entry, b: Entry) => (a.position ?? -Infinity) - (b.position ?? -Infinity) || b.addedAt - a.addedAt,
  }[sort]
  return entries.sort(by).map((e) => e.track)
}

export function smartCounts(tracks: Track[]): Record<SmartView, number> {
  return {
    top: Math.min(TOP_SIZE, tracks.filter((t) => t.playCount > 0).length),
    stale: tracks.filter(isStale).length,
    never: tracks.filter((t) => t.playCount === 0).length,
  }
}
