import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import readline from 'node:readline'

// Binary is fetched into node_modules by youtube-dl-exec's postinstall;
// its typings don't declare the constants module, hence the plain require.
const { YOUTUBE_DL_PATH } = createRequire(import.meta.url)('youtube-dl-exec/src/constants') as { YOUTUBE_DL_PATH: string }
const YTDLP = process.env.YTDLP_PATH ?? YOUTUBE_DL_PATH

export function run(args: string[], onLine?: (line: string) => void) {
  return new Promise<string>((resolve, reject) => {
    const proc = spawn(YTDLP, args)
    let stdout = ''
    let lastError = ''
    for (const stream of [proc.stdout, proc.stderr]) {
      readline.createInterface({ input: stream }).on('line', (line) => {
        if (stream === proc.stdout) stdout += line + '\n'
        if (line.startsWith('ERROR:')) lastError = line.slice(7)
        onLine?.(line)
      })
    }
    proc.on('error', (e) => reject(new Error(`Не удалось запустить yt-dlp: ${e.message}`)))
    proc.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(lastError || `yt-dlp exited with ${code}`))))
  })
}

// GitHub allows 60 unauthenticated requests an hour; the UI asks on every page load.
const LATEST_TTL_MS = 60 * 60 * 1000
let latest: { tag: string; at: number } | undefined

async function latestVersion() {
  if (latest && Date.now() - latest.at < LATEST_TTL_MS) return latest.tag
  const res = await fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest')
  if (!res.ok) throw new Error(`GitHub ответил ${res.status}`)
  const { tag_name } = (await res.json()) as { tag_name: string }
  latest = { tag: tag_name, at: Date.now() }
  return tag_name
}

export async function versionInfo() {
  const [current, newest] = await Promise.all([run(['--version']), latestVersion().catch(() => null)])
  return { current: current.trim(), latest: newest }
}

// The standalone exe replaces itself; yt-dlp handles the Windows "file in use" dance.
export async function update() {
  await run(['-U'])
  latest = undefined
  return versionInfo()
}
