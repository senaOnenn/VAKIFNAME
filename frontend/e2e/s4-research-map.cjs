// S4: Dahili Bursa araştırma haritası (masaüstü + mobil) ve yapılandırılmış temel kimlik formu.
// Gerçek V20 + YENİ geçici inceleme DB'si; karar yalnızca geçici DB'deki test hesabıyla verilir ve çalıştırma sonunda silinir.
const fs = require('fs')
const { scenario } = require('./lib.cjs')
const [BASE, out, workdir] = process.argv.slice(2)
const secret = (name) => fs.readFileSync(`${workdir}/${name}`, 'utf8').trim()

async function openInventory(page) {
  await page.goto(BASE + '/?mod=envanter')
  await page.getByLabel('Dahili erişim anahtarı').fill(secret('token'))
  await page.getByRole('button', { name: 'Oturum aç' }).click()
  await page.locator('.research-map .leaflet-marker-icon').first().waitFor()
}

// Her işaretçinin temsil ettiği aday sayısı: tekil işaretçi 1, grup işaretçisi başlığındaki sayı.
async function markerSummary(page) {
  const titles = await page.locator('.research-map .leaflet-marker-icon').evaluateAll((els) => els.map((e) => e.title))
  const count = titles.reduce((n, t) => n + (/^\d+ /.test(t) ? Number(t.split(' ')[0]) : 1), 0)
  return { titles, count }
}

async function noHorizontalScroll(page) {
  // Mobil öykünmede taşan içerik yerleşim genişliğini büyütür (sayfa uzaklaşır); genişlik de denetlenir.
  return page.evaluate(() => window.innerWidth === window.outerWidth && document.documentElement.scrollWidth <= window.innerWidth + 1)
}

