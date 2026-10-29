// Downloads the LGPL ffmpeg build bundled with the app into vendor/ffmpeg: ffmpeg, ffprobe and
// their DLLs. LGPL rather than GPL so the app can be shared freely.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const URL =
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-30-13-08/ffmpeg-n8.1.3-9-g29e619e767-win64-lgpl-shared-8.1.zip'
const vendor = path.resolve(import.meta.dirname, '../vendor')
const dest = path.join(vendor, 'ffmpeg')

if (existsSync(path.join(dest, 'ffmpeg.exe'))) process.exit(0)
mkdirSync(vendor, { recursive: true })
const zip = path.join(vendor, 'ffmpeg.zip')
const res = await fetch(URL)
if (!res.ok) throw new Error(`ffmpeg download failed: HTTP ${res.status}`)
writeFileSync(zip, Buffer.from(await res.arrayBuffer()))

const tmp = path.join(vendor, 'ffmpeg-tmp')
rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp)
// Windows 10+ ships bsdtar, which reads zip. By full path: Git Bash's GNU tar would come first on
// PATH and take "D:" for a remote host.
execFileSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', tmp])
const top = path.join(tmp, readdirSync(tmp)[0])
mkdirSync(dest, { recursive: true })
for (const f of readdirSync(path.join(top, 'bin')))
  if (f !== 'ffplay.exe') cpSync(path.join(top, 'bin', f), path.join(dest, f))
cpSync(path.join(top, 'LICENSE.txt'), path.join(dest, 'LICENSE.txt'))
rmSync(tmp, { recursive: true, force: true })
rmSync(zip)
console.log(`ffmpeg: ${dest}`)
