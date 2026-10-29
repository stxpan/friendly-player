import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpDown, Download, Search, Shuffle, X } from 'lucide-react'
import { toast } from 'sonner'
import { DeleteDialog } from '@/components/DeleteDialog'
import { Downloads } from '@/components/Downloads'
import { FormDialog, type FormDialogProps } from '@/components/FormDialog'
import { Lyrics } from '@/components/Lyrics'
import { Player, type DownloadState, type RepeatMode } from '@/components/Player'
import { SearchResults } from '@/components/SearchResults'
import { Duplicates } from '@/components/Duplicates'
import { SMART_VIEWS, Sidebar, type View } from '@/components/Sidebar'
import { Settings, type ClientSettings } from '@/components/Settings'
import { Stats } from '@/components/Stats'
import { TrackRow } from '@/components/TrackRow'
import { VirtualList } from '@/components/VirtualList'
import { YtdlpUpdate } from '@/components/YtdlpUpdate'
import { arrayMove } from '@dnd-kit/sortable'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Toaster } from '@/components/ui/sonner'
import { api, coverUrl, fromResult, fromTrack, type Job, type NowPlaying, type Playlist, type SearchResult, type Track } from '@/lib/api'
import { findDuplicates } from '@/lib/duplicates'
import { dedupeResults, matcher } from '@/lib/search'
import { cn } from '@/lib/utils'
import { load, save } from '@/lib/storage'

const SEARCH_DEBOUNCE_MS = 400

type Sort = 'added' | 'artist' | 'title' | 'plays' | 'custom'
const SORT_LABELS: Record<Sort, string> = {
  added: 'Дата добавления',
  artist: 'Исполнитель',
  title: 'Название',
  plays: 'Сколько слушал',
  custom: 'Свой порядок',
}
const collator = new Intl.Collator('ru', { sensitivity: 'base', numeric: true })

const DAY_MS = 24 * 60 * 60 * 1000
// How many tracks before the end of a radio mix more are fetched.
const RADIO_REFILL_AT = 5
const TOP_SIZE = 100
const STALE_DAYS = 30
const RECENT_DAYS = 3

const EMPTY_NOTES = {
  all: 'Библиотека пуста — найди трек или добавь ссылку в «Загрузках»',
  playlist: 'Плейлист пуст — добавь треки через «⋯» → «Добавить в плейлист»',
  top: 'Пока пусто — здесь появятся треки, которые слушаешь чаще всего',
  stale: 'Пока пусто — здесь появятся треки, которые не слушал больше месяца',
  never: 'Ты слушал всё, что есть в библиотеке',
}

const PAGE_TITLES: Partial<Record<string, string>> = { stats: 'Статистика', duplicates: 'Дубликаты', radio: 'Радио', settings: 'Настройки' }

const artistsOf = (t: Track) => (t.artist ?? '').split(', ').filter(Boolean)

// One button cycles through the modes: off → repeat track → repeat list.
const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = { off: 'one', one: 'all', all: 'off' }

// Fisher–Yates; `first` (the playing track) stays at the front, tracks matching `later` go last.
function shuffled(ids: string[], first?: string, later?: (id: string) => boolean) {
  const rest = ids.filter((id) => id !== first)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  const ordered = later ? [...rest.filter((id) => !later(id)), ...rest.filter(later)] : rest
  return first ? [first, ...ordered] : ordered
}

type Row =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'note'; key: string; text: string }
  | { kind: 'track'; track: Track; list: string[] }
  | { kind: 'results' }

const rowKey = (r: Row) => (r.kind === 'track' ? r.track.id : r.kind === 'results' ? 'results' : r.key)
const rowSize = (r: Row) => ({ track: 56, header: 32, note: 44, results: 400 })[r.kind]

