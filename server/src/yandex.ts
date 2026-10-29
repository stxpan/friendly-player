export type YandexTrack = {
  id: string
  title: string
  artists: string[]
  durationMs: number
}

type ApiTrack = {
  id: string
  title: string
  version?: string
  durationMs: number
  artists: { name: string }[]
}

// Public playlists via the unofficial API the web player itself uses.
// It answers 451 to foreign IPs, so the host must be reachable without VPN.
export async function fetchYandexPlaylist(url: URL): Promise<{ title: string; tracks: YandexTrack[] }> {
  const uuid = url.pathname.match(/\/playlists\/(lk\.[\w-]+)/)?.[1]
  if (!uuid) throw new Error('Поддерживаются ссылки вида music.yandex.ru/playlists/lk.…')

  const res = await fetch(`https://api.music.yandex.net/playlist/${uuid}`)
  if (res.status === 451) throw new Error('Яндекс Музыка недоступна из этой сети (451) — проверь исключения VPN')
  if (res.status === 403) throw new Error('Яндекс Музыка отклонила запрос (403) — попробуй ещё раз')
  if (!res.ok) throw new Error(`Яндекс Музыка ответила ${res.status}`)

  const { result } = (await res.json()) as { result: { title: string; tracks: { track: ApiTrack }[] } }
  return {
    title: result.title,
    tracks: result.tracks.map(({ track }) => ({
      id: track.id,
      title: track.version ? `${track.title} (${track.version})` : track.title,
      artists: track.artists.map((a) => a.name),
      durationMs: track.durationMs,
    })),
  }
}
