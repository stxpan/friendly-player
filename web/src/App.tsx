import { useMemo, useState } from 'react'
import { arrayMove } from '@dnd-kit/sortable'
import { toast } from 'sonner'
import { AppUpdate } from '@/components/AppUpdate'
import { Downloads } from '@/components/Downloads'
import { Duplicates } from '@/components/Duplicates'
import { LibraryList } from '@/components/LibraryList'
import { ListToolbar } from '@/components/ListToolbar'
import { Lyrics } from '@/components/Lyrics'
import { Player, type DownloadState } from '@/components/Player'
import { SearchBar } from '@/components/SearchBar'
import { SearchResults } from '@/components/SearchResults'
import { Settings } from '@/components/Settings'
import { SMART_VIEWS, Sidebar, type View } from '@/components/Sidebar'
import { Stats } from '@/components/Stats'
import { TrackRow } from '@/components/TrackRow'
import { YtdlpUpdate } from '@/components/YtdlpUpdate'
import { Toaster } from '@/components/ui/sonner'
import { useClientSettings } from '@/hooks/useClientSettings'
import { useLibrary } from '@/hooks/useLibrary'
import { useLibraryActions } from '@/hooks/useLibraryActions'
import { useMusicSearch } from '@/hooks/useMusicSearch'
import { useOnline } from '@/hooks/useOnline'
import { usePersisted } from '@/hooks/usePersisted'
import { usePlayback } from '@/hooks/usePlayback'
import { api, type Job, type SearchResult } from '@/lib/api'
import { findDuplicates } from '@/lib/duplicates'
import { smartCounts, tracksOfView, type Sort } from '@/lib/library'
import { dedupeResults, matcher } from '@/lib/search'
import { cn } from '@/lib/utils'

const EMPTY_NOTES = {
  all: 'Библиотека пуста — найди трек или добавь ссылку в «Загрузках»',
  playlist: 'Плейлист пуст — добавь треки через «⋯» → «Добавить в плейлист»',
  top: 'Пока пусто — здесь появятся треки, которые слушаешь чаще всего',
  stale: 'Пока пусто — здесь появятся треки, которые не слушал больше месяца',
  never: 'Ты слушал всё, что есть в библиотеке',
}

const PAGE_TITLES: Partial<Record<string, string>> = { stats: 'Статистика', duplicates: 'Дубликаты', radio: 'Радио', settings: 'Настройки' }