scenario('S4-masaüstü', async ({ browser, check }) => {
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage()
  const tiles = []
  page.on('response', (r) => r.url().includes('tile.openstreetmap.org') && tiles.push(r.status()))
  await openInventory(page)
  const region = page.getByRole('region', { name: 'Bursa araştırma haritası (doğrulanmamış adaylar)' })
  check('Araştırma haritası görünür', await region.isVisible())
  const list = page.getByRole('list', { name: 'Gerçek eserler ve konum adayları' })
  check('10 gerçek eser listede', (await list.locator(':scope > li').count()) === 10)
  check('Listede 15 aday satırı', (await list.locator('ul > li').count()) === 15)
  const { titles, count } = await markerSummary(page)
  check('Haritadaki işaretçiler toplam 15 adayı temsil ediyor', count === 15, `${titles.length} işaretçi`)
  check('Her işaretçi "doğrulanmamış" olarak etiketli', titles.every((t) => /oğrulanmamış konum adayı/.test(t)))
  check('Bursa merkezde: işaretçiler harita kutusu içinde', await page.evaluate(() => {
    const box = document.querySelector('.research-map').getBoundingClientRect()
    return [...document.querySelectorAll('.research-map .leaflet-marker-icon')].every((m) => {
      const r = m.getBoundingClientRect()
      return r.left >= box.left - 20 && r.right <= box.right + 20 && r.top >= box.top - 20 && r.bottom <= box.bottom + 20
    })
  }))
  await page.screenshot({ path: `${out}/s4-harita-masaustu.png`, fullPage: false })

  // Üst üste binen adaylar: Muradiye Medresesi'nin iki adayı 1,4 m arayla en yakın görünümde bile tek grupta kalır.
  const group = page.locator('.research-map .leaflet-marker-icon[title*="üst üste"]').first()
  check('Üst üste binen adaylar grup işaretçisinde', (await group.count()) === 1)
  await group.click()
  const popupList = page.getByRole('list', { name: 'Üst üste binen adaylar' })
  await popupList.waitFor()
  const groupSize = Number((await group.getAttribute('title')).split(' ')[0])
  check('Grup penceresi gruptaki her adayı listeliyor', (await popupList.locator(':scope > li').count()) === groupSize, `${groupSize}`)
  await page.getByRole('button', { name: 'Bu adaylara yakınlaştır' }).click()
  await page.waitForTimeout(800)
  const zoomed = await markerSummary(page)
  check('Yakınlaştırınca da 15 aday erişilebilir', zoomed.count === 15)
  const medrese = page.locator('.research-map .leaflet-marker-icon[title*="üst üste"][title*="Muradiye Medresesi"]')
  if ((await medrese.count()) > 0) {
    await medrese.first().click()
    const items = page.getByRole('list', { name: 'Üst üste binen adaylar' }).locator(':scope > li')
    check('1,4 m arayla çakışan iki Medrese adayı ayrı ayrı seçilebilir',
          (await items.filter({ hasText: 'LC-0005-01' }).count()) === 1 && (await items.filter({ hasText: 'LC-0005-02' }).count()) === 1)
    await items.filter({ hasText: 'LC-0005-02' }).getByRole('button', { name: 'Envanter ayrıntısını aç' }).click()
    await page.getByRole('heading', { level: 2, name: 'Muradiye Medresesi' }).waitFor()
    check('Gruptan seçilen aday envanter ayrıntısını açtı', true)
  } else {
    check('Medrese adayları gruplanmış olmalı', false, zoomed.titles.join(' | '))
  }

  // Cem Sultan: listeden seçilince harita esere yakınlaşır; iki çelişen aday ayrı işaretçi.
  await list.getByRole('button', { name: /BUR-0008/ }).click()
  await page.waitForTimeout(800)
  const cem1 = page.locator('.research-map .leaflet-marker-icon[title*="(LC-0008-01)"]')
  const cem2 = page.locator('.research-map .leaflet-marker-icon[title*="(LC-0008-02)"]')
  check('Cem Sultan: iki aday ayrı işaretçi', (await cem1.count()) === 1 && (await cem2.count()) === 1)
  check('Cem Sultan: ikisi de "çelişen aday"', /çelişen aday/.test(await cem1.getAttribute('title')) && /çelişen aday/.test(await cem2.getAttribute('title')))
  await page.getByRole('heading', { level: 2, name: 'Cem Sultan Türbesi' }).waitFor()
  check('Listeden seçim envanter ayrıntısını açtı', true)
  await region.screenshot({ path: `${out}/s4-cem-sultan.png` })

  // Bedesten: işaretçiye tıklayınca ayrıntı açılır; pencere kullanım alanı/bina ayrımını, kaynağı ve doğruluğu gösterir.
  await list.getByRole('button', { name: /BUR-0014/ }).click()
  await page.waitForTimeout(800)
  await page.locator('.research-map .leaflet-marker-icon[title*="(LC-0014-01)"]').click()
  const popup = page.locator('.research-map .leaflet-popup-content').filter({ hasText: 'LC-0014-01' })
  await popup.waitFor()
  // textContent: büyük harf dönüşümü (CSS) metni değiştirmez.
  const text = await popup.evaluate((e) => e.textContent)
  check('Bedesten: "Kullanım alanı merkezi (bina değil)"', text.includes('Kullanım alanı merkezi (bina değil)'))
  check('Pencere kaynak türü, OSM nesnesi ve doğruluğu gösteriyor',
        text.includes('OpenStreetMap') && text.includes('osm:way/1063228547@v2') && text.includes('±37 m'))
  check('Pencere "Doğrulanmamış konum adayı" diyor', text.includes('Doğrulanmamış konum adayı'))
  check('Eser seçilince başka eserin penceresi açık kalmıyor', (await page.locator('.research-map .leaflet-popup').count()) === 1)
  await page.getByRole('heading', { level: 2, name: 'Yıldırım Bayezid Bedesteni' }).waitFor()
  check('Haritada işaretçi seçimi ayrıntı panelini açtı', true)
  check('Masaüstünde yatay kaydırma yok', await noHorizontalScroll(page))
  check('Harita altlığı', true, tiles.length ? `${tiles.filter((s) => s === 200).length}/${tiles.length} karo yüklendi` : 'karo isteği yok')

  // Yapılandırılmış temel kimlik formu — geçici DB'deki test hesabıyla.
  const bar = page.getByRole('region', { name: 'İncelemeci kimliği' })
  await bar.getByLabel('İncelemeci hesabı').fill('e2e.editor')
  await bar.getByLabel('Kişisel kimlik bilgisi').fill(secret('reviewer_credential'))
  await bar.getByRole('button', { name: 'İncelemeci olarak giriş yap' }).click()
  await bar.getByText('Tarayıcı Testi Editörü (geçici DB)').waitFor()
  await list.getByRole('button', { name: /BUR-0001/ }).click()
  const panel = page.locator('article.review-panel')
  await page.getByRole('heading', { level: 2, name: 'Ulucami' }).waitFor()
  await panel.getByRole('button', { name: 'Eser kimliği ve katalog meta verisinin yayını: karar ver' }).click()
  const form = panel.getByRole('group', { name: /Temel kimlik/ })
  await form.waitFor()
  check('Kimlik formunda JSON alanı yok', (await panel.getByLabel(/JSON/).count()) === 0)
  const formText = await form.innerText()
  check('Form BUR kimliği, tür, il/ilçe gösteriyor', formText.includes('BUR-0001') && formText.includes('cami') && formText.includes('Bursa / Osmangazi'))
  check('Resmî kaynak bağlantısı var', (await form.getByRole('link', { name: 'BURSA ULU CAMİ' }).getAttribute('href')) === 'https://www.kulturportali.gov.tr/turkiye/bursa/gezilecekyer/bursa-ulu-cami')
  check('Tutarsızlık D-0001-01 listeleniyor', formText.includes('D-0001-01'))
  check('Hiçbir seçim önceden yapılmamış', (await form.locator('input:checked').count()) === 0 && (await form.getByLabel('Eser adı (yayında görünecek)').inputValue()) === '')

  // Önce kaynak kitaptaki adresi seç: hak kaydı olmadığı için sunucu reddetmeli.
  await form.getByLabel('Eser adı (yayında görünecek)').selectOption('Bursa Ulu Camii')
  await form.getByRole('radio', { name: /Şehreküstü Mahallesi/ }).check()
  await form.getByRole('checkbox', { name: /S-0001-KP/ }).check()
  await form.getByRole('checkbox', { name: /D-0001-01/ }).check()
  check('Form kaynak kitap hakkı uyarısını gösteriyor', /bursa-envanteri-cilt-1\.pdf/.test(await form.getByRole('list', { name: 'Kimlik onayı için eksikler' }).innerText()))
  await form.screenshot({ path: `${out}/s4-kimlik-formu.png` })
  await panel.getByLabel('Editör kararı').selectOption('approved')
  await panel.getByLabel('Kaynak kontrolü').selectOption('verified_on_page')
  await panel.getByLabel(/Karar gerekçesi/).fill('Tarayıcı testi: Kültür Portalı kaydıyla ad, tür ve adres karşılaştırıldı.')
  const save = panel.getByRole('button', { name: 'Kararı kaydet' })
  await save.and(page.locator(':enabled')).waitFor({ timeout: 8000 })
  await save.click()
  const alert = await panel.getByRole('alert').innerText()
  check('Kaynak kitap adresi hak kaydı olmadan reddedildi', alert.includes('source_usage_rights:bursa-envanteri-cilt-1.pdf'), alert.slice(0, 140))

  // Resmî kaynaktaki adresle yeniden gönder (yeni bilet otomatik açıldı, seçimler korundu).
  await form.getByRole('radio', { name: /PTT/ }).check()
  await save.and(page.locator(':enabled')).waitFor({ timeout: 8000 })
  await save.click()
  const row = panel.getByRole('list', { name: 'BUR-0001 kararları' }).locator('li').filter({ hasText: 'Eser kimliği' })
  await row.getByText('Onaylandı').waitFor()
  check('Resmî kaynakla temel kimlik onayı kaydedildi (geçici DB)', true)
  const preview = await page.request.get(BASE + '/internal/review/publication-preview', { headers: { 'X-Vakifname-Review': '1' } })
  const p = await preview.json()
  check('Yayın önizlemesi: 1 eser kimliği, 0 olgu, 0 görsel, harita/GPS kapalı',
        p.monuments_publishable === 1 && p.facts_publishable === 0 && p.images_publishable === 0 &&
        p.monuments['BUR-0001'].map_display === false && p.monuments['BUR-0001'].gps_checkin === false, JSON.stringify(p).slice(0, 80))
})

