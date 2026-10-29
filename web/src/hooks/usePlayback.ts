import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { RepeatMode } from '@/components/Player'
import { usePersisted } from '@/hooks/usePersisted'
import { api, coverUrl, fromResult, fromTrack, type NowPlaying, type SearchResult, type Track } from '@/lib/api'
import { DAY_MS, shuffled } from '@/lib/library'

// How many tracks before the end of a radio mix more are fetched.
const RADIO_REFILL_AT = 5
// Smart shuffle: tracks heard this recently go to the end of a new mix.
const RECENT_DAYS = 3

// One button cycles through the modes: off → repeat track → repeat list.
const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = { off: 'one', one: 'all', all: 'off' }

// A YouTube Music result playing without being downloaded, and the results it was picked from.
// `radio` holds the seed track's title when the list is a radio mix rather than search results.
type Stream = { result: SearchResult; list: SearchResult[]; radio?: string }

type Options = {
  trackById: Map<string, Track>
  online: boolean
  lyricsOpen: boolean
  // What plays when nothing was started yet: the open view.
  viewTracks: Track[]
}

// What plays and in which order. Lists are identified by a `listKey` (view + search): the list
// a mix was made from is shown in playback order.
export function usePlayback({ trackById, online, lyricsOpen, viewTracks }: Options) {
  const [currentId, setCurrentId] = usePersisted<string | null>('player.trackId', null)
  // The list playback started from, in its own order; `queue` is the order it actually plays in
  // (the same list, or a shuffled copy). A fixed order lets the next track be prepared in advance.
  const [queueSource, setQueueSource] = usePersisted<string[]>('player.queueSource', [])
  const [queue, setQueue] = usePersisted<string[]>('player.queue', [])
  const [shuffle, setShuffle] = usePersisted('player.shuffle', false)
  // Which list on screen the current mix was made from.
  const [mixKey, setMixKey] = usePersisted<string | null>('player.mixKey', null)
  const [repeat, setRepeat] = usePersisted<RepeatMode>('player.repeat', 'off')
  const [stream, setStream] = useState<Stream | null>(null)
  // The <audio> element the player plays through; lyrics follow its time.
  const audio = useRef<HTMLAudioElement>(null)

  const recentlyPlayed = (id: string) => (trackById.get(id)?.lastPlayed ?? 0) > Date.now() - RECENT_DAYS * DAY_MS

  // A stream entry that's already downloaded plays from the local file (normalized, offline-safe).
  const playable = (r: SearchResult) => {
    const local = trackById.get(r.id)
    return local ? fromTrack(local) : fromResult(r)
  }
  const libraryTrack = currentId ? trackById.get(currentId) : undefined
  let current: NowPlaying | null = null
  if (stream) current = playable(stream.result)
  else if (libraryTrack) current = fromTrack(libraryTrack)

  // Without internet only downloaded tracks can play.
  const available = (id: string) => online || Boolean(trackById.get(id)?.file)

  // The next playable id in `ids` from position `from`, wrapping around when repeating the list;
  // unavailable (online-only while offline) tracks are skipped.
  const neighbour = (ids: string[], from: number, delta: 1 | -1) => {
    const n = ids.length
    for (let k = 1; k <= n; k++) {
      let j = from + delta * k
      if (j < 0 || j >= n) {
        if (repeat !== 'all') return undefined
        j = ((j % n) + n) % n
      }
      if (ids[j] !== ids[from] && available(ids[j])) return ids[j]
    }
    return undefined
  }

  const go = (id: string) => {
    if (!available(id)) return void toast.error('Нет интернета, а этот трек не скачан')
    setStream(null)
    setCurrentId(id)
  }

  const queueIds = useMemo(() => {
    const ids = queue.filter((id) => trackById.has(id))
    return ids.length ? ids : viewTracks.map((t) => t.id)
  }, [queue, trackById, viewTracks])

  // Streamed tracks play through the search results they were picked from.
  const stepStream = (s: Stream, delta: 1 | -1) => {
    const ids = s.list.map((r) => r.id)
    const n = s.list.length
    const at = ids.indexOf(s.result.id)
    const i = at + delta
    const id = neighbour(ids, at, delta)
    if (id) setStream({ ...s, result: s.list[ids.indexOf(id)] })
    // Radio is endless: near the end, extend the mix from its last track.
    if (s.radio && delta > 0 && i >= n - RADIO_REFILL_AT) {
      api
        .radio(s.list[n - 1].id)
        .then((more) =>
          setStream((cur) => {
            if (!cur?.radio) return cur
            const seen = new Set(cur.list.map((r) => r.id))
            return { ...cur, list: [...cur.list, ...more.filter((r) => !seen.has(r.id))] }
          }),
        )
        .catch(() => {})
    }
  }

  const step = (delta: 1 | -1) => {
    if (stream) return stepStream(stream, delta)
    const id = neighbour(queueIds, currentId ? queueIds.indexOf(currentId) : -1, delta)
    if (id) go(id)
  }

  // Resolves to whether the radio started.
  const startRadio = async (seed: { id: string; title: string }) => {
    try {
      const list = await api.radio(seed.id)
      if (!list.length) {
        toast.error('YouTube Music не нашёл похожих треков')
        return false
      }
      // The mix starts with the seed itself; if it's already playing, it just carries on into the radio.
      setStream({ result: list[0], list, radio: seed.title })
      toast.success(`Радио по «${seed.title}»`)
      return true
    } catch (e) {
      toast.error((e as Error).message)
      return false
    }
  }

  // Put a library track right after the one playing, in whichever list is playing now.
  const playNext = (t: Track) => {
    if (stream) {
      const asResult: SearchResult = {
        id: t.id,
        title: t.title,
        artist: t.artist ?? '',
        duration: t.duration,
        thumb: coverUrl(t.thumb),
      }
      const rest = stream.list.filter((r) => r.id !== t.id)
      const at = rest.findIndex((r) => r.id === stream.result.id) + 1
      setStream({ ...stream, list: [...rest.slice(0, at), asResult, ...rest.slice(at)] })
    } else {
      const rest = queueIds.filter((id) => id !== t.id)
      const at = currentId ? rest.indexOf(currentId) + 1 : 0
      setQueue([...rest.slice(0, at), t.id, ...rest.slice(at)])
    }
    toast.success(`«${t.title}» заиграет следующим`)
  }

  const isMix = (listKey: string) => shuffle && mixKey === listKey

  const play = (id: string, list: string[], listKey: string) => {
    // Clicked inside the mix on screen: jump to that track and keep the mix's order.
    if (isMix(listKey)) return go(id)
    setQueueSource(list)
    setQueue(shuffle ? shuffled(list, id, recentlyPlayed) : list)
    setMixKey(listKey)
    go(id)
  }

  // Shuffle builds a mix of `source` (what's on screen). The playing track stays first if it's
  // part of it; otherwise the mix starts right away.
  const toggleShuffle = (source: string[], listKey: string) => {
    if (shuffle) {
      setShuffle(false)
      if (queueSource.length) setQueue(queueSource)
      return
    }
    setShuffle(true)
    if (!source.length) return
    const keep = !stream && currentId && source.includes(currentId) ? currentId : undefined
    const mix = shuffled(source, keep, recentlyPlayed)
    setQueueSource(source)
    setQueue(mix)
    setMixKey(listKey)
    if (!keep) go(mix[0])
  }

  // A list was reordered by dragging; playback from it follows the new order.
  const reorder = (ids: string[], listKey: string) => {
    if (mixKey !== listKey) return
    setQueue(ids)
    if (!shuffle) setQueueSource(ids)
  }

  // A search result picked to play; without `list` it's a jump inside the stream playing now.
  const playResult = (result: SearchResult, list?: SearchResult[]) =>
    setStream((cur) => (list ? { result, list } : cur && { ...cur, result }))

  const forget = (id: string) => {
    if (id === currentId) setCurrentId(null)
  }

  // While lyrics are open, have the server time the next track's lyrics before it starts.
  const nextId = !stream && currentId ? neighbour(queueIds, queueIds.indexOf(currentId), 1) : undefined
  useEffect(() => {
    if (lyricsOpen && nextId) api.prepareLyrics(nextId).catch(() => {})
  }, [lyricsOpen, nextId])

  // An online track takes a few seconds to start (the server asks yt-dlp for the stream);
  // ask ahead for the next one so switching is instant.
  const upcomingId = stream
    ? neighbour(
        stream.list.map((r) => r.id),
        stream.list.findIndex((r) => r.id === stream.result.id),
        1,
      )
    : nextId
  const upcomingOnline = upcomingId !== undefined && !trackById.get(upcomingId)?.file
  useEffect(() => {
    if (online && upcomingId && upcomingOnline) api.prepareStream(upcomingId).catch(() => {})
  }, [online, upcomingId, upcomingOnline])

  return {
    audio,
    current,
    currentId,
    queue,
    stream,
    shuffle,
    repeat,
    available,
    isMix,
    play,
    playResult,
    playNext,
    startRadio,
    toggleShuffle,
    reorder,
    forget,
    next: () => step(1),
    prev: () => step(-1),
    cycleRepeat: () => setRepeat(NEXT_REPEAT[repeat]),
  }
}
