import { Fragment } from 'react'
import { Check, Download, Ellipsis, Link, ListMinus, ListPlus, ListStart, Loader2, Pencil, Radio, Trash2 } from 'lucide-react'
import type { DownloadState } from '@/components/Player'
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
import { coverUrl, formatTime, type Playlist, type Track } from '@/lib/api'
import { cn } from '@/lib/utils'

type Props = {
  track: Track
  active: boolean
  download: DownloadState
  unavailable: boolean
  playlists: Playlist[]
  onPlay: () => void
  onDownload: () => void
  onRemove: () => void
  onRename: () => void
  onCopyLink: () => void
  onOpenArtist: (name: string) => void
  onPlayNext: () => void
  onRadio: () => void
  onTogglePlaylist: (playlist: Playlist, add: boolean) => void
  // Set when the row is shown inside a playlist.
  onRemoveFromPlaylist?: () => void
}

export function TrackRow({
  track: t,
  active,
  download,
  unavailable,
  playlists,
  onPlay,
  onDownload,
  onRemove,
  onRename,
  onCopyLink,
  onOpenArtist,
  onPlayNext,
  onRadio,
  onTogglePlaylist,
  onRemoveFromPlaylist,
}: Props) {
  return (
    <div
      onClick={unavailable ? undefined : onPlay}
      title={unavailable ? 'Нет интернета, а трек не скачан' : undefined}
      className={cn(
        'group flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted',
        active && 'bg-muted',
        // Online-only while offline: kept in the list, but greyed out and skipped by playback.
        unavailable && 'cursor-default opacity-40 hover:bg-transparent',
      )}
    >
      <div className="size-10 shrink-0 overflow-hidden rounded bg-muted">
        {t.thumb && <img src={coverUrl(t.thumb)!} alt="" loading="lazy" className="size-full object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-sm', active && 'font-medium text-primary')}>{t.title}</div>
        <div className="truncate text-xs text-muted-foreground">
          {(t.artist ?? '').split(', ').map((name, i) => (
            <Fragment key={name}>
              {i > 0 && ', '}
              <button
                className="hover:text-foreground hover:underline"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenArtist(name)
                }}
              >
                {name}
              </button>
            </Fragment>
          ))}
        </div>
      </div>
      {/* Actions show on hover, left of the duration, so durations line up in every list. */}
      <div className="flex shrink-0 items-center">
      {download === 'none' && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="opacity-0 group-hover:opacity-100"
          title="Скачать"
          onClick={(e) => {
            e.stopPropagation()
            onDownload()
          }}
        >
          <Download />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        className="opacity-0 group-hover:opacity-100"
        title={download === 'done' ? 'Удалить с компьютера' : 'Убрать из библиотеки'}
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
          <DropdownMenuItem onSelect={onPlayNext}>
            <ListStart />
            Играть следующим
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onRadio}>
            <Radio />
            Радио по треку
          </DropdownMenuItem>
          <DropdownMenuSeparator />
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
      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{formatTime(t.duration)}</span>
      {/* Downloaded: ✓; downloading: spinner; online-only: nothing (the download button is among the actions). */}
      <div className="flex size-7 shrink-0 items-center justify-center">
        {download === 'done' && (
          <span title="Скачан">
            <Check className="size-4 text-muted-foreground" />
          </span>
        )}
        {download === 'queued' && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>
    </div>
  )
}
