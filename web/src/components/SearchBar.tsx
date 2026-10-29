import { useEffect, useRef } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

type Props = {
  value: string
  onChange: (value: string) => void
  onEscape: () => void
}

export function SearchBar({ value, onChange, onEscape }: Props) {
  const input = useRef<HTMLInputElement>(null)

  // "/" jumps to search. Checked by physical key, so it works in any layout (in Russian it types ".").
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const slash = (e.code === 'Slash' || e.code === 'NumpadDivide') && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey
      if (!slash || (e.target as HTMLElement).closest('input, textarea, [role="dialog"]')) return
      e.preventDefault()
      input.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="relative flex-1">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onEscape()
            e.currentTarget.blur()
          }
        }}
        placeholder="Поиск по библиотеке и YouTube Music  ( / )"
        className="pl-8"
      />
    </div>
  )
}
