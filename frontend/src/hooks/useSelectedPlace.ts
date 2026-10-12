import { useCallback, useEffect, useState } from 'react'

const PARAM = 'eser'

function readFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get(PARAM)
}

/** Seçili eser ID'sini `?eser=<id>` adres parametresiyle eşler; paylaşılabilir bağlantı ve geri tuşu çalışır. */
export function useSelectedPlace(): [string | null, (placeId: string | null) => void] {
  const [selectedId, setSelectedId] = useState<string | null>(readFromUrl)

  useEffect(() => {
    const onPopState = () => setSelectedId(readFromUrl())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const select = useCallback((placeId: string | null) => {
    const url = new URL(window.location.href)
    if (placeId) url.searchParams.set(PARAM, placeId)
    else url.searchParams.delete(PARAM)
    if (url.href !== window.location.href) window.history.pushState(null, '', url)
    setSelectedId(placeId)
  }, [])

  return [selectedId, select]
}
