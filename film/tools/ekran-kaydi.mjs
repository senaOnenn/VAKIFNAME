// Tanıtım filmi (sürüm 3) için uygulamanın gerçek ekranlarını kaydeder. Canlıya yazmaz: yerel tanıtım sunucusunu kullanır.
//
// Hazırlık (bir kez):
//   VAKIFNAME_YEDEK_DIR=~/vakifname-film-demo deploy/yedek/esitle.sh        # canlının onaylı içeriği (kişisel veri gelmez)
//   cd backend && set -a && . ~/vakifname-film-demo/yedek.env && set +a
//   .venv/bin/python -m app.account_cli --email zeynep3@ornek.org --name Zeynep < ~/vakifname-film-demo/.tanitim-parola
//   VAKIFNAME_VISIT_SIMULATION=off VAKIFNAME_CORS_ORIGINS=http://localhost:5181 VAKIFNAME_PUBLIC_BASE_URL=http://localhost:5181 \
//     .venv/bin/uvicorn app.main:app --port 8011                              # API (konum gerçek denetlenir; konum taklit edilir)
//   cd frontend && VITE_API_BASE_URL=http://localhost:8011 npx vite --port 5181 --strictPort   # (+ tanıtım sayfası görsel env'leri)
// Kayıt:  VK_EMAIL=zeynep3@ornek.org node film/tools/ekran-kaydi.mjs landing landing2 karakter rota rehber sorular ziyaret defter seviye dil
// Çıktı ~/vakifname-film-demo/kayit/*.png (telefon 390 × 844 @2x, konum Ulu Cami'nin yanı). Kâşif seçimi ilk kez görünsün diye
// her tam kayıtta yeni bir tanıtım hesabı açılır. Playwright: /opt/homebrew/lib/node_modules/playwright (Chrome kanalı).
//   adımlar: giris (her zaman), landing, karakter, rota, rehber, sorular, ziyaret, defter, dil
import { chromium } from '/opt/homebrew/lib/node_modules/playwright/index.mjs'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
const HOME = process.env.HOME
const BASE = 'http://localhost:5181'
const OUT = HOME + '/vakifname-film-demo/kayit'
const EMAIL = process.env.VK_EMAIL ?? 'zeynep2@ornek.org'
const pass = readFileSync(HOME + '/vakifname-film-demo/.tanitim-parola', 'utf8').trim()
const steps = process.argv.slice(2)
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'tr-TR',
  geolocation: { latitude: 40.18381, longitude: 29.06191 }, permissions: ['geolocation'] })
await ctx.addInitScript(() => { try { sessionStorage.setItem('vakifname.introSeen', '1') } catch {} })
const p = await ctx.newPage()
const shot = async (name, opts = {}) => { await p.waitForTimeout(opts.wait ?? 900); await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: !!opts.full }); console.log('✓', name) }
const dump = async (tag) => {
  const items = await p.evaluate(() => [...document.querySelectorAll('button, a[href], input, textarea, [role=radio], [role=tab], h1, h2, h3')].filter((e) => e.offsetParent !== null).map((e) => `${e.tagName.toLowerCase()}${e.type ? '[' + e.type + ']' : ''}: ${(e.getAttribute('aria-label') || e.textContent || e.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 90)}`))
  console.log(`--- ${tag} ${p.url()}\n` + items.filter((x) => !/^a: (Keşfet|Harita|Oyun|Rozetler|İçeriğe geç|VAKIFNAME)$/.test(x)).join('\n'))
}
/** DOM üzerinden tıklama (anlatım çalarken panel sürekli yeniden çizildiği için Playwright tıklaması bekleyip kalıyor). */
const clickText = async (re) => {
  const ok = await p.evaluate((src) => {
    const r = new RegExp(src)
    const el = [...document.querySelectorAll('button, a, [role=tab]')].find((e) => r.test((e.getAttribute('aria-label') || e.textContent || '').trim()))
    if (el) el.click()
    return !!el
  }, re.source)
  if (!ok) throw new Error('tıklanacak öğe yok: ' + re)
}
/** Dokunma noktaları (CSS px, görünen alan): film bu noktalara dokunma halkası koyar. */
const rects = {}
const rect = async (name, loc) => {
  const bb = await loc.boundingBox()
  if (bb) rects[name] = { x: Math.round(bb.x + bb.width / 2), y: Math.round(bb.y + bb.height / 2), w: Math.round(bb.width), h: Math.round(bb.height) }
}
const rectText = async (name, re) => rect(name, p.locator('button, a, [role=radio], label, input').filter({ hasText: re }).first())
const quizItems = () => JSON.parse(execFileSync('python3', ['-c', `import sqlite3;c=sqlite3.connect('${HOME}/vakifname-film-demo/data/progress.sqlite3');print(c.execute('select items from quizzes order by created_at desc limit 1').fetchone()[0])`]).toString())

