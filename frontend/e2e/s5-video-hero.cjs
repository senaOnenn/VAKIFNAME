// S5: Ana sayfa video girişi. Üretim önizlemesi (dist/media/hero.mp4) ve geliştirme sunucusu rotası.
const { scenario } = require('./lib.cjs')
const [PREVIEW, DEV, out] = process.argv.slice(2)

async function waitPlaying(page) {
  await page.waitForFunction(() => {
    const v = document.querySelector('video.video-hero__video')
    return v && !v.paused && v.readyState >= 3 && v.currentTime > 0.5
  }, null, { timeout: 15000 })
  return page.evaluate(() => {
    const v = document.querySelector('video.video-hero__video')
    const r = v.getBoundingClientRect()
    const cs = getComputedStyle(v)
    return { w: v.videoWidth, h: v.videoHeight, boxW: r.width, boxH: r.height, t: v.currentTime, muted: v.muted,
             loop: v.loop, filter: cs.filter, transform: cs.transform, fit: cs.objectFit, opacity: cs.opacity,
             src: v.currentSrc }
  })
}

async function noHorizontalScroll(page, width) {
  return page.evaluate((w) => window.innerWidth === w && document.documentElement.scrollWidth <= w + 1, width)
}

scenario('S5-video', async ({ browser, check }) => {
  // Masaüstü, üretim önizlemesi.
  const desk = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage()
  await desk.goto(PREVIEW + '/')
  const d = await waitPlaying(desk)
  check('Masaüstü: video oynuyor', d.t > 0.5, `t=${d.t.toFixed(2)} sn, ${d.src.replace(PREVIEW, '')}`)
  check('Video 1280×720 çözülüyor', d.w === 1280 && d.h === 720)
  check('Sessiz ve döngülü', d.muted && d.loop)
  await desk.waitForTimeout(1200)
  const look = await desk.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('video.video-hero__video'))
    return { filter: cs.filter, transform: cs.transform, opacity: cs.opacity }
  })
  check('Bulanıklık/dönüşüm yok, tam görünür', look.filter === 'none' && look.transform === 'none' && look.opacity === '1',
        JSON.stringify(look))
  const ratio = d.boxW / d.boxH
  check('Masaüstü: oran 16:9 (kırpmasız) veya ekran yüksekliğine sığdırılmış', Math.abs(ratio - 16 / 9) < 0.02 || d.boxH >= 600,
        `${Math.round(d.boxW)}×${Math.round(d.boxH)} · ölçek ${(d.boxW / 1280).toFixed(2)}×`)
  check('Masaüstü: yatay kaydırma yok', await noHorizontalScroll(desk, 1366))
  const headings = await desk.evaluate(() =>
    [...document.querySelectorAll('main h1, main h2')].map((h) => h.textContent.replace(/\s+/g, ' ').trim()))
  check('Bölüm sırası', JSON.stringify(headings) === JSON.stringify(['VAKIFNAME', 'Merak et.İzini sür.', 'Gerçek Bursa Eserleri',
        'Bursa Keşif Haritası', 'Bursa’nın Kayıp Vakfiyesi', 'Dijital Miras Pasaportu']), headings.join(' › '))
  check('Footer var', (await desk.locator('footer.site-footer').count()) === 1)
  check('Temsilî/üretilmiş görüntü notu', await desk.getByText(/yapay zekâ ile üretilmiş görüntü/).isVisible())
  await desk.waitForTimeout(1500)
  await desk.screenshot({ path: `${out}/s5-hero-masaustu.png` })
  await desk.getByRole('button', { name: 'Videoyu duraklat' }).click()
  check('Duraklatma düğmesi çalışıyor', await desk.evaluate(() => document.querySelector('video.video-hero__video').paused))
  await desk.getByRole('link', { name: 'Hikâyeye Başla' }).click()
  await desk.waitForTimeout(600)
  check('"Hikâyeye Başla" hikâye bölümüne götürüyor', (await desk.evaluate(() => location.hash)) === '#hikaye' &&
        await desk.getByRole('heading', { name: 'Bursa’nın Kayıp Vakfiyesi' }).isVisible())
  await desk.getByRole('link', { name: 'Eserleri Keşfet' }).click()
  check('"Eserleri Keşfet" kataloğa götürüyor', (await desk.evaluate(() => location.hash)) === '#katalog')

  // Dağıtım: üretim önizlemesi ve geliştirme rotası Range ile video/mp4 verir.
  for (const [label, base] of [['Üretim önizlemesi', PREVIEW], ['Geliştirme sunucusu', DEV]]) {
    const r = await desk.request.get(base + '/media/hero.mp4', { headers: { Range: 'bytes=0-99' } })
    const body = await r.body()
    check(`${label}: /media/hero.mp4 → 206 video/mp4`, r.status() === 206 && r.headers()['content-type'].startsWith('video/mp4') &&
          body.length === 100 && body.toString('latin1', 4, 8) === 'ftyp', `${r.status()} ${r.headers()['content-range'] ?? ''}`)
  }
  for (const path of ['/media/other.mp4', '/media/hero.mp4.bak', '/media/hero.mp4/x']) {
    const r = await desk.request.get(DEV + path)
    check(`Geliştirme rotası yalnızca tam adresi sunuyor (${path})`, !(r.headers()['content-type'] ?? '').startsWith('video/'))
  }

  // Mobil.
  const mob = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })).newPage()
  await mob.goto(PREVIEW + '/')
  const m = await waitPlaying(mob)
  check('Mobil: video oynuyor', m.t > 0.5)
  check('Mobil: video kırpılmadan 16:9 (yakınlaştırma yok)', Math.abs(m.boxW / m.boxH - 16 / 9) < 0.02 && m.boxW <= 390,
        `${Math.round(m.boxW)}×${Math.round(m.boxH)}`)
  const layout = await mob.evaluate(() => {
    const media = document.querySelector('.video-hero__media').getBoundingClientRect()
    const title = document.querySelector('.video-hero__title').getBoundingClientRect()
    const btn = [...document.querySelectorAll('.video-hero__actions a')].map((a) => a.getBoundingClientRect().height)
    return { below: title.top >= media.bottom - 1, btn }
  })
  check('Mobil: başlık videonun altında, okunur', layout.below)
  check('Mobil: düğmeler en az 44 px', layout.btn.every((h) => h >= 44))
  check('Mobil: yatay kaydırma yok', await noHorizontalScroll(mob, 390))
  await mob.waitForTimeout(1200)
  await mob.screenshot({ path: `${out}/s5-hero-mobil.png` })

  // Video bozulursa: çizim görünür, video kaldırılır.
  const brokenCtx = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  await brokenCtx.route('**/media/hero.mp4', (r) => r.fulfill({ status: 404, body: '' }))
  const broken = await brokenCtx.newPage()
  await broken.goto(PREVIEW + '/')
  await broken.getByText('Temsilî çizim · Eser fotoğrafı değildir').waitFor()
  check('Bozuk video: mimari çizim gösteriliyor', await broken.locator('.video-hero__fallback svg').isVisible() &&
        (await broken.locator('video').count()) === 0)
  const corruptCtx = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  await corruptCtx.route('**/media/hero.mp4', (r) => r.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.alloc(4096, 7) }))
  const corrupt = await corruptCtx.newPage()
  await corrupt.goto(PREVIEW + '/')
  await corrupt.getByText('Temsilî çizim · Eser fotoğrafı değildir').waitFor({ timeout: 10000 })
  check('Bozuk içerikli video: çizime düşüyor', (await corrupt.locator('video').count()) === 0)
  await broken.screenshot({ path: `${out}/s5-hero-fallback.png` })

  // Azaltılmış hareket.
  const calm = await (await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' })).newPage()
  await calm.goto(PREVIEW + '/')
  await calm.getByRole('heading', { level: 1, name: 'VAKIFNAME' }).waitFor()
  await calm.waitForTimeout(1000)
  check('Azaltılmış hareket: video kendiliğinden başlamıyor', (await calm.locator('video').count()) === 0)
  await calm.getByRole('button', { name: 'Giriş videosunu oynat' }).click()
  const c = await waitPlaying(calm)
  check('Azaltılmış hareket: kullanıcı isteyince oynuyor', c.t > 0.5)
})
