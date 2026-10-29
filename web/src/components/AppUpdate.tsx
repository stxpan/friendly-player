import { useEffect } from 'react'
import { toast } from 'sonner'

// Provided by the desktop app's preload script; absent in a browser.
declare global {
  interface Window {
    desktop?: {
      onUpdateReady: (callback: (version: string) => void) => void
      installUpdate: () => void
    }
  }
}

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
