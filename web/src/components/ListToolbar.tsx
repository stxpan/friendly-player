import { ArrowUpDown, Download, Shuffle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SORT_LABELS, type Sort } from '@/lib/library'

type Props = {
  title: string
  // Track count next to the title; null on pages that aren't a track list.
  count: number | null
  // A failed import the user is picking a replacement for; replaces the title.
  fixing: string | null
  onCancelFix: () => void
  // Online-only tracks on screen that "Download all" would fetch.
  downloadCount: number
  onDownloadAll: () => void
  // Absent where the list has its own fixed order.
  sort?: { value: Sort; mixed: boolean; onChange: (s: Sort) => void }
}

// The bar above the list: its title, "Download all" and the sort menu.
export function ListToolbar({ title, count, fixing, onCancelFix, downloadCount, onDownloadAll, sort }: Props) {
  return (
    <div className="flex h-11 items-center justify-between gap-2 px-4">
      {fixing ? (
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="truncate">
            Выбери замену для <span className="font-medium">«{fixing}»</span> — нажми ⬇ у нужного трека
          </span>
          <Button variant="ghost" size="icon-xs" onClick={onCancelFix} title="Отменить">
            <X />
          </Button>
        </div>
      ) : (
        <h1 className="truncate text-sm font-medium">
          {title}
          {count !== null && <span className="font-normal text-muted-foreground"> · {count}</span>}
        </h1>
      )}
      {downloadCount > 0 && (
        <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" onClick={onDownloadAll}>
          <Download />
          Скачать всё ({downloadCount})
        </Button>
      )}
      {sort && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              {sort.mixed ? <Shuffle /> : <ArrowUpDown />}
              {sort.mixed ? 'Порядок воспроизведения' : SORT_LABELS[sort.value]}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto">
            <DropdownMenuRadioGroup value={sort.mixed ? '' : sort.value} onValueChange={(v) => sort.onChange(v as Sort)}>
              {(Object.keys(SORT_LABELS) as Sort[]).map((s) => (
                <DropdownMenuRadioItem key={s} value={s}>
                  {SORT_LABELS[s]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
