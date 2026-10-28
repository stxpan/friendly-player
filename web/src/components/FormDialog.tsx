import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type FormDialogProps = {
  title: string
  submitLabel: string
  fields: { name: string; label: string; value: string }[]
  onSubmit: (values: Record<string, string>) => Promise<void>
}

// Mounted only while open (the parent renders it conditionally), so initial values reset each time.
export function FormDialog({ title, submitLabel, fields, onSubmit, onClose }: FormDialogProps & { onClose: () => void }) {
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((f) => [f.name, f.value])))
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await onSubmit(values)
      onClose()
    } catch (err) {
      toast.error((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          {fields.map((f, i) => (
            <div key={f.name} className="flex flex-col gap-2">
              <Label htmlFor={`field-${f.name}`}>{f.label}</Label>
              <Input
                id={`field-${f.name}`}
                autoFocus={i === 0}
                value={values[f.name]}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              />
            </div>
          ))}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" disabled={saving}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
