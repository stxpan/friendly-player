import { Innertube } from 'youtubei.js'

export type SearchResult = {
  id: string
  title: string
  artist: string
  duration: number | null
  thumb: string | null
}

// yt-dlp needs ~10s to return artist/duration for search hits; the YouTube Music
// web API answers in well under a second, so search goes through youtubei.js.
let client: Promise<Innertube> | undefined

export async function searchMusic(query: string): Promise<SearchResult[]> {
  client ??= Innertube.create({ retrieve_player: false })
  const res = await (await client).music.search(query, { type: 'song' })
  return (res.songs?.contents ?? [])
    .filter((s) => s.id)
    .map((s) => ({
      id: s.id!,
      title: s.title ?? s.id!,
      artist: (s.artists ?? []).map((a) => a.name).join(', '),
      duration: s.duration?.seconds ?? null,
      thumb: s.thumbnails?.[0]?.url ?? null,
    }))
}
