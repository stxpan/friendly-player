import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Ellipsis, Link, Loader2, Music, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Player } from '@/components/Player'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Toaster } from '@/components/ui/sonner'
import { api, formatTime, type Job, type Track } from '@/lib/api'
import { load, save } from '@/lib/storage'
import { cn } from '@/lib/utils'

// Big imports queue hundreds of jobs; show only the head of the queue and the latest errors.
const VISIBLE_JOBS = 3

export default function App() {
  const [tracks, setTracks] = useState<Track[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [currentId, setCurrentId] = useState(() => load<string | null>('player.trackId', null))
  const [url, setUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const completed = useRef(0)

  const loadTracks = useCallback(() => {
    api.tracks().then(setTracks).catch((e) => toast.error(e.message))
  }, [])

  useEffect(loadTracks, [loadTracks])

  useEffect(() => save('player.trackId', currentId), [currentId])

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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    setSubmitting(true)
    try {
      const added = await api.download(url.trim())
      toast.success(added.length ? `В очереди: ${added.length}` : 'Уже в библиотеке или в очереди')
      setUrl('')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const remove = async (track: Track) => {
    await api.deleteTrack(track.id)
    if (track.id === currentId) setCurrentId(null)
    loadTracks()
  }

  const copyLink = async (track: Track) => {
    await navigator.clipboard.writeText(`https://www.youtube.com/watch?v=${track.id}`)
    toast.success('Ссылка скопирована')
  }

  const pending = jobs.filter((j) => j.status !== 'error')
  const failed = jobs.filter((j) => j.status === 'error')

  const index = tracks.findIndex((t) => t.id === currentId)
  const current = index === -1 ? null : tracks[index]
  const step = (delta: number) => {
    const next = tracks[index + delta]
    if (next) setCurrentId(next.id)
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex flex-col gap-3 border-b p-4">
        <form onSubmit={submit} className="flex gap-2">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Ссылка на YouTube или плейлист Яндекс Музыки"
            disabled={submitting}
          />
          <Button type="submit" disabled={submitting || !url.trim()}>
            {submitting ? <Loader2 className="animate-spin" /> : <Download />}
            Скачать
          </Button>
        </form>

        {jobs.length > 0 && (
          <ul className="flex flex-col gap-2">
            {[...pending.slice(0, VISIBLE_JOBS), ...failed.slice(-VISIBLE_JOBS)].map((job) => (
              <li key={job.id} className="flex items-center gap-3 text-sm">
                <span className="w-1/3 truncate">{job.title}</span>
                {job.status === 'error' ? (
                  <>
                    <span className="flex-1 truncate text-destructive" title={job.error}>
                      {job.error}
                    </span>
                    <Button variant="ghost" size="icon-xs" onClick={() => api.dismissJob(job.id)}>
                      <X />
                    </Button>
                  </>
                ) : (
                  <>
                    <Progress value={job.progress} className="flex-1" />
                    <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
                      {job.status === 'queued' ? 'ждёт' : `${Math.round(job.progress)}%`}
                    </span>
                  </>
                )}
              </li>
            ))}
            {(pending.length > VISIBLE_JOBS || failed.length > 0) && (
              <li className="flex items-center gap-3 text-xs text-muted-foreground">
                {pending.length > VISIBLE_JOBS && <span>ещё {pending.length - VISIBLE_JOBS} в очереди</span>}
                {failed.length > 0 && (
                  <>
                    <span>ошибок: {failed.length}</span>
                    <Button variant="ghost" size="xs" onClick={() => api.clearErrors()}>
                      Очистить ошибки
                    </Button>
                  </>
                )}
              </li>
            )}
          </ul>
        )}
      </header>

      <ScrollArea className="min-h-0 flex-1">
        {tracks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-16 text-muted-foreground">
            <Music className="size-8" />
            Библиотека пуста — вставь ссылку сверху
          </div>
        ) : (
          <ul className="flex flex-col gap-1 p-2">
            {tracks.map((t) => (
              <li
                key={t.id}
                onClick={() => setCurrentId(t.id)}
                className={cn(
                  'group flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted',
                  t.id === currentId && 'bg-muted',
                )}
              >
                <div className="size-10 shrink-0 overflow-hidden rounded bg-muted">
                  {t.thumb && <img src={`/media/${t.thumb}`} alt="" className="size-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className={cn('truncate text-sm', t.id === currentId && 'font-medium text-primary')}>
                    {t.title}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{t.artist}</div>
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">{formatTime(t.duration)}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="opacity-0 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    remove(t)
                  }}
                >
                  <Trash2 />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Ellipsis />
                    </Button>
                  </DropdownMenuTrigger>
                  {/* React events bubble through the portal to the row and would start playback. */}
                  <DropdownMenuContent align="end" className="w-auto" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem onSelect={() => copyLink(t)}>
                      <Link />
                      Скопировать ссылку
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>

      <Player track={current} onNext={() => step(1)} onPrev={() => step(-1)} />
      <Toaster />
    </div>
  )
}
