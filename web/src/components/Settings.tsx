import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { api, type ServerSettings } from '@/lib/api'

export type ClientSettings = { confirmDelete: boolean; normalize: boolean; menuSide: 'left' | 'right' }

type Props = {
  client: ClientSettings
  onClientChange: (s: ClientSettings) => void
  // Files were removed or moved; the library should be reloaded.
  onLibraryChanged: () => void
}

const CLEANUP_DAYS = [30, 90, 180, 365]

function bytes(n: number) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} ГБ`
  return `${Math.round(n / 1024 ** 2)} МБ`
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="min-w-0">
        <div className="text-sm">{title}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function Settings({ client, onClientChange, onLibraryChanged }: Props) {
  const [server, setServer] = useState<ServerSettings | null>(null)
  const [dir, setDir] = useState('')
  const [moving, setMoving] = useState(false)
  const [usage, setUsage] = useState<{ downloaded: number; online: number; bytes: number } | null>(null)
  const [days, setDays] = useState('90')
  const [preview, setPreview] = useState<{ count: number; bytes: number } | null>(null)
  const [cleaning, setCleaning] = useState(false)

  const loadUsage = () => api.storage().then(setUsage, (e) => toast.error(e.message))

  useEffect(() => {
    api.settings().then((s) => {
      setServer(s)
      setDir(s.mediaDir)
    }, (e) => toast.error(e.message))
    loadUsage()
  }, [])

  useEffect(() => {
    setPreview(null)
    api.cleanupPreview(Number(days)).then(setPreview, () => {})
  }, [days, usage])

  const saveConcurrency = async (v: string) => {
    try {
      const s = await api.saveSettings({ concurrency: Number(v) })
      setServer((cur) => cur && { ...cur, concurrency: s.concurrency })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const moveFolder = async () => {
    setMoving(true)
    try {
      const s = await api.saveSettings({ mediaDir: dir.trim() })
      setServer((cur) => cur && { ...cur, mediaDir: s.mediaDir })
      setDir(s.mediaDir)
      const left = s.moved?.leftBehind ? `, ${s.moved.leftBehind} не удалось удалить из старой папки` : ''
      toast.success(`Папка перенесена: ${s.moved?.moved ?? 0} файлов${left}`)
      onLibraryChanged()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setMoving(false)
    }
  }

  const clean = async () => {
    setCleaning(true)
    try {
      const r = await api.cleanup(Number(days))
      toast.success(`Освобождено ${bytes(r.bytes)}: ${r.count} треков теперь играют онлайн`)
      onLibraryChanged()
      loadUsage()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCleaning(false)
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6 overflow-y-auto p-4">
      <section>
        <h3 className="text-sm font-medium">Воспроизведение</h3>
        <div className="divide-y">
          <Row title="Меню" hint="Панель текста песни встаёт с другой стороны">
            <Select
              value={client.menuSide}
              onValueChange={(v) => onClientChange({ ...client, menuSide: v as ClientSettings['menuSide'] })}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="left">Слева</SelectItem>
                <SelectItem value="right">Справа</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row title="Выравнивать громкость" hint="Громкие треки приглушаются до общего уровня (только скачанные)">
            <Switch checked={client.normalize} onCheckedChange={(v) => onClientChange({ ...client, normalize: v })} />
          </Row>
          <Row title="Спрашивать перед удалением трека">
            <Switch
              checked={client.confirmDelete}
              onCheckedChange={(v) => onClientChange({ ...client, confirmDelete: v })}
            />
          </Row>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-medium">Загрузки</h3>
        <div className="divide-y">
          <Row title="Одновременных загрузок" hint="Больше 3 — YouTube может начать ограничивать скорость">
            {server ? (
              <Select value={String(server.concurrency)} onValueChange={saveConcurrency}>
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            )}
          </Row>
          <div className="flex flex-col gap-2 py-3">
            <Label htmlFor="media-dir" className="font-normal">
              Папка с музыкой
            </Label>
            <div className="flex gap-2">
              <Input id="media-dir" value={dir} onChange={(e) => setDir(e.target.value)} disabled={!server || moving} />
              <Button
                variant="outline"
                disabled={!server || moving || !dir.trim() || dir.trim() === server.mediaDir}
                onClick={moveFolder}
              >
                {moving && <Loader2 className="animate-spin" />}
                Перенести
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Скачанные файлы будут перенесены в новую папку. Пока идут загрузки, перенос недоступен.
            </p>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-medium">Место на диске</h3>
        <div className="divide-y">
          <Row
            title={usage ? `Музыка занимает ${bytes(usage.bytes)}` : 'Считаем…'}
            hint={usage ? `Скачано треков: ${usage.downloaded}, только онлайн: ${usage.online}` : undefined}
          >
            {null}
          </Row>
          <div className="flex flex-col gap-2 py-3">
            <div className="text-sm">Освободить место</div>
            <p className="text-xs text-muted-foreground">
              Удаляет файлы треков, которые давно не слушал. Треки остаются в библиотеке и плейлистах и играют онлайн.
            </p>
            <div className="flex items-center gap-2">
              <span className="text-sm">Не слушал дольше</span>
              <Select value={days} onValueChange={setDays}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLEANUP_DAYS.map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d === 365 ? 'года' : `${d} дней`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="destructive" disabled={!preview?.count || cleaning} onClick={clean}>
                {cleaning && <Loader2 className="animate-spin" />}
                {preview ? `Удалить файлы: ${preview.count} (${bytes(preview.bytes)})` : 'Считаем…'}
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
