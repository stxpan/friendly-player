import { useState } from 'react'
import { cn } from '@/lib/utils'

type Bar = { key: string; value: number; label: string; tooltip: string }

type Props = {
  bars: Bar[]
  // Axis labels under the bars; others are hidden so they don't collide.
  labelEvery: number
  formatMax: (value: number) => string
  className?: string
}

// Single-series bar chart: thin bars with a 2px gap, 4px rounded tops anchored to the baseline,
// recessive axis, a tooltip for the hovered bar. One series, so no legend — the card title names it.
export function BarChart({ bars, labelEvery, formatMax, className }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(...bars.map((b) => b.value), 0)

  return (
    <div className={cn('relative flex flex-col gap-1', className)}>
      <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
        <span>{max > 0 ? formatMax(max) : ''}</span>
      </div>
      <div className="relative flex h-32 items-end gap-[2px] border-b border-border" onMouseLeave={() => setHover(null)}>
        {bars.map((b, i) => (
          // The hit target is the full column height, larger than the bar itself.
          <div key={b.key} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)}>
            <div
              className={cn(
                'w-full rounded-t-[4px] bg-chart-1 transition-opacity',
                hover !== null && hover !== i && 'opacity-50',
              )}
              style={{ height: max > 0 && b.value > 0 ? `max(2px, ${(b.value / max) * 100}%)` : 0 }}
            />
          </div>
        ))}
        {hover !== null && (
          <div
            className="pointer-events-none absolute -top-8 z-10 rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md"
            style={{
              left: `${((hover + 0.5) / bars.length) * 100}%`,
              transform: `translateX(${hover / bars.length > 0.8 ? '-100%' : hover / bars.length < 0.2 ? '0' : '-50%'})`,
            }}
          >
            {bars[hover].tooltip}
          </div>
        )}
      </div>
      <div className="flex gap-[2px] text-[11px] text-muted-foreground tabular-nums">
        {bars.map((b, i) => (
          <span key={b.key} className="flex-1 overflow-visible text-center whitespace-nowrap">
            {i % labelEvery === 0 ? b.label : ''}
          </span>
        ))}
      </div>
    </div>
  )
}
