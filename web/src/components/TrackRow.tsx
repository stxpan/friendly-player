import { Ellipsis, Link, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatTime, type Track } from '@/lib/api'
import { cn } from '@/lib/utils'

type Props = {
  track: Track
  active: boolean
  onPlay: () => void
  onRemove: () => void
  onCopyLink: () => void
}

export function TrackRow({ track: t, active, onPlay, onRemove, onCopyLink }: Props) {
  return (
    <li
      onClick={onPlay}
      className={cn(
        'group flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted',
        active && 'bg-muted',
      )}
    >
      <div className="size-10 shrink-0 overflow-hidden rounded bg-muted">
        {t.thumb && <img src={`/media/${t.thumb}`} alt="" className="size-full object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-sm', active && 'font-medium text-primary')}>{t.title}</div>
        <div className="truncate text-xs text-muted-foreground">{t.artist}</div>
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{formatTime(t.duration)}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        className="opacity-0 group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
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
          <DropdownMenuItem onSelect={onCopyLink}>
            <Link />
            Скопировать ссылку
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}
