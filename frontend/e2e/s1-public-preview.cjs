// S1: PRODUCTION önizlemesi (app.web + demo uçları kapalı genel API). Geliştirme çubuğu, demo ve envanter yok.
const { scenario } = require('./lib.cjs')
const [BASE, out] = process.argv.slice(2)

scenario('S1', async ({ browser, check }) => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  const page = await ctx.newPage()
  const requests = []
  const cspErrors = []
  page.on('request', (r) => requests.push(new URL(r.url()).pathname))
  page.on('console', (m) => /Content Security Policy|Refused to/.test(m.text()) && cspErrors.push(m.text().slice(0, 120)))
  const res = await page.goto(BASE + '/')
  check('Güvenlik başlıkları (CSP, nosniff, DENY)', /script-src 'self'/.test(res.headers()['content-security-policy'] ?? '') &&
        res.headers()['x-content-type-options'] === 'nosniff' && res.headers()['x-frame-options'] === 'DENY')
  await page.getByText('Henüz yayımlanmış gerçek eser yok').waitFor()
  check('Boş katalog açıkça gösteriliyor', true)
  const body = await page.locator('body').innerText()
  check('Geliştirme çubuğu / mod seçici yok', (await page.getByRole('navigation', { name: 'Uygulama bölümleri' }).count()) === 0
        && !/Geliştirme ortamı|GELİŞTİRME ORTAMI/.test(body))
  check('Demo ve envanter bağlantısı yok', !/Demo Keşif Oyunu|Demo Mekân|Gerçek Bursa Envanteri/.test(body))
  const links = await page.getByRole('navigation', { name: 'Ana menü' }).getByRole('link').evaluateAll((a) => a.map((x) => x.getAttribute('href')))
  check('Menüde yalnızca platform sayfaları', JSON.stringify(links) === JSON.stringify(['#katalog', '#katalog-harita', '#hikaye', '#pasaport-tanitim']), links.join(' '))
  check('Harita boş durumu açıklayıcı, büyük kutu yok', await page.getByText('Haritada henüz onaylı konum yok').isVisible() &&
        (await page.locator('.place-map--placeholder, .leaflet-container').count()) === 0)
  await page.getByText(/Henüz mühür yok/).waitFor()
  check('Pasaport gerçek eser pasaportu (0 mühür, nedeni açık)', true)
  await page.screenshot({ path: `${out}/s1-katalog-bos.png`, fullPage: true })

  for (const q of ['?mod=demo', '?mod=envanter']) {
    await page.goto(BASE + '/' + q)
    await page.getByText('Henüz yayımlanmış gerçek eser yok').waitFor()
    check(`${q} üretimde genel sayfaya düşüyor`, (await page.getByLabel('Dahili erişim anahtarı').count()) === 0 &&
          (await page.getByRole('list', { name: 'Eser listesi' }).count()) === 0)
  }
  const bad = requests.filter((p) => p.startsWith('/internal') || p.startsWith('/places') || /\/users\/[^/]+\/passport$/.test(p))
  check('İstekler yalnızca genel katalog ve gerçek pasaport', bad.length === 0 &&
        requests.some((p) => p === '/monuments') && requests.some((p) => p.endsWith('/monument-passport')), bad.join(', '))
  check('CSP ihlali yok', cspErrors.length === 0, cspErrors.join(' | '))

  const mobile = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage()
  await mobile.goto(BASE + '/')
  await mobile.getByText('Haritada henüz onaylı konum yok').waitFor()
  check('Mobil: yatay taşma yok', await mobile.evaluate(() => window.innerWidth === 390 && document.documentElement.scrollWidth <= 391))
  await mobile.screenshot({ path: `${out}/s1-katalog-bos-mobil.png`, fullPage: true })
})