const STEPS = {
  async landing() {
    await p.goto(BASE + '/')
    await shot('01-landing', { wait: 2500 })
    await shot('01-landing-tam', { full: true, wait: 300 })
  },
  async landing2() {
    await p.goto(BASE + '/')
    await p.waitForTimeout(2500)
    const heads = ['Keşif Bursa', 'Her Eser Bir Hikâye', 'Tarihin Merak', 'Kayıp Vakfiyenin İzinde']
    for (let i = 0; i < heads.length; i++) {
      // Bölüm görünür olana kadar adım adım kaydır (açılış animasyonları görünürlükle tetikleniyor).
      await p.evaluate(async (h) => {
        const el = [...document.querySelectorAll('h2')].find((e) => e.textContent.includes(h))
        if (!el) return
        const target = el.getBoundingClientRect().top + window.scrollY - 70
        for (let y = window.scrollY; y < target; y += 160) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)) }
        window.scrollTo(0, target)
      }, heads[i])
      await shot(`01-landing-${i + 1}`, { wait: 1600 })
    }
  },
  async giris() {
    await p.goto(BASE + '/giris')
    await p.locator('input[type=email]').fill(EMAIL)
    await p.locator('input[type=password]').fill(pass)
    await p.locator('button[type=submit]').click()
    await p.waitForTimeout(2500)
  },
  async karakter() {
    await p.goto(BASE + '/oyun/karakter')
    await shot('03-karakter', { wait: 1500 })
    await rect('03-kadin', p.locator('label, li, article').filter({ hasText: /Kadın kâşif/ }).first())
    await p.getByRole('radio').first().check({ force: true })
    await rectText('03-basla', /Seç ve maceraya başla/)
    await shot('03-karakter-secili', { wait: 500 })
    await p.getByRole('button', { name: /Seç ve maceraya başla/ }).click()
    await shot('03-oda', { wait: 2500 })
  },
  async rota() {
    await p.goto(BASE + '/oyun/sehir')
    await shot('04-sehir', { wait: 1500 })
    await rectText('04-kesfe-basla', /Keşfe başla/)
    await p.goto(BASE + '/oyun/rota/bursa')
    await shot('04-rota', { wait: 2500 })
    await rectText('04-konum', /Konumumu kullan/)
    await p.getByRole('button', { name: /Konumumu kullan/ }).click({ force: true })
    await shot('04-rota-konum', { wait: 3000 })
    await shot('04-rota-tam', { full: true, wait: 300 })
  },
  async rehber() {
    await p.goto(BASE + '/oyun/eser/BUR-0001')
    await shot('05-eser', { wait: 2000 })
    await rectText('05-dinle', /Hikâyeyi dinle/)
    await p.getByRole('button', { name: /Hikâyeyi dinle/ }).click({ force: true })
    await p.waitForTimeout(1200)
    await p.getByRole('button', { name: /^Dinle$/ }).click({ force: true })
    await shot('05-dinliyor', { wait: 5200 })
    await shot('05-dinliyor-2', { wait: 3500 })
    await clickText(/^Duraklat$/).catch(() => {})
    await clickText(/^Rehberle Konuş$/)
    await p.waitForTimeout(1200)
    await dump('rehberle-konus')
    await shot('05-rehber-konus', { wait: 300 })
    const box = p.getByRole('textbox').last()
    await box.fill("Ulu Cami'de kaç kubbe var?")
    await shot('05-rehber-soru', { wait: 400 })
    await rect('05-sor', p.getByRole('button', { name: /^Sor$/ }).last())
    const send = p.getByRole('button', { name: /^Sor$|Gönder/ }).last()
    if (await send.count()) await send.click({ force: true })
    else await box.press('Enter')
    await shot('05-rehber-bekle', { wait: 1800 })
    const before = await p.evaluate(() => document.body.innerText.length)
    for (let i = 0; i < 60; i++) {
      await p.waitForTimeout(2000)
      const busy = await p.evaluate(() => !!document.querySelector('[aria-busy=true]') || /düşünüyor|yazıyor|cevap hazırlanıyor/i.test(document.body.innerText))
      const grown = (await p.evaluate(() => document.body.innerText.length)) > before + 80
      if (grown && !busy) break
    }
    await shot('05-rehber-cevap', { wait: 1500 })
    await dump('rehber-cevap')
  },
  async sorular() {
    await p.goto(BASE + '/oyun/eser/BUR-0001/rozet')
    await p.waitForSelector('[role=radio]', { timeout: 20000 })
    await p.waitForTimeout(1200)
    const items = quizItems()
    console.log('soru türleri:', items.map((q) => (q.statement ? 'tf' : q.images ? 'img' : 'mc')).join(','))
    for (let i = 0; i < items.length; i++) {
      const q = items[i]
      await p.waitForFunction(() => [...document.querySelectorAll('[role=radio]')].some((e) => !e.disabled), null, { timeout: 15000 })
      if (i === 0) await shot('06-soru1', { wait: 2500 })
      const want = i !== 1
      let target
      if (q.statement) target = p.getByRole('radio', { name: (q.answer === 1) === want ? /^Doğru/ : /^Yanlış/ })
      else {
        const n = (q.images ?? q.choices).length
        target = p.getByRole('radio').nth(want ? q.answer : (q.answer + 1) % n)
      }
      if (i < 2) await rect(`06-cevap${i + 1}`, target)
      await target.click({ force: true })
      await p.waitForTimeout(1300)
      if (i === 0) await shot('06-soru1-dogru', { wait: 300 })
      if (i === 1) await shot('06-soru2-yanlis', { wait: 300 })
      await p.getByRole('button', { name: /Sonraki soru|Sonucu gör/ }).click({ force: true })
    }
    await p.evaluate(() => window.scrollTo(0, 0))
    await shot('06-sonuc', { wait: 1500 })
    await shot('06-sonuc-tam', { full: true, wait: 300 })
    await dump('sonuc')
  },
  async ziyaret() {
    await p.goto(BASE + '/oyun/eser/BUR-0001')
    await p.waitForTimeout(2000)
    await p.evaluate(() => [...document.querySelectorAll('h2')].find((h) => /yerinde ziyaret/i.test(h.textContent))?.scrollIntoView({ block: 'center' }))
    await shot('07-ziyaret-once', { wait: 800 })
    await rectText('07-dogrula', /Konumumu doğrula/)
    await clickText(/^Konumumu doğrula$/)
    await shot('07-ziyaret-altin', { wait: 3500 })
    await dump('ziyaret-sonra')
    await shot('07-ziyaret-tam', { full: true, wait: 300 })
  },
  async defter() {
    await p.goto(BASE + '/pasaport')
    await shot('08-defter', { wait: 2500 })
    await shot('08-defter-tam', { full: true, wait: 300 })
  },
  async seviye() {
    await p.goto(BASE + '/oyun')
    await shot('09-oda', { wait: 2500 })
    await dump('oda')
  },
  async dil() {
    await p.goto(BASE + '/oyun/eser/BUR-0001')
    await p.waitForTimeout(2000)
    await rect('10-a11y', p.getByRole('button', { name: /Erişilebilirlik ayarları/ }))
    await rect('10-en', p.getByRole('button', { name: /EN – English/ }))
    await clickText(/^Erişilebilirlik ayarları$/)
    await shot('10-erisilebilirlik', { wait: 1200 })
    await dump('erisilebilirlik')
    await p.keyboard.press('Escape')
    await p.waitForTimeout(500)
    await clickText(/^EN – English$/)
    await shot('10-en-eser', { wait: 2500 })
    await p.goto(BASE + '/oyun/rota/bursa')
    await shot('10-en-rota', { wait: 3000 })
    await clickText(/^TR – Türkçe$/)
    await p.waitForTimeout(800)
  },
}
try {
  await STEPS.giris()
  for (const s of steps) {
    if (s === 'giris') continue
    if (!STEPS[s]) throw new Error('bilinmeyen adım ' + s)
    console.log('## ' + s)
    await STEPS[s]()
  }
} catch (e) {
  console.log('HATA:', e.message.split('\n')[0])
  await dump('hata')
  await p.screenshot({ path: `${OUT}/hata.png` })
}
writeFileSync(OUT + '/dokunma.json', JSON.stringify(rects, null, 1))
await b.close()
