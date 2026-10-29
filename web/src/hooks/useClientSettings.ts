import { useEffect, useState } from 'react'
import type { ClientSettings } from '@/components/Settings'
import { load, save } from '@/lib/storage'

export function useClientSettings() {
  const [settings, setSettings] = useState<ClientSettings>(() => ({
    // Older versions stored the opposite flag.
    confirmDelete: !load('player.deleteWithoutConfirm', false),
    normalize: load('player.normalize', true),
    menuSide: load<'left' | 'right'>('player.menuSide', 'left'),
  }))
  useEffect(() => {
    save('player.deleteWithoutConfirm', !settings.confirmDelete)
    save('player.normalize', settings.normalize)
    save('player.menuSide', settings.menuSide)
  }, [settings])
  return [settings, setSettings] as const
}
