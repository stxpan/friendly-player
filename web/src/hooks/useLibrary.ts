import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api, type Job, type Playlist, type Track } from '@/lib/api'

// Library tracks, playlists and the server's add/download queue (polled every second).
export function useLibrary() {
  const [tracks, setTracks] = useState<Track[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const completed = useRef(0)

  const loadTracks = useCallback(() => {
    api.tracks().then(setTracks).catch((e) => toast.error(e.message))
  }, [])
  const loadPlaylists = useCallback(() => {
    api.playlists().then(setPlaylists).catch((e) => toast.error(e.message))
  }, [])

  useEffect(loadTracks, [loadTracks])
  useEffect(loadPlaylists, [loadPlaylists])

  useEffect(() => {
    const id = setInterval(async () => {
      const q = await api.queue().catch(() => null)
      if (!q) return
      setJobs(q.jobs)
      if (q.completed !== completed.current) {
        completed.current = q.completed
        loadTracks()
        // Imports into a playlist fill it as tracks are found.
        loadPlaylists()
      }
    }, 1000)
    return () => clearInterval(id)
  }, [loadTracks, loadPlaylists])

  const trackById = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks])
  const downloadingIds = useMemo(
    () => new Set(jobs.filter((j) => j.kind === 'download' && j.status !== 'error').map((j) => j.videoId)),
    [jobs],
  )

  return { tracks, setTracks, playlists, setPlaylists, jobs, trackById, downloadingIds, loadTracks, loadPlaylists }
}

export type Library = ReturnType<typeof useLibrary>
