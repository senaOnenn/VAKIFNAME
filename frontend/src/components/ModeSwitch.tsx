import { DEMO_AVAILABLE, MODE_PARAM, type AppMode } from '../mode'

const MODES: { mode: AppMode; href: string; label: string; note: string; available: boolean }[] = [
  { mode: 'katalog', href: '?', label: 'Gerçek Bursa Eserleri', note: 'Yayın onaylı kayıtlar', available: true },
  { mode: 'demo', href: `?${MODE_PARAM}=demo`, label: 'Demo Keşif Oyunu', note: 'Kurgusal test mekânları', available: DEMO_AVAILABLE },
  // Koşul burada doğrudan yazılır: üretim derlemesinde dal ve etiket metni pakete hiç girmez (scripts/check-public-build.mjs).
  ...(import.meta.env.DEV
    ? [{ mode: 'envanter' as const, href: `?${MODE_PARAM}=envanter`, label: 'Gerçek Bursa Envanteri',
         note: 'Dahili · yetki gerekir', available: true }]
    : []),
]

/**
 * Geliştirme ortamı çubuğu: genel platform, dahili envanter ve Demo Keşif Oyunu arasında geçiş. Yalnızca geliştirme
 * araçları (`dev/DevModes.tsx`) kullanır; genel kullanıcı arayüzünde ve üretim derlemesinde yoktur.
 */
export function ModeSwitch({ mode }: { mode: AppMode }) {
  const modes = MODES.filter((m) => m.available)
  if (modes.length < 2) return null
  return (
    <nav className="mode-switch" aria-label="Uygulama bölümleri">
      <div className="container mode-switch__inner">
        <p className="mode-switch__label">Geliştirme ortamı</p>
        <ul className="mode-switch__list">
          {modes.map((m) => (
            <li key={m.mode}>
              <a className="mode-switch__link" href={m.href} aria-current={m.mode === mode ? 'page' : undefined}>
                <span className="mode-switch__name">{m.label}</span>
                <span className="mode-switch__note">{m.note}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  )
}
