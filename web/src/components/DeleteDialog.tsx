import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import type { Track } from '@/lib/api'

type Props = {
  track: Track
  // "Don't ask again": the caller remembers it and deletes right away next time.
  onConfirm: (dontAskAgain: boolean) => void
  onClose: () => void
}

export function DeleteDialog({ track, onConfirm, onClose }: Props) {
  const [dontAsk, setDontAsk] = useState(false)
  const downloaded = Boolean(track.file)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{downloaded ? 'Удалить трек с компьютера?' : 'Убрать трек из библиотеки?'}</DialogTitle>
          <DialogDescription>
            «{track.title}»{track.artist ? ` — ${track.artist}` : ''}.{' '}
            {downloaded
              ? 'Файл будет удалён, трек пропадёт из библиотеки и всех плейлистов.'
              : 'Трек пропадёт из библиотеки и всех плейлистов.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Checkbox id="dont-ask" checked={dontAsk} onCheckedChange={(v) => setDontAsk(v === true)} />
          <Label htmlFor="dont-ask" className="font-normal">
            Удалять без подтверждения
          </Label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm(dontAsk)
              onClose()
            }}
          >
            Удалить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
