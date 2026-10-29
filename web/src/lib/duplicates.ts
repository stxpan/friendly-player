import type { Track } from '@/lib/api'

// Same song downloaded twice: from a Yandex import and a direct link, or two uploads of it.
// "Remix", "Live" and the like are kept in the title on purpose — those are different recordings.

const DURATION_TOLERANCE = 10

const NOISE =
  /\((?:feat|ft|prod|official|video|audio|lyrics?|клип|премьера)[^)]*\)|\[[^\]]*\]|official\s+(?:music\s+)?video|lyric\s+video/gi

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(NOISE, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

// Direct uploads are often titled "Artist - Song" with the channel as the artist.
function parts(t: Track) {
  const dash = t.title.lastIndexOf(' - ')
  const title = dash === -1 ? t.title : t.title.slice(dash + 3)
  const credit = `${t.artist ?? ''} ${dash === -1 ? '' : t.title.slice(0, dash)}`
  return { title: normalize(title), credit: normalize(credit) }
}

const sameArtist = (a: string, b: string) => {
  const main = (s: string) => s.split(' ')[0]
  return !a || !b || a.includes(main(b)) || b.includes(main(a))
}

export function findDuplicates(tracks: Track[]): Track[][] {
  const byTitle = new Map<string, { track: Track; credit: string }[]>()
  for (const track of tracks) {
    const { title, credit } = parts(track)
    if (!title) continue
    byTitle.set(title, [...(byTitle.get(title) ?? []), { track, credit }])
  }

  const groups: Track[][] = []
  for (const candidates of byTitle.values()) {
    if (candidates.length < 2) continue
    const used = new Set<string>()
    for (const a of candidates) {
      if (used.has(a.track.id)) continue
      const group = candidates.filter(
        (b) =>
          !used.has(b.track.id) &&
          Math.abs((a.track.duration ?? 0) - (b.track.duration ?? 0)) <= DURATION_TOLERANCE &&
          sameArtist(a.credit, b.credit),
      )
      if (group.length > 1) {
        group.forEach((g) => used.add(g.track.id))
        groups.push(group.map((g) => g.track))
      }
    }
  }
  return groups
}
