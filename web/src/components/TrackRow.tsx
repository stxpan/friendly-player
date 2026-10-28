import { Check, Ellipsis, Link, ListMinus, ListPlus, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatTime, type Playlist, type Track } from '@/lib/api'
import { cn } from '@/lib/utils'

type Props = {
  track: Track
  active: boolean
  playlists: Playlist[]
  onPlay: () => void
  onRemove: () => void
  onRename: () => void
  onCopyLink: () => void
  onTogglePlaylist: (playlist: Playlist, add: boolean) => void
  // Set when the row is shown inside a playlist.
  onRemoveFromPlaylist?: () => void
}

export function TrackRow({
  track: t,
  active,
  playlists,
  onPlay,
  onRemove,
  onRename,
  onCopyLink,
  onTogglePlaylist,
  onRemoveFromPlaylist,
}: Props) {
  return (
    <div
      onClick={onPlay}
      className={cn(
        'group flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted',
        active && 'bg-muted',
      )}
    >
      <div className="size-10 shrink-0 overflow-hidden rounded bg-muted">
        {t.thumb && <img src={`/media/${t.thumb}`} alt="" loading="lazy" className="size-full object-cover" />}
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
          <DropdownMenuItem onSelect={onRename}>
            <Pencil />
            Переименовать
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ListPlus />
              Добавить в плейлист
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-auto">
              {playlists.length === 0 && <DropdownMenuItem disabled>Плейлистов пока нет</DropdownMenuItem>}
              {playlists.map((p) => {
                const inside = p.tracks.some((pt) => pt.id === t.id)
                return (
                  <DropdownMenuItem key={p.id} onSelect={() => onTogglePlaylist(p, !inside)}>
                    <Check className={cn(!inside && 'invisible')} />
                    {p.name}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {onRemoveFromPlaylist && (
            <DropdownMenuItem onSelect={onRemoveFromPlaylist}>
              <ListMinus />
              Убрать из плейлиста
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onCopyLink}>
            <Link />
            Скопировать ссылку
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
