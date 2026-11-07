// Açık kaynak lisans bildirimi (7 Kasım; şartname: açık kaynak bileşenlerin lisans koşullarına uyulur).
// Yayın paketine giren npm bağımlılıklarının (package-lock.json'da geliştirme dışı olanlar) adı, sürümü, lisansı ve
// lisans metni ile kendi barındırdığımız yazı tipi ve harita verisi atfı tek dosyaya yazılır:
//   node scripts/third-party-notices.mjs   →  public/acik-kaynak-lisanslari.txt (yayında /acik-kaynak-lisanslari.txt)
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
const pkgs = Object.entries(lock.packages)
  .filter(([path, p]) => path && !p.dev && !p.devOptional)
  .map(([path]) => path)
  .sort()

const out = [
  'VAKIFNAME — açık kaynak lisansları / open-source licences',
  '',
  'Bu dosya, yayın paketine giren üçüncü taraf yazılımların lisans bildirimidir.',
  'This file lists the third-party software shipped in the web application and its licences.',
  '',
]
for (const path of pkgs) {
  const dir = join(root, path)
  const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f))
  out.push('='.repeat(100), `${meta.name} ${meta.version} — ${meta.license ?? 'lisans belirtilmemiş'}`, meta.homepage ?? '', '')
  out.push(file ? readFileSync(join(dir, file), 'utf8').trim() : '(Paket lisans dosyası içermiyor; lisans türü yukarıda.)', '')
}
out.push('='.repeat(100),
  'Cormorant Garamond (yazı tipi / typeface) — SIL Open Font License 1.1',
  'Copyright 2015 The Cormorant Project Authors (https://github.com/CatharsisFonts/Cormorant)',
  'Lisans / licence: https://openfontlicense.org',
  '',
  '='.repeat(100),
  'Harita verisi / map data — © OpenStreetMap katkıcıları / contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)',
  'Atıf haritanın köşesinde gösterilir / attribution is shown on the map.',
  '')
const target = join(root, 'public', 'acik-kaynak-lisanslari.txt')
writeFileSync(target, out.join('\n'))
console.log(`${pkgs.length} paket → ${target}${existsSync(target) ? '' : ' (yazılamadı)'}`)
