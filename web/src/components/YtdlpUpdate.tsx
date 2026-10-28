import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api } from '@/lib/api'

// Checked on every app start: YouTube changes often, and an outdated yt-dlp is the usual reason downloads break.
export function YtdlpUpdate() {
  const [versions, setVersions] = useState<{ current: string; latest: string } | null>(null)
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    api
      .ytdlp()
      .then(({ current, latest }) => {
        if (latest && latest !== current) setVersions({ current, latest })
      })
      .catch(() => {
        // No network or GitHub unavailable: nothing to offer, don't nag.
      })
  }, [])

  const update = async () => {
    setUpdating(true)
    try {
      const { current } = await api.updateYtdlp()
      toast.success(`yt-dlp обновлён до ${current}`)
      setVersions(null)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setUpdating(false)
    }
  }

  return (
    <Dialog open={versions !== null} onOpenChange={(open) => !open && !updating && setVersions(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Доступно обновление yt-dlp</DialogTitle>
          <DialogDescription>
            yt-dlp — программа, которая скачивает музыку с YouTube. YouTube регулярно меняет сайт, и старые версии
            перестают работать: загрузки падают с ошибками или не находят треки. Обновление занимает несколько секунд.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">
          Установлена <span className="font-mono">{versions?.current}</span>, последняя —{' '}
          <span className="font-mono">{versions?.latest}</span>.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setVersions(null)} disabled={updating}>
            Позже
          </Button>
          <Button onClick={update} disabled={updating}>
            {updating && <Loader2 className="animate-spin" />}
            Обновить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
