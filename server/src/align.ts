// Forced alignment of known lyrics to audio ("subtitle timing"): Meta's MMS-300M aligner turns
// audio into per-frame character probabilities, then a CTC Viterbi pass finds where each line starts.
// Unlike speech recognition nothing is guessed, so it's one encoder pass and runs fine on a CPU.
// The heavy part lives in align-worker.ts; this side downloads the model and hands out jobs.
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Worker } from 'node:worker_threads'
import type { AlignRequest, AlignResponse } from './align-worker.ts'
import { DATA_DIR, getSetting, setSetting } from './db.ts'

const MODEL_DIR = path.join(DATA_DIR, 'models', 'mms-fa-int8')
// The fp16 model used before; replaced by the int8 one, so it's removed once that is in place.
const OLD_MODEL_DIR = path.join(DATA_DIR, 'models', 'mms-fa')
// Not bundled with the app (364 MB): fetched on first use. CC-BY-NC-4.0, non-commercial only.
// Our int8 quantization of tatsu020/mms-300m-fa-onnx: same accuracy, ~1.7x faster on a CPU.
const MODEL_BASE_URL = 'https://huggingface.co/stxpan/mms-300m-fa-onnx-int8/resolve/main'
const MODEL_FILES = [
  { name: 'vocab.json', remote: 'vocab.json' },
  {
    name: 'model.onnx',
    remote: 'mms_300m_fa_int8.onnx',
    sha256: '207154a4ba7f05e825c23455ea8df3fe3c98975773f9eddc41c421f1c003ff66',
  },
]

export const isModelReady = () => MODEL_FILES.every((f) => existsSync(path.join(MODEL_DIR, f.name)))

let downloading: Promise<void> | undefined
// Bytes of the model file fetched so far, while it downloads.
let progress: { received: number; total: number } | null = null

// Syncing is opt-in for the desktop app (a checkbox in the installer sets the default);
// when it's off, plain lyrics are shown as they are and the model isn't needed.
export const isSyncEnabled = () => getSetting('syncLyrics', process.env.PLAYER_SYNC_LYRICS !== '0')

export function setSyncEnabled(on: boolean) {
  setSetting('syncLyrics', on)
  if (on) ensureModel().catch((e) => console.warn(`Модель синхронизации: ${(e as Error).message}`))
}

export const modelStatus = () => ({ enabled: isSyncEnabled(), ready: isModelReady(), downloading: progress })

// Frees the 364 MB; syncing is switched off, since it would fetch the model again.
export async function deleteModel() {
  if (downloading) throw new Error('Модель сейчас скачивается — дождись окончания')
  setSetting('syncLyrics', false)
  await worker?.terminate()
  await rm(MODEL_DIR, { recursive: true, force: true })
}

export function ensureModel() {
  downloading ??= downloadModel().catch((e) => {
    downloading = undefined
    throw e
  })
  return downloading
}

async function downloadModel() {
  await mkdir(MODEL_DIR, { recursive: true })
  for (const f of MODEL_FILES) {
    const dest = path.join(MODEL_DIR, f.name)
    if (existsSync(dest)) continue
    const res = await fetch(`${MODEL_BASE_URL}/${f.remote}`)
    if (!res.ok || !res.body) throw new Error(`Не удалось скачать модель: HTTP ${res.status}`)
    progress = { received: 0, total: Number(res.headers.get('content-length')) || 0 }
    // Written under a temporary name and renamed only once complete and verified.
    const part = `${dest}.part`
    const hash = createHash('sha256')
    const hashing = new Transform({
      transform(chunk, _enc, done) {
        hash.update(chunk)
        if (progress) progress.received += chunk.length
        done(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(res.body as never), hashing, createWriteStream(part)).finally(() => {
      progress = null
    })
    if (f.sha256 && hash.digest('hex') !== f.sha256) {
      await rm(part, { force: true })
      throw new Error('Модель скачалась повреждённой, попробуй ещё раз')
    }
    await rename(part, dest)
  }
  await rm(OLD_MODEL_DIR, { recursive: true, force: true })
}

// One long-lived worker keeps the model loaded between tracks.
let worker: Worker | undefined
let nextId = 0
const waiting = new Map<number, { resolve: (t: (number | null)[]) => void; reject: (e: Error) => void }>()

function getWorker() {
  if (!worker) {
    // .ts when run from source, .mjs in the desktop app's bundle.
    worker = new Worker(new URL(`./align-worker${path.extname(import.meta.url)}`, import.meta.url))
    worker.on('message', ({ id, times, error }: AlignResponse) => {
      const job = waiting.get(id)
      waiting.delete(id)
      if (error) job?.reject(new Error(error))
      else job?.resolve(times!)
    })
    worker.on('error', (e: Error) => {
      for (const job of waiting.values()) job.reject(e)
      waiting.clear()
      worker = undefined
    })
  }
  return worker
}

export async function alignLyrics(audioFile: string, lines: string[]): Promise<(number | null)[]> {
  await ensureModel()
  return new Promise((resolve, reject) => {
    const id = nextId++
    waiting.set(id, { resolve, reject })
    getWorker().postMessage({ id, modelDir: MODEL_DIR, file: audioFile, lines } satisfies AlignRequest)
  })
}
