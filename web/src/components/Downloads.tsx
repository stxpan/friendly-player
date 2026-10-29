import { useState } from 'react'
import { Loader2, Plus, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, type Job, type Playlist } from '@/lib/api'

// Big imports queue 1000+ jobs; rendering all of them every second isn't worth it.
const VISIBLE_PENDING = 50

type Props = {
  jobs: Job[]
  open: boolean
  onOpenChange: (open: boolean) => void
  // Pick the right YouTube Music track by hand for an import that wasn't matched automatically.
  onFix: (job: Job) => void
  playlists: Playlist[]
  // Tracks (or a new playlist) were added straight away; library and playlists should be reloaded.
  onAdded: () => void
}

// Select values: the library only, or an existing playlist id.
const LIBRARY = 'library'

export function Downloads({ jobs, open, onOpenChange, onFix, playlists, onAdded }: Props) {
  const [url, setUrl] = useState('')
  const [target, setTarget] = useState(LIBRARY)
  const [submitting, setSubmitting] = useState(false)

  const pending = jobs.filter((j) => j.status !== 'error')
  const failed = jobs.filter((j) => j.status === 'error')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    setSubmitting(true)
    try {
      const playlist = target === LIBRARY ? null : Number(target)
      const { added, queued } = await api.addByUrl(url.trim(), playlist)
      const where = playlist === null ? 'в библиотеку' : 'в плейлист'
      if (queued) toast.success(`Ищем на YouTube Music: ${queued} — треки появятся ${where} по мере нахождения`)
      else if (added || playlist !== null) toast.success(`Добавлено ${where}`)
      else toast.success('Уже в библиотеке')
      onAdded()
      setUrl('')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button variant="outline">
          <Plus />
          Добавить
          {pending.length > 0 && <Badge className="tabular-nums">{pending.length}</Badge>}
        </Button>
      </SheetTrigger>
      <SheetContent className="gap-0">
        <SheetHeader>
          <SheetTitle>Добавить музыку</SheetTitle>
          <SheetDescription>
            Вставь ссылку на видео или плейлист YouTube либо на плейлист Яндекс Музыки. Треки появятся в библиотеке и
            будут играть онлайн. Чтобы слушать без интернета, скачай их кнопкой «Скачать всё» над списком.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={submit} className="flex flex-col gap-2 px-4 pb-4">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://music.yandex.ru/playlists/…"
            disabled={submitting}
          />
          <div className="flex gap-2">
            <Select value={target} onValueChange={setTarget} disabled={submitting}>
              <SelectTrigger className="min-w-0 flex-1" aria-label="Куда добавить">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={LIBRARY}>Только в библиотеку</SelectItem>
                {playlists.length > 0 && <SelectSeparator />}
                {playlists.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    В плейлист «{p.name}»
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" disabled={submitting || !url.trim()}>
              {submitting ? <Loader2 className="animate-spin" /> : <Plus />}
              Добавить
            </Button>
          </div>
        </form>

        <ScrollArea className="min-h-0 flex-1 border-t">
          {jobs.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">Сейчас ничего не добавляется и не скачивается</p>
          )}
          {jobs.length > 0 && (
            <p className="px-4 pt-4 text-xs font-medium text-muted-foreground uppercase">В работе</p>
          )}
          <ul className="flex flex-col gap-3 p-4">
            {pending.slice(0, VISIBLE_PENDING).map((job) => (
              <li key={job.id} className="flex flex-col gap-1 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="truncate">{job.title}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {job.status === 'queued' && 'ждёт'}
                    {job.status === 'downloading' && (job.kind === 'add' ? 'ищем…' : `${Math.round(job.progress)}%`)}
                  </span>
                </div>
                {job.kind === 'download' && <Progress value={job.progress} />}
              </li>
            ))}
            {pending.length > VISIBLE_PENDING && (
              <li className="text-xs text-muted-foreground">ещё {pending.length - VISIBLE_PENDING} в очереди</li>
            )}
          </ul>

          {failed.length > 0 && (
            <div className="border-t p-4">
              <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>Ошибки: {failed.length}</span>
                <Button variant="ghost" size="xs" onClick={() => api.clearErrors()}>
                  Очистить
                </Button>
              </div>
              <ul className="flex flex-col gap-2">
                {failed.map((job) => (
                  <li key={job.id} className="flex items-start gap-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{job.title}</div>
                      <div className="truncate text-xs text-destructive" title={job.error}>
                        {job.error}
                      </div>
                      {job.search && (
                        <Button variant="link" size="xs" className="h-auto px-0" onClick={() => onFix(job)}>
                          <Search />
                          Найти вручную
                        </Button>
                      )}
                    </div>
                    <Button variant="ghost" size="icon-xs" onClick={() => api.dismissJob(job.id)}>
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
