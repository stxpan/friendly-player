import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api, type SearchResult } from '@/lib/api'

const SEARCH_DEBOUNCE_MS = 400

// YouTube Music search for `query`, with further pages loaded on demand (infinite scroll).
export function useMusicSearch(query: string) {
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  // Token for the next page of results, and the request of the current search.
  const [more, setMore] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const searchCtrl = useRef<AbortController | null>(null)

  useEffect(() => {
    setResults([])
    setMore(null)
    setLoadingMore(false)
    if (!query) return
    setSearching(true)
    const ctrl = new AbortController()
    searchCtrl.current = ctrl
    const timer = setTimeout(() => {
      api
        .search(query, ctrl.signal)
        .then((page) => {
          setResults(page.results)
          setMore(page.more)
        })
        .catch((e) => {
          if (e.name !== 'AbortError') toast.error(e.message)
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setSearching(false)
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [query])

  const loadMore = () => {
    const ctrl = searchCtrl.current
    if (!more || loadingMore || !ctrl) return
    setLoadingMore(true)
    api
      .searchMore(more, ctrl.signal)
      .then((page) => {
        setResults((cur) => {
          const seen = new Set(cur.map((r) => r.id))
          return [...cur, ...page.results.filter((r) => !seen.has(r.id))]
        })
        setMore(page.more)
      })
      .catch((e) => {
        if (e.name === 'AbortError') return
        // Stop here rather than retrying on every scroll.
        setMore(null)
        toast.error(e.message)
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoadingMore(false)
      })
  }

  return { results, searching, loadingMore, loadMore: more ? loadMore : undefined }
}
