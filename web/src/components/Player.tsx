import { useEffect, useRef, useState, type RefObject } from 'react'
import {
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
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { formatTime, type Track } from '@/lib/api'
import { load, save } from '@/lib/storage'
import { cn } from '@/lib/utils'

export type RepeatMode = 'off' | 'one' | 'all'

// Loudness tracks are brought down to (YouTube's own playback target). Quieter tracks are left
// as is: <audio>.volume can't go above 1.
const TARGET_LUFS = -14

type Props = {
  audio: RefObject<HTMLAudioElement | null>
  track: Track | null
  shuffle: boolean
  onToggleShuffle: () => void
  repeat: RepeatMode
  onCycleRepeat: () => void
  lyricsOpen: boolean
  onToggleLyrics: () => void
  onNext: () => void
  onPrev: () => void
}

export function Player({
  audio,
  track,
  shuffle,
  onToggleShuffle,
  repeat,
  onCycleRepeat,
  lyricsOpen,
  onToggleLyrics,
  onNext,
  onPrev,
}: Props) {
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  // Slider position while the user drags it, so timeupdate doesn't fight the thumb.
  const [seek, setSeek] = useState<number | null>(null)
  const [volume, setVolume] = useState(() => load('player.volume', 1))
  const [muted, setMuted] = useState(() => load('player.muted', false))
  // Position saved before reload; applied once, when that same track loads again.
  const resumeAt = useRef(load<{ id: string; time: number } | null>('player.position', null))

  const gain = track?.loudness != null ? Math.min(1, 10 ** ((TARGET_LUFS - track.loudness) / 20)) : 1

  useEffect(() => {
    if (!audio.current) return
    audio.current.volume = volume * gain
    audio.current.muted = muted
    save('player.volume', volume)
    save('player.muted', muted)
  }, [audio, volume, muted, gain])

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
          artwork: track.thumb ? [{ src: new URL(`/media/${track.thumb}`, location.origin).href }] : [],
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
    <footer className="flex items-center gap-4 border-t bg-card px-4 py-3">
      <audio
        ref={audio}
        src={track ? `/media/${track.file}` : undefined}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          setTime(e.currentTarget.currentTime)
          if (track) save('player.position', { id: track.id, time: e.currentTarget.currentTime })
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
          if (repeat === 'one') {
            e.currentTarget.currentTime = 0
            e.currentTarget.play()
          } else onNext()
        }}
      />

      <div className="flex w-64 min-w-0 items-center gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
          {track?.thumb ? (
            <img src={`/media/${track.thumb}`} alt="" className="size-full object-cover" />
          ) : (
            <Music className="size-5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{track?.title ?? 'Ничего не играет'}</div>
          <div className="truncate text-xs text-muted-foreground">{track?.artist}</div>
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center gap-1">
        <div className="flex items-center gap-1">
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
            onClick={onCycleRepeat}
            aria-pressed={repeat !== 'off'}
            title={{ off: 'Повтор выключен', one: 'Повтор трека', all: 'Повтор списка' }[repeat]}
            className={cn(repeat === 'off' ? 'text-muted-foreground' : 'text-primary')}
          >
            {repeat === 'one' ? <Repeat1 /> : <Repeat />}
          </Button>
        </div>
        <div className="flex w-full max-w-xl items-center gap-2 text-xs tabular-nums text-muted-foreground">
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

      <div className="flex w-52 items-center justify-end gap-2">
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
