import type { SearchResult } from '@/lib/api'

// "Ага, ну" should be found by "ага ну", "ну ага" and "fuf ye" (typed in the wrong layout).

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`"
const RU = 'йцукенгшщзхъфывапролджэячсмитьбюё'
const layout = (s: string, from: string, to: string) =>
  [...s].map((c) => (from.includes(c) ? to[from.indexOf(c)] : c)).join('')

// Every word of the query must appear somewhere in the text, in any order.
export function matcher(query: string): (text: string) => boolean {
  const q = query.toLowerCase()
  const variants = [q, layout(q, EN, RU), layout(q, RU, EN)]
    .map((v) => normalize(v).split(' ').filter(Boolean))
    .filter((words) => words.length > 0)
  return (text) => {
    const hay = normalize(text)
    return variants.some((words) => words.every((w) => hay.includes(w)))
  }
}

// YouTube Music often returns the same song twice (album and single uploads); keep one,
// preferring the copy already in the library.
export function dedupeResults(results: SearchResult[], inLibrary: (id: string) => boolean): SearchResult[] {
  const byKey = new Map<string, SearchResult>()
  for (const r of results) {
    const key = `${normalize(r.artist)}|${normalize(r.title)}`
    const seen = byKey.get(key)
    if (!seen || (!inLibrary(seen.id) && inLibrary(r.id))) byKey.set(key, r)
  }
  return [...byKey.values()]
}