scenario('S4-mobil', async ({ browser, check }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await openInventory(page)
  const map = page.locator('.research-map')
  await map.scrollIntoViewIfNeeded()
  const box = await map.boundingBox()
  check('Mobilde harita ekran genişliğine sığıyor', box.width <= 390 && box.width > 300, `${Math.round(box.width)} px`)
  check('Mobilde yatay kaydırma yok', await noHorizontalScroll(page))
  await page.waitForTimeout(600)
  const { count } = await markerSummary(page)
  check('Mobilde 15 aday temsil ediliyor', count === 15)
  check('Mobilde tüm işaretçiler harita kutusu içinde', await page.evaluate(() => {
    const box = document.querySelector('.research-map').getBoundingClientRect()
    return [...document.querySelectorAll('.research-map .leaflet-marker-icon')].every((m) => {
      const r = m.getBoundingClientRect()
      return r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom
    })
  }))
  const group = page.locator('.research-map .leaflet-marker-icon[title*="üst üste"]').first()
  await group.tap()
  const items = page.getByRole('list', { name: 'Üst üste binen adaylar' }).locator(':scope > li')
  await items.first().waitFor()
  const name = (await items.first().locator('strong').first().innerText()).trim()
  await page.screenshot({ path: `${out}/s4-harita-mobil.png`, fullPage: false })
  await items.first().getByRole('button', { name: 'Envanter ayrıntısını aç' }).tap()
  await page.locator('article.review-panel h2').waitFor()
  check('Mobilde dokunarak grup adayından ayrıntı açıldı', (await page.locator('article.review-panel').count()) === 1, name)
  check('Mobilde liste düğmeleri en az 44 px', await page.evaluate(() =>
    [...document.querySelectorAll('.research-monument__open')].every((b) => b.getBoundingClientRect().height >= 44)))
})
