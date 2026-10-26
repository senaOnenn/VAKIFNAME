// Ortak yardımcılar. Playwright bu pakete bağımlılık olarak eklenmedi; `PLAYWRIGHT_MODULE` ile yolu verilir.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')

async function scenario(name, fn) {
  const browser = await chromium.launch()
  const results = []
  const check = (label, ok, extra = '') => results.push({ label, ok: !!ok, extra })
  try {
    await fn({ browser, check })
  } catch (e) {
    results.push({ label: `${name}: beklenmeyen hata`, ok: false, extra: String(e).split('\n').slice(0, Number(process.env.E2E_ERROR_LINES || 1)).join(' | ') })
  } finally {
    await browser.close()
  }
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} [${name}] ${r.label}${r.extra ? ' — ' + r.extra : ''}`)
  if (results.some((r) => !r.ok)) process.exitCode = 1
}

module.exports = { scenario }
