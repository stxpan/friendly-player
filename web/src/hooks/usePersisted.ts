import { useEffect, useState } from 'react'
import { load, save } from '@/lib/storage'

// useState that survives a reload (localStorage).
export function usePersisted<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => load(key, fallback))
  useEffect(() => save(key, value), [key, value])
  return [value, setValue] as const
}
