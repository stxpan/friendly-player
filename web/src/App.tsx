import { useCallback, useEffect, useRef, useState } from 'react'
import { Music, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Downloads } from '@/components/Downloads'
import { Player } from '@/components/Player'
import { SearchResults } from '@/components/SearchResults'
import { TrackRow } from '@/components/TrackRow'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Toaster } from '@/components/ui/sonner'
import { api, type Job, type SearchResult, type Track } from '@/lib/api'
import { load, save } from '@/lib/storage'

const SEARCH_DEBOUNCE_MS = 400

export default function App() {
  const [tracks, setTracks] = useState<Track[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [currentId, setCurrentId] = useState(() => load<string | null>('player.trackId', null))
  const [shuffle, setShuffle] = useState(() => load('player.shuffle', false))
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const completed = useRef(0)
  // Tracks played before the current one: "previous" in shuffle mode and the no-repeat set.
  const history = useRef<string[]>([])

  const loadTracks = useCallback(() => {
    api.tracks().then(setTracks).catch((e) => toast.error(e.message))
  }, [])

  useEffect(loadTracks, [loadTracks])

  useEffect(() => save('player.trackId', currentId), [currentId])
  useEffect(() => save('player.shuffle', shuffle), [shuffle])

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

  const remove = async (track: Track) => {
    await api.deleteTrack(track.id)
    if (track.id === currentId) setCurrentId(null)
    loadTracks()
  }

  const copyLink = async (track: Track) => {
    await navigator.clipboard.writeText(`https://www.youtube.com/watch?v=${track.id}`)
    toast.success('Ссылка скопирована')
  }

  const play = (id: string) => {
    if (currentId && currentId !== id) history.current.push(currentId)
    setCurrentId(id)
  }

  const index = tracks.findIndex((t) => t.id === currentId)
  const current = index === -1 ? null : tracks[index]

  const next = () => {
    if (!shuffle) {
      const t = tracks[index + 1]
      if (t) play(t.id)
      return
    }
    const played = new Set(history.current)
    let pool = tracks.filter((t) => t.id !== currentId && !played.has(t.id))
    if (pool.length === 0) {
      // Whole library played — start a new round.
      history.current = []
      pool = tracks.filter((t) => t.id !== currentId)
    }
    if (pool.length) play(pool[Math.floor(Math.random() * pool.length)].id)
  }

  const prev = () => {
    if (shuffle) {
      const id = history.current.pop()
      if (id) setCurrentId(id)
      return
    }
    const t = tracks[index - 1]
    if (t) play(t.id)
  }

  const needle = q.toLowerCase()
  const matches = needle
    ? tracks.filter((t) => t.title.toLowerCase().includes(needle) || t.artist?.toLowerCase().includes(needle))
    : tracks
  const libraryIds = new Set(tracks.map((t) => t.id))
  const queuedIds = new Set(jobs.filter((j) => j.status !== 'error').map((j) => j.videoId))

  const trackList = (list: Track[]) => (
    <ul className="flex flex-col gap-1">
      {list.map((t) => (
        <TrackRow
          key={t.id}
          track={t}
          active={t.id === currentId}
          onPlay={() => play(t.id)}
          onRemove={() => remove(t)}
          onCopyLink={() => copyLink(t)}
        />
      ))}
    </ul>
  )

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex gap-2 border-b p-4">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по библиотеке и YouTube Music"
            className="pl-8"
          />
        </div>
        <Downloads jobs={jobs} />
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">
          {!q ? (
            tracks.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-16 text-muted-foreground">
                <Music className="size-8" />
                Библиотека пуста — найди трек или добавь ссылку в «Загрузках»
              </div>
            ) : (
              trackList(tracks)
            )
          ) : (
            <>
              <h2 className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground uppercase">В библиотеке</h2>
              {matches.length ? (
                trackList(matches)
              ) : (
                <p className="px-2 py-3 text-sm text-muted-foreground">Ничего не найдено</p>
              )}
              <h2 className="px-2 pt-4 pb-1 text-xs font-medium text-muted-foreground uppercase">YouTube Music</h2>
              <SearchResults
                results={results}
                loading={searching}
                inLibrary={(id) => libraryIds.has(id)}
                queued={(id) => queuedIds.has(id)}
              />
            </>
          )}
        </div>
      </ScrollArea>

      <Player
        track={current}
        shuffle={shuffle}
        onToggleShuffle={() => setShuffle(!shuffle)}
        onNext={next}
        onPrev={prev}
      />
      <Toaster />
    </div>
  )
}
