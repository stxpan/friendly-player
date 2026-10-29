// `pnpm release`: builds the app and publishes it to GitHub Releases as v<version> (GH_TOKEN needed).
// The release is created here first: electron-builder uploads files in parallel, and when no release
// exists yet each upload creates its own; it also can't create the tag a published release needs.
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const REPO = 'stxpan/friendly-player'
const token = process.env.GH_TOKEN
if (!token) {
  console.error('Нужен GH_TOKEN — токен GitHub с доступом Contents: Read and write к репозиторию')
  process.exit(1)
}
const dir = path.resolve(import.meta.dirname, '..')
const { version } = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
const tag = `v${version}`

const api = (url, init = {}) =>
  fetch(`https://api.github.com/repos/${REPO}${url}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...init.headers },
  })

const existing = await api(`/releases/tags/${tag}`)
if (existing.status === 404) {
  // Tags the current main: commit and push the release's changes before running this.
  const res = await api('/releases', {
    method: 'POST',
    body: JSON.stringify({ tag_name: tag, target_commitish: 'main', name: `Friendly Player ${version}` }),
  })
  if (!res.ok) throw new Error(`Не удалось создать релиз ${tag}: ${res.status} ${await res.text()}`)
  console.log(`Создан релиз ${tag}`)
} else if (!existing.ok) {
  throw new Error(`GitHub ответил ${existing.status}`)
}

const run = (cmd) => execSync(cmd, { cwd: dir, stdio: 'inherit' })
run('node scripts/build.mjs')
run('npx electron-builder --publish always')
console.log(`Готово: https://github.com/${REPO}/releases/tag/${tag}`)
