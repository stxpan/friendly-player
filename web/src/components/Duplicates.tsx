import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { coverUrl, formatTime, type Track } from '@/lib/api'
import { cn } from '@/lib/utils'

type Props = {
  groups: Track[][]
  currentId: string | null
  onPlay: (track: Track) => void
  onRemove: (track: Track) => void
}

const date = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', year: 'numeric' })

export function Duplicates({ groups, currentId, onPlay, onRemove }: Props) {
  if (groups.length === 0) return <p className="p-6 text-sm text-muted-foreground">Дубликатов нет</p>

  return (
    <div className="flex flex-col gap-4 overflow-y-auto p-4">
      <p className="text-sm text-muted-foreground">
        Похоже, эти треки скачаны несколько раз. Послушай и удали лишние — удаление стирает файл с компьютера.
      </p>
      {groups.map((group) => (
        <div key={group.map((t) => t.id).join()} className="rounded-lg border p-1">
          {group.map((t) => (
            <div
              key={t.id}
              onClick={() => onPlay(t)}
              className={cn(
                'group flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted',
                t.id === currentId && 'bg-muted',
              )}
            >
              <div className="size-10 shrink-0 overflow-hidden rounded bg-muted">
                {t.thumb && <img src={coverUrl(t.thumb)!} alt="" loading="lazy" className="size-full object-cover" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className={cn('truncate text-sm', t.id === currentId && 'font-medium text-primary')}>{t.title}</div>
                <div className="truncate text-xs text-muted-foreground">{t.artist}</div>
              </div>
              <div className="hidden text-right text-xs text-muted-foreground tabular-nums sm:block">
                <div>{t.playCount ? `${t.playCount} прослуш.` : 'не слушал'}</div>
                <div>добавлен {date.format(t.addedAt)}</div>
              </div>
              <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">{formatTime(t.duration)}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Удалить с компьютера"
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove(t)
                }}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
