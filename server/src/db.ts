import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const DATA_DIR = path.resolve(import.meta.dirname, '../data')
export const MEDIA_DIR = path.join(DATA_DIR, 'media')
mkdirSync(MEDIA_DIR, { recursive: true })

const db = new DatabaseSync(path.join(DATA_DIR, 'library.db'))
db.exec(`CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT,
  duration REAL,
  file TEXT NOT NULL,
  thumb TEXT,
  added_at INTEGER NOT NULL
)`)
// Added later: where the track was imported from, e.g. "yandex:31190255". Null for direct YouTube links.
try {
  db.exec('ALTER TABLE tracks ADD COLUMN source TEXT')
} catch {
  // column already exists
}

export type Track = {
  id: string
  title: string
  artist: string | null
  duration: number | null
  file: string
  thumb: string | null
  addedAt: number
}

export function listTracks() {
  return db
    .prepare('SELECT id, title, artist, duration, file, thumb, added_at AS addedAt FROM tracks ORDER BY added_at DESC')
    .all() as Track[]
}

export function getTrack(id: string) {
  return db.prepare('SELECT id, file, thumb FROM tracks WHERE id = ?').get(id) as
    | Pick<Track, 'id' | 'file' | 'thumb'>
    | undefined
}

export function hasSource(source: string) {
  return db.prepare('SELECT 1 FROM tracks WHERE source = ?').get(source) !== undefined
}

export function insertTrack(t: Track, source: string | null = null) {
  db.prepare(
    'INSERT OR REPLACE INTO tracks (id, title, artist, duration, file, thumb, added_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(t.id, t.title, t.artist, t.duration, t.file, t.thumb, t.addedAt, source)
}

export function deleteTrack(id: string) {
  db.prepare('DELETE FROM tracks WHERE id = ?').run(id)
}
