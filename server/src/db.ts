import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// The desktop app keeps data in the user's profile; run from source it's server/data.
export const DATA_DIR = process.env.PLAYER_DATA_DIR ?? path.resolve(import.meta.dirname, '../data')
export const DEFAULT_MEDIA_DIR = path.join(DATA_DIR, 'media')
// Where downloaded audio and covers live; can be moved in settings (see setMediaDir). Importers
// see reassignments: ES module exports are live bindings.
export let MEDIA_DIR = DEFAULT_MEDIA_DIR
mkdirSync(DATA_DIR, { recursive: true })

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
  // Place in the user's own order of the library ("Свой порядок"); null until something is dragged.
  'position REAL',
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
// Synced lyrics cached per track: from LRCLIB or aligned locally.
db.exec(`CREATE TABLE IF NOT EXISTS lyrics (
  track_id TEXT PRIMARY KEY,
  synced TEXT,
  plain TEXT
)`)
// Earlier versions cached plain-only lyrics too; drop them so synced ones get a chance.
db.exec('DELETE FROM lyrics WHERE synced IS NULL')
try {
  // Where the timing came from; rows from before the column existed are LRCLIB's.
  db.exec('ALTER TABLE lyrics ADD COLUMN source TEXT')
} catch {
  // column already exists
}

// One row per listening session. Kept when a track is deleted: it's still time you spent listening.
db.exec(`CREATE TABLE IF NOT EXISTS plays (
  id INTEGER PRIMARY KEY,
  track_id TEXT NOT NULL,
  played_at INTEGER NOT NULL,
  listened REAL NOT NULL,
  completed INTEGER NOT NULL,
  skipped INTEGER NOT NULL
)`)
db.exec('CREATE INDEX IF NOT EXISTS plays_track ON plays (track_id)')
db.exec('CREATE INDEX IF NOT EXISTS plays_time ON plays (played_at)')

export type Track = {
  id: string
  title: string
  artist: string | null
  duration: number | null
  file: string
  thumb: string | null
  addedAt: number
  loudness: number | null
  // Plays that weren't skipped, and when the track was last played at all.
  playCount: number
  lastPlayed: number | null
  position: number | null
}

export function listTracks() {
  return db
    .prepare(
      `SELECT t.id, t.title, t.artist, t.duration, t.file, t.thumb, t.added_at AS addedAt, t.loudness,
              COALESCE(p.plays, 0) AS playCount, p.last AS lastPlayed, t.position
       FROM tracks t
       LEFT JOIN (SELECT track_id, SUM(skipped = 0) AS plays, MAX(played_at) AS last FROM plays GROUP BY track_id) p
         ON p.track_id = t.id
       ORDER BY t.added_at DESC`,
    )
    .all() as Track[]
}

// Listening shorter than this without reaching the end counts as a skip.
const SKIP_SEC = 30

export function recordPlay(trackId: string, playedAt: number, listened: number, completed: boolean) {
  db.prepare('INSERT INTO plays (track_id, played_at, listened, completed, skipped) VALUES (?, ?, ?, ?, ?)').run(
    trackId,
    playedAt,
    listened,
    completed ? 1 : 0,
    !completed && listened < SKIP_SEC ? 1 : 0,
  )
}

export type PlayRow = {
  trackId: string
  playedAt: number
  listened: number
  skipped: number
  title: string | null
  artist: string | null
  thumb: string | null
}

export function playsSince(since: number) {
  return db
    .prepare(
      `SELECT p.track_id AS trackId, p.played_at AS playedAt, p.listened, p.skipped, t.title, t.artist, t.thumb
       FROM plays p LEFT JOIN tracks t ON t.id = p.track_id
       WHERE p.played_at >= ? ORDER BY p.played_at`,
    )
    .all(since) as PlayRow[]
}

export function getTrack(id: string) {
  return db.prepare('SELECT id, title, artist, duration, file, thumb FROM tracks WHERE id = ?').get(id) as
    | Pick<Track, 'id' | 'title' | 'artist' | 'duration' | 'file' | 'thumb'>
    | undefined
}

export function hasSource(source: string) {
  return db.prepare('SELECT 1 FROM tracks WHERE source = ?').get(source) !== undefined
}

// An online track: no file yet (`file` is ''), played as a stream; `thumb` is a remote URL.
// Re-adding a track that's already in the library changes nothing.
export function addOnline(
  t: { id: string; title: string; artist: string | null; duration: number | null; thumb: string | null },
  source: string | null = null,
) {
  db.prepare(
    "INSERT OR IGNORE INTO tracks (id, title, artist, duration, file, thumb, added_at, source) VALUES (?, ?, ?, ?, '', ?, ?, ?)",
  ).run(t.id, t.title, t.artist, t.duration, t.thumb, Date.now(), source)
}

