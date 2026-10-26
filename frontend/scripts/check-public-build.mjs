// Üretim derlemesinin (dist/) dahili envanter ekranını, inceleme API yollarını veya gerçek eser verisini içermediğini
// denetler. `npm run build` sonunda çalışır; ihlal varsa derleme başarısız olur. İsteğe bağlı ilk argüman başka bir
// derleme dizinidir (yalıtılmış tarayıcı testleri kendi geçici dizinine derler).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DIST = process.argv[2] ?? new URL('../dist/', import.meta.url).pathname
const FORBIDDEN = [
  '/internal/',
  'X-Vakifname-Review',
  'Gerçek Bursa Envanteri',
  'Dahili erişim anahtarı',
  'review/tickets',
  'İncelemeci',
  'vakifname_review_session',
  // Dahili araştırma haritası ve kimlik formu yalnızca geliştirme sunucusundadır.
  'Doğrulanmamış konum adayı',
  'Bursa araştırma haritası',
  'research-marker',
  'location-candidates',
  'identity_source_ids',
  // Geliştirme ortamı ve kurgusal Demo Keşif Oyunu genel derlemede yoktur.
  'Geliştirme ortamı',
  'Demo Keşif Oyunu',
  'Demo Mekân',
  'vakifname.demoUserId',
  'Demo konumuyla',
  '/places',
  '/passport`',
  'mod=demo',
  'mod=envanter',
  /\bdemo\b/i,
  // Gerçek eser kimlikleri yalnızca API'den gelir; pakete gömülmez.
  /BUR-\d{4}/,
]

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* files(path)
    else if (/\.(js|css|html|map|json)$/.test(name)) yield path
  }
}

const hits = []
for (const path of files(DIST)) {
  const text = readFileSync(path, 'utf8')
  for (const marker of FORBIDDEN) {
    if (typeof marker === 'string' ? text.includes(marker) : marker.test(text)) hits.push(`${path}: ${marker}`)
  }
}
if (hits.length) {
  console.error('Genel derleme dahili içerik barındırıyor:\n' + hits.join('\n'))
  process.exit(1)
}
console.log('Genel derleme denetimi: dahili envanter ve gerçek eser verisi pakette yok.')
