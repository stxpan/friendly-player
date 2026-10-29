import { run } from './ytdlp.ts'

// Direct googlevideo URLs carry an "expire" timestamp (~6 h); reuse them until shortly before that,
// so seeking (a new Range request each time) doesn't wait for yt-dlp again.
const EXPIRY_MARGIN_MS = 10 * 60 * 1000
const cache = new Map<string, { url: string; expires: number }>()

export async function streamUrl(videoId: string) {
  const hit = cache.get(videoId)
  if (hit && hit.expires > Date.now()) return hit.url

  const out = await run(['-g', '-f', 'bestaudio[ext=m4a]/bestaudio', '--no-playlist', `https://www.youtube.com/watch?v=${videoId}`])
  const url = out.trim().split('\n')[0]
  if (!url) throw new Error('yt-dlp не вернул ссылку на поток')
  const expire = Number(new URL(url).searchParams.get('expire')) * 1000
  cache.set(videoId, { url, expires: (expire || Date.now() + 60 * 60 * 1000) - EXPIRY_MARGIN_MS })
  return url
}
