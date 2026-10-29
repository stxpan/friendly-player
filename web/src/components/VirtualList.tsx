import { useRef, useState, type ReactNode } from 'react'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { restrictToVerticalAxis } from '@/lib/dnd'
import { cn } from '@/lib/utils'

type Props<T> = {
  items: T[]
  getKey: (item: T) => string
  estimateSize: (item: T) => number
  render: (item: T) => ReactNode
  className?: string
  // Drag to reorder: ids that can be dragged, and what to do when one is dropped onto another.
  sortable?: { ids: string[]; onMove: (activeId: string, overId: string) => void }
}

function SortableRow({ id, disabled, children }: { id: string; disabled: boolean; children: ReactNode }) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      // The row stays as a faint placeholder; the copy under the cursor is the DragOverlay.
      className={cn(isDragging && 'opacity-30')}
    >
      {children}
    </div>
  )
}

// Only the rows in view are mounted: the library holds 1000+ tracks, each with its own menu.
// Rows are measured after render, so items of different heights are fine.
export function VirtualList<T>({ items, getKey, estimateSize, render, className, sortable }: Props<T>) {
  const scroller = useRef<HTMLDivElement>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const activeIndex = activeId ? items.findIndex((item) => getKey(item) === activeId) : -1

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => estimateSize(items[i]),
    getItemKey: (i) => getKey(items[i]),
    overscan: 8,
    // Keep the dragged row mounted even when it's scrolled out of view, or dnd-kit loses it.
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range)
      return activeIndex === -1 || indexes.includes(activeIndex) ? indexes : [...indexes, activeIndex].sort((a, b) => a - b)
    },
  })
  // Mouse only: a few pixels of movement before a drag starts, so a click still plays the track.
  // (No keyboard dragging: Space on a focused row must stay play/pause.)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const draggable = new Set(sortable?.ids)

  const onDragStart = ({ active }: DragStartEvent) => setActiveId(String(active.id))
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null)
    if (sortable && over && active.id !== over.id) sortable.onMove(String(active.id), String(over.id))
  }

  return (
    <div ref={scroller} className={cn('overflow-y-auto', className)}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <SortableContext items={sortable?.ids ?? []} strategy={verticalListSortingStrategy}>
          <div
            // While dragging, rows under the cursor mustn't light up as if hovered.
            className={cn('relative w-full', activeId && 'pointer-events-none')}
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((row) => {
              const key = String(row.key)
              return (
                <div
                  key={row.key}
                  data-index={row.index}
                  ref={virtualizer.measureElement}
                  className="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${row.start}px)` }}
                >
                  <SortableRow id={key} disabled={!draggable.has(key)}>
                    {render(items[row.index])}
                  </SortableRow>
                </div>
              )
            })}
          </div>
        </SortableContext>
        <DragOverlay>
          {activeIndex !== -1 && (
            <div className="pointer-events-none rounded-md bg-popover shadow-lg ring-1 ring-border">
              {render(items[activeIndex])}
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
