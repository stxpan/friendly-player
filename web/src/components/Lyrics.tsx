import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Loader2 } from 'lucide-react'
import { api, type Lyrics as LyricsData } from '@/lib/api'
import { cn } from '@/lib/utils'

type Line = { time: number; text: string }

// LRC: "[01:23.45] text" per line; lines without a timestamp (metadata, blanks) are dropped.
function parseLrc(lrc: string): Line[] {
  return lrc.split('\n').flatMap((raw) => {
    const m = /^\[(\d+):(\d+(?:\.\d+)?)\]\s?(.*)$/.exec(raw.trim())
    return m ? [{ time: Number(m[1]) * 60 + Number(m[2]), text: m[3] }] : []
  })
}

type Props = {
  trackId: string | null
  audio: RefObject<HTMLAudioElement | null>
}

export function Lyrics({ trackId, audio }: Props) {
  const [data, setData] = useState<LyricsData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState(-1)
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([])

  useEffect(() => {
    setData(null)
    setError(null)
    if (!trackId) return
    setLoading(true)
    const ctrl = new AbortController()
    api
      .lyrics(trackId, ctrl.signal)
      .then(setData)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message)
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    return () => ctrl.abort()
  }, [trackId])

  const lines = useMemo(() => (data?.synced ? parseLrc(data.synced) : []), [data])

  // Follow playback: the active line is the last one whose timestamp has passed.
  useEffect(() => {
    const a = audio.current
    if (!a || lines.length === 0) return
    const onTime = () => {
      let i = lines.length - 1
      while (i >= 0 && lines[i].time > a.currentTime) i--
      setActive(i)
    }
    onTime()
    a.addEventListener('timeupdate', onTime)
    return () => a.removeEventListener('timeupdate', onTime)
  }, [audio, lines])

  useEffect(() => {
    lineRefs.current[active]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [active])

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
    body = lines.map((l, i) => (
      <p
        key={i}
        ref={(el) => {
          lineRefs.current[i] = el
        }}
        onClick={() => {
          if (audio.current) audio.current.currentTime = l.time
        }}
        className={cn(
          'cursor-pointer py-1 transition-colors hover:text-foreground',
          i === active ? 'font-medium text-foreground' : 'text-muted-foreground',
        )}
      >
        {l.text || '♪'}
      </p>
    ))
  else if (data?.plain) body = <p className="whitespace-pre-line">{data.plain}</p>
  else body = <p className="text-muted-foreground">Текст не найден</p>

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l">
      <h2 className="border-b px-4 py-3 text-sm font-medium">Текст</h2>
      <div className="flex-1 overflow-y-auto px-4 py-3 text-sm leading-relaxed">{body}</div>
    </aside>
  )
}
