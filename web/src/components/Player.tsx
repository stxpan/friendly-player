import { useEffect, useRef, useState } from 'react'
import { Music, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { formatTime, type Track } from '@/lib/api'
import { load, save } from '@/lib/storage'

type Props = {
  track: Track | null
  onNext: () => void
  onPrev: () => void
}

export function Player({ track, onNext, onPrev }: Props) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  // Slider position while the user drags it, so timeupdate doesn't fight the thumb.
  const [seek, setSeek] = useState<number | null>(null)
  const [volume, setVolume] = useState(() => load('player.volume', 1))
  const [muted, setMuted] = useState(() => load('player.muted', false))
  // Position saved before reload; applied once, when that same track loads again.
  const resumeAt = useRef(load<{ id: string; time: number } | null>('player.position', null))

  useEffect(() => {
    if (!audio.current) return
    audio.current.volume = volume
    audio.current.muted = muted
    save('player.volume', volume)
    save('player.muted', muted)
  }, [volume, muted])

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
        onEnded={onNext}
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
          <Button variant="ghost" size="icon" onClick={prev} disabled={!track}>
            <SkipBack />
          </Button>
          <Button size="icon-lg" className="rounded-full" onClick={toggle} disabled={!track}>
            {playing ? <Pause /> : <Play />}
          </Button>
          <Button variant="ghost" size="icon" onClick={onNext} disabled={!track}>
            <SkipForward />
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

      <div className="flex w-40 items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMuted(!muted)}
        >
          {muted || volume === 0 ? <VolumeX /> : <Volume2 />}
        </Button>
        <Slider
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
