import { useEffect } from 'react'
import { toast } from 'sonner'
import '@/lib/desktop'

// Desktop app only: a new version has been downloaded in the background and waits for a restart.
// If the user doesn't restart now, it's installed when the app is closed.
export function AppUpdate() {
  useEffect(() => {
    window.desktop?.onUpdateReady((version) =>
      toast(`Доступна версия ${version}`, {
        // One notice even if the callback fires more than once.
        id: 'app-update',
        description: 'Установится при следующем закрытии плеера',
        duration: Infinity,
        action: { label: 'Перезапустить', onClick: () => window.desktop?.installUpdate() },
      }),
    )
  }, [])
  return null
}
