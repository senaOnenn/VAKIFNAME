import { useEffect, useState } from 'react'
import { citySlug, getMonuments, useLoad } from '../api'
import { CITIES, withCatalog } from '../cities'
import { FILM_URL, FilmDialog } from '../components/FilmDialog'
import { StoryExperience } from '../story/StoryExperience'

/**
 * Ana sayfa (açılış animasyonundan sonra): 7 sahnelik hikâye (bkz. story/). Şehir ve sayılar katalogdan gelir: pilot şehir
 * katalogda eseri olan ilk şehirdir; katalog yüklenene kadar şehir listesindeki varsayılan kullanılır (CLAUDE.md §1).
 */
export default function Landing() {
  // Tanıtım filmi derlemeye girdiyse düğme görünür (dosya yoksa sorulur, 404 → düğme yok).
  const [hasFilm, setHasFilm] = useState(false)
  const [filmOpen, setFilmOpen] = useState(false)
  useEffect(() => {
    let alive = true
    fetch(new URL(FILM_URL, window.location.href).href, { method: 'HEAD' }).then(
      (r) => alive && setHasFilm(r.ok),
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [])
  const catalog = useLoad((s) => getMonuments(s), [])
  const all = catalog.data?.monuments ?? []
  const cities = withCatalog(CITIES, catalog.data ? all.map((m) => m.city) : null, citySlug)
  const city = cities.find((c) => c.open) ?? CITIES[0]
  const monuments = all.filter((m) => citySlug(m.city) === city.slug)

  return (
    <>
      <FilmDialog open={filmOpen} onClose={() => setFilmOpen(false)} />
      <StoryExperience
        cities={cities}
        pilot={{ city, count: monuments.length }}
        monuments={monuments}
        loading={catalog.loading}
        error={catalog.error}
        reload={catalog.reload}
        hasFilm={hasFilm}
        onFilm={() => setFilmOpen(true)}
      />
    </>
  )
}
