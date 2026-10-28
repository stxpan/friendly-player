import { useState } from 'react'
import { Download, Loader2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { api, type Job } from '@/lib/api'

// Big imports queue 1000+ jobs; rendering all of them every second isn't worth it.
const VISIBLE_PENDING = 50

export function Downloads({ jobs }: { jobs: Job[] }) {
  const [url, setUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const pending = jobs.filter((j) => j.status !== 'error')
  const failed = jobs.filter((j) => j.status === 'error')

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

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">
          <Download />
          Загрузки
          {pending.length > 0 && <Badge className="tabular-nums">{pending.length}</Badge>}
        </Button>
      </SheetTrigger>
      <SheetContent className="gap-0">
        <SheetHeader>
          <SheetTitle>Загрузки</SheetTitle>
          <SheetDescription>Видео или плейлист YouTube, плейлист Яндекс Музыки</SheetDescription>
        </SheetHeader>

        <form onSubmit={submit} className="flex gap-2 px-4 pb-4">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Ссылка" disabled={submitting} />
          <Button type="submit" size="icon" disabled={submitting || !url.trim()}>
            {submitting ? <Loader2 className="animate-spin" /> : <Plus />}
          </Button>
        </form>

        <ScrollArea className="min-h-0 flex-1 border-t">
          {jobs.length === 0 && <p className="p-4 text-sm text-muted-foreground">Очередь пуста</p>}
          <ul className="flex flex-col gap-3 p-4">
            {pending.slice(0, VISIBLE_PENDING).map((job) => (
              <li key={job.id} className="flex flex-col gap-1 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="truncate">{job.title}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {job.status === 'queued' ? 'ждёт' : `${Math.round(job.progress)}%`}
                  </span>
                </div>
                <Progress value={job.progress} />
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