export default function App() {
  const library = useLibrary()
  const { tracks, playlists, jobs, trackById, downloadingIds, loadTracks, loadPlaylists } = library
  const online = useOnline()
  const [clientSettings, setClientSettings] = useClientSettings()
  const [view, setView] = usePersisted<View>('player.view', 'all')
  const [sort, setSort] = usePersisted<Sort>('player.sort', 'added')
  const [panel, setPanel] = usePersisted<'lyrics' | null>('player.panel', null)
  const lyricsOpen = panel === 'lyrics'
  const [query, setQuery] = useState('')
  const [downloadsOpen, setDownloadsOpen] = useState(false)
  // Failed import the user is picking a replacement for in search results.
  const [fixing, setFixing] = useState<Job | null>(null)

  // --- what's on screen ---

  const needle = query.trim().toLowerCase()
  const artistName = typeof view === 'string' && view.startsWith('artist:') ? view.slice('artist:'.length) : null
  const playlist = typeof view === 'number' ? playlists.find((p) => p.id === view) : undefined
  const smart = view === 'top' || view === 'stale' || view === 'never' ? view : null
  // These lists have their own meaningful order; the sort menu is hidden for them.
  const fixedOrder = smart === 'top' || smart === 'stale'

  const viewTracks = useMemo(
    () => tracksOfView({ tracks, trackById, playlist, smart, artistName, sort }),
    [smart, artistName, playlist, tracks, trackById, sort],
  )
  const counts = useMemo(() => smartCounts(tracks), [tracks])
  const duplicates = useMemo(() => findDuplicates(tracks), [tracks])

  // On an artist page YouTube Music is searched for the artist even with an empty search box.
  const search = useMusicSearch(query.trim() || artistName || '')
  const shownResults = useMemo(() => dedupeResults(search.results, (id) => trackById.has(id)), [search.results, trackById])

  const playback = usePlayback({ trackById, online, lyricsOpen, viewTracks })
  const { stream, currentId } = playback

  const actions = useLibraryActions({
    library,
    confirmDelete: clientSettings.confirmDelete,
    onStopConfirming: () => setClientSettings((s) => ({ ...s, confirmDelete: false })),
    onDeleted: playback.forget,
    view,
    setView,
  })

  const listKey = `${view}|${needle}`
  const mixed = playback.isMix(listKey)

  // Library tracks on screen: the open view, narrowed by search; in playback order when it's the mix.
  const visibleTracks = useMemo(() => {
    const matches = matcher(needle)
    const list = needle ? viewTracks.filter((t) => matches(`${t.title} ${t.artist ?? ''}`)) : viewTracks
    if (!mixed) return list
    const position = new Map(playback.queue.map((id, i) => [id, i]))
    return [...list].sort((a, b) => (position.get(a.id) ?? Infinity) - (position.get(b.id) ?? Infinity))
  }, [needle, viewTracks, mixed, playback.queue])

  // Statistics and duplicates are their own pages; typing a search switches back to the list.
  let page: 'list' | 'stats' | 'duplicates' | 'radio' | 'settings' = 'list'
  if (!needle && (view === 'stats' || view === 'duplicates' || view === 'settings')) page = view
  else if (!needle && view === 'radio' && stream?.radio) page = 'radio'

  let viewName = 'Все треки'
  if (playlist) viewName = playlist.name
  else if (artistName) viewName = artistName
  else if (smart) viewName = SMART_VIEWS[smart].label

  // Online-only tracks in the list on screen that "Download all" would fetch.
  const toDownload = page === 'list' ? visibleTracks.filter((t) => !t.file && !downloadingIds.has(t.id)) : []
  // Dragging works where the order is the user's to set: the whole library or a playlist, unfiltered.
  const canDrag = page === 'list' && !needle && !artistName && !smart && (view === 'all' || Boolean(playlist))

  // ✓ downloaded, spinner while the file is coming, otherwise online-only.
  const downloadState = (id: string): DownloadState => {
    if (trackById.get(id)?.file) return 'done'
    return downloadingIds.has(id) ? 'queued' : 'none'
  }

  // --- actions ---

  const play = (id: string, list: string[]) => playback.play(id, list, listKey)
  const toggleShuffle = () =>
    playback.toggleShuffle(
      visibleTracks.map((t) => t.id),
      listKey,
    )

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
    playback.reorder(next, listKey)
    if (mixed) return
    setSort('custom')
    const position = new Map(next.map((id, i) => [id, i]))
    if (playlist) {
      library.setPlaylists((all) =>
        all.map((p) =>
          p.id !== playlist.id
            ? p
            : { ...p, tracks: p.tracks.map((pt) => ({ ...pt, position: position.get(pt.id) ?? pt.position })) },
        ),
      )
    } else {
      library.setTracks((all) => all.map((t) => ({ ...t, position: position.get(t.id) ?? t.position })))
    }
    api.saveOrder(playlist?.id ?? null, next).catch((e) => toast.error(e.message))
  }

  const openArtist = (name: string) => {
    setQuery('')
    setView(`artist:${name}`)
  }

  const startRadio = async (seed: { id: string; title: string }) => {
    if (!(await playback.startRadio(seed))) return
    setQuery('')
    setView('radio')
  }

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

  const clearSearch = () => {
    setQuery('')
    setFixing(null)
  }

  // Pages that aren't track lists give way to search results while something is typed, so
  // opening one from the menu clears the search. Lists keep it: it searches within them.
  const select = (v: View) => {
    if (v === 'stats' || v === 'duplicates' || v === 'settings' || v === 'radio') clearSearch()
    setView(v)
  }

  const inLibrary = (id: string) => trackById.has(id)
  const current = playback.current

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Menu on the right: the row is mirrored, so lyrics end up on the left. */}
      <div className={cn('flex min-h-0 flex-1', clientSettings.menuSide === 'right' && 'flex-row-reverse')}>
        <Sidebar
          side={clientSettings.menuSide}
          view={typeof view === 'number' && !playlist ? 'all' : view}
          trackCount={tracks.length}
          smartCounts={counts}
          duplicateCount={duplicates.length}
          radioTitle={stream?.radio ?? null}
          playlists={playlists}
          onSelect={select}
          onCreate={actions.createPlaylist}
          onRename={actions.renamePlaylist}
          onDelete={actions.deletePlaylist}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex gap-2 border-b p-4">
            <SearchBar
              value={query}
              onChange={setQuery}
              onClear={clearSearch}
            />
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

          <ListToolbar
            title={PAGE_TITLES[page] ?? viewName}
            count={page === 'list' ? viewTracks.length : null}
            fixing={fixing?.title ?? null}
            onCancelFix={() => setFixing(null)}
            downloadCount={toDownload.length}
            onDownloadAll={() => actions.download(toDownload.map((t) => t.id))}
            sort={page === 'list' && !fixedOrder ? { value: sort, mixed, onChange: changeSort } : undefined}
          />

          {page === 'settings' && (
            <Settings client={clientSettings} onClientChange={setClientSettings} onLibraryChanged={loadTracks} />
          )}
          {page === 'stats' && <Stats onPlay={(id) => play(id, [id])} onOpenArtist={openArtist} />}
          {page === 'radio' && stream && (
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              <SearchResults
                results={stream.list}
                loading={false}
                playingId={stream.result.id}
                inLibrary={inLibrary}
                onPlay={(r) => playback.playResult(r)}
                onAdd={addResult}
              />
            </div>
          )}
          {page === 'duplicates' && (
            <Duplicates
              groups={duplicates}
              currentId={stream ? null : currentId}
              onPlay={(t) => play(t.id, duplicates.find((g) => g.includes(t))!.map((g) => g.id))}
              onRemove={actions.remove}
            />
          )}
          {page === 'list' && (
            <LibraryList
              resetKey={`${view}|${needle ? 'search' : 'list'}|${mixed ? 'mix' : 'sorted'}`}
              tracks={visibleTracks}
              emptyNote={EMPTY_NOTES[smart ?? (playlist ? 'playlist' : 'all')]}
              // Artist pages always show what YouTube Music has by them, under the library tracks.
              sections={
                needle || artistName
                  ? {
                      library: playlist ? `В плейлисте «${playlist.name}»` : 'В библиотеке',
                      youtube: artistName && !needle ? 'На YouTube Music' : 'YouTube Music',
                    }
                  : null
              }
              renderTrack={(t, list) => (
                <TrackRow
                  track={t}
                  active={!stream && t.id === currentId}
                  download={downloadState(t.id)}
                  onDownload={() => actions.download([t.id])}
                  unavailable={!playback.available(t.id)}
                  playlists={playlists}
                  onPlay={() => play(t.id, list)}
                  onRemove={() => actions.remove(t)}
                  onRename={() => actions.rename(t)}
                  onCopyLink={() => actions.copyLink(t)}
                  onOpenArtist={openArtist}
                  onPlayNext={() => playback.playNext(t)}
                  onRadio={() => startRadio(t)}
                  onTogglePlaylist={(p, add) => actions.togglePlaylist(p, t, add)}
                  onRemoveFromPlaylist={playlist ? () => actions.togglePlaylist(playlist, t, false) : undefined}
                />
              )}
              results={
                <SearchResults
                  results={shownResults}
                  loading={search.searching}
                  onLoadMore={search.loadMore}
                  loadingMore={search.loadingMore}
                  playingId={stream?.result.id ?? null}
                  inLibrary={inLibrary}
                  onPlay={(r) => playback.playResult(r, shownResults)}
                  onAdd={addResult}
                />
              }
              sortable={canDrag ? { ids: visibleTracks.map((t) => t.id), onMove: moveTrack } : undefined}
            />
          )}
        </main>

        {lyricsOpen && (
          <Lyrics
            tabs="Текст"
            side={clientSettings.menuSide === 'left' ? 'right' : 'left'}
            track={current}
            audio={playback.audio}
          />
        )}
      </div>

      <Player
        audio={playback.audio}
        track={current}
        download={
          current && {
            state: downloadState(current.id),
            start: () =>
              stream && !trackById.has(stream.result.id)
                ? actions.downloadResult(stream.result)
                : actions.download([current.id]),
          }
        }
        shuffle={playback.shuffle}
        onToggleShuffle={toggleShuffle}
        repeat={playback.repeat}
        onCycleRepeat={playback.cycleRepeat}
        lyricsOpen={lyricsOpen}
        onToggleLyrics={() => setPanel(lyricsOpen ? null : 'lyrics')}
        onNext={playback.next}
        onPrev={playback.prev}
        onPlayRecorded={loadTracks}
        normalize={clientSettings.normalize}
      />
      {actions.dialogs}
      <YtdlpUpdate />
      <AppUpdate />
      <Toaster />
    </div>
  )
}
