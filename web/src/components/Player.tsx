import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  Check,
  Download,
  Loader2,
  MicVocal,
  Music,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { api, formatTime, type NowPlaying } from '@/lib/api'
import '@/lib/desktop'
import { load, save } from '@/lib/storage'
import { cn } from '@/lib/utils'

export type RepeatMode = 'off' | 'one' | 'all'
export type DownloadState = 'none' | 'queued' | 'done'

// Loudness tracks are brought down to (YouTube's own playback target). Quieter tracks are left
// as is: <audio>.volume can't go above 1.
const TARGET_LUFS = -14

type Props = {
  audio: RefObject<HTMLAudioElement | null>
  track: NowPlaying | null
  // For a streamed track: whether it's already saved, and how to save it.
  download: { state: DownloadState; start: () => void } | null
  shuffle: boolean
  onToggleShuffle: () => void
  repeat: RepeatMode
  onCycleRepeat: () => void
  lyricsOpen: boolean
  onToggleLyrics: () => void
  onNext: () => void
  onPrev: () => void
  // A listening session was saved; play counts changed.
  onPlayRecorded: () => void
  // Bring loud tracks down to a common level (setting).
  normalize: boolean
}

type Session = { trackId: string; playedAt: number; listened: number; lastTime: number }

export function Player({
  audio,
  track,
  download,
  shuffle,
  onToggleShuffle,
  repeat,
  onCycleRepeat,
  lyricsOpen,
  onToggleLyrics,
  onNext,
  onPrev,
  onPlayRecorded,
  normalize,
}: Props) {
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  // Slider position while the user drags it, so timeupdate doesn't fight the thumb.
  const [seek, setSeek] = useState<number | null>(null)
  const [volume, setVolume] = useState(() => load('player.volume', 0.5))
  const [muted, setMuted] = useState(() => load('player.muted', false))
  // Position saved before reload; applied once, when that same track loads again.
  const resumeAt = useRef(load<{ id: string; time: number } | null>('player.position', null))

  // Source and loudness are fixed for as long as a track plays. When an online track finishes
  // downloading mid-play, switching to the local file would restart it from zero, and its freshly
  // measured loudness would jump the volume; both apply from the next play on.
  const started = useRef<{ id?: string; src?: string; loudness?: number | null }>({})
  if (started.current.id !== track?.id) started.current = { id: track?.id, src: track?.src, loudness: track?.loudness }
  const { src, loudness } = started.current
  const gain = normalize && loudness != null ? Math.min(1, 10 ** ((TARGET_LUFS - loudness) / 20)) : 1

  useEffect(() => {
    if (!audio.current) return
    audio.current.volume = volume * gain
    audio.current.muted = muted
    save('player.volume', volume)
    save('player.muted', muted)
  }, [audio, volume, muted, gain])

  // --- listening statistics ---
  // Seconds actually heard (seeking doesn't count) for the current library track. Reported when
  // the track changes or ends, and when the tab closes.
  const session = useRef<Session | null>(null)
  const recorded = useRef(onPlayRecorded)
  recorded.current = onPlayRecorded

  const flush = (completed: boolean) => {
    const s = session.current
    session.current = null
    if (!s || s.listened < 1) return
    api
      .recordPlay({ trackId: s.trackId, playedAt: s.playedAt, listened: Math.round(s.listened), completed })
      .then(() => recorded.current())
      .catch(() => {})
  }

  const startSession = () => {
    session.current =
      track && !track.streamed ? { trackId: track.id, playedAt: Date.now(), listened: 0, lastTime: audio.current?.currentTime ?? 0 } : null
  }

  useEffect(() => {
    startSession()
    return () => flush(false)
    // Keyed by id on purpose: one session per track, not per render.
  }, [track?.id, track?.streamed])

  useEffect(() => {
    const onHide = () => {
      const s = session.current
      if (!s || s.listened < 1) return
      const body = JSON.stringify({ trackId: s.trackId, playedAt: s.playedAt, listened: Math.round(s.listened), completed: false })
      navigator.sendBeacon('/api/plays', new Blob([body], { type: 'application/json' }))
      session.current = null
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [])

  const toggle = () => {
    const a = audio.current
    if (!a || !track) return
    if (a.paused) a.play()
    else a.pause()
  }

  const prev = () => {
    const a = audio.current
    if (a && a.currentTime > 3) a.currentTime = 0
    else onPrev()
  }

  // Media keys and hotkeys are registered once; they call through this ref to get fresh callbacks.
  const actions = useRef({ toggle, prev, next: onNext })
  actions.current = { toggle, prev, next: onNext }

  // Media keys and the Windows media overlay.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = track
      ? new MediaMetadata({
          title: track.title,
          artist: track.artist ?? '',
          artwork: track.cover ? [{ src: new URL(track.cover, location.origin).href }] : [],
        })
      : null
  }, [track])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => audio.current?.play()],
      ['pause', () => audio.current?.pause()],
      ['previoustrack', () => actions.current.prev()],
      ['nexttrack', () => actions.current.next()],
      [
        'seekto',
        (d) => {
          if (audio.current && d.seekTime != null) audio.current.currentTime = d.seekTime
        },
      ],
    ]
    for (const [action, handler] of handlers) navigator.mediaSession.setActionHandler(action, handler)
    return () => {
      for (const [action] of handlers) navigator.mediaSession.setActionHandler(action, null)
    }
  }, [audio])

  // Ctrl+Shift+A / Ctrl+Shift+D: previous / next track. The desktop app registers them system-wide,
  // so they also work from other apps; in a browser they work while the page is focused.
  // By physical key, so they're the same keys in any layout.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return
      if (e.code === 'KeyA') actions.current.prev()
      else if (e.code === 'KeyD') actions.current.next()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    const unsubscribe = window.desktop?.onTrackHotkey((action) => actions.current[action]())
    return () => {
      window.removeEventListener('keydown', onKey)
      unsubscribe?.()
    }
  }, [])

  // Space: play/pause, ←/→: seek 5 s, ↑/↓: volume. Ignored while typing or inside menus and dialogs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, [contenteditable="true"], [role="dialog"], [role="menu"], [role="slider"]')) return
      const a = audio.current
      if (!a) return
      switch (e.code) {
        case 'Space':
          actions.current.toggle()
          break
        case 'ArrowLeft':
          a.currentTime = Math.max(0, a.currentTime - 5)
          break
        case 'ArrowRight':
          a.currentTime = Math.min(a.duration || 0, a.currentTime + 5)
          break
        case 'ArrowUp':
          setVolume((v) => Math.min(1, Math.round((v + 0.05) * 100) / 100))
          setMuted(false)
          break
        case 'ArrowDown':
          setVolume((v) => Math.max(0, Math.round((v - 0.05) * 100) / 100))
          break
        default:
          return
      }
      // Also keeps Space from "clicking" a focused button a second time.
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [audio])

  return (
    <footer className="grid grid-cols-[minmax(0,1fr)_minmax(0,36rem)_minmax(0,1fr)] items-center gap-6 border-t bg-card px-4 py-3">
      <audio
        ref={audio}
        src={src}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => {
          if (track) toast.error(`Не удалось воспроизвести «${track.title}»`)
        }}
        onTimeUpdate={(e) => {
          setTime(e.currentTarget.currentTime)
          const s = session.current
          if (s) {
            // Small forward steps are playback; jumps are seeks and don't count as listening.
            const step = e.currentTarget.currentTime - s.lastTime
            if (step > 0 && step < 2) s.listened += step
            s.lastTime = e.currentTarget.currentTime
          }
          // Streams aren't restored after reload, so their position isn't worth keeping.
          if (track && !track.streamed) save('player.position', { id: track.id, time: e.currentTarget.currentTime })
        }}
        onLoadedMetadata={(e) => {
          const a = e.currentTarget
          setDuration(a.duration)
          // Restored after reload: seek and stay paused. Otherwise the user picked a track — play it.
          if (resumeAt.current?.id === track?.id) a.currentTime = resumeAt.current!.time
          else a.play()
          resumeAt.current = null
        }}
        onEnded={(e) => {
          flush(true)
          if (repeat === 'one') {
            startSession()
            e.currentTarget.currentTime = 0
            e.currentTarget.play()
          } else onNext()
        }}
      />

      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
          {track?.cover ? (
            <img src={track.cover} alt="" className="size-full object-cover" />
          ) : (
            <Music className="size-5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" title={track?.title}>
            {track?.title ?? 'Ничего не играет'}
          </div>
          <div className="truncate text-xs text-muted-foreground" title={track?.artist ?? undefined}>
            {track?.streamed && download?.state !== 'done' ? `YouTube Music · ${track.artist}` : track?.artist}
          </div>
        </div>
        {download && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            disabled={download.state !== 'none'}
            onClick={download.start}
            title={{ none: 'Скачать в библиотеку', queued: 'Скачивается…', done: 'В библиотеке' }[download.state]}
          >
            {download.state === 'done' ? <Check /> : download.state === 'queued' ? <Loader2 className="animate-spin" /> : <Download />}
          </Button>
        )}
      </div>

      <div className="flex min-w-0 flex-col items-center gap-1">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onCycleRepeat}
            aria-pressed={repeat !== 'off'}
            title={{ off: 'Повтор выключен', one: 'Повтор трека', all: 'Повтор списка' }[repeat]}
            className={cn(repeat === 'off' ? 'text-muted-foreground' : 'text-primary')}
          >
            {repeat === 'one' ? <Repeat1 /> : <Repeat />}
          </Button>
          <Button variant="ghost" size="icon" onClick={prev} disabled={!track}>
            <SkipBack />
          </Button>
          <Button size="icon-lg" className="rounded-full" onClick={toggle} disabled={!track}>
            {playing ? <Pause /> : <Play />}
          </Button>
          <Button variant="ghost" size="icon" onClick={onNext} disabled={!track}>
            <SkipForward />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleShuffle}
            aria-pressed={shuffle}
            title={shuffle ? 'Перемешивание включено' : 'Перемешивание выключено'}
            className={cn(shuffle ? 'text-primary' : 'text-muted-foreground')}
          >
            <Shuffle />
          </Button>
        </div>
        <div className="flex w-full items-center gap-2 text-xs tabular-nums text-muted-foreground">
          <span className="w-10 text-right">{formatTime(seek ?? time)}</span>
          <Slider
            value={[seek ?? time]}
            max={duration || 1}
            step={1}
            disabled={!track}
            onValueChange={([v]) => setSeek(v)}
            onValueCommit={([v]) => {
              if (audio.current) audio.current.currentTime = v
              setSeek(null)
            }}
          />
          <span className="w-10">{formatTime(duration)}</span>
        </div>
      </div>

      <div className="flex min-w-0 items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleLyrics}
          aria-pressed={lyricsOpen}
          title="Текст песни"
          className={cn(lyricsOpen ? 'text-primary' : 'text-muted-foreground')}
        >
          <MicVocal />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setMuted(!muted)}>
          {muted || volume === 0 ? <VolumeX /> : <Volume2 />}
        </Button>
        <Slider
          className="w-28"
          value={[muted ? 0 : volume]}
          max={1}
          step={0.01}
          onValueChange={([v]) => {
            setVolume(v)
            setMuted(false)
          }}
        />
      </div>
    </footer>
  )
}
