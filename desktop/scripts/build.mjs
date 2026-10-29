// Prepares desktop/build for electron-builder: the web UI, the server bundled into two files,
// the native onnxruntime pieces it needs, yt-dlp and ffmpeg.
import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { build } from 'esbuild'

const root = path.resolve(import.meta.dirname, '../..')
const out = path.resolve(import.meta.dirname, '../build')
const serverRequire = createRequire(path.join(root, 'server/package.json'))
const pkgDir = (name, from = serverRequire) => path.dirname(from.resolve(`${name}/package.json`))

// FFMPEG_DIR: use another ffmpeg folder (e.g. one already installed) for a local test build.
const ffmpeg = process.env.FFMPEG_DIR ?? path.resolve(import.meta.dirname, '../vendor/ffmpeg')
if (!existsSync(path.join(ffmpeg, 'ffmpeg.exe'))) {
  console.error('Нет vendor/ffmpeg — сначала запусти: node desktop/scripts/fetch-ffmpeg.mjs')
  process.exit(1)
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

// Web UI
execSync('pnpm --filter web build', { cwd: root, stdio: 'inherit' })
cpSync(path.join(root, 'web/dist'), path.join(out, 'web'), { recursive: true })

// Server: one ESM file plus the alignment worker, which align.ts loads by its file name.
await build({
  entryPoints: { index: path.join(root, 'server/src/index.ts'), 'align-worker': path.join(root, 'server/src/align-worker.ts') },
  outdir: path.join(out, 'server'),
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  // Native addon: copied below instead of bundled.
  external: ['onnxruntime-node'],
  // CommonJS dependencies inside an ESM bundle still call require().
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
})

// onnxruntime: the CPU library and binding only (DirectML DLLs aren't used), and its JS API.
const ort = pkgDir('onnxruntime-node')
const ortOut = path.join(out, 'server/node_modules/onnxruntime-node')
for (const f of ['package.json', 'dist']) cpSync(path.join(ort, f), path.join(ortOut, f), { recursive: true })
for (const f of ['onnxruntime.dll', 'onnxruntime_binding.node'])
  cpSync(path.join(ort, 'bin/napi-v6/win32/x64', f), path.join(ortOut, 'bin/napi-v6/win32/x64', f))
// Its package.json isn't exported; pnpm keeps it next to onnxruntime-node.
const common = path.join(ort, '..', 'onnxruntime-common')
for (const f of ['package.json', 'dist'])
  cpSync(path.join(common, f), path.join(out, 'server/node_modules/onnxruntime-common', f), { recursive: true })

// Tools the server runs: yt-dlp (updates itself in place) and ffmpeg.
const ytdlp = path.join(pkgDir('youtube-dl-exec'), 'bin/yt-dlp.exe')
cpSync(ytdlp, path.join(out, 'bin/yt-dlp.exe'))
cpSync(ffmpeg, path.join(out, 'bin'), { recursive: true })

console.log(`Готово: ${out}`)
