import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Loader2 } from 'lucide-react'
import { api, type Lyrics as LyricsData, type NowPlaying } from '@/lib/api'
import { cn } from '@/lib/utils'

type Line = { time: number; text: string }

// LRC: "[01:23.45] text" per line; lines without a timestamp (metadata, blanks) are dropped.
function parseLrc(lrc: string): Line[] {
  return lrc.split('\n').flatMap((raw) => {
    const m = /^\[(\d+):(\d+(?:\.\d+)?)\]\s?(.*)$/.exec(raw.trim())
    return m ? [{ time: Number(m[1]) * 60 + Number(m[2]), text: m[3] }] : []
  })
}

const SCROLL_MS = 600
const SYNC_POLL_MS = 3000
const RETRY_MS = 15000
const SYNC_STATUS = {
  model: 'Скачиваем модель синхронизации (364 МБ, один раз)…',
  queued: 'В очереди на синхронизацию…',
  aligning: 'Синхронизируем текст с песней…',
}
// After the user scrolls by hand, leave the text where they put it for a while.
const MANUAL_SCROLL_PAUSE_MS = 3000

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Ease-out cubic scroll: starts quick, settles softly. Native smooth scrolling is short and abrupt.
function scrollSmoothly(el: HTMLElement, to: number, frame: { id: number }) {
  cancelAnimationFrame(frame.id)
  const from = el.scrollTop
  if (reducedMotion() || Math.abs(to - from) < 1) {
    el.scrollTop = to
    return
  }
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / SCROLL_MS)
    el.scrollTop = from + (to - from) * (1 - (1 - t) ** 3)
    if (t < 1) frame.id = requestAnimationFrame(step)
  }
  frame.id = requestAnimationFrame(step)
}

type Props = {
  tabs: ReactNode
  side: 'left' | 'right'
  track: NowPlaying | null
  audio: RefObject<HTMLAudioElement | null>
}

export function Lyrics({ tabs, side, track, audio }: Props) {
  const [data, setData] = useState<LyricsData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState(-1)
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([])
  const scroller = useRef<HTMLDivElement>(null)
  const scrollFrame = useRef({ id: 0 })
  const manualScrollAt = useRef(0)
  // The track object is rebuilt on every render; fetch only when the id changes.
  const trackId = track?.id ?? null
  const current = useRef(track)
  current.current = track

  useEffect(() => {
    setData(null)
    setError(null)
    setActive(-1)
    const t = current.current
    if (!t) return
    setLoading(true)
    const ctrl = new AbortController()
    let timer = 0
    const fetchLyrics = () =>
      // Library tracks are looked up (and cached) by id; streamed ones by title, uncached.
      (t.streamed ? api.lyricsSearch(t, ctrl.signal) : api.lyrics(t.id, ctrl.signal))
        .then((l) => {
          setData(l)
          // Plain text is shown right away; keep asking until the background timing is done.
          if (l.syncing) timer = window.setTimeout(fetchLyrics, SYNC_POLL_MS)
          else if (l.retry) timer = window.setTimeout(fetchLyrics, RETRY_MS)
        })
        .catch((e) => {
          if (e.name !== 'AbortError') setError(e.message)
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setLoading(false)
        })
    fetchLyrics()
    return () => {
      ctrl.abort()
      clearTimeout(timer)
    }
  }, [trackId])

  const lines = useMemo(() => (data?.synced ? parseLrc(data.synced) : []), [data])

  // Follow playback every frame: timeupdate fires only ~4 times a second, which makes the
  // highlight visibly lag behind the vocals. State only changes when the line does.
  useEffect(() => {
    if (lines.length === 0) return
    let frame = 0
    const tick = () => {
      const a = audio.current
      if (a) {
        let i = lines.length - 1
        while (i >= 0 && lines[i].time > a.currentTime) i--
        setActive(i)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [audio, lines])

  // Keep the active line in the middle of the panel.
  useEffect(() => {
    const el = scroller.current
    const line = lineRefs.current[active]
    if (!el || !line || Date.now() - manualScrollAt.current < MANUAL_SCROLL_PAUSE_MS) return
    scrollSmoothly(el, line.offsetTop - el.clientHeight / 2 + line.offsetHeight / 2, scrollFrame.current)
  }, [active])

  useEffect(() => () => cancelAnimationFrame(scrollFrame.current.id), [])

  const onManualScroll = () => {
    manualScrollAt.current = Date.now()
    cancelAnimationFrame(scrollFrame.current.id)
  }

  let body
  if (!trackId) body = <p className="text-muted-foreground">Ничего не играет</p>
  else if (loading)
    body = (
      <p className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Ищем текст…
      </p>
    )
  else if (error) body = <p className="text-destructive">{error}</p>
  else if (lines.length)
    // Top/bottom padding lets the first and last lines reach the middle too.
    body = (
      <div className="py-[40vh]">
        {lines.map((l, i) => {
          const distance = Math.abs(i - active)
          return (
            <p
              key={i}
              ref={(el) => {
                lineRefs.current[i] = el
              }}
              onClick={() => {
                if (audio.current) audio.current.currentTime = l.time
                manualScrollAt.current = 0
              }}
              className={cn(
                'origin-left cursor-pointer py-2 text-2xl leading-snug font-bold tracking-tight',
                'transition-[color,opacity,transform,filter] duration-500 ease-out motion-reduce:transition-none',
                i === active
                  ? 'scale-100 text-foreground opacity-100'
                  : 'scale-[0.97] text-foreground opacity-35 hover:opacity-70',
                // Soft focus on lines away from the current one; cleared on hover so any line stays readable.
                i !== active && distance > 1 && 'blur-[1px] hover:blur-none',
              )}
            >
              {l.text || '♪'}
            </p>
          )
        })}
      </div>
    )
  else if (data?.plain)
    body = (
      <>
        {data.syncing ? (
          <p className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> {SYNC_STATUS[data.syncing]}
          </p>
        ) : (
          <p className="mb-3 text-xs text-muted-foreground">Без синхронизации — для этого трека нет текста с таймингом</p>
        )}
        <p className="text-base leading-relaxed whitespace-pre-line">{data.plain}</p>
      </>
    )
  else if (data?.retry)
    body = (
      <p className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> LRCLIB сейчас перегружен — попробуем ещё раз через 15 секунд
      </p>
    )
  else body = <p className="text-muted-foreground">Автор не добавил текст для этой композиции</p>

  return (
    <aside className={cn('flex w-96 shrink-0 flex-col', side === 'right' ? 'border-l' : 'border-r')}>
      <h2 className="flex items-baseline justify-between border-b px-5 py-3 text-sm font-medium">
        {tabs}
        {data?.source && (
          <span className="text-xs font-normal text-muted-foreground">
            {data.source === 'Авто' ? 'Синхронизировано автоматически' : data.source}
          </span>
        )}
      </h2>
      <div
        ref={scroller}
        onWheel={onManualScroll}
        onTouchMove={onManualScroll}
        className="relative flex-1 overflow-y-auto px-5 py-3 text-sm"
      >
        {body}
      </div>
    </aside>
  )
}
