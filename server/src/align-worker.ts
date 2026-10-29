// Runs in a worker thread (see align.ts): ONNX inference and the Viterbi pass take seconds of
// synchronous CPU work and would otherwise stall the server, audio streaming included.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import path from 'node:path'
import { parentPort } from 'node:worker_threads'
import * as ort from 'onnxruntime-node'

export type AlignRequest = { id: number; modelDir: string; file: string; lines: string[] }
export type AlignResponse = { id: number; times?: (number | null)[]; error?: string }

// Measured against LRCLIB timings: aligned lines land ~0.15 s after where LRC files put them
// (they mark a line just before the voice comes in).
const LINE_LEAD_SEC = 0.15
const SAMPLE_RATE = 16000
const FRAME_SEC = 320 / SAMPLE_RATE
// The encoder's attention cost grows with input length, so audio goes through in chunks; each keeps
// a little context on both sides so frames near a cut are still recognized well.
const CHUNK_SEC = 30
const CONTEXT_SEC = 2

// MMS was trained on romanized text; a plain letter-by-letter scheme is enough for alignment.
const ROMAN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
}

let model: Promise<{ session: ort.InferenceSession; vocab: Record<string, number> }> | undefined

function load(modelDir: string) {
  model ??= (async () => {
    const { vocab } = JSON.parse(readFileSync(path.join(modelDir, 'vocab.json'), 'utf8'))
    const session = await ort.InferenceSession.create(path.join(modelDir, 'model.onnx'), {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
      // Leave half the cores to playback, downloads and the rest of the machine.
      intraOpNumThreads: Math.max(1, Math.floor(availableParallelism() / 2)),
    })
    return { session, vocab }
  })()
  return model
}

function decode(file: string) {
  return new Promise<Float32Array>((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', '-'])
    const chunks: Buffer[] = []
    proc.stdout.on('data', (c) => chunks.push(c))
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code) return reject(new Error(`ffmpeg завершился с кодом ${code}`))
      const b = Buffer.concat(chunks)
      resolve(new Float32Array(b.buffer, b.byteOffset, b.length / 4))
    })
  })
}

// Log-probabilities [frames × vocab] for the whole track.
async function emissions(session: ort.InferenceSession, audio: Float32Array) {
  const chunk = CHUNK_SEC * SAMPLE_RATE
  const context = CONTEXT_SEC * SAMPLE_RATE
  const frameSamples = FRAME_SEC * SAMPLE_RATE
  const rows: Float32Array[] = []
  for (let start = 0; start < audio.length; start += chunk) {
    const from = Math.max(0, start - context)
    const to = Math.min(audio.length, start + chunk + context)
    const piece = audio.slice(from, to)
    // The model expects zero-mean, unit-variance input per chunk.
    let mean = 0
    for (const v of piece) mean += v
    mean /= piece.length
    let variance = 0
    for (const v of piece) variance += (v - mean) ** 2
    const std = Math.sqrt(variance / piece.length) || 1
    for (let i = 0; i < piece.length; i++) piece[i] = (piece[i] - mean) / std

    const out = await session.run({ input_values: new ort.Tensor('float32', piece, [1, piece.length]) })
    const logits = out.logits as ort.Tensor
    const [, frames, v] = logits.dims as number[]
    const data = logits.data as Float32Array
    // Keep only this chunk's own frames, dropping the context on either side.
    const first = Math.round((start - from) / frameSamples)
    const last = Math.min(frames, first + Math.round((Math.min(start + chunk, audio.length) - start) / frameSamples))
    for (let f = first; f < last; f++) {
      const row = data.subarray(f * v, (f + 1) * v)
      let max = -Infinity
      for (const x of row) max = Math.max(max, x)
      let sum = 0
      for (const x of row) sum += Math.exp(x - max)
      const logSum = max + Math.log(sum)
      rows.push(Float32Array.from(row, (x) => x - logSum))
    }
  }
  return rows
}

// Character token ids for each line; section labels like "[Припев]" and non-letters are dropped.
function tokenize(lines: string[], vocab: Record<string, number>) {
  return lines.map((line) =>
    [...line.toLowerCase().replace(/\[[^\]]*\]/g, '')]
      .flatMap((ch) => [...(ROMAN[ch] ?? ch)])
      .filter((ch) => ch in vocab && vocab[ch] > 3)
      .map((ch) => vocab[ch]),
  )
}

// CTC Viterbi forced alignment. States interleave blanks with tokens (b t1 b t2 … b); returns the
// first frame each token is emitted at.
function viterbi(rows: Float32Array[], tokens: number[], blank: number) {
  const T = rows.length
  const S = tokens.length * 2 + 1
  const label = (s: number) => (s % 2 === 0 ? blank : tokens[(s - 1) >> 1])
  // Which predecessor each state came from: 0 = same state, 1 = s-1, 2 = s-2.
  const back = new Uint8Array(T * S)
  let prev = new Float32Array(S).fill(-Infinity)
  prev[0] = rows[0][blank]
  if (S > 1) prev[1] = rows[0][label(1)]
  let cur = new Float32Array(S)
  for (let t = 1; t < T; t++) {
    const row = rows[t]
    // A state can't be reached yet if even emitting one token per frame wouldn't get there.
    const lo = Math.max(0, S - 2 * (T - t))
    const hi = Math.min(S - 1, 2 * t + 1)
    cur.fill(-Infinity)
    for (let s = lo; s <= hi; s++) {
      let best = prev[s]
      let from = 0
      if (s > 0 && prev[s - 1] > best) {
        best = prev[s - 1]
        from = 1
      }
      if (s > 1 && s % 2 === 1 && tokens[(s - 1) >> 1] !== tokens[(s - 3) >> 1] && prev[s - 2] > best) {
        best = prev[s - 2]
        from = 2
      }
      cur[s] = best + row[label(s)]
      back[t * S + s] = from
    }
    ;[prev, cur] = [cur, prev]
  }

  const firstFrame = new Int32Array(tokens.length).fill(-1)
  let s = S > 1 && prev[S - 2] > prev[S - 1] ? S - 2 : S - 1
  for (let t = T - 1; t >= 0; t--) {
    if (s % 2 === 1) firstFrame[(s - 1) >> 1] = t
    s -= t > 0 ? back[t * S + s] : 0
  }
  return firstFrame
}

async function align({ modelDir, file, lines }: AlignRequest): Promise<(number | null)[]> {
  const { session, vocab } = await load(modelDir)
  const rows = await emissions(session, await decode(file))
  const perLine = tokenize(lines, vocab)
  const tokens = perLine.flat()
  if (tokens.length === 0 || rows.length < tokens.length) return lines.map(() => null)
  const frames = viterbi(rows, tokens, vocab['<blank>'])
  let offset = 0
  return perLine.map((lineTokens) => {
    const at = lineTokens.length ? Math.max(0, frames[offset] * FRAME_SEC - LINE_LEAD_SEC) : null
    offset += lineTokens.length
    return at
  })
}

parentPort?.on('message', (req: AlignRequest) => {
  align(req).then(
    (times) => parentPort!.postMessage({ id: req.id, times } satisfies AlignResponse),
    (e) => parentPort!.postMessage({ id: req.id, error: (e as Error).message } satisfies AlignResponse),
  )
})
