import { useRef, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@/lib/utils'

type Props<T> = {
  items: T[]
  getKey: (item: T) => string
  estimateSize: (item: T) => number
  render: (item: T) => ReactNode
  className?: string
}

// Only the rows in view are mounted: the library holds 1000+ tracks, each with its own menu.
// Rows are measured after render, so items of different heights are fine.
export function VirtualList<T>({ items, getKey, estimateSize, render, className }: Props<T>) {
  const scroller = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => estimateSize(items[i]),
    getItemKey: (i) => getKey(items[i]),
    overscan: 8,
  })

  return (
    <div ref={scroller} className={cn('overflow-y-auto', className)}>
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            data-index={row.index}
            ref={virtualizer.measureElement}
            className="absolute top-0 left-0 w-full"
            style={{ transform: `translateY(${row.start}px)` }}
          >
            {render(items[row.index])}
          </div>
        ))}
      </div>
    </div>
  )
}
