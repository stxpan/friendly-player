import { Check, Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { api, formatTime, type SearchResult } from '@/lib/api'

type Props = {
  results: SearchResult[]
  loading: boolean
  inLibrary: (id: string) => boolean
  queued: (id: string) => boolean
}

export function SearchResults({ results, loading, inLibrary, queued }: Props) {
  const download = async (r: SearchResult) => {
    try {
      await api.download(`https://www.youtube.com/watch?v=${r.id}`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  if (loading && results.length === 0) {
    return (
      <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Ищем…
      </div>
    )
  }
  if (results.length === 0) return <p className="px-2 py-3 text-sm text-muted-foreground">Ничего не найдено</p>

  return (
    <ul className="flex flex-col gap-1">
      {results.map((r) => (
        <li key={r.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted">
          <div className="size-10 shrink-0 overflow-hidden rounded bg-muted">
            {r.thumb && <img src={r.thumb} alt="" className="size-full object-cover" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm">{r.title}</div>
            <div className="truncate text-xs text-muted-foreground">{r.artist}</div>
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">{formatTime(r.duration)}</span>
          {inLibrary(r.id) ? (
            <Check className="m-1.5 size-4 text-muted-foreground" />
          ) : queued(r.id) ? (
            <Loader2 className="m-1.5 size-4 animate-spin text-muted-foreground" />
          ) : (
            <Button variant="ghost" size="icon-sm" onClick={() => download(r)}>
              <Download />
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}
