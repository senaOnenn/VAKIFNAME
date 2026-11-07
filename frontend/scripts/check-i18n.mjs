// R6.17 çeviri kapsam denetimi (arayüz katmanı). Kamuya açık uygulamanın kaynak kodundaki her Türkçe dizgi ya
// İngilizce sözlükte (src/app/i18n-en.ts) anahtar olmalı ya da gerekçesi yazılı istisna listesinde
// (scripts/i18n-allow.json: özel ad, yalnızca Türkçe dalda kalan parça vb.) bulunmalıdır. `t('...')` ile çağrılıp
// sözlükte olmayan anahtarlar da raporlanır. Dizgiler TypeScript sözdizimi ağacından okunur (yorumlar sayılmaz).
// Yönetim (`screens/admin`, `AdminPage`), iç inceleme (`src/internal`) ve geliştirme araçları bilinçli olarak
// Türkçedir ve taranmaz. Tarihî içerik bu denetimin konusu değildir: onaylı İngilizce alanlardan gelir
// (bkz. backend/scripts/report_en_coverage.py).
//
//   node scripts/check-i18n.mjs            → özet; eksik varsa çıkış kodu 1
//   node scripts/check-i18n.mjs --json     → ayrıntılı rapor (JSON)
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'src')
const SKIP_DIRS = new Set(['node_modules', 'internal', 'dev', 'test', 'admin'])
const SKIP_FILES = [/\.test\.tsx?$/, /\.d\.ts$/, /^i18n-en\.ts$/, /^AdminPage\.tsx$/, /^App\.tsx$/, /^ModeSwitch\.tsx$/, /^mode\.ts$/]
const TR = /[çğıöşüÇĞİÖŞÜ]/
// Çeviri işlevleri: `t`, `tt` (yerel ad), `tr` (api.ts'teki `t` takma adı), `translate(lang, ...)`.
const T_FUNCS = new Set(['t', 'tt', 'tr'])

export function enKeys() {
  const sf = ts.createSourceFile('i18n-en.ts', readFileSync(join(SRC, 'app', 'i18n-en.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
  const keys = new Set()
  const visit = (n) => {
    if (ts.isPropertyAssignment(n) && (ts.isStringLiteral(n.name) || ts.isIdentifier(n.name))) keys.add(n.name.text)
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return keys
}

function files(dir = SRC, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(f)) files(p, out)
    } else if (/\.tsx?$/.test(f) && !SKIP_FILES.some((r) => r.test(f))) out.push(p)
  }
  return out
}

export function scan() {
  const keys = enKeys()
  const allow = JSON.parse(readFileSync(join(HERE, 'i18n-allow.json'), 'utf8')).strings
  const missingKeys = []
  const untranslated = []
  const list = files()
  for (const path of list) {
    const rel = relative(SRC, path).split('\\').join('/')
    const sf = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true,
      path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const visit = (n) => {
      // t('anahtar', ...) — anahtar sözlükte olmalı.
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && T_FUNCS.has(n.expression.text) && n.arguments[0]
        && (ts.isStringLiteral(n.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(n.arguments[0]))) {
        const k = n.arguments[0].text
        if (!keys.has(k) && !(k in allow)) missingKeys.push({ file: rel, key: k })
      }
      let text = null
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
        // İçe aktarma yolları ve nesne anahtarları ("çeşme": ...) metin değildir.
        if (!ts.isImportDeclaration(n.parent) && !(ts.isPropertyAssignment(n.parent) && n.parent.name === n)) text = n.text
      } else if (ts.isJsxText(n)) text = n.text
      else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) text = n.text
      const v = text?.replace(/\s+/g, ' ').trim()
      if (v && TR.test(v) && !keys.has(v) && !(v in allow)) {
        const { line } = sf.getLineAndCharacterOfPosition(n.getStart())
        untranslated.push({ file: `${rel}:${line + 1}`, text: v })
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }
  return { keys: keys.size, files: list.length, allow: Object.keys(allow).length, missingKeys, untranslated }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = scan()
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 1))
  else {
    console.log(`Sözlük: ${r.keys} anahtar · taranan dosya: ${r.files} · gerekçeli istisna: ${r.allow}`)
    console.log(`t() ile çağrılıp sözlükte olmayan: ${r.missingKeys.length}`)
    for (const m of r.missingKeys) console.log(`  ${m.file}: ${JSON.stringify(m.key)}`)
    console.log(`Çevrilmemiş Türkçe dizgi: ${r.untranslated.length}`)
    for (const m of r.untranslated) console.log(`  ${m.file}: ${JSON.stringify(m.text)}`)
  }
  process.exit(r.missingKeys.length || r.untranslated.length ? 1 : 0)
}