// The file for a library track has been downloaded; title, artist and date added stay as they were.
export function saveDownload(id: string, file: string, thumb: string | null, duration: number | null) {
  db.prepare(
    'UPDATE tracks SET file = ?, thumb = COALESCE(?, thumb), duration = COALESCE(?, duration) WHERE id = ?',
  ).run(file, thumb, duration, id)
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
  return db.prepare("SELECT id, file FROM tracks WHERE loudness IS NULL AND file != ''").all() as {
    id: string
    file: string
  }[]
}

try {
  // Place in the playlist's own order; null until something is dragged.
  db.exec('ALTER TABLE playlist_tracks ADD COLUMN position REAL')
} catch {
  // column already exists
}

type PlaylistTrack = { id: string; addedAt: number; position: number | null }
export type Playlist = { id: number; name: string; tracks: PlaylistTrack[] }

export function listPlaylists(): Playlist[] {
  const playlists = db.prepare('SELECT id, name FROM playlists ORDER BY created_at').all() as { id: number; name: string }[]
  const rows = db
    .prepare('SELECT playlist_id AS playlistId, track_id AS id, added_at AS addedAt, position FROM playlist_tracks')
    .all() as (PlaylistTrack & { playlistId: number })[]
  return playlists.map((p) => ({
    ...p,
    tracks: rows.filter((r) => r.playlistId === p.id).map(({ id, addedAt, position }) => ({ id, addedAt, position })),
  }))
}

// Saves a dragged order: `ids` is the whole list top to bottom, of the library or of one playlist.
export function saveOrder(playlistId: number | null, ids: string[]) {
  const update =
    playlistId === null
      ? db.prepare('UPDATE tracks SET position = ? WHERE id = ?')
      : db.prepare('UPDATE playlist_tracks SET position = ? WHERE track_id = ? AND playlist_id = ?')
  db.exec('BEGIN')
  try {
    ids.forEach((id, i) => (playlistId === null ? update.run(i, id) : update.run(i, id, playlistId)))
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
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

// `at` lets an import keep the source's order: an earlier track gets a later "added" time and a
// smaller position, so both "date added" and "own order" sorting show it as in the original.
export function addToPlaylist(playlistId: number, trackId: string, at?: { addedAt: number; position: number }) {
  db.prepare(
    'INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, added_at, position) VALUES (?, ?, ?, ?)',
  ).run(playlistId, trackId, at?.addedAt ?? Date.now(), at?.position ?? null)
}

// --- download/import queue, so a server restart doesn't lose it ---

db.exec(`CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`)

export function loadJobs<T>() {
  return (db.prepare('SELECT data FROM jobs ORDER BY created_at, rowid').all() as { data: string }[]).map(
    (r) => JSON.parse(r.data) as T,
  )
}

export function saveJob(job: { id: string }) {
  db.prepare(
    'INSERT INTO jobs (id, data, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
  ).run(job.id, JSON.stringify(job), Date.now())
}

export function deleteJob(id: string) {
  db.prepare('DELETE FROM jobs WHERE id = ?').run(id)
}

// --- settings that live on the server (the browser keeps its own in localStorage) ---

db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row ? (JSON.parse(row.value) as T) : fallback
}

export function setSetting(key: string, value: unknown) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value))
}

export function removeFromPlaylist(playlistId: number, trackId: string) {
  db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').run(playlistId, trackId)
}

type CachedLyrics = { synced: string; plain: string | null; source: string }

export function getLyrics(trackId: string) {
  return db
    .prepare("SELECT synced, plain, COALESCE(source, 'LRCLIB') AS source FROM lyrics WHERE track_id = ?")
    .get(trackId) as CachedLyrics | undefined
}

export function saveLyrics(trackId: string, l: CachedLyrics) {
  db.prepare('INSERT OR REPLACE INTO lyrics (track_id, synced, plain, source) VALUES (?, ?, ?, ?)').run(
    trackId,
    l.synced,
    l.plain,
    l.source,
  )
}

MEDIA_DIR = getSetting('mediaDir', DEFAULT_MEDIA_DIR)
mkdirSync(MEDIA_DIR, { recursive: true })

export function setMediaDir(dir: string) {
  MEDIA_DIR = dir
  setSetting('mediaDir', dir)
}

// Downloaded tracks with the date they were last heard, for freeing disk space.
export function downloadedTracks() {
  return db
    .prepare(
      `SELECT t.id, t.file, t.thumb, t.added_at AS addedAt, MAX(p.played_at) AS lastPlayed
       FROM tracks t LEFT JOIN plays p ON p.track_id = t.id
       WHERE t.file != '' GROUP BY t.id`,
    )
    .all() as { id: string; file: string; thumb: string | null; addedAt: number; lastPlayed: number | null }[]
}

export const countOnline = () => (db.prepare("SELECT count(*) AS n FROM tracks WHERE file = ''").get() as { n: number }).n

// Turns a downloaded track back into an online one: the file is gone, the cover comes from YouTube again.
export function makeOnline(id: string) {
  db.prepare("UPDATE tracks SET file = '', thumb = ?, loudness = NULL WHERE id = ?").run(
    `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    id,
  )
}
