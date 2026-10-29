// What the desktop app's preload script provides (desktop/preload.cjs); absent in a browser.

// Result of "check for updates": a found update downloads on its own, then onUpdateReady fires.
export type UpdateCheck =
  | { status: 'latest' }
  | { status: 'downloading' | 'ready'; version: string }
  | { status: 'error'; message: string }
  // Run unpackaged (`pnpm start`): there's nothing to update.
  | { status: 'dev' }

declare global {
  interface Window {
    desktop?: {
      onUpdateReady: (callback: (version: string) => void) => () => void
      installUpdate: () => void
      version: () => Promise<string>
      checkForUpdates: () => Promise<UpdateCheck>
      // System-wide track hotkeys (Ctrl+Shift+A / Ctrl+Shift+D), pressed while another app is focused.
      onTrackHotkey: (callback: (action: 'prev' | 'next') => void) => () => void
    }
  }
}
