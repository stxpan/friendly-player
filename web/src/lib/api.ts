export type Track = {
  id: string
  title: string
  artist: string | null
  duration: number | null
  file: string
  thumb: string | null
  addedAt: number
  loudness: number | null
  playCount: number
  lastPlayed: number | null
  // Place in the user's own order ("Свой порядок"); null until something is dragged.
  position: number | null
}

export type PlayReport = { trackId: string; playedAt: number; listened: number; completed: boolean }

type TrackStat = { id: string; title: string; artist: string | null; thumb: string | null }

export type Stats = {
  totalSeconds: number
  plays: number
  skips: number
  uniqueTracks: number
  streak: number
  daily: { day: string; seconds: number }[]
  byHour: number[]
  topTracks: (TrackStat & { plays: number; seconds: number })[]
  topArtists: { artist: string; plays: number; seconds: number }[]
  mostSkipped: (TrackStat & { skips: number })[]
}

export type Job = {
  kind: 'add' | 'download'
  id: string
  title: string
  status: 'queued' | 'downloading' | 'error'
  progress: number
  error?: string
  videoId?: string
  search?: { query: string; title: string; artist: string }
}

export type SearchResult = {
  id: string
  title: string
  artist: string
  duration: number | null
  thumb: string | null
}

// A page of search results; `more` fetches the next one (null at the end).
export type SearchPage = { results: SearchResult[]; more: string | null }

export type Playlist = { id: number; name: string; tracks: { id: string; addedAt: number; position: number | null }[] }

export type ServerSettings = { concurrency: number; mediaDir: string; defaultMediaDir: string }

export type Lyrics = {
  synced: string | null
  plain: string | null
  source: string | null
  // Set while the server times plain lyrics to the audio in the background.
  syncing?: 'model' | 'queued' | 'aligning'
  // Nothing found only because LRCLIB was unreachable; ask again later.
  retry?: boolean
}

// What the player is playing: a downloaded track, or a YouTube Music result streamed without downloading.
export type NowPlaying = {
  id: string
  title: string
  artist: string | null
  duration: number | null
  src: string
  cover: string | null
  loudness: number | null
  streamed: boolean
}

export const fromTrack = (t: Track): NowPlaying => ({
  id: t.id,
  title: t.title,
  artist: t.artist,
  duration: t.duration,
  // Online tracks (no file yet) play as a stream.
  src: t.file ? `/media/${t.file}` : `/api/stream/${t.id}`,
  cover: coverUrl(t.thumb),
  loudness: t.loudness,
  streamed: false,
})

export const fromResult = (r: SearchResult): NowPlaying => ({
  id: r.id,
  title: r.title,
  artist: r.artist,
  duration: r.duration,
  src: `/api/stream/${r.id}`,
  cover: r.thumb,
  loudness: null,
  streamed: true,
})

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText)
  return res.status === 204 ? (undefined as T) : res.json()
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  tracks: () => request<Track[]>('/api/tracks'),
  renameTrack: (id: string, title: string, artist: string) =>
    request<void>(`/api/tracks/${id}`, json('PATCH', { title, artist })),
  deleteTrack: (id: string) => request<void>(`/api/tracks/${id}`, { method: 'DELETE' }),
  lyrics: (id: string, signal: AbortSignal) => request<Lyrics>(`/api/tracks/${id}/lyrics`, { signal }),
  prepareLyrics: (id: string) => request<void>(`/api/tracks/${id}/lyrics/prepare`, { method: 'POST' }),
  radio: (id: string) => request<SearchResult[]>(`/api/radio/${id}`),
  // Warms the server's stream URL cache so the next online track starts without waiting for yt-dlp.
  prepareStream: (id: string) => request<void>(`/api/stream/${id}/prepare`, { method: 'POST' }),

  settings: () => request<ServerSettings>('/api/settings'),
  saveSettings: (s: { concurrency?: number; mediaDir?: string }) =>
    request<ServerSettings & { moved?: { moved: number; leftBehind: number } }>('/api/settings', json('PUT', s)),
  storage: () => request<{ downloaded: number; online: number; bytes: number; mediaDir: string }>('/api/storage'),
  cleanupPreview: (days: number) => request<{ count: number; bytes: number }>(`/api/storage/cleanup?days=${days}`),
  cleanup: (days: number) => request<{ count: number; bytes: number }>('/api/storage/cleanup', json('POST', { days })),
  lyricsSearch: (t: { id: string; title: string; artist: string | null; duration: number | null }, signal: AbortSignal) =>
    request<Lyrics>(
      `/api/lyrics?${new URLSearchParams({ id: t.id, title: t.title, artist: t.artist ?? '', duration: String(t.duration ?? '') })}`,
      { signal },
    ),

  // keepalive lets the report finish even if the tab is closing.
  recordPlay: (p: PlayReport) => request<void>('/api/plays', { ...json('POST', p), keepalive: true }),
  stats: (days: number) => request<Stats>(`/api/stats?days=${days}`),

  playlists: () => request<Playlist[]>('/api/playlists'),
  saveOrder: (playlistId: number | null, ids: string[]) => request<void>('/api/order', json('PUT', { playlistId, ids })),
  createPlaylist: (name: string) => request<{ id: number }>('/api/playlists', json('POST', { name })),
  renamePlaylist: (id: number, name: string) => request<void>(`/api/playlists/${id}`, json('PATCH', { name })),
  deletePlaylist: (id: number) => request<void>(`/api/playlists/${id}`, { method: 'DELETE' }),
  addToPlaylist: (id: number, trackId: string) =>
    request<void>(`/api/playlists/${id}/tracks/${trackId}`, { method: 'PUT' }),
  removeFromPlaylist: (id: number, trackId: string) =>
    request<void>(`/api/playlists/${id}/tracks/${trackId}`, { method: 'DELETE' }),

  search: (q: string, signal: AbortSignal) =>
    request<SearchPage>(`/api/search?q=${encodeURIComponent(q)}`, { signal }),
  searchMore: (token: string, signal: AbortSignal) =>
    request<SearchPage>(`/api/search/more?token=${encodeURIComponent(token)}`, { signal }),

  queue: () => request<{ jobs: Job[]; completed: number }>('/api/downloads'),
  // Adds what a YouTube or Yandex Music link points to, online (nothing is downloaded).
  // `playlist`: an existing playlist, 'new' for one named after the source, or null for the library only.
  addByUrl: (url: string, playlist: number | 'new' | null) =>
    request<{ added: number; queued: number; playlistId: number | null }>('/api/downloads', json('POST', { url, playlist })),
  addTrack: (r: SearchResult) => request<void>('/api/tracks', json('POST', r)),
  downloadTracks: (ids: string[]) => request<{ queued: number }>('/api/tracks/download', json('POST', { ids })),
  dismissJob: (id: string) => request<void>(`/api/downloads/${id}`, { method: 'DELETE' }),
  clearErrors: () => request<void>('/api/downloads', { method: 'DELETE' }),
  resolveJob: (id: string, videoId: string) =>
    request<void>(`/api/downloads/${id}/resolve`, json('POST', { videoId })),

  ytdlp: () => request<{ current: string; latest: string | null }>('/api/ytdlp'),
  updateYtdlp: () => request<{ current: string; latest: string | null }>('/api/ytdlp/update', { method: 'POST' }),
}

export function formatTime(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return '–:––'
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Downloaded tracks keep their cover next to the file; online ones point at YouTube's.
export const coverUrl = (thumb: string | null) => (!thumb ? null : thumb.startsWith('http') ? thumb : `/media/${thumb}`)
