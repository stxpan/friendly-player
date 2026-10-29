import { useEffect, useRef } from 'react'
import { Check, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatTime, type SearchResult } from '@/lib/api'
import { cn } from '@/lib/utils'

type Props = {
  results: SearchResult[]
  loading: boolean
  // Infinite scroll: called when the end of the list comes into view; absent when there is nothing more.
  onLoadMore?: () => void
  loadingMore?: boolean
  playingId: string | null
  inLibrary: (id: string) => boolean
  onPlay: (r: SearchResult) => void
  onAdd: (r: SearchResult) => void
}

export function SearchResults({
  results,
  loading,
  onLoadMore,
  loadingMore,
  playingId,
  inLibrary,
  onPlay,
  onAdd,
}: Props) {
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = end.current
    if (!el || !onLoadMore || loadingMore) return
    // Start loading a bit before the end is reached, so scrolling doesn't hit a wall.
    const observer = new IntersectionObserver(([e]) => e.isIntersecting && onLoadMore(), { rootMargin: '600px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [onLoadMore, loadingMore, results.length])

  if (loading && results.length === 0) {
    return (
      <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Ищем…
      </div>
    )
  }
  if (results.length === 0) return <p className="px-2 py-3 text-sm text-muted-foreground">Ничего не найдено</p>

  return (
    <>
      <ul className="flex flex-col gap-1">
        {results.map((r) => (
          <li
            key={r.id}
            onClick={() => onPlay(r)}
            className={cn(
              'group flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted',
              r.id === playingId && 'bg-muted',
            )}
          >
            <div className="size-10 shrink-0 overflow-hidden rounded bg-muted">
              {r.thumb && <img src={r.thumb} alt="" className="size-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className={cn('truncate text-sm', r.id === playingId && 'font-medium text-primary')}>{r.title}</div>
              <div className="truncate text-xs text-muted-foreground">{r.artist}</div>
            </div>
            {/* Same columns as library rows: hover action, duration, then the status mark. */}
          {!inLibrary(r.id) && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="opacity-0 group-hover:opacity-100"
              title="Добавить в библиотеку"
              onClick={(e) => {
                e.stopPropagation()
                onAdd(r)
              }}
            >
              <Plus />
            </Button>
          )}
          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{formatTime(r.duration)}</span>
          <div className="flex size-7 shrink-0 items-center justify-center">
            {inLibrary(r.id) && (
              <span title="В библиотеке">
                <Check className="size-4 text-muted-foreground" />
              </span>
            )}
          </div>
          </li>
        ))}
      </ul>
      {onLoadMore && (
        <div ref={end} className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Загружаем ещё…
        </div>
      )}
    </>
  )
}