export default function App() {
  const [tracks, setTracks] = useState<Track[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [view, setView] = useState<View>(() => load('player.view', 'all'))
  const [sort, setSort] = useState<Sort>(() => load('player.sort', 'added'))
  const [currentId, setCurrentId] = useState(() => load<string | null>('player.trackId', null))
  // The list playback started from, in its own order; `queue` is the order it actually plays in
  // (the same list, or a shuffled copy). A fixed order lets the next track be prepared in advance.
  const [queueSource, setQueueSource] = useState<string[]>(() => load('player.queueSource', []))
  const [queue, setQueue] = useState<string[]>(() => load('player.queue', []))
  const [shuffle, setShuffle] = useState(() => load('player.shuffle', false))
  // Which list on screen (view + search) the current mix was made from; that list is then shown
  // in playback order instead of the chosen sort.
  const [mixKey, setMixKey] = useState<string | null>(() => load('player.mixKey', null))
  const [repeat, setRepeat] = useState<RepeatMode>(() => load('player.repeat', 'off'))
  const [lyricsOpen, setLyricsOpen] = useState(() => load('player.panel', null) === 'lyrics')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  // Token for the next page of YouTube Music results, and the request of the current search.
  const [more, setMore] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const searchCtrl = useRef<AbortController | null>(null)
  const [downloadsOpen, setDownloadsOpen] = useState(false)
  // Failed import the user is picking a replacement for in search results.
  const [fixing, setFixing] = useState<Job | null>(null)
  // A YouTube Music result playing without being downloaded, and the results it was picked from.
  // `radio` holds the seed track's title when the list is a radio mix rather than search results.
  const [stream, setStream] = useState<{ result: SearchResult; list: SearchResult[]; radio?: string } | null>(null)
  const [dialog, setDialog] = useState<FormDialogProps | null>(null)
  const [deleting, setDeleting] = useState<Track | null>(null)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [clientSettings, setClientSettings] = useState<ClientSettings>(() => ({
    // Older versions stored the opposite flag.
    confirmDelete: !load('player.deleteWithoutConfirm', false),
    normalize: load('player.normalize', true),
    menuSide: load<'left' | 'right'>('player.menuSide', 'left'),
  }))
  useEffect(() => {
    save('player.deleteWithoutConfirm', !clientSettings.confirmDelete)
    save('player.normalize', clientSettings.normalize)
    save('player.menuSide', clientSettings.menuSide)
  }, [clientSettings])
  const completed = useRef(0)
  const audio = useRef<HTMLAudioElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)

  const loadTracks = useCallback(() => {
    api.tracks().then(setTracks).catch((e) => toast.error(e.message))
  }, [])
  const loadPlaylists = useCallback(() => {
    api.playlists().then(setPlaylists).catch((e) => toast.error(e.message))
  }, [])

  useEffect(loadTracks, [loadTracks])
  useEffect(loadPlaylists, [loadPlaylists])

  useEffect(() => save('player.trackId', currentId), [currentId])
  useEffect(() => save('player.queue', queue), [queue])
  useEffect(() => save('player.queueSource', queueSource), [queueSource])
  useEffect(() => save('player.view', view), [view])
  useEffect(() => save('player.sort', sort), [sort])
  useEffect(() => save('player.shuffle', shuffle), [shuffle])
  useEffect(() => save('player.mixKey', mixKey), [mixKey])
  useEffect(() => save('player.repeat', repeat), [repeat])
  useEffect(() => save('player.panel', lyricsOpen ? 'lyrics' : null), [lyricsOpen])

  useEffect(() => {
    const id = setInterval(async () => {
      const q = await api.queue().catch(() => null)
      if (!q) return
      setJobs(q.jobs)
      if (q.completed !== completed.current) {
        completed.current = q.completed
        loadTracks()
        // Imports into a playlist fill it as tracks are found.
        loadPlaylists()
      }
    }, 1000)
    return () => clearInterval(id)
  }, [loadTracks, loadPlaylists])

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  // "/" jumps to search. Checked by physical key, so it works in any layout (in Russian it types ".").
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const slash = (e.code === 'Slash' || e.code === 'NumpadDivide') && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey
      if (!slash || (e.target as HTMLElement).closest('input, textarea, [role="dialog"]')) return
      e.preventDefault()
      searchInput.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const q = query.trim()
  const artistName = typeof view === 'string' && view.startsWith('artist:') ? view.slice('artist:'.length) : null
  // On an artist page YouTube Music is searched for the artist even with an empty search box.
  const ytQuery = q || artistName || ''

  useEffect(() => {
    setResults([])
    setMore(null)
    setLoadingMore(false)
    if (!ytQuery) return
    setSearching(true)
    const ctrl = new AbortController()
    searchCtrl.current = ctrl
    const timer = setTimeout(() => {
      api
        .search(ytQuery, ctrl.signal)
        .then((page) => {
          setResults(page.results)
          setMore(page.more)
        })
        .catch((e) => {
          if (e.name !== 'AbortError') toast.error(e.message)
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setSearching(false)
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [ytQuery])

  const loadMore = () => {
    const ctrl = searchCtrl.current
    if (!more || loadingMore || !ctrl) return
    setLoadingMore(true)
    api
      .searchMore(more, ctrl.signal)
      .then((page) => {
        setResults((cur) => {
          const seen = new Set(cur.map((r) => r.id))
          return [...cur, ...page.results.filter((r) => !seen.has(r.id))]
        })
        setMore(page.more)
      })
      .catch((e) => {
        if (e.name === 'AbortError') return
        // Stop here rather than retrying on every scroll.
        setMore(null)
        toast.error(e.message)
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoadingMore(false)
      })
  }

  const trackById = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks])
  const shownResults = useMemo(() => dedupeResults(results, (id) => trackById.has(id)), [results, trackById])
  const playlist = typeof view === 'number' ? playlists.find((p) => p.id === view) : undefined
  const smart = view === 'top' || view === 'stale' || view === 'never' ? view : null
  // These lists have their own meaningful order; the sort menu is hidden for them.
  const fixedOrder = smart === 'top' || smart === 'stale'

  // Tracks of the open view with the date they were added to it, sorted.
  const viewTracks = useMemo(() => {
    if (smart === 'top')
      return tracks
        .filter((t) => t.playCount > 0)
        .sort((a, b) => b.playCount - a.playCount || (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
        .slice(0, TOP_SIZE)
    if (smart === 'stale') {
      const cutoff = Date.now() - STALE_DAYS * DAY_MS
      return tracks.filter((t) => t.lastPlayed != null && t.lastPlayed < cutoff).sort((a, b) => a.lastPlayed! - b.lastPlayed!)
    }
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
      custom: (a: Entry, b: Entry) =>
        (a.position ?? -Infinity) - (b.position ?? -Infinity) || b.addedAt - a.addedAt,
    }[sort]
    return entries.sort(by).map((e) => e.track)
  }, [smart, artistName, playlist, tracks, trackById, sort])

  const smartCounts = useMemo(() => {
    const cutoff = Date.now() - STALE_DAYS * DAY_MS
    return {
      top: Math.min(TOP_SIZE, tracks.filter((t) => t.playCount > 0).length),
      stale: tracks.filter((t) => t.lastPlayed != null && t.lastPlayed < cutoff).length,
      never: tracks.filter((t) => t.playCount === 0).length,
    }
  }, [tracks])

  const duplicates = useMemo(() => findDuplicates(tracks), [tracks])

  // Smart shuffle: tracks heard in the last few days go to the end of a new mix.
  const recentlyPlayed = (id: string) => (trackById.get(id)?.lastPlayed ?? 0) > Date.now() - RECENT_DAYS * DAY_MS

  // A stream entry that's already downloaded plays from the local file (normalized, offline-safe).
  const playable = (r: SearchResult) => {
    const local = trackById.get(r.id)
    return local ? fromTrack(local) : fromResult(r)
  }
  const libraryTrack = currentId ? trackById.get(currentId) : undefined
  let current: NowPlaying | null = null
  if (stream) current = playable(stream.result)
  else if (libraryTrack) current = fromTrack(libraryTrack)

  // --- playback ---

  // Without internet only downloaded tracks can play.
  const available = (id: string) => online || Boolean(trackById.get(id)?.file)

  // The next playable id in `ids` from position `from`, wrapping around when repeating the list;
  // unavailable (online-only while offline) tracks are skipped.
  const neighbour = (ids: string[], from: number, delta: 1 | -1) => {
    const n = ids.length
    for (let k = 1; k <= n; k++) {
      let j = from + delta * k
      if (j < 0 || j >= n) {
        if (repeat !== 'all') return undefined
        j = ((j % n) + n) % n
      }
      if (ids[j] !== ids[from] && available(ids[j])) return ids[j]
    }
    return undefined
  }

  const go = (id: string) => {
    if (!available(id)) return void toast.error('Нет интернета, а этот трек не скачан')
    setStream(null)
    setCurrentId(id)
  }

  // Streamed tracks play through the search results they were picked from.
  const stepStream = (s: NonNullable<typeof stream>, delta: 1 | -1) => {
    const ids = s.list.map((r) => r.id)
    const n = s.list.length
    const at = ids.indexOf(s.result.id)
    const i = at + delta
    const id = neighbour(ids, at, delta)
    if (id) setStream({ ...s, result: s.list[ids.indexOf(id)] })
    // Radio is endless: near the end, extend the mix from its last track.
    if (s.radio && delta > 0 && i >= n - RADIO_REFILL_AT) {
      api
        .radio(s.list[n - 1].id)
        .then((more) =>
          setStream((cur) => {
            if (!cur?.radio) return cur
            const seen = new Set(cur.list.map((r) => r.id))
            return { ...cur, list: [...cur.list, ...more.filter((r) => !seen.has(r.id))] }
          }),
        )
        .catch(() => {})
    }
  }

  const startRadio = async (seed: { id: string; title: string }) => {
    try {
      const list = await api.radio(seed.id)
      if (!list.length) return toast.error('YouTube Music не нашёл похожих треков')
      // The mix starts with the seed itself; if it's already playing, it just carries on into the radio.
      setStream({ result: list[0], list, radio: seed.title })
      setQuery('')
      setView('radio')
      toast.success(`Радио по «${seed.title}»`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // Put a library track right after the one playing, in whichever list is playing now.
  const playNext = (t: Track) => {
    if (stream) {
      const asResult: SearchResult = {
        id: t.id,
        title: t.title,
        artist: t.artist ?? '',
        duration: t.duration,
        thumb: coverUrl(t.thumb),
      }
      const rest = stream.list.filter((r) => r.id !== t.id)
      const at = rest.findIndex((r) => r.id === stream.result.id) + 1
      setStream({ ...stream, list: [...rest.slice(0, at), asResult, ...rest.slice(at)] })
    } else {
      const rest = queueIds.filter((id) => id !== t.id)
      const at = currentId ? rest.indexOf(currentId) + 1 : 0
      setQueue([...rest.slice(0, at), t.id, ...rest.slice(at)])
    }
    toast.success(`«${t.title}» заиграет следующим`)
  }

  const play = (id: string, list: string[]) => {
    // Clicked inside the mix on screen: jump to that track and keep the mix's order.
    if (mixed) return go(id)
    setQueueSource(list)
    setQueue(shuffle ? shuffled(list, id, recentlyPlayed) : list)
    setMixKey(listKey)
    go(id)
  }

  // Shuffle builds a mix of what's on screen: the open list, or the library tracks found by search.
  // The playing track stays first if it's part of it; otherwise the mix starts right away.
  const toggleShuffle = () => {
    if (shuffle) {
      setShuffle(false)
      if (queueSource.length) setQueue(queueSource)
      return
    }
    setShuffle(true)
    const source = visibleTracks.map((t) => t.id)
    if (!source.length) return
    const keep = !stream && currentId && source.includes(currentId) ? currentId : undefined
    const mix = shuffled(source, keep, recentlyPlayed)
    setQueueSource(source)
    setQueue(mix)
    setMixKey(listKey)
    if (!keep) go(mix[0])
  }

  // Picking a sort order means the user wants that order back, not the mix.
  const changeSort = (s: Sort) => {
    setSort(s)
    if (mixed) toggleShuffle()
  }

  // Dragging a track. In the mix it only reorders the mix; otherwise it changes the list's own
  // order for good (saved as "Свой порядок"), and playback from this list follows it.
  const moveTrack = (activeId: string, overId: string) => {
    const ids = visibleTracks.map((t) => t.id)
    const next = arrayMove(ids, ids.indexOf(activeId), ids.indexOf(overId))
    if (mixKey === listKey) {
      setQueue(next)
      if (!shuffle) setQueueSource(next)
    }
    if (mixed) return
    setSort('custom')
    const position = new Map(next.map((id, i) => [id, i]))
    if (playlist) {
      setPlaylists((all) =>
        all.map((p) =>
          p.id !== playlist.id
            ? p
            : { ...p, tracks: p.tracks.map((pt) => ({ ...pt, position: position.get(pt.id) ?? pt.position })) },
        ),
      )
    } else {
      setTracks((all) => all.map((t) => ({ ...t, position: position.get(t.id) ?? t.position })))
    }
    api.saveOrder(playlist?.id ?? null, next).catch((e) => toast.error(e.message))
  }

  const queueIds = useMemo(() => {
    const ids = queue.filter((id) => trackById.has(id))
    return ids.length ? ids : viewTracks.map((t) => t.id)
  }, [queue, trackById, viewTracks])

  const step = (delta: 1 | -1) => {
    if (stream) return stepStream(stream, delta)
    const id = neighbour(queueIds, currentId ? queueIds.indexOf(currentId) : -1, delta)
    if (id) go(id)
  }
  const next = () => step(1)
  const prev = () => step(-1)

  // While lyrics are open, have the server time the next track's lyrics before it starts.
  const nextId = !stream && currentId ? neighbour(queueIds, queueIds.indexOf(currentId), 1) : undefined
  useEffect(() => {
    if (lyricsOpen && nextId) api.prepareLyrics(nextId).catch(() => {})
  }, [lyricsOpen, nextId])

  // An online track takes a few seconds to start (the server asks yt-dlp for the stream);
  // ask ahead for the next one so switching is instant.
  const upcomingId = stream ? neighbour(stream.list.map((r) => r.id), stream.list.findIndex((r) => r.id === stream.result.id), 1) : nextId
  const upcomingOnline = upcomingId !== undefined && !trackById.get(upcomingId)?.file
  useEffect(() => {
    if (online && upcomingId && upcomingOnline) api.prepareStream(upcomingId).catch(() => {})
  }, [online, upcomingId, upcomingOnline])

  // --- track actions ---

  const removeNow = async (track: Track) => {
    try {
      await api.deleteTrack(track.id)
      if (track.id === currentId) setCurrentId(null)
      loadTracks()
      loadPlaylists()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // Asks first, unless the user ticked "delete without confirmation" once.
  const remove = (track: Track) => {
    if (!clientSettings.confirmDelete) void removeNow(track)
    else setDeleting(track)
  }

  const copyLink = async (track: Track) => {
    await navigator.clipboard.writeText(`https://www.youtube.com/watch?v=${track.id}`)
    toast.success('Ссылка скопирована')
  }

  const rename = (track: Track) =>
    setDialog({
      title: 'Переименовать трек',
      submitLabel: 'Сохранить',
      fields: [
        { name: 'title', label: 'Название', value: track.title },
        { name: 'artist', label: 'Исполнитель', value: track.artist ?? '' },
      ],
      onSubmit: async (v) => {
        await api.renameTrack(track.id, v.title, v.artist)
        loadTracks()
      },
    })

  const togglePlaylist = async (p: Playlist, track: Track, add: boolean) => {
    try {
      if (add) await api.addToPlaylist(p.id, track.id)
      else await api.removeFromPlaylist(p.id, track.id)
      toast.success(add ? `Добавлено в «${p.name}»` : `Убрано из «${p.name}»`)
      loadPlaylists()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // --- playlists ---

  const createPlaylist = () =>
    setDialog({
      title: 'Новый плейлист',
      submitLabel: 'Создать',
      fields: [{ name: 'name', label: 'Название', value: '' }],
      onSubmit: async (v) => {
        const { id } = await api.createPlaylist(v.name)
        loadPlaylists()
        setView(id)
      },
    })

  const renamePlaylist = (p: Playlist) =>
    setDialog({
      title: 'Переименовать плейлист',
      submitLabel: 'Сохранить',
      fields: [{ name: 'name', label: 'Название', value: p.name }],
      onSubmit: async (v) => {
        await api.renamePlaylist(p.id, v.name)
        loadPlaylists()
      },
    })

  const deletePlaylist = (p: Playlist) =>
    setDialog({
      title: `Удалить плейлист «${p.name}»? Треки останутся в библиотеке.`,
      submitLabel: 'Удалить',
      fields: [],
      onSubmit: async () => {
        await api.deletePlaylist(p.id)
        if (view === p.id) setView('all')
        loadPlaylists()
      },
    })

  // --- search & downloads ---

  const fix = (job: Job) => {
    setFixing(job)
    setQuery(job.search?.query ?? job.title)
    setDownloadsOpen(false)
  }

  // "+" on a search result: into the library as an online track (nothing downloaded).
  const addResult = async (r: SearchResult) => {
    try {
      if (fixing) {
        await api.resolveJob(fixing.id, r.id)
        toast.success(`Добавляем замену для «${fixing.title}»`)
        setFixing(null)
        setQuery('')
      } else {
        await api.addTrack(r)
        toast.success(`«${r.title}» в библиотеке`)
        loadTracks()
      }
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const download = async (ids: string[]) => {
    try {
      const { queued } = await api.downloadTracks(ids)
      if (queued > 1) toast.success(`Скачиваем: ${queued}`)
      // Job ids differ from track ids; the poll brings the new jobs in.
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // "Download" on a streamed result: add it to the library and fetch the file right away.
  const downloadResult = async (r: SearchResult) => {
    try {
      await api.addTrack(r)
      loadTracks()
      await download([r.id])
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // --- list ---

  const needle = q.toLowerCase()
  const libraryIds = new Set(trackById.keys())
  const downloadingIds = new Set(
    jobs.filter((j) => j.kind === 'download' && j.status !== 'error').map((j) => j.videoId),
  )
  // ✓ downloaded, spinner while the file is coming, otherwise online-only.
  const downloadState = (id: string): DownloadState => {
    if (trackById.get(id)?.file) return 'done'
    return downloadingIds.has(id) ? 'queued' : 'none'
  }
  let viewName = 'Все треки'
  if (playlist) viewName = playlist.name
  else if (artistName) viewName = artistName
  else if (smart) viewName = SMART_VIEWS[smart].label
  // Statistics and duplicates are their own pages; typing a search switches back to the list.
  let page: 'list' | 'stats' | 'duplicates' | 'radio' | 'settings' = 'list'
  if (!needle && (view === 'stats' || view === 'duplicates' || view === 'settings')) page = view
  else if (!needle && view === 'radio' && stream?.radio) page = 'radio'


  const openArtist = (name: string) => {
    setQuery('')
    setView(`artist:${name}`)
  }

  const listKey = `${view}|${needle}`
  const mixed = shuffle && mixKey === listKey

  // Library tracks on screen: the open view, narrowed by search; in playback order when it's the mix.
  const visibleTracks = useMemo(() => {
    const matches = matcher(needle)
    const list = needle ? viewTracks.filter((t) => matches(`${t.title} ${t.artist ?? ''}`)) : viewTracks
    if (!mixed) return list
    const position = new Map(queue.map((id, i) => [id, i]))
    return [...list].sort((a, b) => (position.get(a.id) ?? Infinity) - (position.get(b.id) ?? Infinity))
  }, [needle, viewTracks, mixed, queue])

  // Online-only tracks in the list on screen that "Download all" would fetch.
  const toDownload = page === 'list' ? visibleTracks.filter((t) => !t.file && !downloadingIds.has(t.id)) : []

  // Dragging works where the order is the user's to set: the whole library or a playlist, unfiltered.
  const canDrag = page === 'list' && !needle && !artistName && !smart && (view === 'all' || Boolean(playlist))

  const rows = useMemo<Row[]>(() => {
    const toRows = (list: Track[]): Row[] => {
      const ids = list.map((t) => t.id)
      return list.map((track) => ({ kind: 'track', track, list: ids }))
    }
    // Artist pages always show what YouTube Music has by them, under the library tracks.
    if (!needle && !artistName) {
      if (visibleTracks.length) return toRows(visibleTracks)
      return [{ kind: 'note', key: 'empty', text: EMPTY_NOTES[smart ?? (playlist ? 'playlist' : 'all')] }]
    }
    return [
      { kind: 'header', key: 'h-lib', label: playlist ? `В плейлисте «${playlist.name}»` : 'В библиотеке' },
      ...(visibleTracks.length
        ? toRows(visibleTracks)
        : [{ kind: 'note', key: 'no-lib', text: 'Ничего не найдено' } as Row]),
      { kind: 'header', key: 'h-yt', label: artistName && !needle ? 'На YouTube Music' : 'YouTube Music' },
      { kind: 'results' },
    ]
  }, [needle, artistName, smart, visibleTracks, playlist])

  const renderRow = (row: Row) => {
    switch (row.kind) {
      case 'header':
        return <h2 className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground uppercase">{row.label}</h2>
      case 'note':
        return <p className="px-2 py-3 text-sm text-muted-foreground">{row.text}</p>
      case 'results':
        return (
          <SearchResults
            results={shownResults}
            loading={searching}
            onLoadMore={more ? loadMore : undefined}
            loadingMore={loadingMore}
            playingId={stream?.result.id ?? null}
            inLibrary={(id) => libraryIds.has(id)}
            onPlay={(r) => setStream({ result: r, list: shownResults })}
            onAdd={addResult}
          />
        )
      case 'track': {
        const t = row.track
        return (
          <div className="pb-1">
            <TrackRow
              track={t}
              active={!stream && t.id === currentId}
              download={downloadState(t.id)}
              onDownload={() => download([t.id])}
              unavailable={!available(t.id)}
              playlists={playlists}
              onPlay={() => play(t.id, row.list)}
              onRemove={() => remove(t)}
              onRename={() => rename(t)}
              onCopyLink={() => copyLink(t)}
              onOpenArtist={openArtist}
              onPlayNext={() => playNext(t)}
              onRadio={() => startRadio(t)}
              onTogglePlaylist={(p, add) => togglePlaylist(p, t, add)}
              onRemoveFromPlaylist={playlist ? () => togglePlaylist(playlist, t, false) : undefined}
            />
          </div>
        )
      }
    }
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Menu on the right: the row is mirrored, so lyrics end up on the left. */}
      <div className={cn('flex min-h-0 flex-1', clientSettings.menuSide === 'right' && 'flex-row-reverse')}>
        <Sidebar
          side={clientSettings.menuSide}
          view={typeof view === 'number' && !playlist ? 'all' : view}
          trackCount={tracks.length}
          smartCounts={smartCounts}
          duplicateCount={duplicates.length}
          radioTitle={stream?.radio ?? null}
          playlists={playlists}
          onSelect={setView}
          onCreate={createPlaylist}
          onRename={renamePlaylist}
          onDelete={deletePlaylist}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex gap-2 border-b p-4">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInput}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setQuery('')
                    setFixing(null)
                    e.currentTarget.blur()
                  }
                }}
                placeholder="Поиск по библиотеке и YouTube Music  ( / )"
                className="pl-8"
              />
            </div>
            <Downloads
              jobs={jobs}
              open={downloadsOpen}
              onOpenChange={setDownloadsOpen}
              onFix={fix}
              playlists={playlists}
              onAdded={() => {
                loadTracks()
                loadPlaylists()
              }}
            />
          </header>

          <div className="flex h-11 items-center justify-between gap-2 px-4">
            {fixing ? (
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <span className="truncate">
                  Выбери замену для <span className="font-medium">«{fixing.title}»</span> — нажми ⬇ у нужного трека
                </span>
                <Button variant="ghost" size="icon-xs" onClick={() => setFixing(null)} title="Отменить">
                  <X />
                </Button>
              </div>
            ) : (
              <h1 className="truncate text-sm font-medium">
                {PAGE_TITLES[page] ?? viewName}
                {page === 'list' && <span className="font-normal text-muted-foreground"> · {viewTracks.length}</span>}
              </h1>
            )}
            {toDownload.length > 0 && (
              <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" onClick={() => download(toDownload.map((t) => t.id))}>
                <Download />
                Скачать всё ({toDownload.length})
              </Button>
            )}
            {page === 'list' && !fixedOrder && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-muted-foreground">
                    {mixed ? <Shuffle /> : <ArrowUpDown />}
                    {mixed ? 'Порядок воспроизведения' : SORT_LABELS[sort]}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-auto">
                  <DropdownMenuRadioGroup value={mixed ? '' : sort} onValueChange={(v) => changeSort(v as Sort)}>
                    {(Object.keys(SORT_LABELS) as Sort[]).map((s) => (
                      <DropdownMenuRadioItem key={s} value={s}>
                        {SORT_LABELS[s]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {page === 'settings' && (
            <Settings
              client={clientSettings}
              onClientChange={setClientSettings}
              onLibraryChanged={loadTracks}
            />
          )}
          {page === 'stats' && <Stats onPlay={(id) => play(id, [id])} onOpenArtist={openArtist} />}
          {page === 'radio' && stream && (
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              <SearchResults
                results={stream.list}
                loading={false}
                playingId={stream.result.id}
                inLibrary={(id) => libraryIds.has(id)}
                onPlay={(r) => setStream({ ...stream, result: r })}
                onAdd={addResult}
              />
            </div>
          )}
          {page === 'duplicates' && (
            <Duplicates
              groups={duplicates}
              currentId={stream ? null : currentId}
              onPlay={(t) => play(t.id, duplicates.find((g) => g.includes(t))!.map((g) => g.id))}
              onRemove={remove}
            />
          )}
          {page === 'list' && (
            <VirtualList
              key={`${view}|${needle ? 'search' : 'list'}|${mixed ? 'mix' : 'sorted'}`}
              className="min-h-0 flex-1 px-2 pb-2"
              items={rows}
              getKey={rowKey}
              estimateSize={rowSize}
              render={renderRow}
              sortable={canDrag ? { ids: visibleTracks.map((t) => t.id), onMove: moveTrack } : undefined}
            />
          )}
        </main>

        {lyricsOpen && <Lyrics tabs="Текст" side={clientSettings.menuSide === 'left' ? 'right' : 'left'} track={current} audio={audio} />}
      </div>

      <Player
        audio={audio}
        track={current}
        download={
          current && {
            state: downloadState(current.id),
            start: () => (stream && !trackById.has(stream.result.id) ? downloadResult(stream.result) : download([current.id])),
          }
        }
        shuffle={shuffle}
        onToggleShuffle={toggleShuffle}
        repeat={repeat}
        onCycleRepeat={() => setRepeat(NEXT_REPEAT[repeat])}
        lyricsOpen={lyricsOpen}
        onToggleLyrics={() => setLyricsOpen(!lyricsOpen)}
        onNext={next}
        onPrev={prev}
        onPlayRecorded={loadTracks}
        normalize={clientSettings.normalize}
      />
      {dialog && <FormDialog {...dialog} onClose={() => setDialog(null)} />}
      {deleting && (
        <DeleteDialog
          track={deleting}
          onConfirm={(dontAsk) => {
            if (dontAsk) setClientSettings((s) => ({ ...s, confirmDelete: false }))
            void removeNow(deleting)
          }}
          onClose={() => setDeleting(null)}
        />
      )}
      <YtdlpUpdate />
      <Toaster />
    </div>
  )
}
