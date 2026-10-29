import { Innertube, YTNodes } from 'youtubei.js'

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

export function innertube() {
  client ??= Innertube.create({ retrieve_player: false })
  return client
}

type Song = YTNodes.MusicResponsiveListItem
type Page = Awaited<ReturnType<Innertube['music']['search']>> | Awaited<ReturnType<SearchContinuation['getContinuation']>>
type SearchContinuation = Awaited<ReturnType<Awaited<ReturnType<Innertube['music']['search']>>['getContinuation']>>

// Pages of a search the user may scroll to, kept between requests; the oldest are dropped.
const pages = new Map<string, Page>()
const MAX_PAGES = 50

const toResult = (s: Song): SearchResult => ({
  id: s.id!,
  title: s.title ?? s.id!,
  artist: (s.artists ?? []).map((a) => a.name).join(', '),
  duration: s.duration?.seconds ?? null,
  thumb: s.thumbnails?.[0]?.url ?? null,
})

function songsOf(page: Page): Song[] {
  const shelf = 'songs' in page ? page.songs : page.contents
  return (shelf?.contents ?? []).flatMap((s) => (s.is(YTNodes.MusicResponsiveListItem) && s.id ? [s] : []))
}

export async function searchMusic(query: string): Promise<SearchResult[]> {
  return songsOf(await (await innertube()).music.search(query, { type: 'song' })).map(toResult)
}

// For infinite scroll: a page of results plus a token for the next one (null at the end).
export type SearchPage = { results: SearchResult[]; more: string | null }

function toPage(page: Page): SearchPage {
  let more: string | null = null
  if (page.has_continuation) {
    more = crypto.randomUUID()
    pages.set(more, page)
    if (pages.size > MAX_PAGES) pages.delete(pages.keys().next().value!)
  }
  return { results: songsOf(page).map(toResult), more }
}

export async function searchFirst(query: string): Promise<SearchPage> {
  return toPage(await (await innertube()).music.search(query, { type: 'song' }))
}

export async function searchMore(more: string): Promise<SearchPage | null> {
  const page = pages.get(more)
  if (!page) return null
  pages.delete(more)
  return toPage(await page.getContinuation())
}

// "Radio" for a track: YouTube Music's endless up-next mix, starting with the track itself.
export async function radio(videoId: string): Promise<SearchResult[]> {
  const panel = await (await innertube()).music.getUpNext(videoId, true)
  return panel.contents.filterType(YTNodes.PlaylistPanelVideo).map((v) => ({
    id: v.video_id,
    title: v.title.toString(),
    artist: (v.artists ?? []).map((a) => a.name).join(', '),
    duration: v.duration?.seconds ?? null,
    thumb: v.thumbnail?.[0]?.url ?? null,
  }))
}
