import { useEffect, useState } from 'react'
import { Loader2, Music } from 'lucide-react'
import { BarChart } from '@/components/BarChart'
import { Button } from '@/components/ui/button'
import { api, coverUrl, type Stats as StatsData } from '@/lib/api'
import { load, save } from '@/lib/storage'
import { cn } from '@/lib/utils'

const RANGES = [
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
  { days: 365, label: 'Год' },
  { days: 0, label: 'Всё время' },
]

function duration(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h ? `${h} ч ${m} мин` : `${m} мин`
}

const dayLabel = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' })
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

type Props = {
  onPlay: (id: string) => void
  onOpenArtist: (name: string) => void
}

export function Stats({ onPlay, onOpenArtist }: Props) {
  const [days, setDays] = useState(() => load('player.statsDays', 30))
  const [data, setData] = useState<StatsData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    save('player.statsDays', days)
    setError(null)
    api.stats(days).then(setData, (e) => setError(e.message))
  }, [days])

  if (error) return <p className="p-6 text-sm text-destructive">{error}</p>
  if (!data)
    return (
      <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Считаем…
      </p>
    )

  const tiles = [
    { label: 'Время прослушивания', value: duration(data.totalSeconds) },
    { label: 'Прослушиваний', value: data.plays.toLocaleString('ru') },
    { label: 'Разных треков', value: data.uniqueTracks.toLocaleString('ru') },
    {
      label: 'Серия',
      value: `${data.streak} ${plural(data.streak, 'день', 'дня', 'дней')} подряд`,
    },
  ]

  // A year of daily bars is too thin to read; show weeks instead.
  const weekly = data.daily.length > 62
  const series = weekly
    ? Array.from({ length: Math.ceil(data.daily.length / 7) }, (_, w) => {
        const week = data.daily.slice(w * 7, w * 7 + 7)
        return { day: week[0].day, seconds: week.reduce((s, d) => s + d.seconds, 0) }
      })
    : data.daily

  return (
    <div className="flex flex-col gap-6 overflow-y-auto p-4">
      <div className="flex gap-1">
        {RANGES.map((r) => (
          <Button key={r.days} variant={r.days === days ? 'secondary' : 'ghost'} size="sm" onClick={() => setDays(r.days)}>
            {r.label}
          </Button>
        ))}
      </div>

      {data.plays === 0 && data.totalSeconds === 0 ? (
        <div className="flex flex-col items-center gap-2 p-12 text-sm text-muted-foreground">
          <Music className="size-8" />
          За этот период ещё ничего не слушал — статистика копится с каждым треком.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">{t.label}</div>
                <div className="mt-1 text-xl font-semibold tabular-nums">{t.value}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-lg border p-4">
              <h3 className="mb-3 text-sm font-medium">{weekly ? 'Минут в неделю' : 'Минут в день'}</h3>
              <BarChart
                labelEvery={Math.ceil(series.length / 6)}
                formatMax={(v) => `${Math.round(v / 60)} мин`}
                bars={series.map((d) => ({
                  key: d.day,
                  value: d.seconds,
                  label: dayLabel.format(new Date(d.day)),
                  tooltip: `${weekly ? 'Неделя с ' : ''}${dayLabel.format(new Date(d.day))}: ${duration(d.seconds)}`,
                }))}
              />
            </section>
            <section className="rounded-lg border p-4">
              <h3 className="mb-3 text-sm font-medium">Когда слушаешь</h3>
              <BarChart
                labelEvery={6}
                formatMax={(v) => `${Math.round(v / 60)} мин`}
                bars={data.byHour.map((sec, h) => ({
                  key: String(h),
                  value: sec,
                  label: `${h}:00`,
                  tooltip: `${h}:00–${h + 1}:00: ${duration(sec)}`,
                }))}
              />
            </section>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-lg border p-2">
              <h3 className="px-2 py-2 text-sm font-medium">Топ треков</h3>
              {data.topTracks.map((t, i) => (
                <button
                  key={t.id}
                  onClick={() => onPlay(t.id)}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                >
                  <span className="w-5 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                  <div className="size-9 shrink-0 overflow-hidden rounded bg-muted">
                    {t.thumb && <img src={coverUrl(t.thumb)!} alt="" className="size-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{t.title}</div>
                    <div className="truncate text-xs text-muted-foreground">{t.artist}</div>
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">{t.plays}×</span>
                </button>
              ))}
            </section>

            <section className="rounded-lg border p-2">
              <h3 className="px-2 py-2 text-sm font-medium">Топ исполнителей</h3>
              {data.topArtists.map((a, i) => (
                <button
                  key={a.artist}
                  onClick={() => onOpenArtist(a.artist)}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted"
                >
                  <span className="w-5 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{a.artist}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {a.plays}× · {duration(a.seconds)}
                  </span>
                </button>
              ))}
            </section>
          </div>

          {data.mostSkipped.length > 0 && (
            <section className={cn('rounded-lg border p-2')}>
              <h3 className="px-2 pt-2 text-sm font-medium">Чаще всего пропускаешь</h3>
              <p className="px-2 pb-2 text-xs text-muted-foreground">Может, их пора удалить?</p>
              {data.mostSkipped.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onPlay(t.id)}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{t.title}</div>
                    <div className="truncate text-xs text-muted-foreground">{t.artist}</div>
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">пропущен {t.skips}×</span>
                </button>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}
