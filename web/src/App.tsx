import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpDown, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { Downloads } from '@/components/Downloads'
import { FormDialog, type FormDialogProps } from '@/components/FormDialog'
import { Lyrics } from '@/components/Lyrics'
import { Player, type RepeatMode } from '@/components/Player'
import { SearchResults } from '@/components/SearchResults'
import { Sidebar, type View } from '@/components/Sidebar'
import { TrackRow } from '@/components/TrackRow'
import { VirtualList } from '@/components/VirtualList'
import { YtdlpUpdate } from '@/components/YtdlpUpdate'
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
import { api, type Job, type Playlist, type SearchResult, type Track } from '@/lib/api'
import { load, save } from '@/lib/storage'

const SEARCH_DEBOUNCE_MS = 400

type Sort = 'added' | 'artist' | 'title'
const SORT_LABELS: Record<Sort, string> = { added: 'Дата добавления', artist: 'Исполнитель', title: 'Название' }
const collator = new Intl.Collator('ru', { sensitivity: 'base', numeric: true })

// One button cycles through the modes: off → repeat track → repeat list.
const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = { off: 'one', one: 'all', all: 'off' }

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
  // The list playback started from; next/previous/shuffle stay within it.
  const [queue, setQueue] = useState<string[]>(() => load('player.queue', []))
  const [shuffle, setShuffle] = useState(() => load('player.shuffle', false))
  const [repeat, setRepeat] = useState<RepeatMode>(() => load('player.repeat', 'off'))
  const [lyricsOpen, setLyricsOpen] = useState(() => load('player.lyrics', false))
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [downloadsOpen, setDownloadsOpen] = useState(false)
  // Failed import the user is picking a replacement for in search results.
  const [fixing, setFixing] = useState<Job | null>(null)
  const [dialog, setDialog] = useState<FormDialogProps | null>(null)
  const completed = useRef(0)
  // Tracks played before the current one: "previous" in shuffle mode and the no-repeat set.
  const history = useRef<string[]>([])
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
  useEffect(() => save('player.view', view), [view])
  useEffect(() => save('player.sort', sort), [sort])
  useEffect(() => save('player.shuffle', shuffle), [shuffle])
  useEffect(() => save('player.repeat', repeat), [repeat])
  useEffect(() => save('player.lyrics', lyricsOpen), [lyricsOpen])

  useEffect(() => {
    const id = setInterval(async () => {
      const q = await api.queue().catch(() => null)
      if (!q) return
      setJobs(q.jobs)
      if (q.completed !== completed.current) {
        completed.current = q.completed
        loadTracks()
      }
    }, 1000)
    return () => clearInterval(id)
  }, [loadTracks])

  // "/" jumps to search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || (e.target as HTMLElement).closest('input, textarea, [role="dialog"]')) return
      e.preventDefault()
      searchInput.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const q = query.trim()

  useEffect(() => {
    setResults([])
    if (!q) return
    setSearching(true)
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      api
        .search(q, ctrl.signal)
        .then(setResults)
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
  }, [q])

  const trackById = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks])
  const playlist = typeof view === 'number' ? playlists.find((p) => p.id === view) : undefined

  // Tracks of the open view with the date they were added to it, sorted.
  const viewTracks = useMemo(() => {
    const entries = playlist
      ? playlist.tracks.flatMap((pt) => {
          const t = trackById.get(pt.id)
          return t ? [{ track: t, addedAt: pt.addedAt }] : []
        })
      : tracks.map((t) => ({ track: t, addedAt: t.addedAt }))
    const by = {
      added: (a: (typeof entries)[0], b: (typeof entries)[0]) => b.addedAt - a.addedAt,
      title: (a: (typeof entries)[0], b: (typeof entries)[0]) => collator.compare(a.track.title, b.track.title),
      artist: (a: (typeof entries)[0], b: (typeof entries)[0]) =>
        collator.compare(a.track.artist ?? '', b.track.artist ?? '') || collator.compare(a.track.title, b.track.title),
    }[sort]
    return entries.sort(by).map((e) => e.track)
  }, [playlist, tracks, trackById, sort])

  const current = currentId ? (trackById.get(currentId) ?? null) : null

  // --- playback ---

  const go = (id: string) => {
    if (currentId && currentId !== id) history.current.push(currentId)
    setCurrentId(id)
  }

  const play = (id: string, list: string[]) => {
    setQueue(list)
    go(id)
  }

  const queueIds = useMemo(() => {
    const ids = queue.filter((id) => trackById.has(id))
    return ids.length ? ids : viewTracks.map((t) => t.id)
  }, [queue, trackById, viewTracks])

  const next = () => {
    const i = currentId ? queueIds.indexOf(currentId) : -1
    if (!shuffle) {
      if (i + 1 < queueIds.length) go(queueIds[i + 1])
      else if (repeat === 'all' && queueIds.length) go(queueIds[0])
      return
    }
    const played = new Set(history.current)
    let pool = queueIds.filter((id) => id !== currentId && !played.has(id))
    if (pool.length === 0) {
      // Whole list played: start a new round only when repeating the list.
      if (repeat !== 'all') return
      history.current = []
      pool = queueIds.filter((id) => id !== currentId)
    }
    if (pool.length) go(pool[Math.floor(Math.random() * pool.length)])
  }

  const prev = () => {
    if (shuffle) {
      const id = history.current.pop()
      if (id) setCurrentId(id)
      return
    }
    const i = currentId ? queueIds.indexOf(currentId) : -1
    if (i > 0) go(queueIds[i - 1])
    else if (repeat === 'all' && queueIds.length) go(queueIds[queueIds.length - 1])
  }

  // --- track actions ---

  const remove = async (track: Track) => {
    await api.deleteTrack(track.id)
    if (track.id === currentId) setCurrentId(null)
    loadTracks()
    loadPlaylists()
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

  const downloadResult = async (r: SearchResult) => {
    try {
      if (fixing) {
        await api.resolveJob(fixing.id, r.id)
        toast.success(`Скачиваем замену для «${fixing.title}»`)
        setFixing(null)
        setQuery('')
      } else {
        await api.download(`https://www.youtube.com/watch?v=${r.id}`)
      }
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // --- list ---

  const needle = q.toLowerCase()
  const libraryIds = new Set(trackById.keys())
  const queuedIds = new Set(jobs.filter((j) => j.status !== 'error').map((j) => j.videoId))
  const viewName = playlist ? playlist.name : 'Все треки'

  const rows = useMemo<Row[]>(() => {
    const toRows = (list: Track[]): Row[] => {
      const ids = list.map((t) => t.id)
      return list.map((track) => ({ kind: 'track', track, list: ids }))
    }
    if (!needle) {
      if (viewTracks.length) return toRows(viewTracks)
      return [
        {
          kind: 'note',
          key: 'empty',
          text: playlist
            ? 'Плейлист пуст — добавь треки через «⋯» → «Добавить в плейлист»'
            : 'Библиотека пуста — найди трек или добавь ссылку в «Загрузках»',
        },
      ]
    }
    const matches = viewTracks.filter(
      (t) => t.title.toLowerCase().includes(needle) || t.artist?.toLowerCase().includes(needle),
    )
    return [
      { kind: 'header', key: 'h-lib', label: playlist ? `В плейлисте «${playlist.name}»` : 'В библиотеке' },
      ...(matches.length ? toRows(matches) : [{ kind: 'note', key: 'no-lib', text: 'Ничего не найдено' } as Row]),
      { kind: 'header', key: 'h-yt', label: 'YouTube Music' },
      { kind: 'results' },
    ]
  }, [needle, viewTracks, playlist])

  const renderRow = (row: Row) => {
    switch (row.kind) {
      case 'header':
        return <h2 className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground uppercase">{row.label}</h2>
      case 'note':
        return <p className="px-2 py-3 text-sm text-muted-foreground">{row.text}</p>
      case 'results':
        return (
          <SearchResults
            results={results}
            loading={searching}
            inLibrary={(id) => libraryIds.has(id)}
            queued={(id) => queuedIds.has(id)}
            onDownload={downloadResult}
          />
        )
      case 'track': {
        const t = row.track
        return (
          <div className="pb-1">
            <TrackRow
              track={t}
              active={t.id === currentId}
              playlists={playlists}
              onPlay={() => play(t.id, row.list)}
              onRemove={() => remove(t)}
              onRename={() => rename(t)}
              onCopyLink={() => copyLink(t)}
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
      <div className="flex min-h-0 flex-1">
        <Sidebar
          view={playlist ? view : 'all'}
          trackCount={tracks.length}
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
            <Downloads jobs={jobs} open={downloadsOpen} onOpenChange={setDownloadsOpen} onFix={fix} />
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
                {viewName} <span className="font-normal text-muted-foreground">· {viewTracks.length}</span>
              </h1>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="text-muted-foreground">
                  <ArrowUpDown />
                  {SORT_LABELS[sort]}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto">
                <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as Sort)}>
                  {(Object.keys(SORT_LABELS) as Sort[]).map((s) => (
                    <DropdownMenuRadioItem key={s} value={s}>
                      {SORT_LABELS[s]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <VirtualList
            key={`${view}|${needle ? 'search' : 'list'}`}
            className="min-h-0 flex-1 px-2 pb-2"
            items={rows}
            getKey={rowKey}
            estimateSize={rowSize}
            render={renderRow}
          />
        </main>

        {lyricsOpen && <Lyrics trackId={currentId} audio={audio} />}
      </div>

      <Player
        audio={audio}
        track={current}
        shuffle={shuffle}
        onToggleShuffle={() => setShuffle(!shuffle)}
        repeat={repeat}
        onCycleRepeat={() => setRepeat(NEXT_REPEAT[repeat])}
        lyricsOpen={lyricsOpen}
        onToggleLyrics={() => setLyricsOpen(!lyricsOpen)}
        onNext={next}
        onPrev={prev}
      />
      {dialog && <FormDialog {...dialog} onClose={() => setDialog(null)} />}
      <YtdlpUpdate />
      <Toaster />
    </div>
  )
}
