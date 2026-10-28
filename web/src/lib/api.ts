export type Track = {
  id: string
  title: string
  artist: string | null
  duration: number | null
  file: string
  thumb: string | null
  addedAt: number
  loudness: number | null
}

export type Job = {
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

export type Playlist = { id: number; name: string; tracks: { id: string; addedAt: number }[] }

export type Lyrics = { synced: string | null; plain: string | null }

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

  playlists: () => request<Playlist[]>('/api/playlists'),
  createPlaylist: (name: string) => request<{ id: number }>('/api/playlists', json('POST', { name })),
  renamePlaylist: (id: number, name: string) => request<void>(`/api/playlists/${id}`, json('PATCH', { name })),
  deletePlaylist: (id: number) => request<void>(`/api/playlists/${id}`, { method: 'DELETE' }),
  addToPlaylist: (id: number, trackId: string) =>
    request<void>(`/api/playlists/${id}/tracks/${trackId}`, { method: 'PUT' }),
  removeFromPlaylist: (id: number, trackId: string) =>
    request<void>(`/api/playlists/${id}/tracks/${trackId}`, { method: 'DELETE' }),

  search: (q: string, signal: AbortSignal) =>
    request<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`, { signal }),

  queue: () => request<{ jobs: Job[]; completed: number }>('/api/downloads'),
  download: (url: string) => request<Job[]>('/api/downloads', json('POST', { url })),
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
