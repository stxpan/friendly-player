import {
  ChartColumn,
  Copy,
  Ellipsis,
  Flame,
  Hourglass,
  ListMusic,
  Music,
  Pencil,
  Plus,
  Radio,
  Settings,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Playlist } from '@/lib/api'
import { cn } from '@/lib/utils'

// Smart lists are built from listening statistics; `artist:<name>` is an artist page.
export type SmartView = 'top' | 'stale' | 'never'
export type View = 'all' | SmartView | 'stats' | 'duplicates' | 'radio' | 'settings' | number | `artist:${string}`

export const SMART_VIEWS: Record<SmartView, { label: string; icon: typeof Music }> = {
  top: { label: 'Часто слушаю', icon: Flame },
  stale: { label: 'Давно не слушал', icon: Hourglass },
  never: { label: 'Ни разу не слушал', icon: Sparkles },
}

type Props = {
  // Which edge of the window the menu sits on; the border faces the content.
  side: 'left' | 'right'
  view: View
  trackCount: number
  smartCounts: Record<SmartView, number>
  duplicateCount: number
  // Seed track of the radio that's playing, if any.
  radioTitle: string | null
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

export function Sidebar({
  side,
  view,
  trackCount,
  smartCounts,
  duplicateCount,
  radioTitle,
  playlists,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: Props) {
  const item = (v: View, Icon: typeof Music, label: string, count?: number) => (
    <button className={itemClass(view === v)} onClick={() => onSelect(v)}>
      <Icon className="size-4 shrink-0" />
      <span className="flex-1 truncate text-left">{label}</span>
      {count !== undefined && <span className="text-xs tabular-nums text-muted-foreground">{count}</span>}
    </button>
  )

  return (
    <aside className={cn('flex w-56 shrink-0 flex-col gap-4 overflow-y-auto p-3', side === 'left' ? 'border-r' : 'border-l')}>
      <div className="flex flex-col gap-1">
        {item('all', Music, 'Все треки', trackCount)}
        {item('stats', ChartColumn, 'Статистика')}
        {item('settings', Settings, 'Настройки')}
        {duplicateCount > 0 && item('duplicates', Copy, 'Дубликаты', duplicateCount)}
        {radioTitle && item('radio', Radio, `Радио: ${radioTitle}`)}
      </div>

      <div className="flex flex-col gap-1">
        <div className="px-2 text-xs font-medium text-muted-foreground uppercase">Подборки</div>
        {(Object.keys(SMART_VIEWS) as SmartView[]).map((v) => (
          <div key={v}>{item(v, SMART_VIEWS[v].icon, SMART_VIEWS[v].label, smartCounts[v])}</div>
        ))}
      </div>

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
