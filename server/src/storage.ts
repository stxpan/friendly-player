import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { countOnline, downloadedTracks, makeOnline, MEDIA_DIR, setMediaDir } from './db.ts'
import { isDownloading } from './downloader.ts'

const DAY_MS = 24 * 60 * 60 * 1000

const size = (file: string | null) =>
  file && !file.startsWith('http')
    ? stat(path.join(MEDIA_DIR, file)).then(
        (s) => s.size,
        () => 0,
      )
    : Promise.resolve(0)

async function bytesOf(tracks: { file: string; thumb: string | null }[]) {
  const sizes = await Promise.all(tracks.flatMap((t) => [size(t.file), size(t.thumb)]))
  return sizes.reduce((a, b) => a + b, 0)
}

export async function usage() {
  const tracks = downloadedTracks()
  return { downloaded: tracks.length, online: countOnline(), bytes: await bytesOf(tracks), mediaDir: MEDIA_DIR }
}

// Downloaded tracks not heard for `days` (or, if never played, added longer ago than that).
function stale(days: number) {
  const cutoff = Date.now() - days * DAY_MS
  return downloadedTracks().filter((t) => (t.lastPlayed ?? t.addedAt) < cutoff)
}

export async function cleanupPreview(days: number) {
  const tracks = stale(days)
  return { count: tracks.length, bytes: await bytesOf(tracks) }
}

// Frees disk space: the files go, the tracks stay in the library as online ones.
export async function cleanup(days: number) {
  const tracks = stale(days)
  const bytes = await bytesOf(tracks)
  for (const t of tracks) {
    for (const f of [t.file, t.thumb]) if (f && !f.startsWith('http')) await rm(path.join(MEDIA_DIR, f), { force: true })
    makeOnline(t.id)
  }
  return { count: tracks.length, bytes }
}

// Moves the music folder. Files are copied first and the old ones removed afterwards, so nothing
// is lost if copying fails halfway; old files that are busy (e.g. playing) stay behind.
export async function moveMedia(target: string) {
  if (isDownloading()) throw new Error('Дождись окончания загрузок — сейчас идёт скачивание')
  const dir = path.resolve(target)
  if (!path.isAbsolute(target)) throw new Error('Укажи полный путь, например D:\\Music\\player')
  const from = MEDIA_DIR
  if (path.relative(from, dir) === '') return { moved: 0, leftBehind: 0 }
  if (!path.relative(from, dir).startsWith('..')) throw new Error('Новая папка не может быть внутри текущей')

  await mkdir(dir, { recursive: true })
  // Fails early with a clear error if the folder isn't writable.
  const probe = path.join(dir, '.player-write-test')
  await writeFile(probe, '')
  await rm(probe)

  const files = (await readdir(from, { withFileTypes: true })).filter((f) => f.isFile()).map((f) => f.name)
  for (const f of files) await copyFile(path.join(from, f), path.join(dir, f))
  setMediaDir(dir)
  let leftBehind = 0
  for (const f of files) await rm(path.join(from, f)).catch(() => leftBehind++)
  return { moved: files.length, leftBehind }
}
