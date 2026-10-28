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

// Columns added after the first release; ALTER fails harmlessly when they already exist.
for (const column of [
  // Where the track was imported from, e.g. "yandex:31190255". Null for direct YouTube links.
  'source TEXT',
  // Integrated loudness in LUFS, measured by ffmpeg after download.
  'loudness REAL',
]) {
  try {
    db.exec(`ALTER TABLE tracks ADD COLUMN ${column}`)
  } catch {
    // column already exists
  }
}

db.exec(`CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`)
db.exec(`CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id INTEGER NOT NULL,
  track_id TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, track_id)
)`)
// Lyrics from LRCLIB, cached per track.
db.exec(`CREATE TABLE IF NOT EXISTS lyrics (
  track_id TEXT PRIMARY KEY,
  synced TEXT,
  plain TEXT
)`)

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

export function listTracks() {
  return db
    .prepare(
      'SELECT id, title, artist, duration, file, thumb, added_at AS addedAt, loudness FROM tracks ORDER BY added_at DESC',
    )
    .all() as Track[]
}

export function getTrack(id: string) {
  return db.prepare('SELECT id, title, artist, duration, file, thumb FROM tracks WHERE id = ?').get(id) as
    | Pick<Track, 'id' | 'title' | 'artist' | 'duration' | 'file' | 'thumb'>
    | undefined
}

export function hasSource(source: string) {
  return db.prepare('SELECT 1 FROM tracks WHERE source = ?').get(source) !== undefined
}

export function insertTrack(t: Omit<Track, 'loudness'>, source: string | null = null) {
  db.prepare(
    'INSERT OR REPLACE INTO tracks (id, title, artist, duration, file, thumb, added_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(t.id, t.title, t.artist, t.duration, t.file, t.thumb, t.addedAt, source)
}

export function renameTrack(id: string, title: string, artist: string | null) {
  db.prepare('UPDATE tracks SET title = ?, artist = ? WHERE id = ?').run(title, artist, id)
  // Lyrics were looked up by the old name.
  db.prepare('DELETE FROM lyrics WHERE track_id = ?').run(id)
}

export function deleteTrack(id: string) {
  db.prepare('DELETE FROM tracks WHERE id = ?').run(id)
  db.prepare('DELETE FROM playlist_tracks WHERE track_id = ?').run(id)
  db.prepare('DELETE FROM lyrics WHERE track_id = ?').run(id)
}

export function setLoudness(id: string, lufs: number) {
  db.prepare('UPDATE tracks SET loudness = ? WHERE id = ?').run(lufs, id)
}

export function tracksWithoutLoudness() {
  return db.prepare('SELECT id, file FROM tracks WHERE loudness IS NULL').all() as { id: string; file: string }[]
}

export type Playlist = { id: number; name: string; tracks: { id: string; addedAt: number }[] }

export function listPlaylists(): Playlist[] {
  const playlists = db.prepare('SELECT id, name FROM playlists ORDER BY created_at').all() as { id: number; name: string }[]
  const rows = db
    .prepare('SELECT playlist_id AS playlistId, track_id AS id, added_at AS addedAt FROM playlist_tracks')
    .all() as { playlistId: number; id: string; addedAt: number }[]
  return playlists.map((p) => ({
    ...p,
    tracks: rows.filter((r) => r.playlistId === p.id).map(({ id, addedAt }) => ({ id, addedAt })),
  }))
}

export function createPlaylist(name: string) {
  return Number(db.prepare('INSERT INTO playlists (name, created_at) VALUES (?, ?)').run(name, Date.now()).lastInsertRowid)
}

export function renamePlaylist(id: number, name: string) {
  db.prepare('UPDATE playlists SET name = ? WHERE id = ?').run(name, id)
}

export function deletePlaylist(id: number) {
  db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(id)
  db.prepare('DELETE FROM playlists WHERE id = ?').run(id)
}

export function addToPlaylist(playlistId: number, trackId: string) {
  db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, added_at) VALUES (?, ?, ?)').run(
    playlistId,
    trackId,
    Date.now(),
  )
}

export function removeFromPlaylist(playlistId: number, trackId: string) {
  db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').run(playlistId, trackId)
}

export type Lyrics = { synced: string | null; plain: string | null }

export function getLyrics(trackId: string) {
  return db.prepare('SELECT synced, plain FROM lyrics WHERE track_id = ?').get(trackId) as Lyrics | undefined
}

export function saveLyrics(trackId: string, l: Lyrics) {
  db.prepare('INSERT OR REPLACE INTO lyrics (track_id, synced, plain) VALUES (?, ?, ?)').run(trackId, l.synced, l.plain)
}
