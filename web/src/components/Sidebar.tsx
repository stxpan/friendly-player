import { Ellipsis, ListMusic, Music, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Playlist } from '@/lib/api'
import { cn } from '@/lib/utils'

export type View = 'all' | number

type Props = {
  view: View
  trackCount: number
  playlists: Playlist[]
  onSelect: (view: View) => void
  onCreate: () => void
  onRename: (p: Playlist) => void
  onDelete: (p: Playlist) => void
}

const itemClass = (active: boolean) =>
  cn(
    'group flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-muted',
    active && 'bg-muted font-medium',
  )

export function Sidebar({ view, trackCount, playlists, onSelect, onCreate, onRename, onDelete }: Props) {
  return (
    <aside className="flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r p-3">
      <button className={itemClass(view === 'all')} onClick={() => onSelect('all')}>
        <Music className="size-4" />
        <span className="flex-1 text-left">Все треки</span>
        <span className="text-xs tabular-nums text-muted-foreground">{trackCount}</span>
      </button>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between px-2 text-xs font-medium text-muted-foreground uppercase">
          Плейлисты
          <Button variant="ghost" size="icon-xs" onClick={onCreate} title="Новый плейлист">
            <Plus />
          </Button>
        </div>
        {playlists.length === 0 && (
          <button className="px-2 py-1 text-left text-sm text-muted-foreground hover:text-foreground" onClick={onCreate}>
            + Создать первый
          </button>
        )}
        {playlists.map((p) => (
          <div key={p.id} role="button" className={itemClass(view === p.id)} onClick={() => onSelect(p.id)}>
            <ListMusic className="size-4 shrink-0" />
            <span className="flex-1 truncate">{p.name}</span>
            <span className="text-xs tabular-nums text-muted-foreground group-hover:hidden">{p.tracks.length}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="hidden group-hover:inline-flex data-[state=open]:inline-flex"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-auto" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onSelect={() => onRename(p)}>
                  <Pencil />
                  Переименовать
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => onDelete(p)}>
                  <Trash2 />
                  Удалить
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </div>
    </aside>
  )
}
