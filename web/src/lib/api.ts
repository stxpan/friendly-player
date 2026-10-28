export type Track = {
  id: string
  title: string
  artist: string | null
  duration: number | null
  file: string
  thumb: string | null
  addedAt: number
}

export type Job = {
  id: string
  title: string
  status: 'queued' | 'downloading' | 'error'
  progress: number
  error?: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText)
  return res.status === 204 ? (undefined as T) : res.json()
}

export const api = {
  tracks: () => request<Track[]>('/api/tracks'),
  deleteTrack: (id: string) => request<void>(`/api/tracks/${id}`, { method: 'DELETE' }),
  queue: () => request<{ jobs: Job[]; completed: number }>('/api/downloads'),
  download: (url: string) =>
    request<Job[]>('/api/downloads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    }),
  dismissJob: (id: string) => request<void>(`/api/downloads/${id}`, { method: 'DELETE' }),
  clearErrors: () => request<void>('/api/downloads', { method: 'DELETE' }),
}

export function formatTime(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return '–:––'
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
