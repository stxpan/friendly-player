import { spawn } from 'node:child_process'
import path from 'node:path'
import { MEDIA_DIR, setLoudness, tracksWithoutLoudness } from './db.ts'

// Integrated loudness (EBU R128) of a file in LUFS, via ffmpeg's ebur128 filter.
function measure(file: string) {
  return new Promise<number>((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-nostats', '-hide_banner', '-i', file, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'])
    let stderr = ''
    proc.stderr.on('data', (d) => (stderr += d))
    proc.on('error', (e) => reject(new Error(`Не удалось запустить ffmpeg: ${e.message}`)))
    proc.on('close', () => {
      // The summary at the end contains "I:  -9.3 LUFS"; earlier lines can't, framelog is off.
      const m = /I:\s+(-?\d+(?:\.\d+)?) LUFS/.exec(stderr)
      if (m) resolve(Number(m[1]))
      else reject(new Error(`ffmpeg не вернул громкость для ${file}`))
    })
  })
}

const queue: { id: string; file: string }[] = []
let running = false

export function queueLoudness(id: string, file: string) {
  queue.push({ id, file })
  void drain()
}

// Tracks downloaded before loudness was measured get analyzed once, in the background.
export function backfillLoudness() {
  for (const t of tracksWithoutLoudness()) queueLoudness(t.id, t.file)
}

async function drain() {
  if (running) return
  running = true
  let item
  while ((item = queue.shift())) {
    try {
      setLoudness(item.id, await measure(path.join(MEDIA_DIR, item.file)))
    } catch (e) {
      console.warn((e as Error).message)
    }
  }
  running = false
}
