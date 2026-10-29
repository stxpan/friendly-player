import { useState } from 'react'
import { toast } from 'sonner'
import { DeleteDialog } from '@/components/DeleteDialog'
import { FormDialog, type FormDialogProps } from '@/components/FormDialog'
import type { View } from '@/components/Sidebar'
import type { Library } from '@/hooks/useLibrary'
import { api, type Playlist, type SearchResult, type Track } from '@/lib/api'

type Options = {
  library: Library
  confirmDelete: boolean
  // "Delete without asking" was ticked in the confirmation.
  onStopConfirming: () => void
  // A track is gone from the library.
  onDeleted: (id: string) => void
  view: View
  setView: (v: View) => void
}

// Changes to tracks and playlists, and the dialogs they ask through (render `dialogs`).
export function useLibraryActions({ library, confirmDelete, onStopConfirming, onDeleted, view, setView }: Options) {
  const { loadTracks, loadPlaylists } = library
  const [dialog, setDialog] = useState<FormDialogProps | null>(null)
  const [deleting, setDeleting] = useState<Track | null>(null)

  // --- tracks ---

  const removeNow = async (track: Track) => {
    try {
      await api.deleteTrack(track.id)
      onDeleted(track.id)
      loadTracks()
      loadPlaylists()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // Asks first, unless the user ticked "delete without confirmation" once.
  const remove = (track: Track) => {
    if (!confirmDelete) void removeNow(track)
    else setDeleting(track)
  }

  const copyLink = async (track: Track) => {
    await navigator.clipboard.writeText(`https://www.youtube.com/watch?v=${track.id}`)
    toast.success('Ссылка скопирована')
  }

  const rename = (track: Track) =>
    setDialog({
      title: 'Переименовать трек',
      submitLabel: 'Сохранить',
      fields: [
        { name: 'title', label: 'Название', value: track.title },
        { name: 'artist', label: 'Исполнитель', value: track.artist ?? '' },
      ],
      onSubmit: async (v) => {
        await api.renameTrack(track.id, v.title, v.artist)
        loadTracks()
      },
    })

  const togglePlaylist = async (p: Playlist, track: Track, add: boolean) => {
    try {
      if (add) await api.addToPlaylist(p.id, track.id)
      else await api.removeFromPlaylist(p.id, track.id)
      toast.success(add ? `Добавлено в «${p.name}»` : `Убрано из «${p.name}»`)
      loadPlaylists()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const download = async (ids: string[]) => {
    try {
      const { queued } = await api.downloadTracks(ids)
      if (queued > 1) toast.success(`Скачиваем: ${queued}`)
      // Job ids differ from track ids; the poll brings the new jobs in.
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // "Download" on a streamed result: add it to the library and fetch the file right away.
  const downloadResult = async (r: SearchResult) => {
    try {
      await api.addTrack(r)
      loadTracks()
      await download([r.id])
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // --- playlists ---

  const createPlaylist = () =>
    setDialog({
      title: 'Новый плейлист',
      submitLabel: 'Создать',
      fields: [{ name: 'name', label: 'Название', value: '' }],
      onSubmit: async (v) => {
        const { id } = await api.createPlaylist(v.name)
        loadPlaylists()
        setView(id)
      },
    })

  const renamePlaylist = (p: Playlist) =>
    setDialog({
      title: 'Переименовать плейлист',
      submitLabel: 'Сохранить',
      fields: [{ name: 'name', label: 'Название', value: p.name }],
      onSubmit: async (v) => {
        await api.renamePlaylist(p.id, v.name)
        loadPlaylists()
      },
    })

  const deletePlaylist = (p: Playlist) =>
    setDialog({
      title: `Удалить плейлист «${p.name}»? Треки останутся в библиотеке.`,
      submitLabel: 'Удалить',
      fields: [],
      onSubmit: async () => {
        await api.deletePlaylist(p.id)
        if (view === p.id) setView('all')
        loadPlaylists()
      },
    })

  const dialogs = (
    <>
      {dialog && <FormDialog {...dialog} onClose={() => setDialog(null)} />}
      {deleting && (
        <DeleteDialog
          track={deleting}
          onConfirm={(dontAsk) => {
            if (dontAsk) onStopConfirming()
            void removeNow(deleting)
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  )

  return {
    remove,
    copyLink,
    rename,
    togglePlaylist,
    download,
    downloadResult,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    dialogs,
  }
}
