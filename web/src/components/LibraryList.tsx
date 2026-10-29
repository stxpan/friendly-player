import { useMemo, type ReactNode } from 'react'
import { VirtualList } from '@/components/VirtualList'
import type { Track } from '@/lib/api'

type Row =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'note'; key: string; text: string }
  | { kind: 'track'; track: Track; list: string[] }
  | { kind: 'results' }

const rowKey = (r: Row) => (r.kind === 'track' ? r.track.id : r.kind === 'results' ? 'results' : r.key)
const rowSize = (r: Row) => ({ track: 56, header: 32, note: 44, results: 400 })[r.kind]

type Props = {
  // Scroll position and measurements start over when this changes.
  resetKey: string
  tracks: Track[]
  emptyNote: string
  // Searching (or on an artist page): library tracks under one header, YouTube Music results under another.
  sections: { library: string; youtube: string } | null
  // `list`: the ids of all tracks shown, in order — what plays after this one.
  renderTrack: (track: Track, list: string[]) => ReactNode
  results: ReactNode
  sortable?: { ids: string[]; onMove: (activeId: string, overId: string) => void }
}

export function LibraryList({ resetKey, tracks, emptyNote, sections, renderTrack, results, sortable }: Props) {
  // Compared by value: the caller builds a new object every render.
  const libraryLabel = sections?.library
  const youtubeLabel = sections?.youtube
  const rows = useMemo<Row[]>(() => {
    const ids = tracks.map((t) => t.id)
    const trackRows = tracks.map((track): Row => ({ kind: 'track', track, list: ids }))
    if (libraryLabel === undefined || youtubeLabel === undefined)
      return trackRows.length ? trackRows : [{ kind: 'note', key: 'empty', text: emptyNote }]
    return [
      { kind: 'header', key: 'h-lib', label: libraryLabel },
      ...(trackRows.length ? trackRows : [{ kind: 'note', key: 'no-lib', text: 'Ничего не найдено' } as Row]),
      { kind: 'header', key: 'h-yt', label: youtubeLabel },
      { kind: 'results' },
    ]
  }, [tracks, emptyNote, libraryLabel, youtubeLabel])

  const render = (row: Row) => {
    switch (row.kind) {
      case 'header':
        return <h2 className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground uppercase">{row.label}</h2>
      case 'note':
        return <p className="px-2 py-3 text-sm text-muted-foreground">{row.text}</p>
      case 'results':
        return results
      case 'track':
        return <div className="pb-1">{renderTrack(row.track, row.list)}</div>
    }
  }

  return (
    <VirtualList
      key={resetKey}
      className="min-h-0 flex-1 px-2 pb-2"
      items={rows}
      getKey={rowKey}
      estimateSize={rowSize}
      render={render}
      sortable={sortable}
    />
  )
}
