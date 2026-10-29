// What the desktop app's preload script provides (desktop/preload.cjs); absent in a browser.
declare global {
  interface Window {
    desktop?: {
      onUpdateReady: (callback: (version: string) => void) => void
      installUpdate: () => void
      // System-wide track hotkeys (Ctrl+Shift+A / Ctrl+Shift+D), pressed while another app is focused.
      onTrackHotkey: (callback: (action: 'prev' | 'next') => void) => () => void
    }
  }
}

export {}
